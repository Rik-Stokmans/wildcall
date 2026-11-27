package game

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestPreGridSaveIsRepacked: a version-2 save (stacks without positions, unlimited
// storage stacks) loads into valid grids with every unit kept, the surplus in
// storage, and is written back in the current format.
func TestPreGridSaveIsRepacked(t *testing.T) {
	js := `{"version":2,"seed":5,"profile":{"name":"Old Hand","level":4,"rank":2,
		"inventory":[{"item":"headphones","qty":1},{"item":"field_stool","qty":1},{"item":"film_roll","qty":6},
			{"item":"film_roll","qty":3},{"item":"tripod","qty":1},{"item":"explorer_binoculars","qty":1},
			{"item":"pocket_guide","qty":1},{"item":"blackberry","qty":7},{"item":"seed_mix","qty":8}],
		"storage":[{"item":"oats","qty":45},{"item":"spotting_scope","qty":1}],
		"equipped":{"optics":"basic_binoculars","camera":"starter_camera","backpack":"canvas_satchel"}}}`
	want := map[string]int{"headphones": 1, "field_stool": 1, "film_roll": 9, "tripod": 1, "explorer_binoculars": 1,
		"pocket_guide": 1, "blackberry": 7, "seed_mix": 8, "oats": 45, "spotting_scope": 1}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "save.json"), []byte(js), 0o644); err != nil {
		t.Fatal(err)
	}
	s := newSession(t, dir, "", true)
	s.Attach(&capture{})
	s.Handle(proto.CHello, []byte(`{"name":"x"}`))
	p := s.p
	if p.Name != "Old Hand" {
		t.Fatalf("the save did not load: %q", p.Name)
	}
	if !progress.PackGrid(p).Valid() || !progress.StorageGrid(p).Valid() {
		t.Fatalf("grids invalid:\n%+v\n%+v", p.Inventory, p.Storage)
	}
	for id, n := range want {
		if got := progress.Carried(p, id) + progress.Stored(p, id); got != n {
			t.Errorf("%s: %d, want %d", id, got, n)
		}
	}
	if len(p.Storage) < 4 {
		t.Errorf("27 cells of things cannot all fit a 20-cell satchel: storage %+v", p.Storage)
	}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "save.json"))
	if !strings.Contains(string(raw), `"version": 3`) && !strings.Contains(string(raw), `"version":3`) || !strings.Contains(string(raw), `"x":`) {
		t.Errorf("not rewritten in the grid format")
	}
}
