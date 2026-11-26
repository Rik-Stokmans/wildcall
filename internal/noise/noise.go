// Package noise provides fast, deterministic, allocation-free 2D simplex noise with
// the fractal helpers the world generator is built from: fBm, ridged multifractal
// and domain warping, each with analytic derivatives where the generator needs
// them (distance-to-contour estimates for shorelines and rivers).
//
// A Source is one seeded noise layer. It is immutable after New and safe for
// concurrent use; every method is a pure function of (seed, x, y).
package noise

import "math"

// Source is one seeded layer of 2D simplex noise.
type Source struct {
	perm [512]uint8 // permutation table, doubled so lookups never need a second mask
	ox   float64    // per-layer domain offset: decorrelates the lattices of different
	oy   float64    // layers and keeps the origin from being a zero of every octave
}

// New returns the noise layer for a seed. Different seeds give uncorrelated layers.
func New(seed int64) *Source {
	s := &Source{}
	r := NewRNG(uint64(seed))
	var p [256]uint8
	for i := range p {
		p[i] = uint8(i)
	}
	for i := 255; i > 0; i-- {
		j := r.Intn(i + 1)
		p[i], p[j] = p[j], p[i]
	}
	for i := range s.perm {
		s.perm[i] = p[i&255]
	}
	s.ox = r.Float64()*512 + 31.7
	s.oy = r.Float64()*512 + 57.3
	return s
}

const (
	skew   = 0.36602540378443865 // (sqrt(3) - 1) / 2
	unskew = 0.21132486540518712 // (3 - sqrt(3)) / 6
	// norm scales the raw simplex sum (unit gradients) to roughly [-1, 1].
	norm = 99.2
)

// grad holds 16 unit gradient directions, evenly spread, offset by half a step so
// none is axis-aligned (avoids visible grid-aligned streaks).
var grad [16][2]float64

func init() {
	for i := range grad {
		a := (float64(i) + 0.5) * math.Pi / 8
		grad[i] = [2]float64{math.Cos(a), math.Sin(a)}
	}
}

func floor(v float64) int64 {
	i := int64(v)
	if v < float64(i) {
		i--
	}
	return i
}

// Eval returns simplex noise at (x, y) in roughly [-1, 1]. One unit of input is one
// lattice cell: features are about one unit across.
func (s *Source) Eval(x, y float64) float64 {
	x += s.ox
	y += s.oy
	f := (x + y) * skew
	i, j := floor(x+f), floor(y+f)
	t := float64(i+j) * unskew
	x0, y0 := x-(float64(i)-t), y-(float64(j)-t)
	var i1, j1 int64 = 0, 1
	if x0 > y0 {
		i1, j1 = 1, 0
	}
	x1, y1 := x0-float64(i1)+unskew, y0-float64(j1)+unskew
	x2, y2 := x0-1+2*unskew, y0-1+2*unskew
	ii, jj := int(i&255), int(j&255)

	n := 0.0
	if t0 := 0.5 - x0*x0 - y0*y0; t0 > 0 {
		g := &grad[s.perm[ii+int(s.perm[jj])]&15]
		t0 *= t0
		n += t0 * t0 * (g[0]*x0 + g[1]*y0)
	}
	if t1 := 0.5 - x1*x1 - y1*y1; t1 > 0 {
		g := &grad[s.perm[ii+int(i1)+int(s.perm[jj+int(j1)])]&15]
		t1 *= t1
		n += t1 * t1 * (g[0]*x1 + g[1]*y1)
	}
	if t2 := 0.5 - x2*x2 - y2*y2; t2 > 0 {
		g := &grad[s.perm[ii+1+int(s.perm[jj+1])]&15]
		t2 *= t2
		n += t2 * t2 * (g[0]*x2 + g[1]*y2)
	}
	return norm * n
}

// EvalD returns the noise value and its partial derivatives with respect to x and y.
func (s *Source) EvalD(x, y float64) (v, dx, dy float64) {
	x += s.ox
	y += s.oy
	f := (x + y) * skew
	i, j := floor(x+f), floor(y+f)
	t := float64(i+j) * unskew
	x0, y0 := x-(float64(i)-t), y-(float64(j)-t)
	var i1, j1 int64 = 0, 1
	if x0 > y0 {
		i1, j1 = 1, 0
	}
	x1, y1 := x0-float64(i1)+unskew, y0-float64(j1)+unskew
	x2, y2 := x0-1+2*unskew, y0-1+2*unskew
	ii, jj := int(i&255), int(j&255)

	// For each corner: n = t^4 (g . d); dn/dx = t^4 gx - 8 t^3 dx (g . d).
	if t0 := 0.5 - x0*x0 - y0*y0; t0 > 0 {
		g := &grad[s.perm[ii+int(s.perm[jj])]&15]
		gd := g[0]*x0 + g[1]*y0
		t2 := t0 * t0
		t4 := t2 * t2
		k := 8 * t2 * t0 * gd
		v += t4 * gd
		dx += t4*g[0] - k*x0
		dy += t4*g[1] - k*y0
	}
	if t1 := 0.5 - x1*x1 - y1*y1; t1 > 0 {
		g := &grad[s.perm[ii+int(i1)+int(s.perm[jj+int(j1)])]&15]
		gd := g[0]*x1 + g[1]*y1
		t2 := t1 * t1
		t4 := t2 * t2
		k := 8 * t2 * t1 * gd
		v += t4 * gd
		dx += t4*g[0] - k*x1
		dy += t4*g[1] - k*y1
	}
	if t2c := 0.5 - x2*x2 - y2*y2; t2c > 0 {
		g := &grad[s.perm[ii+1+int(s.perm[jj+1])]&15]
		gd := g[0]*x2 + g[1]*y2
		t2 := t2c * t2c
		t4 := t2 * t2
		k := 8 * t2 * t2c * gd
		v += t4 * gd
		dx += t4*g[0] - k*x2
		dy += t4*g[1] - k*y2
	}
	return norm * v, norm * dx, norm * dy
}

