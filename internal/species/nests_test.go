package species

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// The nest site of every species follows its real habit (contract §11).
func TestNestSitesFollowRealHabits(t *testing.T) {
	want := map[string]string{
		"european_robin": "cup_shrub", "blue_tit": "cavity", "great_tit": "cavity",
		"common_blackbird": "cup_shrub", "eurasian_wren": "dome", "common_chaffinch": "cup_fork",
		"great_spotted_woodpecker": "cavity", "eurasian_jay": "cup_fork", "eurasian_nuthatch": "cavity",
		"eurasian_treecreeper": "cavity", "tawny_owl": "cavity", "common_buzzard": "platform",
		"song_thrush": "cup_shrub", "goldcrest": "pendant", "long_tailed_tit": "dome",
		"eurasian_blackcap": "cup_shrub", "common_chiffchaff": "dome", "grey_wagtail": "ledge",
		"common_kingfisher": "burrow", "golden_oriole": "cup_fork",
		"mallard": "ground", "common_moorhen": "floating", "grey_heron": "platform",
		"eurasian_reed_warbler": "reed", "eurasian_bittern": "reed", "western_marsh_harrier": "reed",
		"northern_wheatear": "burrow", "common_raven": "platform", "ring_ouzel": "cup_shrub",
		"golden_eagle": "platform", "herring_gull": "ledge", "eurasian_oystercatcher": "scrape",
		"great_cormorant": "ledge", "atlantic_puffin": "burrow", "redwing": "none", "brambling": "none",
		"hawfinch": "cup_fork", "snow_bunting": "ground", "rock_ptarmigan": "scrape", "snowy_owl": "none",
	}
	all := All()
	if len(all) != len(want) {
		t.Fatalf("catalog has %d species, the table %d", len(all), len(want))
	}
	for _, sp := range all {
		w, ok := want[sp.ID]
		if !ok {
			t.Errorf("%s: not in the table", sp.ID)
			continue
		}
		if sp.Nest.Site != w {
			t.Errorf("%s: nest site %q, want %q", sp.ID, sp.Nest.Site, w)
		}
	}
	// A few habits that are easy to get wrong.
	perch := func(id string) string { sp, _ := ByID(id); return sp.Nest.Perches[0] }
	for id, p := range map[string]string{"blue_tit": "cavity", "common_kingfisher": "bank", "eurasian_reed_warbler": "reed",
		"goldcrest": "branch", "common_buzzard": "fork", "golden_eagle": "ledge", "herring_gull": "ledge"} {
		if got := perch(id); got != p {
			t.Errorf("%s: first nest perch %q, want %q", id, got, p)
		}
	}
	if sp, _ := ByID("eurasian_wren"); sp.Nest.HeightMax > 4 {
		t.Errorf("a wren nests low in cover, not %.1f m up", sp.Nest.HeightMax)
	}
	if sp, _ := ByID("common_buzzard"); sp.Nest.HeightMin < 5 || sp.Nest.Size < 0.6 {
		t.Errorf("a buzzard's nest is a big platform high in a tree: %+v", sp.Nest)
	}
}

// Birds that only visit in winter never nest; everyone else nests while present.
func TestNestSeasons(t *testing.T) {
	for _, sp := range All() {
		breedsHere := sp.Seasons[core.Spring] || sp.Seasons[core.Summer]
		if !breedsHere && sp.Nest.Site != "none" {
			t.Errorf("%s: a winter visitor with a nest", sp.ID)
		}
		if breedsHere && sp.Nest.Site == "none" {
			t.Errorf("%s: present in the breeding season but never nests", sp.ID)
		}
		if sp.Nest.Site != "none" && !sp.Nest.Seasons[core.Spring] {
			t.Errorf("%s: nests outside spring only", sp.ID)
		}
		if sp.Nest.Seasons[core.Autumn] || sp.Nest.Seasons[core.Winter] {
			t.Errorf("%s: active nests in autumn or winter", sp.ID)
		}
	}
}

// Facts are short, speakable, varied and not just the journal trivia read out.
func TestFactsSpeakable(t *testing.T) {
	total := 0
	seen := map[string]string{}
	for _, sp := range All() {
		if len(sp.Facts) < MinFacts {
			t.Errorf("%s: %d facts", sp.ID, len(sp.Facts))
		}
		for _, f := range sp.Facts {
			total++
			if o, dup := seen[f]; dup {
				t.Errorf("%s: fact also used for %s: %q", sp.ID, o, f)
			}
			seen[f] = sp.ID
			if strings.Contains(sp.Fact, f) {
				t.Errorf("%s: fact repeats the journal trivia: %q", sp.ID, f)
			}
			for _, bad := range []string{"\n", "  ", "Greenhollow", "Amberwood", "Frostveil", "Windpeak", "Murmur", "Whispering"} {
				if strings.Contains(f, bad) {
					t.Errorf("%s: fact contains %q: %q", sp.ID, bad, f)
				}
			}
		}
	}
	if total < 6*len(All()) {
		t.Errorf("only %d facts", total)
	}
}

// Validate rejects broken nest and fact data.
func TestValidateNestAndFacts(t *testing.T) {
	good := greenhollowSpecies()[0]
	good.Similar = nil // validated alone, without the rest of the catalog
	if errs := Validate([]core.Species{good}); len(errs) != 0 {
		t.Fatalf("robin invalid: %v", errs)
	}
	cases := map[string]func(sp *core.Species){
		"bad site":           func(sp *core.Species) { sp.Nest.Site = "hollow" },
		"no perches":         func(sp *core.Species) { sp.Nest.Perches = nil },
		"bad perch":          func(sp *core.Species) { sp.Nest.Perches = []string{"hedge"} },
		"heights reversed":   func(sp *core.Species) { sp.Nest.HeightMin, sp.Nest.HeightMax = 3, 1 },
		"no season":          func(sp *core.Species) { sp.Nest.Seasons = [4]bool{} },
		"nests while absent": func(sp *core.Species) { sp.Seasons = [4]bool{false, true, true, true} },
		"tiny nest":          func(sp *core.Species) { sp.Nest.Size = 0.01 },
		"no nest desc":       func(sp *core.Species) { sp.Nest.Desc = "" },
		"none with perches":  func(sp *core.Species) { sp.Nest.Site = "none" },
		"too few facts":      func(sp *core.Species) { sp.Facts = sp.Facts[:5] },
		"long fact": func(sp *core.Species) {
			sp.Facts = append([]string{strings.Repeat("word ", 23) + "end."}, sp.Facts[1:]...)
		},
		"two sentences": func(sp *core.Species) {
			sp.Facts = append([]string{"Robins sing. They also fight."}, sp.Facts[1:]...)
		},
		"no full stop":   func(sp *core.Species) { sp.Facts = append([]string{"Robins sing"}, sp.Facts[1:]...) },
		"duplicate fact": func(sp *core.Species) { sp.Facts = append([]string{sp.Facts[1]}, sp.Facts[1:]...) },
	}
	for name, mutate := range cases {
		sp := greenhollowSpecies()[0]
		sp.Similar = nil
		mutate(&sp)
		if errs := Validate([]core.Species{sp}); len(errs) == 0 {
			t.Errorf("%s: not caught", name)
		}
	}
}
