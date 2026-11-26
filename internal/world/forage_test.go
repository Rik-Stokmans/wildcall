package world

import (
	"fmt"
	"math"
	"reflect"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// The home valley offers the everyday plants within 400 m of the cabin in every
// world.
func TestForageHomeValley(t *testing.T) {
	need := []core.VegKind{core.VegBramble, core.VegStrawberry, core.VegElder, core.VegHazel, core.VegNettle,
		core.VegWildGarlic, core.VegWaterMint, core.VegChamomile, core.VegYoungPine, core.VegChanterelle}
	for seed := int64(1); seed <= 20; seed++ {
		w := New(seed * 7919)
		cabin, _ := w.POI("cabin")
		got := map[core.VegKind]int{}
		for _, f := range w.ForageNear(cabin.Pos.X, cabin.Pos.Z, 400) {
			got[f.Veg.Kind]++
		}
		for _, k := range need {
			if got[k] == 0 {
				t.Errorf("seed %d: no %v within 400 m of the cabin (%v)", seed*7919, k, got)
			}
		}
		if seed == 1 {
			t.Logf("seed %d, within 400 m of the cabin: %v", seed*7919, got)
		}
	}
}

// Plants grow only where their kind belongs, never on trails, pads or water, and
// at a gentle density.
func TestForagePlacement(t *testing.T) {
	w := New(4)
	var trailPts []core.Vec3
	for _, tr := range w.hl.trails {
		trailPts = append(trailPts, tr.Points...)
	}
	var chunks [][2]int
	for cz := -7; cz <= 7; cz++ {
		for cx := -7; cx <= 7; cx++ {
			chunks = append(chunks, [2]int{cx, cz})
		}
	}
	beach := func(s *sample) bool { return s.seaDist > 5 && s.seaDist < 40 && s.cliffy < 0.2 }
	for _, c := range []struct {
		reg core.RegionID
		ok  func(*sample) bool
	}{{core.RegionAmberwood, nil}, {core.RegionMurmurMarsh, nil}, {core.RegionWindpeak, nil}, {core.RegionWhisperingCoast, nil}, {core.RegionWhisperingCoast, beach}, {core.RegionFrostveil, nil}} {
		reg := c.reg
		cx, cz, ok := findChunk(w, reg, c.ok)
		if !ok {
			t.Fatalf("no %s chunk", reg.Key())
		}
		for dz := -3; dz <= 3; dz++ {
			for dx := -3; dx <= 3; dx++ {
				chunks = append(chunks, [2]int{cx + dx, cz + dz})
			}
		}
	}
	kinds := map[core.VegKind]int{}
	empty, suitable, inSuitable, most := 0, 0, 0, 0
	for _, c := range chunks {
		n := 0
		for i, v := range w.vegetation(c[0], c[1]).veg {
			if !isForage(v.Kind) {
				continue
			}
			n++
			kinds[v.Kind]++
			reg, hab := w.RegionAt(v.Pos.X, v.Pos.Z), w.HabitatAt(v.Pos.X, v.Pos.Z)
			if !forageAllowed(v.Kind, reg, hab) {
				t.Errorf("%v in %s/%s at %.0f,%.0f", v.Kind, reg.Key(), hab.Key(), v.Pos.X, v.Pos.Z)
			}
			if g := w.HeightAt(v.Pos.X, v.Pos.Z); g < 0.05 || math.Abs(float64(v.Pos.Y-g)) > 0.01 {
				t.Errorf("%v at height %.2f over ground %.2f", v.Kind, v.Pos.Y, g)
			}
			gr, fx, fz := w.gridAt(float64(v.Pos.X), float64(v.Pos.Z))
			if gv := &gr.v[gr.nearest(fx, fz)]; gv.trail > 0 || gv.keep > 0.2 || gv.htrail > 0.05 {
				t.Errorf("%v on a trail or pad at %.0f,%.0f", v.Kind, v.Pos.X, v.Pos.Z)
			}
			for _, p := range trailPts {
				if v.Pos.DistXZ(p) < 2 {
					t.Errorf("%v %.1f m from a home trail", v.Kind, v.Pos.DistXZ(p))
					break
				}
			}
			if v.Scale <= 0 || v.Variant >= 252 {
				t.Errorf("bad record %+v", v)
			}
			if id := ForageID(c[0], c[1], i); true {
				got, ok := w.ForageAt(id)
				if !ok || got != v {
					t.Errorf("ForageAt(%q) = %+v %v, want %+v", id, got, ok, v)
				}
			}
		}
		if n == 0 {
			empty++
		} else {
			suitable++
			inSuitable += n
			most = max(most, n)
		}
	}
	t.Logf("%d chunks: %d without forage, %.1f plants per chunk that has some (max %d); kinds %v",
		len(chunks), empty, float64(inSuitable)/float64(max(suitable, 1)), most, kinds)
	if empty < len(chunks)/5 {
		t.Errorf("forage in almost every chunk (%d of %d empty): a carpet, not a find", empty, len(chunks))
	}
	if avg := float64(inSuitable) / float64(max(suitable, 1)); avg < 2 || avg > 8 {
		t.Errorf("%.1f plants per chunk with forage, want 2..8", avg)
	}
	for k := core.FirstForageKind; k < core.VegKindCount; k++ {
		if kinds[k] == 0 {
			t.Errorf("no %v anywhere in the sampled regions", k)
		}
	}
}

func TestForageIDs(t *testing.T) {
	w1, w2 := New(31), New(31)
	cabin, _ := w1.POI("cabin")
	a := w1.ForageNear(cabin.Pos.X, cabin.Pos.Z, 250)
	// Build the second world's chunks in a different order: ids must not care.
	for cz := 5; cz >= -5; cz-- {
		for cx := 5; cx >= -5; cx-- {
			w2.vegetation(cx, cz)
		}
	}
	b := w2.ForageNear(cabin.Pos.X, cabin.Pos.Z, 250)
	if len(a) == 0 || !reflect.DeepEqual(a, b) {
		t.Fatalf("forage differs between runs (%d vs %d plants)", len(a), len(b))
	}
	for _, f := range a {
		v, ok := w2.ForageAt(f.ID)
		if !ok || v != f.Veg {
			t.Fatalf("ForageAt(%q) = %+v %v, want %+v", f.ID, v, ok, f.Veg)
		}
	}
	for _, bad := range []string{"", "fg@", "fg@1,2", "fg@1,2,x", "fg@0,0,-1", "fg@0,0,99999", "fg@+0,0,1", "fg@0,0,1 ", "xx@0,0,1", "fg@0,0,01"} {
		if _, ok := w1.ForageAt(bad); ok {
			t.Errorf("ForageAt(%q) accepted", bad)
		}
	}
	// A record that is not a forage plant is not a forage id.
	if _, ok := w1.ForageAt(ForageID(0, 0, 0)); ok && !isForage(w1.vegetation(0, 0).veg[0].Kind) {
		t.Error("ForageAt resolved a non-forage record")
	}
}

// Forage plants travel at LOD 0 and 1 (chestnut trees at every LOD), with the
// same records.
func TestForageInLODs(t *testing.T) {
	w := New(4)
	cabin, _ := w.POI("cabin")
	seen := 0
	for _, f := range w.ForageNear(cabin.Pos.X, cabin.Pos.Z, 300) {
		var cx, cz, n int
		parseID(t, f.ID, &cx, &cz, &n)
		l0 := chunkAt(t, w, cx, cz, 0)
		if l0.veg[n] != f.Veg {
			t.Fatalf("%s: LOD-0 record %d is %+v, want %+v", f.ID, n, l0.veg[n], f.Veg)
		}
		in := func(lod int) bool {
			for _, v := range chunkAt(t, w, cx, cz, lod).veg {
				if v == f.Veg {
					return true
				}
			}
			return false
		}
		if !in(1) {
			t.Fatalf("%s missing at LOD 1", f.ID)
		}
		if in(2) != f.Veg.Kind.IsTree() {
			t.Fatalf("%s (%v) at LOD 2: %v", f.ID, f.Veg.Kind, in(2))
		}
		seen++
	}
	if seen == 0 {
		t.Fatal("no forage near home")
	}
}

func parseID(t *testing.T, id string, cx, cz, n *int) {
	t.Helper()
	var a, b, c int
	if _, err := fmt.Sscanf(id, "fg@%d,%d,%d", &a, &b, &c); err != nil {
		t.Fatalf("bad id %q", id)
	}
	*cx, *cz, *n = a, b, c
}
