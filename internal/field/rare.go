package field

import (
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Rare discoveries (spec §11, rule 7; contract §3.3.7).
//
// These helpers decide WHEN something the player did constitutes a rare discovery
// and write its journal text. Each returned proto.RareDiscovery has a stable ID
// that names the discovery itself, so the session logs it at most once: check
// HasRare(journal.Rare, d.ID), then set Day (and Photo) and append it.
//
// Rarity is never announced before the player has earned it: every discovery that
// names a species requires that the player has identified — and, in the field,
// recognised — that species. The one exception is unusual plumage, which is visible
// to anyone: for an unidentified bird it is logged without a species ("a strangely
// pale bird"), keyed by the individual.
//
// RareDiscovery.Rarity: 1 uncommon, 2 rare, 3 epic, 4 legendary.
const (
	RareKindSpecies  = "rare_species"
	RareKindPlumage  = "unusual_plumage"
	RareKindVagrant  = "out_of_range"
	RareKindBehavior = "behavior"
	RareKindPhoto    = "exceptional_photo"

	rareSeenClarity = 0.35 // a rare species counts as seen from this clarity
)

// HasRare reports whether a discovery with this id is already in the journal.
func HasRare(log []*proto.RareDiscovery, id string) bool {
	for _, d := range log {
		if d != nil && d.ID == id {
			return true
		}
	}
	return false
}

// RareFromSighting returns the rare discoveries that observing bird b at the given
// clarity constitutes. known says whether the player knows what they are looking
// at: the species is identified and has been recognised in this sighting
// (proto.Sighting.Known is set). region is where the bird is.
//
//   - rare_species: a Rare / Legendary species seen at clarity >= 0.35 (known only)
//   - out_of_range: a vagrant individual seen at clarity >= 0.35 (known only)
//   - unusual_plumage: a rare-plumage individual seen at clarity >= 0.5
func RareFromSighting(b core.BirdState, sp *core.Species, clarity float32, region core.RegionID, known bool) []proto.RareDiscovery {
	if sp == nil {
		return nil
	}
	var out []proto.RareDiscovery
	if known && clarity >= rareSeenClarity {
		if d, ok := rareSpecies(sp); ok {
			out = append(out, d)
		}
		if b.Flags&core.FlagVagrant != 0 {
			out = append(out, rareVagrant(sp, region))
		}
	}
	if b.Flags&core.FlagRarePlumage != 0 && clarity >= plumageClarity {
		out = append(out, rarePlumage(b.ID, sp, known))
	}
	return out
}

// RareFromIdentification returns the rare discoveries that identifying a species
// constitutes: the species itself if it is Rare / Legendary, and — given the flags
// of the individual(s) the evidence came from — an out-of-range visitor or unusual
// plumage. bird is the individual observed (0 if not known; plumage is then skipped).
func RareFromIdentification(sp *core.Species, bird uint32, flags uint8, region core.RegionID) []proto.RareDiscovery {
	if sp == nil {
		return nil
	}
	var out []proto.RareDiscovery
	if d, ok := rareSpecies(sp); ok {
		out = append(out, d)
	}
	if flags&core.FlagVagrant != 0 {
		out = append(out, rareVagrant(sp, region))
	}
	if flags&core.FlagRarePlumage != 0 && bird != 0 {
		out = append(out, rarePlumage(bird, sp, true))
	}
	return out
}

// RareFromBehavior reports whether watching a species do something is a rare
// discovery: only a behaviour that is both uncommon in general and one of the
// species' own special behaviours (or bathing, courtship, nesting, a dive) counts —
// a robin eating is a nice moment, not a rarity. The caller must only ask for
// species the player has identified and recognised.
func RareFromBehavior(sp *core.Species, act core.BirdAct) (proto.RareDiscovery, bool) {
	if sp == nil || !act.UncommonBehaviour() {
		return proto.RareDiscovery{}, false
	}
	special := contains(sp.Behavior.Specials, act.Key())
	switch act {
	case core.ActBathing, core.ActSocial, core.ActNesting, core.ActDiving:
	default:
		if !special {
			return proto.RareDiscovery{}, false
		}
	}
	var title, text string
	switch act {
	case core.ActBathing:
		title, text = "Bath time", "You watched "+withArticle(sp.Name)+" bathing, flicking water through its feathers."
	case core.ActSocial:
		title, text = "Between birds", "You watched "+withArticle(sp.Name)+" displaying and calling to its own kind."
	case core.ActNesting:
		title, text = "A nest in the making", "You watched "+withArticle(sp.Name)+" carrying material to a hidden nest site."
	case core.ActDiving:
		title, text = "The plunge", "You watched "+withArticle(sp.Name)+" dive for its prey."
	case core.ActHovering:
		title, text = "Hanging on the wind", "You watched "+withArticle(sp.Name)+" hover in place, head perfectly still."
	case core.ActFeeding:
		title, text = "Caught feeding", "You watched "+withArticle(sp.Name)+" feed in the way only its kind does."
	default:
		title, text = "A quiet moment", "You watched "+withArticle(sp.Name)+" "+act.Key()+", unhurried and unaware of you."
	}
	return proto.RareDiscovery{
		ID:   RareKindBehavior + ":" + sp.ID + ":" + act.Key(),
		Kind: RareKindBehavior, Title: title, Text: text, Species: sp.ID, Rarity: 1,
	}, true
}

// RareFromPhoto reports whether a scored photo is an exceptional photograph
// (score >= 90). One is logged per subject species: the id is keyed by the species
// if the player has identified it, otherwise by its mystery (or, failing that, by
// the photo), so nothing about an unidentified bird leaks. The session sets
// RareDiscovery.Photo to the photo id.
func RareFromPhoto(c *Context, s PhotoScore) (proto.RareDiscovery, bool) {
	if s.Meta.Stars == 0 || s.Meta.Score < exceptionalScore || len(s.Birds) == 0 {
		return proto.RareDiscovery{}, false
	}
	sp := c.SpeciesAt(s.Birds[0].Species)
	if sp == nil {
		return proto.RareDiscovery{}, false
	}
	d := proto.RareDiscovery{Kind: RareKindPhoto, Title: "An exceptional photograph", Rarity: 2}
	know := c.know()
	switch {
	case know.Identified(sp.ID):
		d.ID = RareKindPhoto + ":" + sp.ID
		d.Species = sp.ID
		d.Text = "Sharp, close and beautifully lit: a portrait of " + withArticle(sp.Name) + " worth a place on the wall."
		if s.Rare {
			d.Rarity = 3
		}
	default:
		d.Text = "Sharp, close and beautifully lit: a portrait of a bird you have yet to name, worth a place on the wall."
		if m := know.Mystery(sp.ID); m != nil {
			d.ID = RareKindPhoto + ":" + m.ID
		} else {
			d.ID = RareKindPhoto + ":day" + strconv.Itoa(s.Meta.Day) + "@" + strconv.Itoa(roundInt(s.Meta.Time*100))
		}
	}
	return d, true
}

// OutOfRange reports whether a species does not normally live in a region type.
// (The ecosystem's FlagVagrant is the authority for individuals; this is for text
// and for sessions that want to double-check.)
func OutOfRange(sp *core.Species, region core.RegionID) bool {
	return sp != nil && region < core.RegionCount && !livesIn(sp, region)
}

func rareSpecies(sp *core.Species) (proto.RareDiscovery, bool) {
	switch sp.Rarity {
	case core.Rare:
		return proto.RareDiscovery{
			ID: RareKindSpecies + ":" + sp.ID, Kind: RareKindSpecies, Species: sp.ID, Rarity: 2,
			Title: "A rare bird: " + sp.Name,
			Text:  "Few naturalists ever log " + withArticle(sp.Name) + ". The right place, the right hour, and the patience to be there.",
		}, true
	case core.Legendary:
		return proto.RareDiscovery{
			ID: RareKindSpecies + ":" + sp.ID, Kind: RareKindSpecies, Species: sp.ID, Rarity: 4,
			Title: "Once in a lifetime: " + sp.Name,
			Text:  "Most who search for " + withArticle(sp.Name) + " never see one. You did.",
		}, true
	}
	return proto.RareDiscovery{}, false
}

func rareVagrant(sp *core.Species, region core.RegionID) proto.RareDiscovery {
	d := proto.RareDiscovery{
		ID: RareKindVagrant + ":" + sp.ID + ":" + region.Key(), Kind: RareKindVagrant, Species: sp.ID, Rarity: 2,
		Title: "A visitor from afar",
		Text:  capitalise(withArticle(sp.Name)) + " has no business in " + region.Name() + " - blown off course, perhaps, or wandering. A record worth reporting.",
	}
	if region >= core.RegionCount {
		d.Text = capitalise(withArticle(sp.Name)) + " far from where its kind belongs - blown off course, perhaps, or wandering. A record worth reporting."
	}
	if sp.Rarity >= core.Rare {
		d.Rarity = 3
	}
	return d
}

func rarePlumage(bird uint32, sp *core.Species, known bool) proto.RareDiscovery {
	d := proto.RareDiscovery{
		ID: RareKindPlumage + ":" + strconv.FormatUint(uint64(bird), 10), Kind: RareKindPlumage, Rarity: 2,
		Title: "Unusual plumage",
		Text:  "One of the birds here is washed pale, almost white, as if it had been left out in the sun: a leucistic individual. You may never see its like again.",
	}
	if known {
		d.Species = sp.ID
		d.Title = "A pale " + sp.Name
		d.Text = "This " + sp.Name + " is washed pale, almost white: a leucistic individual, one in many thousands."
	}
	return d
}
