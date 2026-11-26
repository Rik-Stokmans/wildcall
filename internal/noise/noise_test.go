package noise

import (
	"math"
	"testing"
)

func TestDeterministicAndSeeded(t *testing.T) {
	a, b, c := New(42), New(42), New(43)
	same, diff := 0, 0
	for i := 0; i < 2000; i++ {
		x, y := float64(i)*0.37-300, float64(i)*0.211+17
		if a.Eval(x, y) != b.Eval(x, y) {
			t.Fatalf("same seed differs at %v,%v", x, y)
		}
		if a.Eval(x, y) == c.Eval(x, y) {
			same++
		} else {
			diff++
		}
	}
	if same > 20 {
		t.Fatalf("different seeds agree at %d of %d points", same, same+diff)
	}
}

func TestRangeAndDistribution(t *testing.T) {
	s := New(7)
	lo, hi, sum, sq := 1.0, -1.0, 0.0, 0.0
	const n = 400000
	r := NewRNG(1)
	for i := 0; i < n; i++ {
		v := s.Eval(r.Range(-5000, 5000), r.Range(-5000, 5000))
		lo, hi = math.Min(lo, v), math.Max(hi, v)
		sum += v
		sq += v * v
	}
	if lo < -1.02 || hi > 1.02 {
		t.Fatalf("out of range: [%v, %v]", lo, hi)
	}
	if lo > -0.85 || hi < 0.85 {
		t.Fatalf("range too narrow: [%v, %v]", lo, hi)
	}
	if mean := sum / n; math.Abs(mean) > 0.02 {
		t.Fatalf("mean %v not near 0", mean)
	}
	if sd := math.Sqrt(sq / n); sd < 0.2 || sd > 0.6 {
		t.Fatalf("unexpected spread %v", sd)
	}
}

func TestContinuity(t *testing.T) {
	s := New(3)
	r := NewRNG(9)
	for i := 0; i < 20000; i++ {
		x, y := r.Range(-1e5, 1e5), r.Range(-1e5, 1e5)
		if d := math.Abs(s.Eval(x, y) - s.Eval(x+1e-4, y-1e-4)); d > 2e-3 {
			t.Fatalf("discontinuity %v at %v,%v", d, x, y)
		}
	}
}

func TestDerivativesMatchFiniteDifferences(t *testing.T) {
	s := New(11)
	r := NewRNG(5)
	const e = 1e-5
	for i := 0; i < 5000; i++ {
		x, y := r.Range(-300, 300), r.Range(-300, 300)
		v, dx, dy := s.EvalD(x, y)
		if math.Abs(v-s.Eval(x, y)) > 1e-12 {
			t.Fatalf("EvalD value mismatch")
		}
		fx := (s.Eval(x+e, y) - s.Eval(x-e, y)) / (2 * e)
		fy := (s.Eval(x, y+e) - s.Eval(x, y-e)) / (2 * e)
		if math.Abs(fx-dx) > 1e-4 || math.Abs(fy-dy) > 1e-4 {
			t.Fatalf("derivative mismatch at %v,%v: got %v,%v want %v,%v", x, y, dx, dy, fx, fy)
		}
		fv, fdx, fdy := s.FBMD(x, y, 4, 2.1, 0.5)
		if math.Abs(fv-s.FBM(x, y, 4, 2.1, 0.5)) > 1e-12 {
			t.Fatalf("FBMD value mismatch")
		}
		nx := (s.FBM(x+e, y, 4, 2.1, 0.5) - s.FBM(x-e, y, 4, 2.1, 0.5)) / (2 * e)
		ny := (s.FBM(x, y+e, 4, 2.1, 0.5) - s.FBM(x, y-e, 4, 2.1, 0.5)) / (2 * e)
		if math.Abs(nx-fdx) > 1e-3 || math.Abs(ny-fdy) > 1e-3 {
			t.Fatalf("fbm derivative mismatch at %v,%v: got %v,%v want %v,%v", x, y, fdx, fdy, nx, ny)
		}
	}
}

