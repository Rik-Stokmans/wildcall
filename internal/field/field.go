// Package field is WILDCALL's perception layer: everything about what the player can
// actually hear, notice, see, deduce and capture, computed from the true world state.
//
// The client never decides that a bird was heard, seen, identified, photographed or
// recorded. The session feeds this package the truth (ecosystem events and bird
// states, the terrain, the weather, the player's pose and derived stats) and gets back
// exactly what the player is entitled to perceive:
//
//	Hear + ClueBoard     a vocalization → an audio clue (never a species name unless known)
//	MoveCue              a take-off / hop / flush → a subtle "something moved" hint
//	Clarity + Watch      looking at a bird → clarity, evidence, recognition
//	Candidates           evidence → the identification confidence table
//	ScorePhoto           a shutter press → sub-scores, stars, tags, feedback
//	Recording + CallLog  a recording window → quality, the captured voice, feedback
//	Rare*                when an observation / photo / identification is a rare discovery
//
// Design rules this package enforces (spec §35 rules 1, 2, 7):
//   - Discovery is earned. Nothing here marks a bird. A clue or sighting of a species
//     the player has not identified never carries its id or name in any field, and a
//     bird the player cannot make out produces no sighting at all.
//   - Focused listening and better gear improve the numbers (range, bearing error,
//     band width); they never add knowledge the player has not earned.
//   - Rarity is not announced: rare-discovery helpers only speak about a species once
//     the player has identified it.
//
// Typical session wiring (10 Hz tick, 4 Hz observation):
//
//	ctx := field.Context{Terrain: t, Species: catalog, Env: env, Stats: p.Stats,
//	    Know: field.ProfileKnowledge{P: p}, Regions: p.Regions}
//	for _, ev := range eco.Step(dt, env, obs) {
//	    switch ev.Kind {
//	    case core.EvCall:
//	        bird, _ := eco.Get(ev.Bird)
//	        calls.Add(ev, bird.Flags)                       // field.CallLog, for the recorder
//	        if h, ok := field.Hear(&ctx, ev, bird, pose, rng); ok {
//	            // create / update the mystery when h.NewVoice, then h.Clue.Mystery = id
//	            for _, c := range board.Offer(h, p.Stats.ClueSlots) { send("clue", c) }
//	        }
//	    case core.EvMove, core.EvFlush:
//	        if cue, ok := field.MoveCue(&ctx, ev, pose, rng); ok { send("cue", cue) }
//	    }
//	}
//	res := watch.Tick(&ctx, 0.25, pose, eco.Near(eye, field.MaxSightRange, buf))
//
// Everything is deterministic: all randomness comes from the *rand.Rand the caller
// injects, and there is no package-level mutable state.
package field

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// MaxSightRange is the farthest a bird can be observed or photographed, in metres.
// It matches the bird-snapshot radius of the session (contract §3.6): a bird that is
// not sent to the client is not drawn, so it cannot be seen.
const MaxSightRange float32 = 260

// Context bundles the world state every perception function reads. The session
// keeps one and refreshes Env, Stats and Regions when they change; it is cheap to
// build on the fly. A Context is read-only for this package.
type Context struct {
	Terrain core.Terrain
	// Species is the catalog; Species[i].Index must equal i.
	Species []core.Species
	Env     core.Env
	Stats   core.Stats
	// Know answers what the player already knows. nil means "knows nothing".
	Know Knowledge
	// Regions are the unlocked region ids (proto.Profile.Regions). The candidate
	// table only lists species of these region types; empty means no restriction.
	Regions []int
}

// SpeciesAt returns the catalog entry for a species index, or nil if out of range.
func (c *Context) SpeciesAt(i int) *core.Species {
	if i < 0 || i >= len(c.Species) {
		return nil
	}
	return &c.Species[i]
}

func (c *Context) know() Knowledge {
	if c.Know == nil {
		return noKnowledge{}
	}
	return c.Know
}

// Eye returns the eye position carried by a pose.
func Eye(p proto.Pose) core.Vec3 { return core.V(p.X, p.Y, p.Z) }

// ---------------------------------------------------------------------------
// Optics: what the pose says about magnification, sanitised against the stats so a
// confused or dishonest client cannot see farther than the equipment allows.

type opticsKind uint8

const (
	opticsNone opticsKind = iota // naked eye
	opticsBinoculars
	opticsCamera
)

type optics struct {
	kind  opticsKind
	zoom  float32 // magnification, >= 1
	sharp float32 // 0..1 optical focus; always 1 for the naked eye
}

const (
	defaultFOV    = 60 // vertical degrees assumed for a naked-eye pose that carries none
	defaultCamFOV = 50 // vertical degrees of the camera at 1x when a pose carries none
)

