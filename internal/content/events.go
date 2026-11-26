package content

import (
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Event is something the player did that quests may care about. Kind uses exactly
// the objective vocabulary of proto.ObjectiveDef. Build events with the constructors
// below so every part of the session describes the world the same way.
//
// Target is always the TRUE subject (the real species id even if the player has not
// identified it yet): events never leave the server, and the tracker never copies a
// target into the profile.
type Event struct {
	Kind   string
	Target string
	Params map[string]string
	Count  int // how many to add; 0 means 1
}

// At describes where and when something happened. Every field is optional; an
// objective that filters on a field the event leaves empty simply does not match.
type At struct {
	Region  string // region key, core.RegionID.Key()
	Habitat string // habitat key, core.Habitat.Key()
	Phase   string // day phase key: dawn | morning | midday | afternoon | evening | night
}

// Place builds an At from the contract types.
func Place(region core.RegionID, habitat core.Habitat, phase core.DayPhase) At {
	a := At{Habitat: habitat.Key(), Phase: PhaseKey(phase)}
	if region < core.RegionCount {
		a.Region = region.Key()
	}
	return a
}

// PhaseKey is the lower-case key of a day phase as used by the "phase" parameter.
func PhaseKey(p core.DayPhase) string { return strings.ToLower(p.String()) }

// RarityKey is the lower-case key of a species rarity as used by the "rarity"
// parameter.
func RarityKey(r core.Rarity) string { return strings.ToLower(r.String()) }

func (a At) params(extra ...string) map[string]string {
	m := make(map[string]string, 3+len(extra)/2)
	if a.Region != "" {
		m[ParamRegion] = a.Region
	}
	if a.Habitat != "" {
		m[ParamHabitat] = a.Habitat
	}
	if a.Phase != "" {
		m[ParamPhase] = a.Phase
	}
	for i := 0; i+1 < len(extra); i += 2 {
		if extra[i+1] != "" {
			m[extra[i]] = extra[i+1]
		}
	}
	return m
}

// Heard: a call of speciesID was audible to the player. known says whether the
// player has already identified that species.
func Heard(speciesID string, known bool, at At) Event {
	return Event{Kind: KindHear, Target: speciesID, Params: at.params(paramKnown, strconv.FormatBool(known))}
}

// Observed: the player is watching a bird of speciesID (or has closed to within
// investigating distance of it). behavior is the bird's core.BirdAct key.
func Observed(speciesID, behavior string, at At) Event {
	return Event{Kind: KindObserve, Target: speciesID, Params: at.params(ParamBehavior, behavior)}
}

// Identified: the player has just put the right name to speciesID (certain or
// probable). method is sight | sound | photo | mixed.
func Identified(speciesID, method string, rarity core.Rarity, at At) Event {
	return Event{Kind: KindIdentify, Target: speciesID, Params: at.params(ParamMethod, method, ParamRarity, RarityKey(rarity))}
}

// Photographed: a photo with speciesID as its subject. Do not emit for photos with
// no bird in them (0 stars).
func Photographed(speciesID, behavior string, stars int, at At) Event {
	return Event{Kind: KindPhoto, Target: speciesID, Params: at.params(ParamBehavior, behavior, paramStars, strconv.Itoa(stars))}
}

// Recorded: a usable recording of speciesID was saved.
func Recorded(speciesID string, stars int, at At) Event {
	return Event{Kind: KindRecord, Target: speciesID, Params: at.params(paramStars, strconv.Itoa(stars))}
}

// Discovered: the player discovered the POI poiID of the given core.POI.Kind.
func Discovered(poiID, poiKind string, at At) Event {
	return Event{Kind: KindDiscover, Target: poiID, Params: at.params(paramKind, poiKind)}
}

// Collected: the player picked up the collectible collectibleID (the resolved
// collectible, e.g. "feather_eurasian_jay" or "page_3", not the POI it lay at) of
// kind feather | page | relic.
func Collected(collectibleID, kind string, at At) Event {
	return Event{Kind: KindCollect, Target: collectibleID, Params: at.params(paramKind, kind)}
}

// CacheOpened: the player opened the cache POI poiID. Caches are "collected" in
// quest terms: target the POI id, or kind:cache.
func CacheOpened(poiID string, at At) Event {
	return Event{Kind: KindCollect, Target: poiID, Params: at.params(paramKind, "cache")}
}

// Talked: the player spoke to an NPC.
func Talked(npcID string) Event { return Event{Kind: KindTalk, Target: npcID} }

// Returned: the player arrived back at the cabin.
func Returned() Event { return Event{Kind: KindReturn} }

// Researched: desk research at the cabin. action is study | analyze | submit;
// speciesID is the species concerned ("" if unidentified); what is photo |
// recording for analyze / submit; stars is the rating of the piece (0 for study).
func Researched(action, speciesID, what string, stars int) Event {
	p := map[string]string{}
	if speciesID != "" {
		p[ParamSpecies] = speciesID
	}
	if what != "" {
		p[ParamWhat] = what
	}
	if stars > 0 {
		p[paramStars] = strconv.Itoa(stars)
	}
	return Event{Kind: KindResearch, Target: action, Params: p}
}

// RareFound: a proto.RareDiscovery of the given kind was logged.
func RareFound(rareKind, speciesID string, at At) Event {
	return Event{Kind: KindRare, Target: rareKind, Params: at.params(ParamSpecies, speciesID)}
}
