package world

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func checkPerches(t *testing.T, w *World, cx, cz int) map[core.PerchKind]int {
	t.Helper()
	counts := map[core.PerchKind]int{}
	for _, p := range w.chunkPerches(cx, cz) {
		counts[p.Kind]++
		g := w.HeightAt(p.Pos.X, p.Pos.Z)
		if p.Cover < 0 || p.Cover > 1 {
			t.Fatalf("perch cover %v", p.Cover)
		}
		if p.Kind == core.PerchWater {
			if p.Pos.Y != 0 || g > 0.05 {
				t.Errorf("water perch at y %.2f over ground %.2f", p.Pos.Y, g)
			}
			continue
		}
		if p.Pos.Y < g-0.02 {
			t.Errorf("%s perch at %.2f below the ground %.2f (%.1f,%.1f)", p.Kind.Key(), p.Pos.Y, g, p.Pos.X, p.Pos.Z)
		}
		if p.Pos.Y < 0 {
			t.Errorf("%s perch under water at %.2f", p.Kind.Key(), p.Pos.Y)
		}
		switch p.Kind {
		case core.PerchCanopy:
			if p.Cover < 0.6 || p.Cover > 0.9 {
				t.Errorf("canopy cover %.2f", p.Cover)
			}
		case core.PerchBranch:
			if p.Cover < 0.1 || p.Cover > 0.35 {
				t.Errorf("branch cover %.2f", p.Cover)
			}
		case core.PerchShrub:
			if p.Cover < 0.5 || p.Cover > 0.8 {
				t.Errorf("shrub cover %.2f", p.Cover)
			}
		case core.PerchReed:
			if p.Cover < 0.5 || p.Cover > 0.7 {
				t.Errorf("reed cover %.2f", p.Cover)
			}
		case core.PerchGround:
			if p.Cover > 0.3 {
				t.Errorf("ground cover %.2f", p.Cover)
			}
		case core.PerchSnag:
			if p.Cover != 0 {
				t.Errorf("snag cover %.2f", p.Cover)
			}
		}
	}
	return counts
}

func TestPerches(t *testing.T) {
	w := New(13)
	total := map[core.PerchKind]int{}
	for cz := -6; cz <= 6; cz++ {
		for cx := -6; cx <= 6; cx++ {
			for k, n := range checkPerches(t, w, cx, cz) {
				total[k] += n
			}
		}
	}
	for _, reg := range []core.RegionID{core.RegionMurmurMarsh, core.RegionWhisperingCoast, core.RegionWindpeak, core.RegionFrostveil} {
		if cx, cz, ok := findChunk(w, reg, nil); ok {
			for k, n := range checkPerches(t, w, cx, cz) {
				total[k] += n
			}
		}
	}
	// Open sea far out.
	if cx, cz, ok := findSea(w); ok {
		for k, n := range checkPerches(t, w, cx, cz) {
			total[k] += n
		}
	}
	for k := core.PerchKind(0); k < core.PerchKindCount; k++ {
		if total[k] == 0 {
			t.Errorf("no %s perches anywhere (%v)", k.Key(), total)
		}
	}
}

func findSea(w *World) (int, int, bool) {
	var s sample
	for r := 10; r < 120; r++ {
		for cx := -r; cx <= r; cx += 2 {
			for _, cz := range []int{-r, r} {
				w.g.sample(float64(cx*64+32), float64(cz*64+32), &s)
				if s.region == core.RegionNone && s.h < -8 {
					return cx, cz, true
				}
			}
		}
	}
	return 0, 0, false
}

func TestPerchesNearMatchesBruteForce(t *testing.T) {
	w := New(2)
	for _, q := range [][3]float32{{10, -20, 35}, {-130, 77, 64}, {0, 0, 5}, {200, 210, 140}} {
		got := w.PerchesNear(q[0], q[1], q[2], nil)
		want := 0
		for cz := chunkOf(float64(q[1]-q[2])) - 1; cz <= chunkOf(float64(q[1]+q[2]))+1; cz++ {
			for cx := chunkOf(float64(q[0]-q[2])) - 1; cx <= chunkOf(float64(q[0]+q[2]))+1; cx++ {
				for _, p := range w.chunkPerches(cx, cz) {
					if math.Hypot(float64(p.Pos.X-q[0]), float64(p.Pos.Z-q[1])) <= float64(q[2]) {
						want++
					}
				}
			}
		}
		if len(got) != want {
			t.Errorf("PerchesNear%v = %d perches, brute force %d", q, len(got), want)
		}
		for _, p := range got {
			if math.Hypot(float64(p.Pos.X-q[0]), float64(p.Pos.Z-q[1])) > float64(q[2])+1e-3 {
				t.Errorf("perch outside the radius")
			}
		}
	}
}

