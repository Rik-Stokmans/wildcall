package field

import (
	"math/rand/v2"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Movement-cue tuning (spec §6.1 "Players discover birds through movement";
// contract §3.3.2). A cue is a soft ripple roughly where something moved. It is
// jittered on purpose: it says "over there", never "this bird".
const (
	cueAspect      = 1.6  // assumed screen aspect for the "inside the view" test (pose carries none)
	cueFlushBoost  = 1.4  // a flushed bird bursting away is noticed this much farther than a hop
	cueRefLength   = 0.14 // metres: a robin-sized bird is noticed at exactly MoveSense
	cueSizeCurve   = 0.5  // bigger birds are noticed farther: (length / ref)^curve …
	cueSizeMin     = 0.7  // … clamped to this range
	cueSizeMax     = 2.5
	cueDarkFloor   = 0.35 // fraction of in-view range left in full darkness
	cueOccBlock    = 0.9  // occlusion at which an in-view movement is simply not seen
	cueOccTerrain  = 0.99 // occlusion (solid ground) at which even a peripheral rustle is lost
	cueOccFade     = 0.7  // strength lost behind full occlusion
	cueMinStrength = 0.12 // every cue that fires is at least this visible
	// Jitter (1 sigma, degrees): base + extra·(1 − strength).
	cueJitterInBase   = 1.5
	cueJitterInExtra  = 3
	cueJitterOutBase  = 6
	cueJitterOutExtra = 10
)

// MoveCue turns an EvMove / EvFlush into the subtle hint the player may notice
// (Sharp Eyes, Movement Recognition, Peripheral Awareness): inside the view when the
// bird is within Stats.MoveSense metres (scaled by magnification, the bird's size and
// the light, and blocked by foliage), or outside the view when it is within
// Stats.Peripheral metres. Other event kinds never produce a cue.
// rng jitters the reported direction; nil means no jitter.
func MoveCue(c *Context, ev core.EcoEvent, p proto.Pose, rng *rand.Rand) (proto.MoveCue, bool) {
	if ev.Kind != core.EvMove && ev.Kind != core.EvFlush {
		return proto.MoveCue{}, false
	}
	st := c.Stats
	eye := Eye(p)
	dist := eye.Dist(ev.Pos)
	if dist < 0.2 {
		return proto.MoveCue{}, false
	}
	cam := newCamera(eye, p.Yaw, p.Pitch, halfFOV(p, st), cueAspect)
	inView := cam.inFrame(cam.project(ev.Pos))
	occ := clamp01(c.Terrain.Occlusion(eye, ev.Pos))

	boost := float32(1)
	if ev.Kind == core.EvFlush {
		boost = cueFlushBoost
	}

	var limit float32
	if inView {
		if occ >= cueOccBlock {
			return proto.MoveCue{}, false
		}
		size := float32(1)
		if sp := c.SpeciesAt(ev.Species); sp != nil {
			size = clamp(pow32(sp.Look.Length/cueRefLength, cueSizeCurve), cueSizeMin, cueSizeMax)
		}
		light := cueDarkFloor + (1-cueDarkFloor)*sqrt32(clamp01(c.Env.Light))
		limit = st.MoveSense * opticsOf(p, st).zoom * size * light * boost
	} else {
		// Out of view the cue is as much a rustle or a wing-clap as a glimpse:
		// foliage and darkness do not stop it, solid ground does.
		if occ >= cueOccTerrain {
			return proto.MoveCue{}, false
		}
		limit = st.Peripheral * boost
	}
	if limit <= 0 || dist > limit {
		return proto.MoveCue{}, false
	}

	strength := pow32(clamp01(1-dist/limit), 0.8) * (1 - cueOccFade*occ)
	strength = clamp(strength, cueMinStrength, 1)

	jitter := rad(cueJitterInBase + cueJitterInExtra*(1-strength))
	if !inView {
		jitter = rad(cueJitterOutBase + cueJitterOutExtra*(1-strength))
	}
	bearing, elev := core.HeadingTo(eye, ev.Pos), elevationOf(eye, ev.Pos)
	if rng != nil {
		bearing += clamp(float32(rng.NormFloat64()), -2, 2) * jitter
		elev += clamp(float32(rng.NormFloat64()), -2, 2) * jitter
	}
	return proto.MoveCue{
		Bearing:  wrapTwoPi(bearing),
		Elev:     clamp(elev, -rad(89), rad(89)),
		InView:   inView,
		Strength: strength,
	}, true
}
