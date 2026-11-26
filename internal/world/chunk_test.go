package world

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// parsedChunk is a decoded chunk frame (an independent reader of contract §2.3).
type parsedChunk struct {
	lod, n  int
	cx, cz  int
	heights []float32
	normals [][3]int8
	colors  [][3]uint8
	region  []uint8
	habitat []uint8
	veg     []core.Veg
}

func parseChunk(t *testing.T, b []byte) parsedChunk {
	t.Helper()
	le := binary.LittleEndian
	if len(b) < 16 || string(b[:4]) != "WCHK" || b[4] != 2 {
		t.Fatalf("bad chunk header % x", b[:min(len(b), 16)])
	}
	p := parsedChunk{lod: int(b[5]), n: int(le.Uint16(b[6:])), cx: int(int32(le.Uint32(b[8:]))), cz: int(int32(le.Uint32(b[12:])))}
	if want := 64/(2<<p.lod) + 1; p.n != want {
		t.Fatalf("lod %d has N=%d, want %d", p.lod, p.n, want)
	}
	nv := p.n * p.n
	o := 16
	for i := 0; i < nv; i++ {
		p.heights = append(p.heights, math.Float32frombits(le.Uint32(b[o+i*4:])))
	}
	o += nv * 4
	for i := 0; i < nv; i++ {
		p.normals = append(p.normals, [3]int8{int8(b[o+i*3]), int8(b[o+i*3+1]), int8(b[o+i*3+2])})
	}
	o += nv * 3
	for i := 0; i < nv; i++ {
		p.colors = append(p.colors, [3]uint8{b[o+i*3], b[o+i*3+1], b[o+i*3+2]})
	}
	o += nv * 3
	p.region = append([]uint8(nil), b[o:o+nv]...)
	o += nv
	p.habitat = append([]uint8(nil), b[o:o+nv]...)
	o += nv
	o = (o + 3) &^ 3
	cnt := int(le.Uint32(b[o:]))
	o += 4
	if len(b) != o+cnt*20 {
		t.Fatalf("chunk length %d, want %d for %d vegetation records", len(b), o+cnt*20, cnt)
	}
	for i := 0; i < cnt; i++ {
		r := b[o+i*20:]
		p.veg = append(p.veg, core.Veg{
			Kind: core.VegKind(r[0]), Variant: r[1],
			Rot:   float32(float64(le.Uint16(r[2:])) / 65535 * 2 * math.Pi),
			Pos:   core.Vec3{X: math.Float32frombits(le.Uint32(r[4:])), Y: math.Float32frombits(le.Uint32(r[8:])), Z: math.Float32frombits(le.Uint32(r[12:]))},
			Scale: math.Float32frombits(le.Uint32(r[16:])),
		})
	}
	return p
}

func chunkAt(t *testing.T, w *World, cx, cz, lod int) parsedChunk {
	t.Helper()
	b, err := w.Chunk(cx, cz, lod)
	if err != nil {
		t.Fatal(err)
	}
	p := parseChunk(t, b)
	if p.cx != cx || p.cz != cz || p.lod != lod {
		t.Fatalf("chunk header says %d,%d lod %d, want %d,%d lod %d", p.cx, p.cz, p.lod, cx, cz, lod)
	}
	return p
}

func TestChunkLayout(t *testing.T) {
	w := New(9)
	if _, err := w.Chunk(0, 0, 3); err == nil {
		t.Fatal("lod 3 must be rejected")
	}
	for _, k := range [][2]int{{0, 0}, {-3, 7}, {-625, 625}, {1000, -1000}} {
		for lod := 0; lod <= 2; lod++ {
			p := chunkAt(t, w, k[0], k[1], lod)
			x0, z0 := float32(k[0]*64), float32(k[1]*64)
			for i, h := range p.heights {
				if math.IsNaN(float64(h)) || h < -60 || h > 400 {
					t.Fatalf("chunk %v: height %v", k, h)
				}
				n := p.normals[i]
				if n[1] <= 0 {
					t.Fatalf("chunk %v: normal %v points down", k, n)
				}
				if p.habitat[i] >= uint8(core.HabCount) || (p.region[i] >= uint8(core.RegionCount) && p.region[i] != 255) {
					t.Fatalf("chunk %v: bad region/habitat %d/%d", k, p.region[i], p.habitat[i])
				}
			}
			for _, v := range p.veg {
				if v.Kind >= core.VegKindCount || v.Scale <= 0 || v.Pos.X < x0 || v.Pos.X >= x0+64 || v.Pos.Z < z0 || v.Pos.Z >= z0+64 {
					t.Fatalf("chunk %v: bad vegetation %+v", k, v)
				}
			}
		}
	}
}

