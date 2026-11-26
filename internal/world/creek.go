package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// creek is the home valley's stream: a gently meandering line crossing the valley
// near the origin. It is described as a curve in a rotated frame: t runs along the
// valley (unit vector u), the lateral coordinate l (unit vector v) of the centre line
// is off + m(t). Downstream is +u.
//
// The home layout is placed in "valley coordinates" (a, b): a is the position along
// the creek, b the perpendicular distance from its centre line, positive on the side
// of the origin (the cabin side).
type creek struct {
	ux, uz float64 // along-valley unit vector (downstream)
	vx, vz float64 // lateral unit vector
	off    float64 // lateral offset of the centre line from the origin
	sigma  float64 // sign(off): the cabin side is at smaller sigma*l
	a1, l1 float64 // primary meander amplitude / wavelength scale
	a2, l2 float64 // secondary meander
	p1, p2 float64 // phases
}

func newCreek(r *noise.RNG) creek {
	ang := r.Range(0, 2*math.Pi)
	c := creek{
		ux: math.Cos(ang), uz: math.Sin(ang),
		a1: r.Range(22, 32), l1: r.Range(62, 80),
		a2: r.Range(5, 9), l2: r.Range(22, 30),
		p1: r.Range(0, 2*math.Pi), p2: r.Range(0, 2*math.Pi),
	}
	c.vx, c.vz = -c.uz, c.ux
	c.off = r.Range(150, 180)
	c.sigma = 1
	if r.Chance(0.5) {
		c.off, c.sigma = -c.off, -1
	}
	return c
}

// meander returns m(t) and m'(t).
func (c *creek) meander(t float64) (m, dm float64) {
	s1, c1 := math.Sincos(t/c.l1 + c.p1)
	s2, c2 := math.Sincos(t/c.l2 + c.p2)
	return c.a1*s1 + c.a2*s2, c.a1/c.l1*c1 + c.a2/c.l2*c2
}

// signed returns an estimate of the signed distance (metres) from (x, z) to the
// creek centre line, positive on the +v side, and its gradient (unit length).
func (c *creek) signed(x, z float64) (d, gx, gz float64) {
	t := x*c.ux + z*c.uz
	l := x*c.vx + z*c.vz
	m, dm := c.meander(t)
	k := 1 / math.Sqrt(1+dm*dm)
	d = (l - c.off - m) * k
	gx = (c.vx - dm*c.ux) * k
	gz = (c.vz - dm*c.uz) * k
	return
}

// along returns the position along the valley (metres) of (x, z).
func (c *creek) along(x, z float64) float64 { return x*c.ux + z*c.uz }

// at maps valley coordinates (a along, b perpendicular towards the cabin side) to
// world (x, z).
func (c *creek) at(a, b float64) (x, z float64) {
	m, dm := c.meander(a)
	l := c.off + m - c.sigma*b*math.Sqrt(1+dm*dm)
	return a*c.ux + l*c.vx, a*c.uz + l*c.vz
}

// local maps world (x, z) to valley coordinates (a, b).
func (c *creek) local(x, z float64) (a, b float64) {
	d, _, _ := c.signed(x, z)
	return c.along(x, z), -c.sigma * d
}
