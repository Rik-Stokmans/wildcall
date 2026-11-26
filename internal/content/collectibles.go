package content

import (
	"hash/fnv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Collectible sets (proto.CollectibleDef.Set).
const (
	SetFeathers = "Feathers"
	SetJournal  = "The Forgotten Field Journal"
	SetRelics   = "Relics"
	SetBadges   = "Badges"
)

// Counts of the fixed collectibles.
const (
	PageCount  = 8 // page_0 .. page_7
	RelicCount = 6 // relic_0 .. relic_5
)

// FeatherID is the collectible id of a species' feather.
func FeatherID(speciesID string) string { return "feather_" + speciesID }

// featherParts are the kinds of feather a bird can leave behind. Which one a species
// leaves is fixed by its id, so each feather has its own name.
var featherParts = []struct{ name, note string }{
	{"Wing Covert", "Short and soft, from the shoulder of the wing. It holds the colour of the bird better than any other small feather."},
	{"Tail Feather", "Stiff and straight, shed in the late summer moult. How long it is and how it is shaped says a lot about how the bird flies."},
	{"Primary Feather", "A long flight feather from the edge of the wing. The vane is narrower on the leading side, which is what makes it quiet in the air."},
	{"Breast Feather", "Soft and loosely barbed, from the body. It is made for warmth and not for flight."},
	{"Flank Feather", "A small body feather from the side. Faint markings that are hard to see on the living bird show up clearly on it."},
	{"Secondary Feather", "From the inner wing. It carries the pattern that shows when the bird opens its wing to fly."},
	{"Scapular", "A feather from the shoulder, where the wing meets the back. It folds over the wing at rest."},
	{"Nape Feather", "From the back of the neck. Fine and light, it is the first to be lost when a bird bathes."},
}

// shortName drops the geographic prefix of a species name for feather names:
// "Eurasian Jay" gives "Jay".
func shortName(name string) string {
	for _, p := range []string{"Eurasian ", "European ", "Common ", "Northern ", "Western ", "Atlantic "} {
		if strings.HasPrefix(name, p) {
			return strings.TrimPrefix(name, p)
		}
	}
	return name
}

// collectibleRarity maps species rarity onto the 0..4 item rarity scale: Common 0,
// Uncommon 1, Rare 3, Legendary 4.
func collectibleRarity(r core.Rarity) int {
	switch r {
	case core.Uncommon:
		return proto.RarityUncommon
	case core.Rare:
		return proto.RarityEpic
	case core.Legendary:
		return proto.RarityLegendary
	}
	return proto.RarityCommon
}

func hashString(s string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(s))
	return h.Sum32()
}

// Collectibles returns every collectible: one feather per species (in catalog
// order), the eight pages of the Forgotten Field Journal, the six relics, and the
// badges quests and region discoveries award. POI is empty on all of them: the
// session decides which collectible a found feather / page / relic POI yields.
//
// A feather's Name contains its species' name ("Jay Wing Covert"). The session should
// show the generic "Unidentified feather" in the collection screen until the species
// has been identified.
func Collectibles(species []core.Species) []proto.CollectibleDef {
	out := make([]proto.CollectibleDef, 0, len(species)+PageCount+RelicCount+24)
	for i := range species {
		sp := &species[i]
		part := featherParts[hashString(sp.ID)%uint32(len(featherParts))]
		out = append(out, proto.CollectibleDef{
			ID: FeatherID(sp.ID), Kind: "feather", Set: SetFeathers,
			Name:   shortName(sp.Name) + " " + part.name,
			Desc:   "A " + strings.ToLower(part.name) + " shed by a " + sp.Name + ".",
			Text:   part.note + " Compare it with the field guide once you know whose it is.",
			Rarity: collectibleRarity(sp.Rarity), Icon: "feather",
		})
	}
	for i, pg := range pages {
		out = append(out, proto.CollectibleDef{
			ID: pageID(i), Kind: "page", Set: SetJournal, Name: pg.title,
			Desc:   "A page from an earlier naturalist's field diary.",
			Text:   pg.text,
			Rarity: pageRarity(i), Icon: "page",
		})
	}
	for i, r := range relics {
		out = append(out, proto.CollectibleDef{
			ID: relicID(i), Kind: "relic", Set: SetRelics, Name: r.name,
			Desc: r.desc, Text: r.text, Rarity: r.rarity, Icon: "relic",
		})
	}
	for _, b := range badges() {
		out = append(out, b)
	}
	return out
}

func pageID(i int) string  { return "page_" + string(rune('0'+i)) }
func relicID(i int) string { return "relic_" + string(rune('0'+i)) }

func pageRarity(i int) int {
	if i < 4 {
		return proto.RarityUncommon
	}
	return proto.RarityRare
}