func TestOcclusion(t *testing.T) {
	w := New(6)
	// A mountain ridge: two low points either side of a high one.
	found := false
	for _, a := range w.g.anchors {
		if a.kind != core.RegionWindpeak || found {
			continue
		}
		for r := 0.0; r < a.r && !found; r += 23 {
			for ang := 0.0; ang < 2*math.Pi && !found; ang += 0.4 {
				x, z := float32(a.x+r*math.Cos(ang)), float32(a.z+r*math.Sin(ang))
				h := w.HeightAt(x, z)
				for _, d := range [][2]float32{{90, 0}, {0, 90}, {64, 64}, {64, -64}} {
					h1 := w.HeightAt(x-d[0], z-d[1])
					h2 := w.HeightAt(x+d[0], z+d[1])
					if h-h1 > 35 && h-h2 > 35 {
						from := core.Vec3{X: x - d[0], Y: h1 + 1.65, Z: z - d[1]}
						to := core.Vec3{X: x + d[0], Y: h2 + 1.65, Z: z + d[1]}
						if o := w.Occlusion(from, to); o != 1 {
							t.Errorf("ridge at %.0f,%.0f (%.0f m above both ends): occlusion %.2f", x, z, h-max(h1, h2), o)
						}
						found = true
						break
					}
				}
			}
		}
	}
	if !found {
		t.Error("no ridge found to test")
	}
	// Open water at short range is clear.
	cx, cz, ok := findSea(w)
	if !ok {
		t.Fatal("no sea found")
	}
	x, z := float32(cx*64+10), float32(cz*64+10)
	if o := w.Occlusion(core.Vec3{X: x, Y: 1.5, Z: z}, core.Vec3{X: x + 40, Y: 0.3, Z: z + 25}); o != 0 {
		t.Errorf("open water occlusion %.2f", o)
	}
	// Through dense canopy the line is partly blocked, never fully.
	best := float32(0)
	for cz := -4; cz <= 4; cz++ {
		for cx := -4; cx <= 4; cx++ {
			for _, p := range w.chunkPerches(cx, cz) {
				if p.Kind != core.PerchCanopy {
					continue
				}
				g := w.HeightAt(p.Pos.X+30, p.Pos.Z)
				o := w.Occlusion(core.Vec3{X: p.Pos.X + 30, Y: g + 1.65, Z: p.Pos.Z}, p.Pos)
				if o > best {
					best = o
				}
				if o > 0.95 && o < 1 {
					t.Fatalf("foliage occlusion %.3f above 0.95", o)
				}
			}
		}
	}
	if best < 0.3 {
		t.Errorf("a bird inside a crown is never well hidden (best %.2f)", best)
	}
}

func TestChordFraction(t *testing.T) {
	f := foliage{x: 0, y: 5, z: 0, rx: 2, ry: 3, occ: 0.35}
	if c := chordFraction(&f, -10, 5, 0, 20, 0, 0); math.Abs(c-1) > 1e-9 {
		t.Errorf("centre pass %.3f, want 1", c)
	}
	if c := chordFraction(&f, -10, 5, 1.9, 20, 0, 0); c <= 0 || c > 0.5 {
		t.Errorf("grazing pass %.3f", c)
	}
	if c := chordFraction(&f, 0, 5, 0, 10, 0, 0); math.Abs(c-0.5) > 1e-9 {
		t.Errorf("from the centre outwards %.3f, want 0.5", c)
	}
	if c := chordFraction(&f, -10, 9, 0, 20, 0, 0); c != 0 {
		t.Errorf("miss above %.3f", c)
	}
}
