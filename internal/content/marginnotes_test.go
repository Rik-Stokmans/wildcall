package content

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/species"
)

func TestMarginNotesCoverTheCatalogExactly(t *testing.T) {
	notes := MarginNotes()
	cat := species.All()
	if len(cat) == 0 {
		t.Fatal("empty species catalog")
	}
	want := map[string]bool{}
	for _, sp := range cat {
		if want[sp.ID] {
			t.Errorf("duplicate catalog id %s", sp.ID)
		}
		want[sp.ID] = true
		if strings.TrimSpace(notes[sp.ID]) == "" {
			t.Errorf("%s has no margin note", sp.ID)
		}
	}
	for id := range notes {
		if !want[id] {
			t.Errorf("margin note for %q, which is not in the catalog", id)
		}
	}
	if len(notes) != len(cat) {
		t.Errorf("%d notes for %d species", len(notes), len(cat))
	}
	// The pinned list and the catalog agree, so the notes cover both.
	for _, id := range pinnedSpecies {
		if _, ok := notes[id]; !ok {
			t.Errorf("pinned species %s has no note", id)
		}
	}
}

func TestMarginNotesAreShortHandwrittenAndDiscreet(t *testing.T) {
	cat := species.All()
	for id, n := range MarginNotes() {
		if l := len(n); l < 100 || l > 280 {
			t.Errorf("%s: note is %d characters: %q", id, l, n)
		}
		if strings.Count(n, ". ")+strings.Count(n, ": ")+1 > 9 {
			t.Errorf("%s: note runs long: %q", id, n)
		}
		low := strings.ToLower(n)
		// A note shows only once its own bird is identified: it may name that bird,
		// never another one.
		for _, sp := range cat {
			if sp.ID == id {
				continue
			}
			if strings.Contains(low, strings.ToLower(sp.Name)) || strings.Contains(low, strings.ReplaceAll(sp.ID, "_", " ")) {
				t.Errorf("%s: note names another species (%s): %q", id, sp.Name, n)
			}
		}
		// No coordinates, no numbers that read like a map reference.
		for _, bad := range []string{" x=", " z=", "°", "metres north", "metres east", "km "} {
			if strings.Contains(low, bad) {
				t.Errorf("%s: note reads like a coordinate (%q): %q", id, bad, n)
			}
		}
	}
	// MarginNotes returns a copy: callers cannot edit the source.
	a := MarginNotes()
	a["european_robin"] = "x"
	if MarginNotes()["european_robin"] == "x" {
		t.Error("MarginNotes shares its map")
	}
}

// Every note that speaks of a season or a place agrees with the catalog: a bird away
// in winter is not placed there in winter, and a note naming a habitat region (marsh,
// coast, mountains, Amberwood, the white north) belongs to a bird that lives there.
func TestMarginNotesAgreeWithTheSpeciesData(t *testing.T) {
	notes := MarginNotes()
	for _, sp := range species.All() {
		n := strings.ToLower(notes[sp.ID])
		regions := map[string]bool{}
		for _, r := range sp.Regions {
			regions[r.Name()] = true
		}
		check := func(word, region string) {
			if strings.Contains(n, word) && !regions[region] {
				t.Errorf("%s: note mentions %q but the bird is not in %s", sp.ID, word, region)
			}
		}
		check("amberwood", "Amberwood")
		check("white north", "Frostveil")
		check("reedbed", "Murmur Marsh")
		check("creekside", "Greenhollow Woods")
		check("cabin", "Greenhollow Woods")
		if !sp.Seasons[3] && (strings.Contains(n, "all year") || strings.Contains(n, "dec.") || strings.Contains(n, "jan.")) {
			t.Errorf("%s: away in winter but the note says otherwise: %q", sp.ID, n)
		}
		if sp.Seasons[3] && !sp.Seasons[0] && !strings.Contains(n, "winter") {
			t.Errorf("%s: a winter visitor whose note never says winter: %q", sp.ID, n)
		}
	}
}
