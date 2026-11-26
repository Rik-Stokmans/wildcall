package world

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func TestSeedFromText(t *testing.T) {
	if SeedFromText("12345") != 12345 || SeedFromText(" -7 ") != -7 {
		t.Fatal("numbers must parse as numbers")
	}
	a, b := SeedFromText("wren song"), SeedFromText("wren song")
	if a != b {
		t.Fatal("text hashing must be deterministic")
	}
	if a == SeedFromText("wren Song") || a == 0 {
		t.Fatal("different text should give different seeds")
	}
}

func TestDeterminism(t *testing.T) {
	a, b, c := New(42), New(42), New(43)
	diff := 0
	for _, k := range [][2]int{{0, 0}, {-1, -1}, {5, -3}, {-40, 22}, {300, -300}} {
		ca, _ := a.Chunk(k[0], k[1], 0)
		cb, _ := b.Chunk(k[0], k[1], 0)
		cc, _ := c.Chunk(k[0], k[1], 0)
		if !bytes.Equal(ca, cb) {
			t.Fatalf("chunk %v differs between identical seeds", k)
		}
		if !bytes.Equal(ca, cc) {
			diff++
		}
	}
	if diff < 4 {
		t.Fatalf("different seeds gave %d identical chunks of 5", 5-diff)
	}
	pa := a.POIsNear(900, -700, 900, nil)
	pb := b.POIsNear(900, -700, 900, nil)
	if !reflect.DeepEqual(pa, pb) {
		t.Fatal("POIs differ between identical seeds")
	}
	ta := a.TrailsNear(900, -700, 900, nil)
	tb := b.TrailsNear(900, -700, 900, nil)
	if !reflect.DeepEqual(ta, tb) {
		t.Fatal("trails differ between identical seeds")
	}
	if reflect.DeepEqual(a.HomePOIs(), c.HomePOIs()) {
		t.Fatal("different seeds gave the same home layout")
	}
	ma, _ := a.MapTile(1, -2)
	mb, _ := b.MapTile(1, -2)
	if !bytes.Equal(ma, mb) {
		t.Fatal("map tiles differ between identical seeds")
	}
}

// regionAtSample is the exact (unblended-by-grid) region at a point.
func regionAtSample(g *gen, x, z float64) (core.RegionID, bool) {
	var s sample
	g.sample(x, z, &s)
	return s.region, s.h > 0
}

func TestRegionCoverage(t *testing.T) {
	good := 0
	for seed := int64(1); seed <= 20; seed++ {
		g := newGen(seed * 104729)
		g.hl = newHomeLayout(g)
		found := map[core.RegionID]bool{}
		land, tot := 0, 0
		var counts [core.RegionCount]int
		for x := -4000.0; x <= 4000; x += 40 {
			for z := -4000.0; z <= 4000; z += 40 {
				r, dry := regionAtSample(g, x, z)
				if x*x+z*z <= 4000*4000 && dry && r < core.RegionCount {
					found[r] = true
				}
				if x >= -3000 && x <= 3000 && z >= -3000 && z <= 3000 {
					tot++
					if dry {
						land++
						if r < core.RegionCount {
							counts[r]++
						}
					}
				}
			}
		}
		if len(found) == int(core.RegionCount) {
			good++
		} else {
			t.Logf("seed %d: only %d region types within 4 km", seed, len(found))
		}
		if f := float64(land) / float64(tot); f < 0.6 || f > 0.9 {
			t.Errorf("seed %d: land fraction %.2f over a 6 km square", seed, f)
		}
	}
	if good < 18 {
		t.Errorf("all six region types within 4 km of home for only %d of 20 seeds", good)
	}
}