// Octave offsets: each octave samples a shifted copy of the lattice so octaves do
// not line up their zeros.
const (
	octX = 37.31
	octY = 17.73
)

// FBM sums octaves of noise (fractional Brownian motion) and normalises the result
// to roughly [-1, 1]. lacunarity is the frequency multiplier per octave (about 2),
// gain the amplitude multiplier (about 0.5).
func (s *Source) FBM(x, y float64, octaves int, lacunarity, gain float64) float64 {
	sum, amp, tot := 0.0, 1.0, 0.0
	for o := 0; o < octaves; o++ {
		sum += amp * s.Eval(x, y)
		tot += amp
		amp *= gain
		x = x*lacunarity + octX
		y = y*lacunarity + octY
	}
	return sum / tot
}

// FBMD is FBM with analytic partial derivatives.
func (s *Source) FBMD(x, y float64, octaves int, lacunarity, gain float64) (v, dx, dy float64) {
	amp, tot, freq := 1.0, 0.0, 1.0
	for o := 0; o < octaves; o++ {
		n, nx, ny := s.EvalD(x, y)
		v += amp * n
		dx += amp * freq * nx
		dy += amp * freq * ny
		tot += amp
		amp *= gain
		freq *= lacunarity
		x = x*lacunarity + octX
		y = y*lacunarity + octY
	}
	inv := 1 / tot
	return v * inv, dx * inv, dy * inv
}

// Ridged returns ridged multifractal noise in [0, 1]: sharp crests where the
// underlying noise crosses zero, with detail concentrated on the ridges (each
// octave is weighted by the one before). Good for mountain ranges.
func (s *Source) Ridged(x, y float64, octaves int, lacunarity, gain float64) float64 {
	sum, amp, tot, weight := 0.0, 1.0, 0.0, 1.0
	for o := 0; o < octaves; o++ {
		n := 1 - math.Abs(s.Eval(x, y))
		n *= n
		sum += amp * n * weight
		tot += amp
		weight = n * 1.6
		if weight > 1 {
			weight = 1
		}
		amp *= gain
		x = x*lacunarity + octX
		y = y*lacunarity + octY
	}
	return sum / tot
}

// Warp displaces (x, y) by up to amp in each axis using two decorrelated samples of
// this layer. Feed the result into another layer for organic, non-blobby shapes.
func (s *Source) Warp(x, y, amp float64) (wx, wy float64) {
	return x + amp*s.Eval(x, y), y + amp*s.Eval(x+91.7, y-53.9)
}

// WarpD is Warp with the Jacobian of the mapping:
// j = [dwx/dx, dwx/dy, dwy/dx, dwy/dy].
func (s *Source) WarpD(x, y, amp float64) (wx, wy float64, j [4]float64) {
	a, ax, ay := s.EvalD(x, y)
	b, bx, by := s.EvalD(x+91.7, y-53.9)
	return x + amp*a, y + amp*b, [4]float64{1 + amp*ax, amp * ay, amp * bx, 1 + amp*by}
}

// ---------------------------------------------------------------------------
// Hashing and a tiny PRNG for deterministic per-cell decisions.

// Mix is the splitmix64 finaliser: a strong 64-bit integer hash.
func Mix(v uint64) uint64 {
	v += 0x9e3779b97f4a7c15
	v = (v ^ (v >> 30)) * 0xbf58476d1ce4e5b9
	v = (v ^ (v >> 27)) * 0x94d049bb133111eb
	return v ^ (v >> 31)
}

// Hash2 hashes a seed with two signed lattice coordinates.
func Hash2(seed uint64, x, y int64) uint64 {
	h := Mix(seed ^ 0x51ed270b1f4c9a3d)
	h = Mix(h ^ uint64(x)*0x9e3779b97f4a7c15)
	h = Mix(h ^ uint64(y)*0xc2b2ae3d27d4eb4f)
	return h
}

// HashString hashes a seed with a string (FNV-1a folded through Mix).
func HashString(seed uint64, s string) uint64 {
	h := uint64(14695981039346656037)
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return Mix(h ^ Mix(seed))
}

// RNG is a splitmix64 generator. The zero value is usable; copy by value freely.
type RNG struct{ state uint64 }

// NewRNG returns a generator for a seed.
func NewRNG(seed uint64) RNG { return RNG{state: Mix(seed)} }

// Uint64 returns the next 64 random bits.
func (r *RNG) Uint64() uint64 {
	r.state += 0x9e3779b97f4a7c15
	z := r.state
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// Float64 returns a uniform value in [0, 1).
func (r *RNG) Float64() float64 { return float64(r.Uint64()>>11) / (1 << 53) }

// Range returns a uniform value in [lo, hi).
func (r *RNG) Range(lo, hi float64) float64 { return lo + (hi-lo)*r.Float64() }

// Intn returns a uniform integer in [0, n). n must be > 0.
func (r *RNG) Intn(n int) int { return int((r.Uint64() >> 33) % uint64(n)) }

// Chance reports true with probability p.
func (r *RNG) Chance(p float64) bool { return r.Float64() < p }