func opticsOf(p proto.Pose, st core.Stats) optics {
	o := optics{kind: opticsNone, zoom: 1, sharp: 1}
	if !p.Raised {
		return o
	}
	var limit float32
	switch p.Tool {
	case "binoculars":
		o.kind, limit = opticsBinoculars, st.BinoZoom
	case "camera":
		o.kind, limit = opticsCamera, st.CamZoom
	default:
		return o
	}
	zoom := p.Zoom
	if zoom < 1.01 && o.kind == opticsBinoculars && p.FOV > 0.5 && st.BinoFOV > 0 {
		// The pose carries no magnification: derive it from the true field of view
		// (true FOV = BinoFOV / zoom, see core.Stats.BinoFOV).
		zoom = st.BinoFOV / p.FOV
	}
	o.zoom = clamp(zoom, 1, maxf(limit, 1))
	o.sharp = clamp01(p.Sharp)
	return o
}

// halfFOV is half the vertical field of view of the pose in radians.
func halfFOV(p proto.Pose, st core.Stats) float32 {
	fov := p.FOV
	if fov <= 0.5 || fov > 150 {
		o := opticsOf(p, st)
		switch o.kind {
		case opticsBinoculars:
			fov = maxf(st.BinoFOV, 8) / o.zoom
		case opticsCamera:
			fov = defaultCamFOV / o.zoom
		default:
			fov = defaultFOV
		}
	}
	return rad(fov) / 2
}

// camera is a pinhole camera used to decide what is inside the view.
type camera struct {
	pos, fwd, right, up core.Vec3
	tanV, tanH          float32
}

func newCamera(pos core.Vec3, yaw, pitch, halfV, aspect float32) camera {
	fwd := core.LookDir(yaw, pitch)
	right := core.HeadingDir(yaw + math.Pi/2)
	tv := tan32(clamp(halfV, rad(0.25), rad(75)))
	return camera{pos: pos, fwd: fwd, right: right, up: cross(right, fwd), tanV: tv, tanH: tv * aspect}
}

// project maps a world point to normalised device coordinates (x right, y up; the
// frame spans -1..1 on both axes) and its depth along the view axis.
func (c camera) project(p core.Vec3) (x, y, depth float32) {
	d := p.Sub(c.pos)
	depth = d.Dot(c.fwd)
	if depth < 1e-3 {
		return 0, 0, depth
	}
	return d.Dot(c.right) / (depth * c.tanH), d.Dot(c.up) / (depth * c.tanV), depth
}

func (c camera) inFrame(x, y, depth float32) bool {
	return depth > 0.3 && absf(x) <= 1 && absf(y) <= 1
}

// ---------------------------------------------------------------------------
// Small float32 maths helpers.

func clamp(v, lo, hi float32) float32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clamp01(v float32) float32 { return clamp(v, 0, 1) }

func lerp(a, b, t float32) float32 { return a + (b-a)*t }

func absf(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

func minf(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}

func maxf(a, b float32) float32 {
	if a > b {
		return a
	}
	return b
}

func rad(deg float32) float32 { return deg * math.Pi / 180 }

func pow32(x, y float32) float32 {
	if x <= 0 {
		return 0
	}
	return float32(math.Pow(float64(x), float64(y)))
}

func sqrt32(x float32) float32 {
	if x <= 0 {
		return 0
	}
	return float32(math.Sqrt(float64(x)))
}

func tan32(x float32) float32 { return float32(math.Tan(float64(x))) }

func cross(a, b core.Vec3) core.Vec3 {
	return core.Vec3{X: a.Y*b.Z - a.Z*b.Y, Y: a.Z*b.X - a.X*b.Z, Z: a.X*b.Y - a.Y*b.X}
}

// angleBetween returns the angle in radians between two directions (0 for a
// degenerate vector, so a bird at the eye is "on axis" rather than NaN).
func angleBetween(a, b core.Vec3) float32 {
	la, lb := a.Len(), b.Len()
	if la < 1e-6 || lb < 1e-6 {
		return 0
	}
	return float32(math.Acos(float64(clamp(a.Dot(b)/(la*lb), -1, 1))))
}

// wrapTwoPi normalises a heading to 0..2π.
func wrapTwoPi(a float32) float32 {
	const two = 2 * math.Pi
	a = float32(math.Mod(float64(a), two))
	if a < 0 {
		a += two
	}
	return a
}

// wrapPi normalises an angle difference to -π..π.
func wrapPi(a float32) float32 {
	a = wrapTwoPi(a)
	if a > math.Pi {
		a -= 2 * math.Pi
	}
	return a
}

// elevationOf is the pitch (radians, + up) of the direction from → to.
func elevationOf(from, to core.Vec3) float32 {
	d := to.Sub(from)
	return float32(math.Atan2(float64(d.Y), float64(sqrt32(d.X*d.X+d.Z*d.Z))))
}

func roundInt(v float32) int { return int(math.Floor(float64(v) + 0.5)) }

// capitalise upper-cases the first letter of a lower-case vocabulary word
// ("very high" → "Very high").
func capitalise(s string) string {
	if s == "" {
		return s
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 'a' - 'A'
	}
	return string(b)
}

// starsFor maps a 0..100 score to the 1..5 star rating shared by photos and
// recordings (contract §3.3.5: 20/40/60/75/90). A score under 40 is still one star:
// something was captured.
func starsFor(score int) int {
	switch {
	case score >= 90:
		return 5
	case score >= 75:
		return 4
	case score >= 60:
		return 3
	case score >= 40:
		return 2
	}
	return 1
}