// Far from home (no anchors, no home valley) Greenhollow is the most common land
// type and land is about three quarters of the world.
func TestRegionProportions(t *testing.T) {
	var counts [core.RegionCount]float64
	land, tot := 0.0, 0.0
	for seed := int64(1); seed <= 4; seed++ {
		g := newGen(seed)
		g.hl = newHomeLayout(g)
		for x := 20000.0; x < 36000; x += 100 {
			for z := -36000.0; z < -20000; z += 100 {
				r, dry := regionAtSample(g, x, z)
				tot++
				if dry && r < core.RegionCount {
					land++
					counts[r]++
				}
			}
		}
	}
	if f := land / tot; f < 0.68 || f > 0.82 {
		t.Errorf("land fraction %.2f, want ~0.75", f)
	}
	for r := core.RegionID(1); r < core.RegionCount; r++ {
		if counts[r] >= counts[core.RegionGreenhollow] {
			t.Errorf("%s (%.0f) at least as common as Greenhollow (%.0f)", r.Key(), counts[r], counts[core.RegionGreenhollow])
		}
		if counts[r]/land < 0.05 {
			t.Errorf("%s only %.1f%% of land", r.Key(), 100*counts[r]/land)
		}
	}
}

func TestGeneratedPOIs(t *testing.T) {
	for _, seed := range []int64{3, 77, -1234} {
		w := New(seed)
		pois := w.POIsNear(0, 0, 1800, nil)
		kinds := map[string]int{}
		for _, p := range pois {
			if _, pinned := w.home[p.ID]; pinned {
				continue
			}
			kinds[p.Kind]++
			checkGenerated(t, w, seed, p)
		}
		for _, k := range []string{"watchtower", "landmark", "feather", "cache"} {
			if kinds[k] == 0 {
				t.Errorf("seed %d: no generated %s within 1.8 km (%v)", seed, k, kinds)
			}
		}
		// The same POIs come back whatever the query centre.
		for i, p := range pois {
			if i%7 != 0 {
				continue
			}
			got := w.POIsNear(p.Pos.X+30, p.Pos.Z-20, 40, nil)
			found := false
			for _, q := range got {
				if q.ID == p.ID {
					found = reflect.DeepEqual(p, q)
				}
			}
			if !found {
				t.Errorf("seed %d: %s not returned identically from another centre", seed, p.ID)
			}
		}
	}
}

func checkGenerated(t *testing.T, w *World, seed int64, p core.POI) {
	t.Helper()
	q, ok := w.POI(p.ID)
	if !ok || !reflect.DeepEqual(p, q) {
		t.Errorf("seed %d: POI(%q) does not resolve to the same POI", seed, p.ID)
	}
	cx, cz, ok := parseGenID(p.ID)
	if !ok || p.ID != genID(p.Kind, cx, cz) {
		t.Errorf("seed %d: malformed generated id %q", seed, p.ID)
	}
	if cellOf(float64(p.Pos.X)) != cx || cellOf(float64(p.Pos.Z)) != cz {
		t.Errorf("seed %d: %s lies outside its cell", seed, p.ID)
	}
	gh := w.HeightAt(p.Pos.X, p.Pos.Z)
	if p.Kind == "pond" {
		if p.Pos.Y >= 0 || gh >= 0 || !p.Hidden {
			t.Errorf("seed %d: pond %s centre %.2f ground %.2f hidden=%v", seed, p.ID, p.Pos.Y, gh, p.Hidden)
		}
	} else if p.Pos.Y < 0.5 || gh < 0.5 {
		t.Errorf("seed %d: %s (%s) not on land: y %.2f ground %.2f", seed, p.ID, p.Kind, p.Pos.Y, gh)
	}
	if p.Region >= core.RegionCount {
		t.Errorf("seed %d: %s in region %v", seed, p.ID, p.Region)
	}
	if exact, _ := regionAtSample(w.g, float64(p.Pos.X), float64(p.Pos.Z)); exact != p.Region && w.RegionAt(p.Pos.X, p.Pos.Z) != p.Region {
		t.Errorf("seed %d: %s region %s but the ground there is %s", seed, p.ID, p.Region.Key(), exact.Key())
	}
	if p.Name == "" {
		t.Errorf("seed %d: %s has no name", seed, p.ID)
	}
	switch p.Kind {
	case "feather", "cache", "page", "relic":
		if p.Data["region"] != p.Region.Key() || p.Radius != 3 {
			t.Errorf("seed %d: %s data %v radius %v", seed, p.ID, p.Data, p.Radius)
		}
	default:
		if !kindAllowed(p.Region, p.Kind) || !generatedKindFits(p.Region, p.Kind) {
			t.Errorf("seed %d: %s may not stand in %s", seed, p.ID, p.Region.Key())
		}
		if p.Radius != 14 {
			t.Errorf("seed %d: %s radius %v", seed, p.ID, p.Radius)
		}
		switch p.Kind {
		case "hidden_cabin", "viewpoint", "pond":
			if !p.Hidden {
				t.Errorf("seed %d: %s must be hidden", seed, p.ID)
			}
		case "watchtower", "hide", "landmark", "ranger_station":
			if p.Hidden {
				t.Errorf("seed %d: %s must not be hidden", seed, p.ID)
			}
		}
		if p.Kind == "landmark" && p.Data["landmark"] == "" {
			t.Errorf("seed %d: landmark %s without a subtype", seed, p.ID)
		}
	}
	if p.Kind == "hidden_cabin" || p.Kind == "abandoned_station" {
		if _, ok := w.POI(genID("cache", cx, cz)); !ok {
			t.Errorf("seed %d: %s has no cache", seed, p.ID)
		}
	}
}