func vertexEqual(a parsedChunk, i int, b parsedChunk, j int) bool {
	return a.heights[i] == b.heights[j] && a.normals[i] == b.normals[j] && a.colors[i] == b.colors[j] &&
		a.region[i] == b.region[j] && a.habitat[i] == b.habitat[j]
}

func TestChunkBordersAndLODs(t *testing.T) {
	w := New(21)
	spots := [][2]int{{0, 0}, {-1, -1}, {3, -2}, {-625, -625}, {625, 625}, {-625, 624}, {40, 33}}
	for _, s := range spots {
		for lod := 0; lod <= 2; lod++ {
			a := chunkAt(t, w, s[0], s[1], lod)
			e := chunkAt(t, w, s[0]+1, s[1], lod)
			so := chunkAt(t, w, s[0], s[1]+1, lod)
			n := a.n
			for k := 0; k < n; k++ {
				if !vertexEqual(a, k*n+n-1, e, k*n) {
					t.Fatalf("chunk %v lod %d: east border differs at row %d", s, lod, k)
				}
				if !vertexEqual(a, (n-1)*n+k, so, k) {
					t.Fatalf("chunk %v lod %d: south border differs at column %d", s, lod, k)
				}
			}
		}
		// LODs share vertices exactly; coarser LODs show a subset of the vegetation.
		l0 := chunkAt(t, w, s[0], s[1], 0)
		vegs := map[core.Veg]bool{}
		for _, v := range l0.veg {
			vegs[v] = true
		}
		for lod := 1; lod <= 2; lod++ {
			l := chunkAt(t, w, s[0], s[1], lod)
			st := 1 << lod
			for iz := 0; iz < l.n; iz++ {
				for ix := 0; ix < l.n; ix++ {
					if !vertexEqual(l, iz*l.n+ix, l0, iz*st*l0.n+ix*st) {
						t.Fatalf("chunk %v: lod %d vertex %d,%d differs from lod 0", s, lod, ix, iz)
					}
				}
			}
			for _, v := range l.veg {
				if !vegs[v] {
					t.Fatalf("chunk %v: lod %d vegetation %+v not in lod 0", s, lod, v)
				}
				if lod == 2 && shapes[v.Kind].height == 0 && v.Kind != core.VegSnag {
					t.Fatalf("lod 2 carries non-tree %v", v.Kind)
				}
			}
		}
	}
}

