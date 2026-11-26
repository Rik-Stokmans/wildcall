package world

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func TestTreeModelsCompleteAndDeterministic(t *testing.T) {
	ms := TreeModels()
	if len(ms) != len(treeKinds)*core.TreeVariants {
		t.Fatalf("%d models, want %d", len(ms), len(treeKinds)*core.TreeVariants)
	}
	seen := map[[2]int]bool{}
	for _, m := range ms {
		if !core.VegKind(m.Kind).IsTree() || m.Variant < 0 || m.Variant >= core.TreeVariants {
			t.Fatalf("bad model kind %d variant %d", m.Kind, m.Variant)
		}
		seen[[2]int{m.Kind, m.Variant}] = true
	}
	if len(seen) != len(ms) {
		t.Fatalf("duplicate models")
	}
	// A fresh build is identical (fixed seeds, no world input), and the copies
	// handed out are independent of the table.
	for _, k := range treeKinds {
		for v := 0; v < core.TreeVariants; v++ {
			segs, leaves := buildTree(treeBase(k), v)
			fresh := newTreeModel(k, v, segs, leaves).wire
			if !reflect.DeepEqual(fresh, treeModelFor(k, uint8(v)).wire) {
				t.Fatalf("model %v/%d is not deterministic", k, v)
			}
		}
	}
	ms[0].Branches[0].RA = 99
	if TreeModels()[0].Branches[0].RA == 99 {
		t.Fatal("TreeModels hands out shared slices")
	}
	b, err := json.Marshal(New(1).TreeModels())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("welcome.trees: %d models, %d bytes of JSON", len(ms), len(b))
}

func TestTreeModelStructure(t *testing.T) {
	for _, m := range TreeModels() {
		k := core.VegKind(m.Kind)
		name := fmt.Sprintf("%v/%d", k, m.Variant)
		nb, nl := len(m.Branches), len(m.Leaves)
		if nb < treeMinSegs || nb > treeMaxSegs {
			t.Errorf("%s: %d segments, want %d..%d", name, nb, treeMinSegs, treeMaxSegs)
		}
		if k == core.VegSnag {
			if nl != 0 {
				t.Errorf("%s: a snag with %d foliage masses", name, nl)
			}
		} else if nl < treeMinLeaves || nl > treeMaxLeaves {
			t.Errorf("%s: %d foliage masses, want %d..%d", name, nl, treeMinLeaves, treeMaxLeaves)
		}
		nominal := treeKindParams[treeBase(k)].height
		if h := float64(m.Height); h < nominal*0.9 || h > nominal*1.1 {
			t.Errorf("%s: height %.2f, nominal %.0f", name, h, nominal)
		}
		H := float64(m.Height)
		for i, b := range m.Branches {
			a, e := v3f(b.A), v3f(b.B)
			switch {
			case i == 0 && (b.Parent != -1 || a.len() > 1e-6):
				t.Fatalf("%s: segment 0 is not the trunk base (%+v)", name, b)
			case i > 0 && (b.Parent < 0 || b.Parent >= i):
				t.Fatalf("%s: segment %d has parent %d", name, i, b.Parent)
			}
			if i > 0 {
				// A child starts on its parent: at the parent's end node.
				p := m.Branches[b.Parent]
				if d := a.sub(v3f(p.B)).len(); d > 1e-4 {
					t.Errorf("%s: segment %d starts %.3f m from its parent's end", name, i, d)
				}
				if b.RA > p.RB*1.0001 {
					t.Errorf("%s: segment %d (r %.3f) thicker than its parent at the joint (%.3f)", name, i, b.RA, p.RB)
				}
			}
			if b.RB > b.RA || b.RB <= 0 {
				t.Errorf("%s: segment %d does not taper (%.3f -> %.3f)", name, i, b.RA, b.RB)
			}
			for _, q := range []v3{a, e} {
				if q.y < -1e-6 || q.y > H+1e-4 || math.Hypot(q.x, q.z) > 0.62*H {
					t.Errorf("%s: segment %d point %+v outside the model bounds (H %.1f)", name, i, q, H)
				}
			}
		}
		// Pipe model, roughly: the wood entering a node carries what leaves it.
		for i, b := range m.Branches {
			sum := 0.0
			for _, c := range m.Branches {
				if c.Parent == i {
					sum += float64(c.RA) * float64(c.RA)
				}
			}
			if sum > 0 && float64(b.RB) < 0.95*math.Sqrt(sum) && float64(b.RB) > treeKindParams[treeBase(k)].minR*1.01 {
				t.Errorf("%s: node %d radius %.3f carries children worth %.3f", name, i, b.RB, math.Sqrt(sum))
			}
		}
		for i, l := range m.Leaves {
			c, r := v3f(l.C), v3f(l.R)
			if r.x <= 0 || r.y <= 0 || r.z <= 0 || c.y-r.y < 0.5 || c.y+r.y > H+1e-4 || math.Hypot(c.x, c.z)+r.x > 0.7*H {
				t.Errorf("%s: foliage mass %d out of bounds (%+v, %+v)", name, i, c, r)
			}
		}
	}
}

