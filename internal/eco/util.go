package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// mix is the splitmix64 finaliser: a cheap, well-distributed 64-bit hash. Everything
// that must be a pure function of (seed, cell, individual) - who lives where, what
// they look like, where a bird is at a given hour - is derived with it rather than
// from the running random stream, so it does not depend on the order of events.
func mix(x uint64) uint64 {
	x ^= x >> 30
	x *= 0xBF58476D1CE4E5B9
	x ^= x >> 27
	x *= 0x94D049BB133111EB
	x ^= x >> 31
	return x
}

func hash2(a, b uint64) uint64 { return mix(mix(a+0x9E3779B97F4A7C15) ^ b*0xD6E8FEB86659FD93) }

// unit maps a hash onto [0,1).
func unit(h uint64) float32 { return float32(h>>40) / float32(1<<24) }

func sqrt32(v float32) float32 { return float32(math.Sqrt(float64(v))) }
func sin32(v float32) float32  { return float32(math.Sin(float64(v))) }
func cos32(v float32) float32  { return float32(math.Cos(float64(v))) }

func clamp(v, lo, hi float32) float32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func max32(a, b float32) float32 {
	if a > b {
		return a
	}
	return b
}

func min32(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}

func lerp(a, b, t float32) float32 { return a + (b-a)*t }

// heading is the compass heading (0 = north = -Z, pi/2 = east = +X) of a
// horizontal direction.
func heading(dx, dz float32) float32 {
	h := float32(math.Atan2(float64(dx), float64(-dz)))
	if h < 0 {
		h += 2 * math.Pi
	}
	return h
}

func distXZ2(a, b core.Vec3) float32 {
	dx, dz := a.X-b.X, a.Z-b.Z
	return dx*dx + dz*dz
}

func dist2(a, b core.Vec3) float32 {
	dx, dy, dz := a.X-b.X, a.Y-b.Y, a.Z-b.Z
	return dx*dx + dy*dy + dz*dz
}

// rnd returns a uniform value in [lo, hi) from the simulation's random stream.
func (s *Sim) rnd(lo, hi float32) float32 { return lo + (hi-lo)*s.rng.Float32() }

// chance reports true with probability p.
func (s *Sim) chance(p float32) bool { return s.rng.Float32() < p }
