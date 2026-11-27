package field

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Clarity tuning (spec §6.1, §6.2; contract §3.3.3).
//
// Clarity is the product of independent 0..1 factors:
//
//	size × foliage × light × weather × motion × optics
//
// Reference points this tuning hits with base stats in daylight (the client draws
// birds a little larger than life and parts the leaves in front of nearby birds,
// so the naked eye reaches further than it would in a real wood):
//   - 8× binoculars, robin on an exposed branch (cover 0.2) at 25 m: ≈ 0.79
//   - 6× binoculars, robin on an exposed branch at 30-40 m: ≈ 0.76-0.72, every
//     trait in ≈ 10 s
//   - same view, a wren deep in a shrub (cover 0.6, skulking 0.9):   ≈ 0.39 (no marking)
//   - naked eye, robin in the open: noticed to ≈ 22 m, ≈ 0.22 at 20 m (size and
//     shape), ≈ 0.36 at 17 m (colours), ≈ 0.58 at 12 m, ≈ 0.80 at 7 m
const (
	// Apparent size. A bird of refLength is workable to nakedEyeRange metres with
	// the unaided eye; reach scales with magnification and (length/ref)^sizeCurve,
	// so a heron reads at ~80 m and a buzzard through 6× glasses at ~280 m.
	nakedEyeRange = 20   // metres (× Stats.NakedEye)
	refLength     = 0.14 // metres: robin-sized
	sizeCurve     = 0.7
	wingspanShare = 0.6  // an airborne bird presents this share of its wingspan
	sizeFull      = 1.25 // size factor = clamp(sizeFull − dist/reach): 1.0 inside a quarter of the reach, 0.25 at the reach

	// Foliage. A bird's own cover hides it in proportion to how deep it sits:
	// hide = cover × (coverBold + coverSkulk·Skulking); factor = (1 − occlusion) × (1 − coverCut·hide).
	coverBold   = 0.3  // a bold bird sits at the edge of a bush or on an open twig …
	coverSkulk  = 0.62 // … a skulker deep inside it
	coverCut    = 0.9
	hiddenCover = 0.92 // a bird that has ducked into hiding counts as at least this covered
	roostCover  = 0.15 // extra cover for a roosting bird, tucked away

	// Camouflage only works on a still bird: factor = 1 − camoCut × Camo × stillness.
	camoCut       = 0.35
	stillPerched  = 1.0
	stillBusy     = 0.4 // foraging, feeding, preening, wading…
	stillAirborne = 0

	// Light: factor = lightFloor + (1 − lightFloor)·Light^lightCurve, then low-light
	// ability (Stats.LowLight, plus part of BinoClarity through glasses) recovers up
	// to lowLightReach of what was lost.
	lightFloor    = 0.12
	lightCurve    = 0.6
	lowLightReach = 0.8
	glassLowLight = 0.3 // share of BinoClarity that counts as low-light ability

	// Weather.
	rainCut  = 0.45 // clarity lost in a downpour (× (1 − Stats.RainProof))
	mistCut  = 0.6  // clarity lost in thick mist at mistDist metres or more
	mistDist = 80

	// Motion. Airborne birds are hard to study; magnification makes tracking
	// harder; so does walking with the glasses up.
	trackPerZoom  = 0.04 // extra bird-motion penalty per × of magnification
	ownStillSpeed = 1.2  // m/s below which the observer's own movement costs nothing
	ownMoveSpan   = 5    // m/s over which the own-movement penalty ramps up
	ownMoveCut    = 0.5  // penalty at a sprint, naked eye
	ownPerZoom    = 0.1  // growth of the own-movement penalty per × of magnification
	ownMoveMax    = 0.8

	// Optics. Glass is never perfect; out of focus still shows size and shape.
	glassBase   = 0.85 // optical factor of binoculars at BinoClarity 0 (1.0 at BinoClarity 1)
	cameraGlass = 0.9  // optical factor of a camera viewfinder
	blurFloor   = 0.25 // fraction of clarity left when completely out of focus

	// Blocked reason: named whenever clarity is under blockedBelow.
	blockedBelow = 0.65
	blockedMinor = 0.85 // if only soft focus holds the view back, a factor above this is not blamed
)

// Motion penalty by activity (fraction of clarity lost at 1× magnification).
var actMotion = [core.ActCount]float32{
	core.ActFlying:   0.35,
	core.ActFleeing:  0.50,
	core.ActSoaring:  0.15,
	core.ActHovering: 0.10,
	core.ActDiving:   0.45,
	core.ActForaging: 0.05,
	core.ActBathing:  0.05,
	core.ActSocial:   0.08,
}

// View describes how well one bird can be seen from a pose right now.
type View struct {
	Clarity float32 // 0..1
	// Blocked names the dominant reason clarity is low:
	// ""|foliage|distance|dark|rain|motion (proto.Sighting.Blocked vocabulary).
	Blocked string
	Dist    float32 // metres from the eye
	Angle   float32 // radians off the view axis

	// The factors whose product is Clarity (each 0..1; 1 = no loss).
	Size    float32 // apparent size: distance, magnification, the bird's size
	Foliage float32 // terrain / foliage occlusion, the bird's cover, camouflage
	Light   float32 // daylight, helped by LowLight and bright glass
	Weather float32 // rain and mist
	Motion  float32 // the bird's flight and the observer's own movement
	Optics  float32 // glass quality and optical focus (Pose.Sharp)
}

