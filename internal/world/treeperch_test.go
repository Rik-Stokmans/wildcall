package world

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// treeInstancesNear lists the tree instances of the chunks around (cx, cz).
func treeInstancesNear(w *World, cx, cz int) []core.Veg {
	var out []core.Veg
	for dz := -1; dz <= 1; dz++ {
		for dx := -1; dx <= 1; dx++ {
			for _, v := range w.vegetation(cx+dx, cz+dz).veg {
				if v.Kind.IsTree() {
					out = append(out, v)
				}
			}
		}
	}
	return out
}

// onTree reports whether world point p lies on the surface of a tree instance's
// drawn wood (within tol metres), and which kind of tree.
func onTree(trees []core.Veg, p core.Vec3, tol float64) (core.VegKind, bool) {
	wp := v3{float64(p.X), float64(p.Y), float64(p.Z)}
	for i := range trees {
		v := &trees[i]
		if p.DistXZ(v.Pos) > 20*v.Scale {
			continue
		}
		x := instanceXform(v)
		m := treeModelFor(v.Kind, v.Variant)
		if sd := m.surfaceDist(x.inverse(wp)) * x.k; math.Abs(sd) <= tol {
			return v.Kind, true
		}
	}
	return 0, false
}

// Every tree perch lies on the wood the client draws: a bird at a branch perch
// stands on that branch.
func TestTreePerchesOnTheModel(t *testing.T) {
	w := New(21)
	chunks := [][2]int{}
	for cz := -3; cz <= 3; cz++ {
		for cx := -3; cx <= 3; cx++ {
			chunks = append(chunks, [2]int{cx, cz})
		}
	}
	for _, reg := range []core.RegionID{core.RegionAmberwood, core.RegionFrostveil, core.RegionMurmurMarsh, core.RegionWindpeak} {
		if cx, cz, ok := findChunk(w, reg, nil); ok {
			chunks = append(chunks, [2]int{cx, cz}, [2]int{cx + 1, cz})
		}
	}
	counts := map[core.PerchKind]int{}
	var trees, eligible, withCavity int
	for _, c := range chunks {
		near := treeInstancesNear(w, c[0], c[1])
		for _, v := range w.vegetation(c[0], c[1]).veg {
			if v.Kind.IsTree() {
				trees++
				if cavityKind(v.Kind) {
					eligible++
				}
			}
		}
		var logs []core.Vec3
		for _, v := range w.vegetation(c[0], c[1]).veg {
			if v.Kind == core.VegLog || v.Kind == core.VegStump {
				logs = append(logs, v.Pos)
			}
		}
		for _, p := range w.chunkPerches(c[0], c[1]) {
			switch p.Kind {
			case core.PerchBranch, core.PerchCanopy, core.PerchFork, core.PerchCavity, core.PerchTrunk, core.PerchSnag:
			default:
				continue
			}
			counts[p.Kind]++
			kind, ok := onTree(near, p.Pos, 0.03)
			if !ok && p.Kind == core.PerchSnag {
				for _, l := range logs {
					if p.Pos.DistXZ(l) < 0.05 {
						ok = true
					}
				}
				if ok {
					continue
				}
			}
			if !ok {
				t.Errorf("%s perch at %.2f,%.2f,%.2f is not on any drawn tree", p.Kind.Key(), p.Pos.X, p.Pos.Y, p.Pos.Z)
				continue
			}
			switch p.Kind {
			case core.PerchCavity:
				withCavity++
				if !cavityKind(kind) {
					t.Errorf("cavity in a %v", kind)
				}
				if g := w.HeightAt(p.Pos.X, p.Pos.Z); p.Pos.Y-g < cavityMinY-0.5 || p.Pos.Y-g > cavityMaxY+1 {
					t.Errorf("cavity %.1f m above the ground", p.Pos.Y-g)
				}
			case core.PerchCanopy:
				if p.Cover < 0.6 || p.Cover > 0.9 {
					t.Errorf("canopy cover %.2f", p.Cover)
				}
			case core.PerchBranch:
				if p.Cover < 0.1 || p.Cover > 0.35 {
					t.Errorf("branch cover %.2f", p.Cover)
				}
			}
		}
	}
	t.Logf("%d trees (%d cavity kinds), perches %v, cavities in %.0f%% of eligible trees", trees, eligible, counts, 100*float64(withCavity)/float64(max(eligible, 1)))
	for _, k := range []core.PerchKind{core.PerchBranch, core.PerchCanopy, core.PerchFork, core.PerchCavity, core.PerchTrunk, core.PerchSnag} {
		if counts[k] == 0 {
			t.Errorf("no %s perches on trees", k.Key())
		}
	}
	if f := float64(withCavity) / float64(eligible); f < 0.1 || f > 0.35 {
		t.Errorf("cavities in %.0f%% of eligible trees, want roughly one in five", f*100)
	}
}

// Every model offers each kind of perch it should, and each template sits on
// its own wood.
func TestTreePerchTemplates(t *testing.T) {
	initTrees()
	for _, k := range treeKinds {
		for v := 0; v < core.TreeVariants; v++ {
			m := treeTable[k][v]
			snag := treeBase(k) == core.VegSnag
			if !snag && (len(m.canopy) < 3 || len(m.branch) == 0) {
				t.Errorf("%v/%d: %d canopy, %d branch templates", k, v, len(m.canopy), len(m.branch))
			}
			if snag && len(m.tips) == 0 {
				t.Errorf("%v/%d: a snag without bare tips", k, v)
			}
			if len(m.trunk) == 0 {
				t.Errorf("%v/%d: no trunk templates", k, v)
			}
			if cavityKind(k) && treeBase(k) != core.VegBirch && len(m.cavity) == 0 {
				t.Errorf("%v/%d: no cavity templates", k, v)
			}
			all := [][]perchTmpl{m.canopy, m.branch, m.trunk, m.fork, m.cavity, m.tips, {m.top}}
			for _, list := range all {
				for _, p := range list {
					if sd := m.surfaceDist(p.p); math.Abs(sd) > 0.012 {
						t.Errorf("%v/%d: %s template %.3f m off the wood", k, v, p.kind.Key(), sd)
					}
				}
			}
		}
	}
}