func TestWarpJacobian(t *testing.T) {
	s := New(21)
	const e = 1e-5
	for i := 0; i < 500; i++ {
		x, y := float64(i)*0.713-90, float64(i)*0.29+3
		wx, wy, j := s.WarpD(x, y, 0.8)
		ax, ay := s.Warp(x, y, 0.8)
		if wx != ax || wy != ay {
			t.Fatalf("WarpD position differs from Warp")
		}
		bx, by := s.Warp(x+e, y, 0.8)
		cx, cy := s.Warp(x, y+e, 0.8)
		num := [4]float64{(bx - ax) / e, (cx - ax) / e, (by - ay) / e, (cy - ay) / e}
		for k := range num {
			if math.Abs(num[k]-j[k]) > 1e-3 {
				t.Fatalf("jacobian[%d] = %v, want %v", k, j[k], num[k])
			}
		}
	}
}

func TestFractalRanges(t *testing.T) {
	s := New(99)
	r := NewRNG(2)
	for i := 0; i < 100000; i++ {
		x, y := r.Range(-4000, 4000), r.Range(-4000, 4000)
		if v := s.FBM(x, y, 5, 2, 0.5); v < -1.02 || v > 1.02 {
			t.Fatalf("fbm out of range: %v", v)
		}
		if v := s.Ridged(x, y, 5, 2.1, 0.5); v < 0 || v > 1.0001 {
			t.Fatalf("ridged out of range: %v", v)
		}
	}
}

func TestFarFromOriginStaysSmooth(t *testing.T) {
	s := New(5)
	for _, base := range []float64{4e4, -4e4, 1e6, -1e6, 1e9} {
		a := s.Eval(base+0.25, base-0.5)
		b := s.Eval(base+0.2501, base-0.5)
		if math.IsNaN(a) || math.Abs(a-b) > 0.01 {
			t.Fatalf("bad behaviour near %v: %v vs %v", base, a, b)
		}
	}
}

func TestNoAllocations(t *testing.T) {
	s := New(1)
	var sink float64
	if n := testing.AllocsPerRun(100, func() {
		sink += s.Eval(1.5, 2.5)
		sink += s.FBM(3.1, 4.1, 5, 2, 0.5)
		sink += s.Ridged(3.1, 4.1, 5, 2, 0.5)
		a, b := s.Warp(1, 2, 3)
		v, dx, dy := s.FBMD(a, b, 3, 2, 0.5)
		sink += v + dx + dy
		_, _, j := s.WarpD(1, 2, 3)
		sink += j[0]
	}); n != 0 {
		t.Fatalf("noise allocates: %v allocs/op", n)
	}
	_ = sink
}

func TestRNGAndHash(t *testing.T) {
	a, b := NewRNG(5), NewRNG(5)
	for i := 0; i < 100; i++ {
		if a.Uint64() != b.Uint64() {
			t.Fatal("rng not deterministic")
		}
	}
	r := NewRNG(77)
	var buckets [10]int
	for i := 0; i < 100000; i++ {
		f := r.Float64()
		if f < 0 || f >= 1 {
			t.Fatalf("Float64 out of range: %v", f)
		}
		buckets[r.Intn(10)]++
	}
	for i, c := range buckets {
		if c < 9000 || c > 11000 {
			t.Fatalf("bucket %d has %d", i, c)
		}
	}
	if Hash2(1, 2, 3) == Hash2(1, 3, 2) || Hash2(1, -1, 0) == Hash2(1, 1, 0) || Hash2(1, 2, 3) == Hash2(2, 2, 3) {
		t.Fatal("hash collisions on trivial inputs")
	}
	if HashString(1, "a") == HashString(1, "b") || HashString(1, "a") == HashString(2, "a") {
		t.Fatal("string hash collisions on trivial inputs")
	}
}

func BenchmarkEval(b *testing.B) {
	s := New(1)
	var sink float64
	for i := 0; i < b.N; i++ {
		sink += s.Eval(float64(i)*0.013, float64(i)*0.007)
	}
	_ = sink
}

func BenchmarkEvalD(b *testing.B) {
	s := New(1)
	var sink float64
	for i := 0; i < b.N; i++ {
		v, dx, dy := s.EvalD(float64(i)*0.013, float64(i)*0.007)
		sink += v + dx + dy
	}
	_ = sink
}

func BenchmarkFBM4(b *testing.B) {
	s := New(1)
	var sink float64
	for i := 0; i < b.N; i++ {
		sink += s.FBM(float64(i)*0.013, float64(i)*0.007, 4, 2, 0.5)
	}
	_ = sink
}