// No limb grows through another: unrelated segments keep the sum of their radii
// apart (the generator's own rule, checked with the final radii).
func TestTreeModelNoIntersections(t *testing.T) {
	initTrees()
	for _, k := range treeKinds {
		for v := 0; v < core.TreeVariants; v++ {
			m := treeTable[k][v]
			for i := range m.segs {
				si := &m.segs[i]
				for j := 0; j < i; j++ {
					sj := &m.segs[j]
					if j == si.parent || (si.parent >= 0 && j == m.segs[si.parent].parent) || sj.parent == si.parent || sj.parent == i {
						continue
					}
					// Ignore the junction end of segment i.
					pr := 0.0
					if si.parent >= 0 {
						pr = m.segs[si.parent].rb
					}
					l := si.b.sub(si.a).len()
					p0 := si.a.lerp(si.b, math.Min(0.5, (pr+si.ra)/l))
					if d := segDist(p0, si.b, sj.a, sj.b); d < 0.8*(si.ra+sj.ra) {
						t.Errorf("%v/%d: segments %d and %d pass %.3f m apart (radii %.3f, %.3f)", k, v, i, j, d, si.ra, sj.ra)
					}
				}
			}
		}
	}
}

// Silhouettes differ between kinds: spreading oak and chestnut, slender birch,
// narrow pine with a bare lower trunk.
func TestTreeSilhouettes(t *testing.T) {
	initTrees()
	type stat struct{ ratio, lowLeaf float64 }
	avg := map[core.VegKind]stat{}
	for _, k := range []core.VegKind{core.VegOak, core.VegBirch, core.VegPine, core.VegChestnut} {
		var s stat
		for v := 0; v < core.TreeVariants; v++ {
			m := treeTable[k][v]
			w, low := 0.0, math.Inf(1)
			for _, l := range m.leaves {
				w = math.Max(w, math.Hypot(l.c.x, l.c.z)+l.r.x)
				low = math.Min(low, l.c.y-l.r.y)
			}
			s.ratio += 2 * w / m.height / core.TreeVariants
			s.lowLeaf += low / m.height / core.TreeVariants
		}
		avg[k] = s
		t.Logf("%-12v width/height %.2f, lowest foliage at %.0f%% of height", k, s.ratio, s.lowLeaf*100)
	}
	if !(avg[core.VegOak].ratio > avg[core.VegBirch].ratio+0.2 && avg[core.VegOak].ratio > avg[core.VegPine].ratio+0.2) {
		t.Errorf("the oak is not the broad one: %+v", avg)
	}
	if !(avg[core.VegChestnut].ratio > avg[core.VegBirch].ratio+0.15) {
		t.Errorf("the chestnut crown is not big: %+v", avg)
	}
	if avg[core.VegPine].lowLeaf < 0.25 {
		t.Errorf("pines have no bare lower trunk: %+v", avg[core.VegPine])
	}
	for _, k := range []core.VegKind{core.VegOak, core.VegBirch, core.VegChestnut} {
		if r := avg[k].ratio; r < 0.35 || r > 1.3 {
			t.Errorf("%v width/height %.2f is not a tree", k, r)
		}
	}
}

