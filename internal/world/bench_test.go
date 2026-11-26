package world

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"

	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// BenchmarkChunkLOD0Cold measures building a lod-0 chunk that is not cached -
// vertex grid, vegetation, perches and the encoded frame - in an area whose
// structure cells and trails are already known (they are shared by ~50 chunks
// each, so the player pays for them once per area). The sweep is larger than the
// chunk caches, so every request is a miss.
func BenchmarkChunkLOD0Cold(b *testing.B) {
	w := New(1)
	const side = 30 // 900 chunks > capGrids, capVeg, capChunks
	for cz := -side / 2; cz < side/2; cz += 3 {
		for cx := -side / 2; cx < side/2; cx += 3 {
			var ov overlays
			x, z := float64(cx*64), float64(cz*64)
			w.overlaysFor(x, z, x+192, z+192, &ov)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		k := i % (side * side)
		cx, cz := k%side-side/2, k/side-side/2
		if _, err := w.Chunk(cx, cz, 0); err != nil {
			b.Fatal(err)
		}
		w.chunkPerches(cx, cz)
	}
}

// BenchmarkChunkNewArea includes everything: fresh cells and trails as well.
func BenchmarkChunkNewArea(b *testing.B) {
	w := New(2)
	for i := 0; i < b.N; i++ {
		// March east in a straight line: every chunk is new, and so is every
		// third column of structure cells.
		if _, err := w.Chunk(i, 3, 0); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkHeightAtWarm(b *testing.B) {
	w := New(3)
	r := noise.NewRNG(1)
	pts := make([][2]float32, 1024)
	for i := range pts {
		pts[i] = [2]float32{float32(r.Range(-90, 90)), float32(r.Range(-90, 90))}
		w.HeightAt(pts[i][0], pts[i][1])
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p := pts[i&1023]
		w.HeightAt(p[0], p[1])
	}
}

func BenchmarkPerchesNear(b *testing.B) {
	w := New(4)
	w.PerchesNear(0, 0, 160, nil)
	r := noise.NewRNG(2)
	var out = w.PerchesNear(0, 0, 1, nil)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		out = w.PerchesNear(float32(r.Range(-100, 100)), float32(r.Range(-100, 100)), 40, out[:0])
	}
}

func BenchmarkOcclusion(b *testing.B) {
	w := New(5)
	w.PerchesNear(0, 0, 160, nil)
	r := noise.NewRNG(3)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		x, z := float32(r.Range(-80, 80)), float32(r.Range(-80, 80))
		from := w.HeightAt(x, z)
		w.Occlusion(core.Vec3{X: x, Y: from + 1.65, Z: z}, core.Vec3{X: x + 60, Y: from + 6, Z: z + 30})
	}
}

func BenchmarkMapTile(b *testing.B) {
	w := New(6)
	for i := 0; i < b.N; i++ {
		if _, err := w.renderTile(i%5, i/5); err != nil {
			b.Fatal(err)
		}
	}
}
