package world

import (
	"sync"
	"testing"
)

func TestLRU(t *testing.T) {
	c := newLRU[int, int](3)
	calls := 0
	get := func(k int) int { return c.get(k, func() int { calls++; return k * 10 }) }
	for _, k := range []int{1, 2, 3, 1, 4} { // 4 evicts 2 (1 was used recently)
		if get(k) != k*10 {
			t.Fatal("wrong value")
		}
	}
	if calls != 4 || c.len() != 3 {
		t.Fatalf("calls %d len %d", calls, c.len())
	}
	get(1)
	get(3)
	if calls != 4 {
		t.Fatal("1 and 3 should still be cached")
	}
	get(2)
	if calls != 5 {
		t.Fatal("2 should have been evicted")
	}
}

// Touching thousands of chunks from many goroutines stays within the cache
// bounds and gives the same answers as a fresh world.
func TestCachesBoundedAndConcurrent(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	w := New(31)
	const side = 71 // 5041 distinct chunks
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := g; i < side*side; i += 8 {
				cx, cz := i%side-side/2, i/side-side/2
				if _, err := w.Chunk(cx, cz, 2); err != nil {
					t.Error(err)
					return
				}
				w.HeightAt(float32(cx*64+5), float32(cz*64+9))
				if i%5 == 0 {
					w.PerchesNear(float32(cx*64+32), float32(cz*64+32), 20, nil)
				}
			}
		}(g)
	}
	wg.Wait()
	for name, c := range map[string][2]int{
		"cells": {w.cells.len(), capCells}, "trails": {w.trails.len(), capTrails}, "pois": {w.pois.len(), capPOIs},
		"grids": {w.grids.len(), capGrids}, "veg": {w.veg.len(), capVeg}, "perches": {w.perches.len(), capPerches},
		"chunks": {w.chunks.len(), capChunks}, "tiles": {w.tiles.len(), capTiles},
	} {
		if c[0] > c[1] {
			t.Errorf("%s cache holds %d entries, cap %d", name, c[0], c[1])
		}
	}
	if w.grids.len() != capGrids {
		t.Errorf("grid cache should be full after 5000 chunks, has %d", w.grids.len())
	}
	// Evicted and rebuilt data is identical.
	fresh := New(31)
	for _, k := range [][2]int{{-35, -35}, {0, 0}, {35, 35}} {
		a, _ := w.Chunk(k[0], k[1], 0)
		b, _ := fresh.Chunk(k[0], k[1], 0)
		if string(a) != string(b) {
			t.Fatalf("chunk %v differs after cache churn", k)
		}
	}
}