func v3f(a [3]float32) v3 { return v3{float64(a[0]), float64(a[1]), float64(a[2])} }

// TestRenderTreeModels draws every model (side and top view) into a PNG sheet
// when WILDCALL_TREE_PNG names a directory. It is a looking aid, not a check.
func TestRenderTreeModels(t *testing.T) {
	dir := os.Getenv("WILDCALL_TREE_PNG")
	if dir == "" {
		t.Skip("set WILDCALL_TREE_PNG=<dir> to render the tree models")
	}
	const cell, px = 260, 13.0 // pixels per model, pixels per metre
	ms := TreeModels()
	cols := core.TreeVariants
	rows := len(ms) / cols
	img := image.NewRGBA(image.Rect(0, 0, cols*cell, rows*cell*3/2))
	for i := range img.Pix {
		img.Pix[i] = 236
	}
	for i, m := range ms {
		ox, oy := float64(i%cols*cell+cell/2), float64(i/cols*cell*3/2+cell-10)
		drawModel(img, m, ox, oy, px, false)
		drawModel(img, m, ox, oy+cell/4+5, px*0.5, true)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(filepath.Join(dir, "trees.png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func drawModel(img *image.RGBA, m proto.TreeModel, ox, oy, px float64, top bool) {
	proj := func(p v3) (float64, float64) {
		if top {
			return ox + p.x*px, oy + p.z*px
		}
		return ox + p.x*px, oy - p.y*px
	}
	for _, l := range m.Leaves {
		c, r := v3f(l.C), v3f(l.R)
		cx, cy := proj(c)
		ry := r.y
		if top {
			ry = r.z
		}
		shade := color.RGBA{120, 170, 90, 255}
		if top {
			shade = color.RGBA{140, 185, 110, 255}
		}
		for y := -ry * px; y <= ry*px; y++ {
			for x := -r.x * px; x <= r.x*px; x++ {
				if sq(x/(r.x*px))+sq(y/(ry*px)) <= 1 {
					blend(img, int(cx+x), int(cy+y), shade, 0.55)
				}
			}
		}
	}
	for _, b := range m.Branches {
		a, e := v3f(b.A), v3f(b.B)
		ax, ay := proj(a)
		bx, by := proj(e)
		n := int(math.Max(math.Hypot(bx-ax, by-ay), 1)) * 2
		for s := 0; s <= n; s++ {
			u := float64(s) / float64(n)
			x, y := lerp(ax, bx, u), lerp(ay, by, u)
			r := math.Max(lerp(float64(b.RA), float64(b.RB), u)*px, 0.5)
			for dy := -r; dy <= r; dy++ {
				for dx := -r; dx <= r; dx++ {
					if dx*dx+dy*dy <= r*r {
						blend(img, int(x+dx), int(y+dy), color.RGBA{92, 64, 44, 255}, 1)
					}
				}
			}
		}
	}
}

func blend(img *image.RGBA, x, y int, c color.RGBA, a float64) {
	if !(image.Point{x, y}.In(img.Rect)) {
		return
	}
	o := img.PixOffset(x, y)
	img.Pix[o] = uint8(lerp(float64(img.Pix[o]), float64(c.R), a))
	img.Pix[o+1] = uint8(lerp(float64(img.Pix[o+1]), float64(c.G), a))
	img.Pix[o+2] = uint8(lerp(float64(img.Pix[o+2]), float64(c.B), a))
	img.Pix[o+3] = 255
}
