package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// circle is a disc on the ground plane.
type circle struct{ x, z, r float64 }

func (c circle) dist(x, z float64) float64 { return hypot(x-c.x, z-c.z) }

// pad is a flattened disc under a structure or collectible: level at y within r,
// eased back into the surrounding ground over blend metres.
type pad struct{ x, z, r, blend, y float64 }

// apply returns the padded height and how strongly the pad applies (0..1).
func (p *pad) apply(x, z, h float64) (float64, float64) {
	d := hypot(x-p.x, z-p.z)
	if d >= p.r+p.blend {
		return h, 0
	}
	if d <= p.r {
		return p.y, 1
	}
	w := 1 - smoothstep(p.r, p.r+p.blend, d)
	return lerp(h, p.y, w), w
}

// pond is a small carved pool: water (below y = 0) within about rWater of the
// centre, a low damp shore, and a bowl easing back to the natural ground at rRim.
type pond struct{ x, z, rWater, rRim, depth float64 }

func (p *pond) apply(x, z, h float64) float64 {
	d := hypot(x-p.x, z-p.z)
	if d >= p.rRim {
		return h
	}
	inner := p.rWater + 2
	if d < inner {
		return lerp(-p.depth, 0.55, smoothstep(p.rWater-5, inner, d))
	}
	return lerp(0.55, h, smoothstep(inner, p.rRim, d))
}

// structure is something birds can perch on: a roof, a rail, a tower top.
type structure struct {
	x, z   float64
	y      float64 // ground (pad) height at the footprint
	height float64 // metres above y
	r      float64 // footprint radius
}

// structureHeight is the roof / top height of a structure of the given POI kind,
// or 0 if the kind has nothing to perch on.
func structureHeight(kind string) (height, radius float64) {
	switch kind {
	case "cabin":
		return 4.6, 3.5
	case "ranger_station":
		return 4.2, 3.5
	case "watchtower":
		return 11.5, 1.8
	case "shop":
		return 2.7, 2.0
	case "research_site":
		return 2.5, 2.2
	case "hide":
		return 2.8, 2.0
	case "hidden_cabin":
		return 2.9, 2.6
	case "abandoned_station":
		return 3.4, 3.0
	case "camp":
		return 1.6, 1.6
	}
	return 0, 0
}

// poiRadius is the discovery / interaction radius for a POI kind (contract §2.2).
func poiRadius(kind string) float32 {
	switch kind {
	case "npc", "cache", "feather", "page", "relic":
		return 3
	}
	return 14
}

// vec converts generator coordinates to a wire position.
func vec(x, y, z float64) core.Vec3 { return core.Vec3{X: float32(x), Y: float32(y), Z: float32(z)} }

// heading is the compass heading (0 = north = -Z, pi/2 = east = +X) of direction (dx, dz).
func heading(dx, dz float64) float64 {
	h := math.Atan2(dx, -dz)
	if h < 0 {
		h += 2 * math.Pi
	}
	return h
}

// headingDir is the unit direction (dx, dz) of a compass heading.
func headingDir(yaw float64) (dx, dz float64) { return math.Sin(yaw), -math.Cos(yaw) }