// generatedKindFits restates contract §2.2's "where" column independently of
// the generator's own table.
func generatedKindFits(r core.RegionID, kind string) bool {
	forest := r == core.RegionGreenhollow || r == core.RegionAmberwood
	switch kind {
	case "watchtower", "landmark", "ranger_station":
		return true
	case "hide":
		return r != core.RegionFrostveil
	case "camp":
		return forest || r == core.RegionWindpeak || r == core.RegionFrostveil
	case "hidden_cabin", "pond":
		return forest
	case "abandoned_station":
		return r == core.RegionMurmurMarsh || r == core.RegionWindpeak || r == core.RegionFrostveil || r == core.RegionWhisperingCoast
	case "viewpoint":
		return r != core.RegionMurmurMarsh
	}
	return false
}

func TestGeneratedTrails(t *testing.T) {
	w := New(5)
	ts := w.TrailsNear(0, 0, 1500, nil)
	gen := 0
	for _, tr := range ts {
		if tr.ID == "main" || len(tr.ID) < 6 || tr.ID[:6] != "trail@" {
			continue
		}
		gen++
		if tr.Name == "" || len(tr.Points) < 2 {
			t.Errorf("trail %s malformed", tr.ID)
		}
		wet := 0
		for i, p := range tr.Points {
			if i > 0 {
				if d := p.DistXZ(tr.Points[i-1]); d > 6.6 {
					t.Errorf("trail %s spacing %.1f", tr.ID, d)
				}
			}
			if w.HeightAt(p.X, p.Z) < -0.6 {
				wet++
			}
		}
		if wet > 0 {
			t.Errorf("trail %s has %d points in deep water", tr.ID, wet)
		}
	}
	if gen < 5 {
		t.Errorf("only %d generated trails within 1.5 km", gen)
	}
}

func TestCoverAndAmbient(t *testing.T) {
	w := New(11)
	// Find a dense woodland spot and an open meadow spot near home.
	var forest, open float32 = -1, -1
	for x := float32(-400); x <= 400 && (forest < 0 || open < 0); x += 7 {
		for z := float32(-400); z <= 400; z += 7 {
			switch w.HabitatAt(x, z) {
			case core.HabWoodland:
				if c := w.Cover(x, z); c > forest {
					forest = c
				}
			case core.HabMeadow:
				if open < 0 {
					open = w.Cover(x, z)
				}
			}
		}
	}
	if forest < 0.6 {
		t.Errorf("densest woodland cover %.2f", forest)
	}
	if open > 0.5 {
		t.Errorf("meadow cover %.2f", open)
	}
	// Far from any water there is no ambient noise; the sea is loud.
	quiet, surf := 0, 0
	for x := float32(-3000); x <= 3000; x += 97 {
		for z := float32(-3000); z <= 3000; z += 89 {
			a := w.AmbientNoise(x, z)
			if a < 0 || a > 1 {
				t.Fatalf("ambient %v out of range", a)
			}
			if a == 0 {
				quiet++
			}
			if a > 0.5 {
				surf++
			}
		}
	}
	if quiet == 0 || surf == 0 {
		t.Errorf("ambient: %d quiet points, %d loud points", quiet, surf)
	}
}