var relics = [RelicCount]struct {
	name, desc, text string
	rarity           int
}{
	{"Weathered Ring Tag", "A tiny aluminium bird band, its number almost rubbed away.",
		"Someone caught a bird, fitted this to its leg and let it go. Somewhere, years later, the band came off, or the bird did. A ring is a question asked of a bird: where will you go, and will anyone find out?", proto.RarityUncommon},
	{"Boxwood Bird Whistle", "A small turned pipe, polished by a thumb.",
		"A call whistle, made to imitate one particular bird. They were once used to lure birds in close. A bird called in is a bird interrupted, but the carving is lovely.", proto.RarityUncommon},
	{"Smoke-Blackened Lens", "A thick glass disc with a sooty rim.",
		"The glass from a storm lamp. Whoever kept the light here kept it for a long time, and the soot has dried in the shape of a thumbprint.", proto.RarityRare},
	{"Pressed Fern Plate", "A fern frond pressed flat between two sheets of card.",
		"A pressed plant with a date and a place written in a careful hand. It is the sort of record that lasts for a hundred years if nobody opens the box.", proto.RarityUncommon},
	{"Brass Survey Pin", "A heavy brass marker with a numbered head.",
		"Hammered into the ground to mark where a survey line began. The number on the head is the same as one in the old survey notes, and with a little luck, a naturalist's notes too.", proto.RarityRare},
	{"Carved Wooden Decoy", "A palm-sized bird, carved and painted by hand.",
		"A decoy, shaped so exactly that it is hard to believe it was made by eye. Whoever carved it had watched the real bird for years, and the wear on its back says someone held it just as often.", proto.RarityEpic},
}

// questBadges are the badges quest rewards name. They live in this list so that every
// Reward.Badge resolves to a collectible.
var questBadges = []struct{ id, name, desc string }{
	{"badge_first_song", "First Song", "You tracked down your first unseen singer."},
	{"badge_perfect_moment", "A Perfect Moment", "A bird caught in the act of feeding."},
	{"badge_far_traveller", "Far Traveller", "You documented a bird a long way from home."},
	{"badge_harrows_heir", "Harrow's Heir", "You repeated Edith Harrow's records."},
	{"badge_pathfinder", "Pathfinder", "You found the places that no trail visits."},
	{"badge_dawn_counter", "Dawn Counter", "You counted the voices of the dawn chorus."},
	{"badge_golden_flute", "The Golden Flute", "You heard what Harrow heard in the crown."},
	{"badge_voice_of_the_reeds", "Voice of the Reeds", "You recorded the boom across the marsh."},
	{"badge_white_on_white", "White on White", "You wrote the first page about Frostveil in forty years."},
}

// RegionBadgeID is the badge awarded for first entering a region type (the Region
// Discovery screen). Greenhollow has none: everybody starts there.
func RegionBadgeID(r core.RegionID) string { return "badge_region_" + r.Key() }

func badges() []proto.CollectibleDef {
	var out []proto.CollectibleDef
	for _, b := range questBadges {
		out = append(out, proto.CollectibleDef{
			ID: b.id, Kind: "badge", Set: SetBadges, Name: b.name, Desc: b.desc,
			Text: b.desc, Rarity: proto.RarityUncommon, Icon: "badge",
		})
	}
	for r := core.RegionID(1); r < core.RegionCount; r++ {
		out = append(out, proto.CollectibleDef{
			ID: RegionBadgeID(r), Kind: "badge", Set: SetBadges, Name: r.Name() + " Explorer",
			Desc: "You are the first of your kind to walk into " + r.Name() + ".",
			Text: "You are the first of your kind to walk into " + r.Name() + ".", Rarity: proto.RarityCommon, Icon: "badge",
		})
	}
	return out
}

// ---------------------------------------------------------------------------
// Caches

// CacheLoot returns the ordered unique items a cache in the given region type yields
// (contract §3.5): the session gives the first one the player does not own yet.
func CacheLoot(regionKey string) []string {
	switch regionKey {
	case "murmur_marsh":
		return []string{itemLens}
	case "windpeak":
		return []string{itemCompass}
	case "whispering_coast":
		return []string{itemBackpack}
	}
	return []string{}
}

// Find is the modest contents of a cache with nothing unique left to give.
type Find struct {
	Items   []string // supplies, one of each entry (film_roll / seed_mix)
	Credits int      // Field Credits
	Lore    string   // a Natural History entry id, or ""
}

// ModestFind returns what an ordinary cache holds when it has no unique item for the
// player: a supply or two, some credits, and sometimes a lore entry the player does
// not know yet. It is a pure function of the cache's POI id, so reopening a save
// cannot reroll it. knownLore is Profile.Journal.Lore.
func ModestFind(poiID string, knownLore []string) Find {
	h := hashString(poiID)
	f := Find{Credits: 20 + int(h%5)*10}
	if h&1 == 0 {
		f.Items = []string{itemFilm}
	} else {
		f.Items = []string{itemSeed}
	}
	if (h>>3)%3 == 0 {
		f.Items = append(f.Items, itemSeed)
	}
	if (h>>5)%2 == 0 {
		for i := 0; i < len(cacheLore); i++ {
			id := cacheLore[(int(h>>8)+i)%len(cacheLore)]
			if !oneOf(id, knownLore...) {
				f.Lore = id
				break
			}
		}
	}
	return f
}