// The instance transform matches the client's matrix and inverts exactly.
func TestInstanceXform(t *testing.T) {
	v := core.Veg{Pos: core.Vec3{X: 10, Y: 3, Z: -4}, Scale: 1.5, Rot: quantRot(1.1)}
	x := instanceXform(&v)
	p := v3{1, 2, 0}
	got := x.apply(p)
	// three.js rotation.y = rot maps the local +X axis to (cos, 0, -sin).
	c, s := math.Cos(float64(v.Rot)), math.Sin(float64(v.Rot))
	want := v3{10 + 1.5*c, 3 + 3, -4 - 1.5*s}
	if got.sub(want).len() > 1e-9 {
		t.Fatalf("apply %+v, want %+v", got, want)
	}
	if back := x.inverse(got); back.sub(p).len() > 1e-9 {
		t.Fatalf("inverse %+v, want %+v", back, p)
	}
	// Rotations survive the 16-bit wire encoding unchanged.
	for _, a := range []float64{0, 0.8, 3.14159, 6.2, -1} {
		q := quantRot(a)
		enc := math.Round(math.Mod(float64(q), 2*math.Pi) / (2 * math.Pi) * 65535)
		if float32(enc/65535*2*math.Pi) != q && !(enc == 0 && q == 0) {
			t.Errorf("rotation %.3f -> %v is not a wire value", a, q)
		}
	}
}

// Perches never lie further outside their chunk than PerchesNear looks.
func TestPerchOverhang(t *testing.T) {
	w := New(3)
	for cz := -4; cz <= 4; cz++ {
		for cx := -4; cx <= 4; cx++ {
			for _, p := range w.chunkPerches(cx, cz) {
				x0, z0 := float32(cx*64), float32(cz*64)
				if p.Pos.X < x0-perchOverhang || p.Pos.X > x0+64+perchOverhang || p.Pos.Z < z0-perchOverhang || p.Pos.Z > z0+64+perchOverhang {
					t.Fatalf("perch at %.1f,%.1f is beyond the overhang of chunk %d,%d", p.Pos.X, p.Pos.Z, cx, cz)
				}
			}
		}
	}
}

// Banks sit on steep earth just above nearby water; ledges on cliff faces in
// the highlands and on the coast.
func TestBankAndLedgePerches(t *testing.T) {
	w := New(13)
	banks, ledges := 0, 0
	check := func(cx, cz int) {
		for _, p := range w.chunkPerches(cx, cz) {
			switch p.Kind {
			case core.PerchBank:
				banks++
				g := w.HeightAt(p.Pos.X, p.Pos.Z)
				if p.Pos.Y < 0.4-0.06 || p.Pos.Y > 2.06 || math.Abs(float64(p.Pos.Y-g)) > 0.1 {
					t.Errorf("bank perch at %.2f (ground %.2f)", p.Pos.Y, g)
				}
				wet := false
				for a := 0.0; a < 2*math.Pi && !wet; a += math.Pi / 8 {
					for d := float32(1); d <= 6 && !wet; d++ {
						wet = w.HeightAt(p.Pos.X+d*float32(math.Sin(a)), p.Pos.Z+d*float32(math.Cos(a))) < -0.05
					}
				}
				if !wet {
					t.Errorf("bank perch at %.0f,%.0f with no water within 6 m", p.Pos.X, p.Pos.Z)
				}
				if h := w.HabitatAt(p.Pos.X, p.Pos.Z); h == core.HabBeach || h == core.HabCliff || h == core.HabSnow {
					t.Errorf("bank perch on %s", h.Key())
				}
			case core.PerchLedge:
				ledges++
				if r := w.RegionAt(p.Pos.X, p.Pos.Z); r != core.RegionWindpeak && r != core.RegionWhisperingCoast {
					t.Errorf("ledge perch in %s", r.Key())
				}
			}
		}
	}
	// The home creek and the rivers beyond.
	for cz := -7; cz <= 7; cz++ {
		for cx := -7; cx <= 7; cx++ {
			check(cx, cz)
		}
	}
	if banks == 0 {
		t.Error("no bank perches along the home valley's waters")
	}
	for _, reg := range []core.RegionID{core.RegionWindpeak, core.RegionWhisperingCoast} {
		before := ledges
		cx, cz, ok := findChunk(w, reg, func(s *sample) bool { return reg != core.RegionWindpeak || s.h > 90 })
		if reg == core.RegionWhisperingCoast {
			cx, cz, ok = findChunk(w, reg, func(s *sample) bool { return s.cliffy > 0.6 && s.seaDist < 40 && s.seaDist > -30 })
		}
		if !ok {
			t.Errorf("no %s chunk found", reg.Key())
			continue
		}
		for dz := -2; dz <= 2; dz++ {
			for dx := -2; dx <= 2; dx++ {
				check(cx+dx, cz+dz)
			}
		}
		if ledges == before {
			t.Errorf("no ledge perches around %s chunk %d,%d", reg.Key(), cx, cz)
		}
	}
	t.Logf("%d bank and %d ledge perches", banks, ledges)
}
