package field

import "github.com/Rik-Stokmans/wildcall/internal/core"

// Evidence values are stored raw, in the vocabulary of core.Traits / core.Call /
// core.Habitat.Key() / core.BirdAct.Key(), so the client can compare them with the
// species data in the field guide. The helpers here turn them into display text
// and classify them.

var evidenceLabels = map[string]string{
	"size":      "Size",
	"shape":     "Shape",
	"primary":   "Main colour",
	"secondary": "Second colour",
	"marking":   "Field mark",
	"bill":      "Bill",
	"flight":    "Flight",
	"behavior":  "Behaviour",
	"pitch":     "Pitch",
	"pattern":   "Call pattern",
	"habitat":   "Habitat",
}

// EvidenceLabel is the player-facing name of an evidence key ("Field mark").
func EvidenceLabel(key string) string {
	if l, ok := evidenceLabels[key]; ok {
		return l
	}
	return capitalise(key)
}

// EvidenceText is the player-facing phrase for an evidence value: habitat keys
// become their label ("woodland" → "Woodland canopy"), everything else is
// capitalised vocabulary ("very high" → "Very high", "feeding" → "Feeding").
func EvidenceText(key, value string) string {
	if key == "habitat" {
		if h, ok := core.HabitatFromKey(value); ok {
			return h.Label()
		}
	}
	return capitalise(value)
}

// EvidenceCount is the number of recognised evidence keys with a value: what the
// session compares with MinEvidence before accepting an identification.
func EvidenceCount(evidence map[string]string) int {
	n := 0
	for _, k := range core.EvidenceKeys {
		if evidence[k] != "" {
			n++
		}
	}
	return n
}

// IDMethod classifies how an identification was reached from its evidence, in the
// vocabulary of proto.SpeciesEntry.Method and the "identify" quest objective:
// "sound" if only heard (pitch / pattern), "sight" if only seen, "mixed" if both.
// Habitat counts for neither. With no evidence it is "sight".
func IDMethod(evidence map[string]string) string {
	var seen, heard bool
	for _, k := range core.EvidenceKeys {
		if evidence[k] == "" {
			continue
		}
		switch k {
		case "pitch", "pattern":
			heard = true
		case "habitat":
		default:
			seen = true
		}
	}
	switch {
	case seen && heard:
		return "mixed"
	case heard:
		return "sound"
	}
	return "sight"
}
