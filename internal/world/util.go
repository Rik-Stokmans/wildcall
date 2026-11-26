package world

import "math"

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clamp01(v float64) float64 { return clamp(v, 0, 1) }

func lerp(a, b, t float64) float64 { return a + (b-a)*t }

// smoothstep is the cubic Hermite step: 0 at x <= a, 1 at x >= b. a may be greater
// than b for a falling edge.
func smoothstep(a, b, x float64) float64 {
	t := clamp01((x - a) / (b - a))
	return t * t * (3 - 2*t)
}

// smoothstepD returns smoothstep and its derivative with respect to x.
func smoothstepD(a, b, x float64) (v, dv float64) {
	t := (x - a) / (b - a)
	if t <= 0 {
		return 0, 0
	}
	if t >= 1 {
		return 1, 0
	}
	return t * t * (3 - 2*t), 6 * t * (1 - t) / (b - a)
}

// smax is a smooth maximum; k is the width of the blend where a and b are close.
func smax(a, b, k float64) float64 {
	d := a - b
	return 0.5 * (a + b + math.Sqrt(d*d+k*k))
}

func hypot(x, z float64) float64 { return math.Sqrt(x*x + z*z) }

// floorDiv is integer division rounding towards negative infinity (b > 0).
func floorDiv(a, b int) int {
	q := a / b
	if a%b != 0 && a < 0 {
		q--
	}
	return q
}

func floorInt(v float64) int { return int(math.Floor(v)) }

// distSeg returns the distance from (px,pz) to segment a-b and the parameter t
// (0..1) of the closest point.
func distSeg(px, pz, ax, az, bx, bz float64) (d, t float64) {
	dx, dz := bx-ax, bz-az
	l2 := dx*dx + dz*dz
	if l2 > 1e-12 {
		t = clamp01(((px-ax)*dx + (pz-az)*dz) / l2)
	}
	cx, cz := ax+dx*t-px, az+dz*t-pz
	return math.Sqrt(cx*cx + cz*cz), t
}

type rgb struct{ r, g, b float64 }

func (c rgb) mix(o rgb, t float64) rgb {
	return rgb{c.r + (o.r-c.r)*t, c.g + (o.g-c.g)*t, c.b + (o.b-c.b)*t}
}

func (c rgb) scale(k float64) rgb { return rgb{c.r * k, c.g * k, c.b * k} }

func (c rgb) add(o rgb, k float64) rgb { return rgb{c.r + o.r*k, c.g + o.g*k, c.b + o.b*k} }

func to8(v float64) uint8 {
	if v <= 0 {
		return 0
	}
	if v >= 255 {
		return 255
	}
	return uint8(v + 0.5)
}
