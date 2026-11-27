package world

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// A bird squarely behind a trunk is hidden; one beside it, or perched on the near
// side of the bark, is not.
func TestTrunkOcclusion(t *testing.T) {
	w := New(5)
	var tree *core.Veg
	for cz := 0; cz < 6 && tree == nil; cz++ {
		for cx := 0; cx < 6 && tree == nil; cx++ {
			vs := w.vegetation(cx, cz)
			for i := range vs.veg {
				if v := &vs.veg[i]; (v.Kind == core.VegOak || v.Kind == core.VegPine) && v.Scale >= 0.9 {
					tree = v
					break
				}
			}
		}
	}
	if tree == nil {
		t.Skip("no tree found")
	}
	m := treeModelFor(tree.Kind, tree.Variant)
	x := instanceXform(tree)
	var trunk *tseg
	for i := range m.segs {
		if m.segs[i].order == 0 {
			trunk = &m.segs[i]
			break
		}
	}
	a := x.apply(trunk.a)
	r := trunk.ra * float64(tree.Scale)
	y := float32(a.y + 1.5)
	c := core.Vec3{X: float32(a.x), Y: y, Z: float32(a.z)}
	eye := c.Add(core.V(-12, 0.1, 0))
	behind := c.Add(core.V(10, 0, 0))
	if o := w.TrunkOcclusion(eye, behind); o < 0.99 {
		t.Errorf("bird squarely behind a trunk (r %.2f m): occlusion %.2f, want 1", r, o)
	}
	beside := c.Add(core.V(10, 0, float32(4*r+1)))
	if o := w.TrunkOcclusion(eye, beside); o > 0.01 {
		t.Errorf("bird well beside the trunk: occlusion %.2f, want 0", o)
	}
	// On the near side of the bark (a treecreeper facing the player).
	near := c.Add(core.V(-float32(r+0.02), 0, 0))
	if o := w.TrunkOcclusion(eye, near); o > 0.01 {
		t.Errorf("bird on the near side of the trunk: occlusion %.2f, want 0", o)
	}
	// On the far side it is hidden.
	far := c.Add(core.V(float32(r+0.04), 0, 0))
	if o := w.TrunkOcclusion(eye, far); o < 0.99 {
		t.Errorf("bird on the far side of the trunk: occlusion %.2f, want 1", o)
	}
	if o := w.TrunkOcclusion(eye, eye.Add(core.V(0.1, 0, 0))); o != 0 {
		t.Errorf("degenerate line: %v", o)
	}
}

func BenchmarkTrunkOcclusion(b *testing.B) {
	w := New(5)
	w.PerchesNear(0, 0, 160, nil)
	r := noise.NewRNG(3)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		x, z := float32(r.Range(-80, 80)), float32(r.Range(-80, 80))
		from := w.HeightAt(x, z)
		w.TrunkOcclusion(core.Vec3{X: x, Y: from + 1.65, Z: z}, core.Vec3{X: x + 25, Y: from + 6, Z: z + 12})
	}
}
