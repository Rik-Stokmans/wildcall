package world

import (
	"bytes"
	"image"
	"image/png"
	"math"
	"testing"
)

func decodeTile(t *testing.T, w *World, tx, tz int) image.Image {
	t.Helper()
	b, err := w.MapTile(tx, tz)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if r := img.Bounds(); r.Dx() != 128 || r.Dy() != 128 {
		t.Fatalf("tile %d,%d is %v", tx, tz, r)
	}
	return img
}

// colDiff is the mean absolute channel difference between pixel columns (or rows)
// of two images.
func lineDiff(a image.Image, ax, ay int, b image.Image, bx, by int, vertical bool) float64 {
	sum := 0.0
	for i := 0; i < 128; i++ {
		x1, y1, x2, y2 := ax, i, bx, i
		if !vertical {
			x1, y1, x2, y2 = i, ay, i, by
		}
		r1, g1, b1, _ := a.At(x1, y1).RGBA()
		r2, g2, b2, _ := b.At(x2, y2).RGBA()
		sum += math.Abs(float64(r1>>8)-float64(r2>>8)) + math.Abs(float64(g1>>8)-float64(g2>>8)) + math.Abs(float64(b1>>8)-float64(b2>>8))
	}
	return sum / (128 * 3)
}

func TestMapTilesSeamless(t *testing.T) {
	w := New(17)
	for _, k := range [][2]int{{0, 0}, {-1, -1}, {3, -2}, {-5, 4}, {6, 6}} {
		a := decodeTile(t, w, k[0], k[1])
		east := decodeTile(t, w, k[0]+1, k[1])
		south := decodeTile(t, w, k[0], k[1]+1)
		// Neighbouring pixels across a seam differ no more than neighbouring
		// pixels inside a tile do (plus a little slack for steep terrain).
		inE := lineDiff(a, 126, 0, a, 127, 0, true)
		seamE := lineDiff(a, 127, 0, east, 0, 0, true)
		if seamE > 2*inE+4 {
			t.Errorf("tile %v: east seam differs by %.1f (inside %.1f)", k, seamE, inE)
		}
		inS := lineDiff(a, 0, 126, a, 0, 127, false)
		seamS := lineDiff(a, 0, 127, south, 0, 0, false)
		if seamS > 2*inS+4 {
			t.Errorf("tile %v: south seam differs by %.1f (inside %.1f)", k, seamS, inS)
		}
	}
}

func TestMapTileHasVariety(t *testing.T) {
	w := New(17)
	img := decodeTile(t, w, 0, 0)
	seen := map[uint32]bool{}
	for y := 0; y < 128; y += 4 {
		for x := 0; x < 128; x += 4 {
			r, g, b, _ := img.At(x, y).RGBA()
			seen[(r>>11)<<10|(g>>11)<<5|b>>11] = true
		}
	}
	if len(seen) < 12 {
		t.Errorf("home tile has only %d distinct colours", len(seen))
	}
}
