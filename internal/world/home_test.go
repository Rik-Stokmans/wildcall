package world

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// pinnedHome is contract §2.2's table: id -> kind, name, hidden, data.
var pinnedHome = []struct {
	id, kind, name string
	hidden         bool
	data           map[string]string
}{
	{"cabin", "cabin", "Naturalist Cabin", false, nil},
	{"npc_mara", "npc", "Mara", false, map[string]string{"npc": "mara"}},
	{"woodland_entrance", "landmark", "Woodland Entrance", false, nil},
	{"shop_finn", "shop", "Finn's Field Supply", false, nil},
	{"npc_finn", "npc", "Finn", false, map[string]string{"npc": "finn"}},
	{"old_oak", "landmark", "The Old Oak", false, nil},
	{"creekside", "landmark", "Creekside", false, nil},
	{"research_creekside", "research_site", "Creekside Field Lab", false, nil},
	{"npc_alder", "npc", "Professor Alder", false, map[string]string{"npc": "alder"}},
	{"fern_valley", "landmark", "Fern Valley", false, nil},
	{"meadow_clearing", "landmark", "Meadow Clearing", false, nil},
	{"ranger_station", "ranger_station", "Greenhollow Ranger Station", false, nil},
	{"npc_june", "npc", "June", false, map[string]string{"npc": "june"}},
	{"old_watchtower", "watchtower", "Old Watchtower", false, nil},
	{"hidden_pond", "pond", "Hidden Pond", true, nil},
	{"hide_creek", "hide", "Creek Hide", false, nil},
	{"viewpoint_lookout", "viewpoint", "Lookout Rock", true, nil},
	{"hidden_cabin", "hidden_cabin", "Trapper's Cabin", true, nil},
	{"camp_survey", "camp", "Old Survey Camp", true, nil},
	{"cache_watchtower", "cache", "Weathered Satchel", false, map[string]string{"item": "forgotten_journal"}},
	{"cache_hidden_cabin", "cache", "Dusty Leather Case", false, map[string]string{"item": "historical_binoculars"}},
	{"cache_camp", "cache", "Oilcloth Bundle", false, map[string]string{"item": "vintage_recorder"}},
	{"page_0", "page", "Torn Journal Page", false, map[string]string{"collectible": "page_0"}},
}

// mainTrailPOIs are the places the Greenhollow Trail (with its meadow spur) links.
var mainTrailPOIs = []string{"cabin", "woodland_entrance", "old_oak", "creekside", "ranger_station", "meadow_clearing"}

func distToTrails(ts []core.Trail, x, z float64) float64 {
	best := math.Inf(1)
	for _, t := range ts {
		for i := 0; i+1 < len(t.Points); i++ {
			a, b := t.Points[i], t.Points[i+1]
			if d, _ := distSeg(x, z, float64(a.X), float64(a.Z), float64(b.X), float64(b.Z)); d < best {
				best = d
			}
		}
	}
	return best
}

func homeTrails(w *World, hidden bool) []core.Trail {
	var out []core.Trail
	for _, t := range w.hl.trails {
		if t.Hidden == hidden {
			out = append(out, t)
		}
	}
	return out
}