// findChunk returns a chunk whose centre samples to the given region (and
// optionally habitat), searching outward from home.
func findChunk(w *World, want core.RegionID, ok func(*sample) bool) (int, int, bool) {
	var s sample
	for r := 2; r < 70; r++ {
		for cz := -r; cz <= r; cz++ {
			for cx := -r; cx <= r; cx++ {
				if max(abs(cx), abs(cz)) != r {
					continue
				}
				w.g.sample(float64(cx*64+32), float64(cz*64+32), &s)
				if s.region == want && s.w[want] > 0.85 && (ok == nil || ok(&s)) {
					all := true
					for _, d := range [4][2]float64{{-24, -24}, {24, -24}, {-24, 24}, {24, 24}} {
						var t sample
						w.g.sample(float64(cx*64+32)+d[0], float64(cz*64+32)+d[1], &t)
						all = all && t.region == want && t.w[want] > 0.85
					}
					if all {
						return cx, cz, true
					}
				}
			}
		}
	}
	return 0, 0, false
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func kindCount(vs []core.Veg) map[core.VegKind]int {
	m := map[core.VegKind]int{}
	for _, v := range vs {
		m[v.Kind]++
	}
	return m
}

func TestVegetationByRegion(t *testing.T) {
	w := New(4)
	cases := []struct {
		name string
		reg  core.RegionID
		ok   func(*sample) bool
		want []core.VegKind
	}{
		{"greenhollow forest", core.RegionGreenhollow, func(s *sample) bool { return s.clear < 0 && s.thicket < 0.3 && s.h > 3 && s.riverD > 60 }, []core.VegKind{core.VegOak, core.VegBirch}},
		{"amberwood", core.RegionAmberwood, func(s *sample) bool { return s.clear < 0.2 && s.h > 3 }, []core.VegKind{core.VegAmberOak, core.VegAmberBirch}},
		{"frostveil", core.RegionFrostveil, func(s *sample) bool { return s.conifer > 0.35 && s.ice < 0.1 }, []core.VegKind{core.VegSnowPine}},
		{"marsh", core.RegionMurmurMarsh, nil, []core.VegKind{core.VegReeds}},
		{"windpeak", core.RegionWindpeak, func(s *sample) bool { return s.h > 90 }, []core.VegKind{core.VegRock}},
		{"beach", core.RegionWhisperingCoast, func(s *sample) bool { return s.seaDist > 5 && s.seaDist < 30 && s.cliffy < 0.2 }, []core.VegKind{core.VegDriftwood}},
	}
	for _, c := range cases {
		cx, cz, ok := findChunk(w, c.reg, c.ok)
		if !ok {
			t.Errorf("%s: no chunk found", c.name)
			continue
		}
		// Look at a 2x2 block so one sparse chunk does not decide the test.
		var all []core.Veg
		for dz := 0; dz <= 1; dz++ {
			for dx := 0; dx <= 1; dx++ {
				all = append(all, chunkAt(t, w, cx+dx, cz+dz, 0).veg...)
			}
		}
		kc := kindCount(all)
		for _, k := range c.want {
			if kc[k] == 0 {
				t.Errorf("%s (chunk %d,%d): no %v in %v", c.name, cx, cz, k, kc)
			}
		}
		if c.reg == core.RegionGreenhollow {
			n := len(chunkAt(t, w, cx, cz, 0).veg)
			if n < 150 || n > 450 {
				t.Errorf("forested chunk %d,%d has %d instances, want 150..450", cx, cz, n)
			}
		}
		for _, v := range all {
			if (v.Kind == core.VegFlowers || v.Kind == core.VegFern) && w.RegionAt(v.Pos.X, v.Pos.Z) == core.RegionFrostveil {
				t.Errorf("%v in Frostveil at %.0f,%.0f", v.Kind, v.Pos.X, v.Pos.Z)
			}
		}
	}
}

// Trails and structure pads stay clear of trees and shrubs.
func TestVegetationKeepsClear(t *testing.T) {
	w := New(8)
	var trailPts []core.Vec3
	for _, tr := range w.hl.trails {
		if !tr.Hidden {
			trailPts = append(trailPts, tr.Points...)
		}
	}
	cabin, _ := w.POI("cabin")
	for cz := -7; cz <= 7; cz++ {
		for cx := -7; cx <= 7; cx++ {
			for _, v := range w.vegetation(cx, cz).veg {
				big := shapes[v.Kind].isTree || v.Kind == core.VegShrub || v.Kind == core.VegSnag
				if !big {
					continue
				}
				if v.Pos.DistXZ(cabin.Pos) < 9 {
					t.Errorf("%v at %.1f m from the cabin", v.Kind, v.Pos.DistXZ(cabin.Pos))
				}
				for _, p := range trailPts {
					if v.Pos.DistXZ(p) < 2.2 && v.Scale < 2 {
						t.Errorf("%v %.1f m from a home trail point at %.0f,%.0f", v.Kind, v.Pos.DistXZ(p), p.X, p.Z)
						break
					}
				}
			}
		}
	}
}
