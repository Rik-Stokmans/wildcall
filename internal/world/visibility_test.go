package world

import (
	"fmt"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Seeing into the wood (the owner's "trees are quite low and the birds are not
// visible"): measuring aids for the crown heights of the tree models and the
// density of the understorey, plus the checks that keep them where they belong.

// crownBase is the height (model space, scale 1) of the lowest foliage and of the
// lowest limb leaving the trunk.
func crownBase(m *treeModel) (leaf, limb float64) {
	leaf, limb = math.Inf(1), math.Inf(1)
	for _, l := range m.leaves {
		leaf = math.Min(leaf, l.c.y-l.r.y)
	}
	for _, s := range m.segs {
		if s.order == 1 {
			limb = math.Min(limb, s.a.y)
		}
	}
	return leaf, limb
}

func TestCrownBaseReport(t *testing.T) {
	initTrees()
	var sb strings.Builder
	for _, k := range []core.VegKind{core.VegOak, core.VegBirch, core.VegPine, core.VegChestnut} {
		fmt.Fprintf(&sb, "%-9s", kindName(k))
		for v := 0; v < core.TreeVariants; v++ {
			m := treeTable[k][v]
			leaf, limb := crownBase(m)
			fmt.Fprintf(&sb, "\n   v%d leaf %.1f limb %.1f (h %.1f, %d segs, %d masses; templates %d canopy %d branch %d tips)", v, leaf, limb, m.height, len(m.segs), len(m.leaves), len(m.canopy), len(m.branch), len(m.tips))
		}
		sb.WriteString("\n")
	}
	t.Logf("crown base (lowest foliage, lowest limb) in metres at scale 1:\n%s", sb.String())
}

func kindName(k core.VegKind) string {
	switch k {
	case core.VegOak:
		return "oak"
	case core.VegBirch:
		return "birch"
	case core.VegPine:
		return "pine"
	case core.VegChestnut:
		return "chestnut"
	}
	return fmt.Sprint(int(k))
}

// woodStats counts the understorey of woodland chunks of one region.
type woodStats struct {
	chunks, shrubs, bushes, trees, youngPines, pines int
}

func woodlandChunks(w *World, reg core.RegionID, n int) [][2]int {
	var out [][2]int
	for r := 0; r < 60 && len(out) < n; r++ {
		for cz := -r; cz <= r && len(out) < n; cz++ {
			for cx := -r; cx <= r && len(out) < n; cx++ {
				if max(abs(cx), abs(cz)) != r {
					continue
				}
				gr := w.grid(cx, cz)
				wood := 0
				for i := range gr.v {
					if core.RegionID(gr.v[i].reg) == reg && core.Habitat(gr.v[i].hab) == core.HabWoodland {
						wood++
					}
				}
				if wood > len(gr.v)*8/10 {
					out = append(out, [2]int{cx, cz})
				}
			}
		}
	}
	return out
}

func measureWood(w *World, chunks [][2]int) woodStats {
	var st woodStats
	for _, c := range chunks {
		st.chunks++
		for _, v := range w.vegetation(c[0], c[1]).veg {
			switch {
			case v.Kind == core.VegShrub:
				st.shrubs++
			case v.Kind == core.VegHazel || v.Kind == core.VegElder || v.Kind == core.VegBramble || v.Kind == core.VegDogRose || v.Kind == core.VegYoungPine:
				st.bushes++
			case v.Kind.IsTree():
				st.trees++
				if treeBase(v.Kind) == core.VegPine {
					st.pines++
					if int(v.Variant)%core.TreeVariants == youngPine || v.Scale < 0.9 {
						st.youngPines++
					}
				}
			}
		}
	}
	return st
}

func TestUnderstoreyReport(t *testing.T) {
	if os.Getenv("WILDCALL_VIS") == "" {
		t.Skip("set WILDCALL_VIS=1 to print the understorey report")
	}
	for _, seed := range []int64{SeedFromText("scenic"), 21} {
		w := New(seed)
		for _, reg := range []core.RegionID{core.RegionGreenhollow, core.RegionAmberwood} {
			st := measureWood(w, woodlandChunks(w, reg, 40))
			n := float64(max(st.chunks, 1))
			t.Logf("seed %d %-12s %d woodland chunks: %.1f shrubs, %.1f forage bushes, %.1f trees (%.1f pines, %.1f young/small) per chunk",
				seed, reg.Key(), st.chunks, float64(st.shrubs)/n, float64(st.bushes)/n, float64(st.trees)/n, float64(st.pines)/n, float64(st.youngPines)/n)
		}
	}
}

// The mature trees of every broadleaf kind carry their crowns clear of head
// height (sight lines under and into the wood), and mature pines are bare to 5 m:
// at most one younger, lower variant per kind.
func TestCrownsAboveHeadHeight(t *testing.T) {
	initTrees()
	floor := map[core.VegKind]float64{core.VegOak: 3.2, core.VegBirch: 3.8, core.VegPine: 5.0, core.VegChestnut: 4.5}
	for k, lo := range floor {
		low := 0
		for v := 0; v < core.TreeVariants; v++ {
			leaf, _ := crownBase(treeTable[k][v])
			if leaf < lo {
				low++
				if leaf < 2.4 {
					t.Errorf("%s/%d: foliage down to %.1f m", kindName(k), v, leaf)
				}
			}
		}
		if low > 1 {
			t.Errorf("%s: %d of %d variants carry foliage below %.1f m", kindName(k), low, core.TreeVariants, lo)
		}
	}
}

// Live trees offer exposed perches on bare outer limb ends: every broadleaf model
// has bare tips and low-cover branch templates.
func TestBareOuterLimbEnds(t *testing.T) {
	initTrees()
	for _, k := range []core.VegKind{core.VegOak, core.VegBirch, core.VegChestnut} {
		for v := 0; v < core.TreeVariants; v++ {
			m := treeTable[k][v]
			open := 0
			for _, b := range m.branch {
				if b.cover < 0.2 {
					open++
				}
			}
			if len(m.tips) == 0 || open < 3 {
				t.Errorf("%s/%d: %d bare tips, %d open branch perches", kindName(k), v, len(m.tips), open)
			}
		}
	}
}