func TestHomeValley(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		w := New(seed * 7919)
		pois := w.HomePOIs()
		byID := map[string]core.POI{}
		for _, p := range pois {
			if _, dup := byID[p.ID]; dup {
				t.Errorf("seed %d: duplicate home POI %s", seed, p.ID)
			}
			byID[p.ID] = p
		}
		if len(pois) != len(pinnedHome) {
			t.Errorf("seed %d: %d home POIs, want %d", seed, len(pois), len(pinnedHome))
		}
		visible := homeTrails(w, false)
		for _, want := range pinnedHome {
			p, ok := byID[want.id]
			if !ok {
				t.Errorf("seed %d: missing %s", seed, want.id)
				continue
			}
			if p.Kind != want.kind || p.Name != want.name || p.Hidden != want.hidden {
				t.Errorf("seed %d: %s = %s/%q/hidden=%v, want %s/%q/%v", seed, want.id, p.Kind, p.Name, p.Hidden, want.kind, want.name, want.hidden)
			}
			if len(p.Data) != len(want.data) {
				t.Errorf("seed %d: %s data %v, want %v", seed, want.id, p.Data, want.data)
			}
			for k, v := range want.data {
				if p.Data[k] != v {
					t.Errorf("seed %d: %s data %v, want %v", seed, want.id, p.Data, want.data)
				}
			}
			x, z := float64(p.Pos.X), float64(p.Pos.Z)
			if d := hypot(x, z); d > core.HomeRadius {
				t.Errorf("seed %d: %s is %.0f m from the origin", seed, p.ID, d)
			}
			if r := w.RegionAt(p.Pos.X, p.Pos.Z); r != core.RegionGreenhollow || p.Region != core.RegionGreenhollow {
				t.Errorf("seed %d: %s region %v / %v", seed, p.ID, r, p.Region)
			}
			gh := w.HeightAt(p.Pos.X, p.Pos.Z)
			if want.id == "hidden_pond" {
				if p.Pos.Y >= 0 || gh >= 0 {
					t.Errorf("seed %d: hidden pond centre at %.2f (ground %.2f), want under water", seed, p.Pos.Y, gh)
				}
			} else {
				if p.Pos.Y < 0.8 || gh < 0.8 {
					t.Errorf("seed %d: %s at y %.2f (ground %.2f), want dry land", seed, p.ID, p.Pos.Y, gh)
				}
				if math.Abs(float64(p.Pos.Y-gh)) > 0.35 {
					t.Errorf("seed %d: %s y %.2f but ground %.2f", seed, p.ID, p.Pos.Y, gh)
				}
			}
			if p.Hidden {
				if d := distToTrails(visible, x, z); d < 60 {
					t.Errorf("seed %d: hidden %s only %.0f m from the main trail", seed, p.ID, d)
				}
			}
			wantR := float32(14)
			if p.Kind == "npc" || p.Kind == "cache" || p.Kind == "page" {
				wantR = 3
			}
			if p.Radius != wantR {
				t.Errorf("seed %d: %s radius %v", seed, p.ID, p.Radius)
			}
		}
		for _, id := range mainTrailPOIs {
			p := byID[id]
			if d := distToTrails(visible, float64(p.Pos.X), float64(p.Pos.Z)); d > 20 {
				t.Errorf("seed %d: %s is %.0f m from the Greenhollow Trail", seed, id, d)
			}
		}
		cabin := byID["cabin"]
		if d := hypot(float64(cabin.Pos.X), float64(cabin.Pos.Z)); d > 60 {
			t.Errorf("seed %d: cabin %.0f m from the origin", seed, d)
		}
		if d := cabin.Pos.DistXZ(byID["woodland_entrance"].Pos); d < 90 || d > 150 {
			t.Errorf("seed %d: woodland entrance %.0f m from the cabin, want ~120", seed, d)
		}
		if d := byID["shop_finn"].Pos.DistXZ(byID["woodland_entrance"].Pos); d > 15 {
			t.Errorf("seed %d: Finn's stall %.0f m from the entrance", seed, d)
		}
		checkMainTrail(t, w, seed, byID)
		checkSpawn(t, w, seed, cabin, byID["woodland_entrance"])
		checkCreek(t, w, seed, byID)
		checkOldOak(t, w, seed, byID["old_oak"])
	}
}