// Clarity computes how clearly the bird b can be seen from pose p (spec §6.1): the
// combination of apparent size, foliage and cover, light, weather, motion and optics.
// It does not care where the player is looking — View.Angle reports that; Watch
// applies the view-cone rules.
func Clarity(c *Context, b core.BirdState, p proto.Pose) View {
	sp := c.SpeciesAt(b.Species)
	if sp == nil {
		return View{}
	}
	eye := Eye(p)
	extent := sp.Look.Length
	if b.Act.Airborne() && sp.Look.Wingspan*wingspanShare > extent {
		extent = sp.Look.Wingspan * wingspanShare
	}
	// Foliage, cover and camouflage.
	foliage := sightline(c, eye, b, sp) * (1 - camoCut*clamp01(sp.Behavior.Camo)*stillness(b.Act))
	return viewOf(c, p, b.Pos, extent, foliage, actMotion[b.Act%core.ActCount])
}

// viewOf is the clarity model shared by birds and nests: an object of the given
// extent (metres) at pos, with its foliage factor already worked out, moving with
// the given motion penalty (fraction of clarity lost at 1x), seen from pose p.
func viewOf(c *Context, p proto.Pose, pos core.Vec3, extent, foliage, motion float32) View {
	st, env := c.Stats, c.Env
	eye := Eye(p)
	o := opticsOf(p, st)

	v := View{Dist: eye.Dist(pos)}
	v.Angle = angleBetween(core.LookDir(p.Yaw, p.Pitch), pos.Sub(eye))

	// Apparent size.
	reach := nakedEyeRange * pow32(maxf(extent, 0.02)/refLength, sizeCurve) * maxf(o.zoom+(st.NakedEye-1), 0.1)
	v.Size = clamp01(sizeFull - v.Dist/reach)
	if v.Dist > MaxSightRange {
		v.Size = 0
	}

	v.Foliage = clamp01(foliage)

	// Light.
	v.Light = lightFloor + (1-lightFloor)*pow32(clamp01(env.Light), lightCurve)
	aid := st.LowLight
	if o.kind == opticsBinoculars {
		aid += glassLowLight * st.BinoClarity
	}
	v.Light += (1 - v.Light) * lowLightReach * clamp01(aid)

	// Weather.
	v.Weather = (1 - rainCut*clamp01(env.Rain)*(1-clamp01(st.RainProof))) *
		(1 - mistCut*clamp01(env.Mist)*clamp01(v.Dist/mistDist))

	// Motion.
	objMove := clamp01(motion * (1 + trackPerZoom*(o.zoom-1)))
	ownMove := clamp01((p.Speed-ownStillSpeed)/ownMoveSpan) * ownMoveCut * (1 + ownPerZoom*(o.zoom-1))
	v.Motion = (1 - objMove) * (1 - minf(ownMove, ownMoveMax))

	// Optics.
	focus := float32(1)
	v.Optics = 1
	switch o.kind {
	case opticsBinoculars:
		v.Optics = glassBase + (1-glassBase)*clamp01(st.BinoClarity)
	case opticsCamera:
		v.Optics = cameraGlass
	}
	if o.kind != opticsNone {
		focus = blurFloor + (1-blurFloor)*o.sharp
		v.Optics *= focus
	}

	v.Clarity = clamp01(v.Size * v.Foliage * v.Light * v.Weather * v.Motion * v.Optics)
	v.Blocked = blockedReason(v, focus)
	return v
}

// sightline is the 0..1 fraction of the bird left visible by terrain, foliage along
// the line of sight and the cover of its own perch. Shared with photo scoring.
func sightline(c *Context, eye core.Vec3, b core.BirdState, sp *core.Species) float32 {
	occ := clamp01(c.Terrain.Occlusion(eye, b.Pos))
	// A trunk the client draws hides what is squarely behind it (the world's crown
	// occlusion does not count wood): no evidence through solid wood.
	if tt, ok := c.Terrain.(trunkTerrain); ok && occ < 1 {
		occ = maxf(occ, clamp01(tt.TrunkOcclusion(eye, b.Pos.Add(core.V(0, trunkBodyY, 0)))))
	}
	hide := clamp01(b.Cover) * (coverBold + coverSkulk*clamp01(sp.Behavior.Skulking))
	switch {
	case b.Act.Airborne():
		hide = 0
	case b.Act == core.ActHiding || b.Flags&core.FlagHidden != 0:
		hide = maxf(hide, hiddenCover)
	case b.Act == core.ActRoosting:
		hide = minf(hide+roostCover, 1)
	}
	return (1 - occ) * (1 - coverCut*hide)
}

func stillness(a core.BirdAct) float32 {
	switch {
	case a.Airborne():
		return stillAirborne
	case a == core.ActPerched, a == core.ActRoosting, a == core.ActHiding, a == core.ActAlert:
		return stillPerched
	}
	return stillBusy
}

// blockedReason names the factor that costs the most clarity. Soft focus has no
// word in the vocabulary (the player sees the blur): when it is the main culprit
// and nothing else is notably wrong, no reason is given.
func blockedReason(v View, focus float32) string {
	if v.Clarity >= blockedBelow {
		return ""
	}
	reasons := [...]struct {
		name string
		f    float32
	}{
		{"distance", v.Size}, {"foliage", v.Foliage}, {"dark", v.Light}, {"rain", v.Weather}, {"motion", v.Motion},
	}
	worst := reasons[0]
	for _, r := range reasons[1:] {
		if r.f < worst.f {
			worst = r
		}
	}
	if focus < worst.f && worst.f >= blockedMinor {
		return ""
	}
	return worst.name
}

// trunkTerrain is implemented by a terrain that can tell how much of a target the
// tree trunks in a sight line hide (world.World.TrunkOcclusion); optional, so test
// terrains without trees need nothing.
type trunkTerrain interface {
	TrunkOcclusion(from, to core.Vec3) float32
}

// trunkBodyY lifts the trunk test from a bird's feet to its body (m).
const trunkBodyY = 0.08
