package narrator

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Line is one sentence the narrator can say, exactly as it will be sent in
// proto.Narration.Text.
type Line struct {
	// ID is LineID(Text): the key of the pregenerated voice file (web/voice/<id>.<ext>).
	ID   string `json:"id"`
	Text string `json:"text"`
	// Kind is the pool the sentence comes from ("call.new", "forage.bramble",
	// "sp.european_robin.fact"…): a grouping for tools, not part of the protocol.
	Kind string `json:"kind"`
}

// LineID is the stable id of a spoken sentence: the first 16 hex characters of the
// SHA-256 of its exact UTF-8 text. The client computes the same from Narration.Text.
func LineID(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:8])
}

// AllLines lists every sentence the narrator can ever produce for this species
// catalog (each once, in a stable order): every template filled with every value of
// its closed slot vocabularies, the identified-species lines for every species, and
// every species fact. Anything Offer or Idle returns is in this list (tested), so a
// voice pack generated from it covers the whole game.
func AllLines(species []core.Species) []Line {
	var out []Line
	seen := map[string]bool{}
	add := func(text, kind string) {
		if text == "" || seen[text] {
			return
		}
		seen[text] = true
		out = append(out, Line{ID: LineID(text), Text: text, Kind: kind})
	}

	pools := make([]string, 0, len(bank))
	for k := range bank {
		pools = append(pools, k)
	}
	sort.Strings(pools)

	for _, pool := range pools {
		if len(pool) > 6 && pool[:6] == "shape." {
			// Shape lines are the fallback for identified species without lines of
			// their own (planEvent: sp watch/note first, then shape).
			shape := pool[6:]
			for i := range species {
				sp := &species[i]
				if sp.Traits.Shape != shape || hasOwnWatchLines(sp.ID) {
					continue
				}
				for _, tpl := range bank[pool] {
					expand(tpl, sp, func(t string) { add(t, pool) })
				}
			}
			continue
		}
		for _, tpl := range bank[pool] {
			if usesName(tpl) {
				for i := range species {
					expand(tpl, &species[i], func(t string) { add(t, pool) })
				}
				continue
			}
			expand(tpl, nil, func(t string) { add(t, pool) })
		}
	}
	for i := range species {
		for _, f := range SpeciesFacts(&species[i]) {
			add(f, "sp."+species[i].ID+".fact")
		}
	}
	return out
}

// hasOwnWatchLines reports whether a species has enough watch/note lines that the
// shape fallback can never be reached (pick skips only the line just spoken).
func hasOwnWatchLines(id string) bool {
	return len(bank["sp."+id+".watch"])+len(bank["sp."+id+".note"]) >= 2
}

func usesName(tpl string) bool {
	for _, s := range templateSlots(tpl) {
		if s == "name" || s == "aname" {
			return true
		}
	}
	return false
}

// expand calls emit with every sentence the template can become: the cartesian
// product of its slots' domains ({name}/{aname} from sp), filtered by fill.
func expand(tpl string, sp *core.Species, emit func(string)) {
	names := templateSlots(tpl)
	var keys []string
	var doms [][]string
	seen := map[string]bool{}
	sl := slots{}
	if sp != nil {
		nameSlots(sl, sp)
	}
	for _, k := range names {
		if seen[k] {
			continue
		}
		seen[k] = true
		if k == "name" || k == "aname" {
			if sp == nil {
				return
			}
			continue
		}
		d := slotDomain(k)
		if len(d) == 0 {
			return
		}
		keys = append(keys, k)
		doms = append(doms, d)
	}
	var rec func(i int)
	rec = func(i int) {
		if i == len(keys) {
			if t, ok := fill(tpl, sl); ok {
				emit(t)
			}
			return
		}
		for _, v := range doms[i] {
			sl[keys[i]] = v
			rec(i + 1)
		}
	}
	rec(0)
}