// checkMainTrail: points every ~6 m, never under water except at the creek crossing.
func checkMainTrail(t *testing.T, w *World, seed int64, byID map[string]core.POI) {
	t.Helper()
	cs := byID["creekside"]
	found := false
	for _, tr := range w.hl.trails {
		if tr.ID == "main" {
			found = true
			if tr.Name != "Greenhollow Trail" || tr.Hidden {
				t.Errorf("seed %d: main trail %q hidden=%v", seed, tr.Name, tr.Hidden)
			}
		}
		for i, p := range tr.Points {
			if i > 0 {
				if d := p.DistXZ(tr.Points[i-1]); d > 6.6 || d < 1.5 {
					t.Errorf("seed %d: trail %s point spacing %.1f m", seed, tr.ID, d)
				}
			}
			if tr.Hidden {
				continue
			}
			h := w.HeightAt(p.X, p.Z)
			// The crossing: the ford and its banks, within 25 m of Creekside.
			if h < 0.05 && p.DistXZ(cs.Pos) > 25 {
				t.Errorf("seed %d: trail %s under water (%.2f) at %.0f,%.0f", seed, tr.ID, h, p.X, p.Z)
			}
		}
	}
	if !found {
		t.Errorf("seed %d: no main trail", seed)
	}
	for _, id := range []string{"secret_pond", "secret_cabin", "secret_lookout", "secret_camp"} {
		ok := false
		for _, tr := range w.hl.trails {
			ok = ok || (tr.ID == id && tr.Hidden && len(tr.Points) >= 2)
		}
		if !ok {
			t.Errorf("seed %d: hidden trail %s missing", seed, id)
		}
	}
}

func checkSpawn(t *testing.T, w *World, seed int64, cabin, entrance core.POI) {
	t.Helper()
	pos, yaw := w.Spawn()
	if d := pos.DistXZ(cabin.Pos); d < 5 || d > 16 {
		t.Errorf("seed %d: spawn %.1f m from the cabin", seed, d)
	}
	if h := w.HeightAt(pos.X, pos.Z); h < 0.8 || math.Abs(float64(h-pos.Y)) > 0.2 {
		t.Errorf("seed %d: spawn y %.2f, ground %.2f", seed, pos.Y, h)
	}
	want := core.HeadingTo(pos, entrance.Pos)
	diff := math.Abs(math.Remainder(float64(yaw-want), 2*math.Pi))
	if diff > 0.6 {
		t.Errorf("seed %d: spawn faces %.2f, entrance is at %.2f", seed, yaw, want)
	}
}

// checkCreek: the main trail crosses water at Creekside (the creek exists there)
// and stepping stones stand in it.
func checkCreek(t *testing.T, w *World, seed int64, byID map[string]core.POI) {
	t.Helper()
	cs := byID["creekside"]
	wet := 0
	for _, tr := range w.hl.trails {
		if tr.ID != "main" {
			continue
		}
		for i := 0; i+1 < len(tr.Points); i++ {
			a, b := tr.Points[i], tr.Points[i+1]
			for k := 0; k <= 6; k++ {
				f := float32(k) / 6
				x, z := a.X+(b.X-a.X)*f, a.Z+(b.Z-a.Z)*f
				if w.HeightAt(x, z) < 0 {
					wet++
				}
			}
		}
	}
	if wet == 0 {
		t.Errorf("seed %d: the main trail never crosses the creek", seed)
	}
	stones := 0
	for _, v := range w.hl.special {
		if v.Kind == core.VegRock && v.Pos.DistXZ(cs.Pos) < 20 {
			stones++
		}
	}
	if stones < 3 {
		t.Errorf("seed %d: %d stepping stones at Creekside", seed, stones)
	}
	// Running water is audible at Creekside.
	if a := w.AmbientNoise(cs.Pos.X, cs.Pos.Z); a < 0.2 || a > 0.55 {
		t.Errorf("seed %d: creek ambient %.2f at Creekside", seed, a)
	}
}

func checkOldOak(t *testing.T, w *World, seed int64, oak core.POI) {
	t.Helper()
	cx, cz := chunkOf(float64(oak.Pos.X)), chunkOf(float64(oak.Pos.Z))
	vs := w.vegetation(cx, cz)
	for _, v := range vs.veg {
		if v.Kind == core.VegOak && v.Scale >= 2.4 && v.Pos.DistXZ(oak.Pos) < 1 {
			return
		}
	}
	t.Errorf("seed %d: no giant oak at the Old Oak", seed)
}
