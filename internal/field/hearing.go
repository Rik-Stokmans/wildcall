package field

import (
	"math"
	"math/rand/v2"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Hearing tuning (spec §5; contract §3.3.1).
//
// Audible range = call.AudibleRange() × HearRange × (1 + FocusBonus while focusing)
//
//	× (1 − occlusionCut·occlusion) × (1 − noise·(1 − NoiseReduce))
//
// With base stats a blackbird (Loud ≈ 0.7, 222 m) behind typical woodland foliage
// (occlusion 0.4) carries ≈ 175 m, so at 60 m it is a "Fair"-to-"Clear" voice; a
// goldcrest (Loud ≈ 0.12, 71 m) carries ≈ 55 m and is only a clear voice within
// about 20 m.
const (
	occlusionCut = 0.5  // fraction of range lost behind full occlusion (sound diffracts; it is never cut to zero)
	maxMasking   = 0.85 // even a storm leaves 15 % of the range: nearby birds can always be heard

	// Own-footstep noise: nothing when still or creeping, up to footNoiseMax at a sprint.
	footQuietSpeed = 1.0  // m/s below which the player makes no masking noise
	footLoudSpeed  = 6.5  // m/s (sprint) at which footsteps mask the most
	footNoiseMax   = 0.35 // masking noise added at a sprint
	crouchFootCut  = 0.5  // crouching halves footstep noise

	strengthCurve = 0.7 // perceived strength = (1 − dist/range)^curve: a call stays present until near the edge

	// Confidence words by perceived strength.
	strengthUncertain = 0.25
	strengthFair      = 0.50
	strengthClear     = 0.75

	// Bearing error (1 sigma) at DirAccuracy 0 and 1. A faint voice is harder to
	// place: sigma scales by faintErrBase − faintErrSlope·strength (1.35 … 0.75).
	sigmaVagueDeg   = 38
	sigmaPreciseDeg = 3
	faintErrBase    = 1.35
	faintErrSlope   = 0.6
	spreadSigmas    = 1.5  // reported ± spread = this many sigmas
	maxErrSigmas    = 2.0  // the error draw is clamped, so the truth is always within ~1.3 spreads
	focusDirBonus   = 0.15 // focused listening adds this to the effective DirAccuracy
	focusDistBonus  = 0.10 // … and this to the effective DistAcc

	preciseDirAcc = 0.6 // effective accuracy from which the direction word is 16-point
	elevationAcc  = 0.5 // effective accuracy from which the clue says above / level / below
	elevationDeg  = 12  // a source this far above / below the ear is "above" / "below"

	// Distance band: shown only when DistAcc > distGate. Its relative half-width goes
	// from bandWide (DistAcc 0) to bandTight (DistAcc 1); the band always contains
	// the true distance.
	distGate   = 0.1
	bandWide   = 0.60
	bandTight  = 0.08
	bandOffset = 0.6 // the band centre is off by up to this fraction of the half-width

	clueTTLPad = 4  // seconds a clue outlives its bout
	clueTTLMin = 6  // seconds
	clueTTLMax = 16 // seconds
)

// Heard is the result of Hear. Occ, Dist, Range and Noise are filled whether or not
// the call is audible (the session wants Occ for proto.CallMsg either way); the
// rest is only meaningful when Hear returned true.
type Heard struct {
	// Clue is ready to send, except Clue.Mystery when NewVoice is set: the session
	// creates the mystery and writes its id into the clue before offering it to the
	// ClueBoard.
	Clue proto.Clue

	Bird    uint32    // sound source (also Clue.ID)
	Species int       // true species index. Server-side only.
	Call    int       // index into Species.Calls
	Pos     core.Vec3 // true source position. Server-side only.

	Dist     float32 // true distance from the listener, metres
	Range    float32 // audible range of this call for this listener right now, metres
	Occ      float32 // 0..1 occlusion between listener and source (for proto.CallMsg.Occ)
	Noise    float32 // 0..1 masking noise at the listener (ambient, weather, own footsteps)
	Loudness float32 // 0..1 perceived strength (== Clue.Strength); 0 when inaudible

	// NewVoice: the species is unidentified and has no mystery yet (== Clue.New).
	NewVoice bool
	// Evidence is what this hearing legitimately adds to the species' evidence:
	// "pitch" / "pattern" / "habitat" (raw vocabulary values), each present only if
	// the clue shows it. Apply with MergeHeard. Primary tells whether it came from
	// the species' primary call (Calls[0]), which takes precedence.
	Evidence map[string]string
	Primary  bool

	sigma float32 // bearing error sigma used, radians (the ClueBoard refines with it)
	dir16 bool    // direction word resolution
}

// Hear decides whether the listener hears an EvCall and, if so, builds the audio clue
// (spec §5.2). bird is the caller's current state (Ecosystem.Get(ev.Bird)); a zero
// BirdState is acceptable and only loses the perch hint and the "unusual" flag.
// rng drives the bearing and distance estimate errors; nil means no error at all.
//
// The clue never names a species the player cannot recognise by ear: Known is set
// only for an identified species when CallRecognise >= 1, or CallMemory >= 1 and the
// player holds a recording of it. Focused listening extends the range and tightens
// the numbers (and temporarily shows pitch and pattern); it reveals nothing else.
func Hear(c *Context, ev core.EcoEvent, bird core.BirdState, p proto.Pose, rng *rand.Rand) (Heard, bool) {
	sp := c.SpeciesAt(ev.Species)
	if ev.Kind != core.EvCall || sp == nil || len(sp.Calls) == 0 {
		return Heard{}, false
	}
	ci := ev.Call
	if ci < 0 || ci >= len(sp.Calls) {
		ci = 0
	}
	call := sp.Calls[ci]
	st := c.Stats
	ear := Eye(p)

	h := Heard{Bird: ev.Bird, Species: ev.Species, Call: ci, Pos: ev.Pos, Primary: ci == 0}
	h.Dist = ear.Dist(ev.Pos)
	h.Occ = clamp01(c.Terrain.Occlusion(ear, ev.Pos))
	h.Noise = ListenerNoise(c, p)
	h.Range = AudibleRange(call, st, p.Focus, h.Occ, h.Noise)
	if h.Range <= 0 || h.Dist > h.Range {
		return h, false
	}

	strength := pow32(clamp01(1-h.Dist/h.Range), strengthCurve)
	h.Loudness = strength

	// Direction: the true bearing plus an error that shrinks with skill, focus and
	// loudness.
	acc := st.DirAccuracy
	if p.Focus {
		acc += focusDirBonus
	}
	acc = clamp01(acc)
	sigma := rad(lerp(sigmaVagueDeg, sigmaPreciseDeg, acc)) * (faintErrBase - faintErrSlope*strength)
	bearing := core.HeadingTo(ear, ev.Pos)
	if rng != nil {
		bearing += clamp(float32(rng.NormFloat64()), -maxErrSigmas, maxErrSigmas) * sigma
	}
	bearing = wrapTwoPi(bearing)
	h.sigma, h.dir16 = sigma, acc >= preciseDirAcc

	cl := proto.Clue{
		ID:         ev.Bird,
		Bearing:    bearing,
		Spread:     sigma * spreadSigmas,
		Dir:        directionWord(bearing, h.dir16),
		Confidence: confidenceWord(strength),
		Strength:   strength,
		TTL:        clamp(ev.Dur+clueTTLPad, clueTTLMin, clueTTLMax),
	}

	if st.DistAcc > distGate {
		da := st.DistAcc
		if p.Focus {
			da += focusDistBonus
		}
		cl.DistMin, cl.DistMax = distanceBand(h.Dist, clamp01(da), rng)
	}
	if acc >= elevationAcc {
		cl.Elevation = elevationWord(elevationOf(ear, ev.Pos))
	}

	evid := map[string]string{}
	if (st.PitchInfo >= 1 || p.Focus) && call.Pitch != "" {
		cl.Pitch = capitalise(call.Pitch)
		evid["pitch"] = call.Pitch
	}
	if (st.PatternInfo >= 1 || p.Focus) && call.Pattern != "" {
		cl.Pattern = capitalise(call.Pattern)
		evid["pattern"] = call.Pattern
	}
	if st.HabitatInfo >= 1 {
		hab := c.Terrain.HabitatAt(ev.Pos.X, ev.Pos.Z)
		cl.Habitat = hab.Label()
		if !bird.Act.Airborne() {
			// A bird calling in flight says nothing about where it lives.
			evid["habitat"] = hab.Key()
		}
	}
	if st.PerchHint >= 1 && bird.ID != 0 {
		cl.Perch = perchHint(bird, ev.Pos.Y-c.Terrain.HeightAt(ev.Pos.X, ev.Pos.Z))
	}
	if st.Instinct >= 1 && isUnusual(sp, bird.Flags) {
		cl.Unusual = true
	}

	know := c.know()
	if know.Identified(sp.ID) {
		if st.CallRecognise >= 1 || (st.CallMemory >= 1 && know.Recorded(sp.ID)) {
			cl.Known = sp.ID
		}
	} else if m := know.Mystery(sp.ID); m != nil {
		cl.Mystery = m.ID
	} else {
		cl.New, h.NewVoice = true, true
	}

	h.Clue, h.Evidence = cl, evid
	return h, true
}

// AudibleRange is the distance in metres at which a call can be heard by a listener
// with the given stats, focus state, occlusion (0..1) and masking noise (0..1).
func AudibleRange(call core.Call, st core.Stats, focus bool, occlusion, noise float32) float32 {
	r := call.AudibleRange() * st.HearRange
	if focus {
		r *= 1 + maxf(st.FocusBonus, 0)
	}
	r *= 1 - occlusionCut*clamp01(occlusion)
	r *= 1 - minf(clamp01(noise)*(1-clamp01(st.NoiseReduce)), maxMasking)
	return maxf(r, 0)
}

// ListenerNoise is the 0..1 masking noise at the player's ears: the louder of the
// place's ambient noise and the weather, plus the player's own footsteps.
func ListenerNoise(c *Context, p proto.Pose) float32 {
	n := maxf(c.Terrain.AmbientNoise(p.X, p.Z), c.Env.WeatherNoise())
	return clamp01(n + footstepNoise(p))
}

func footstepNoise(p proto.Pose) float32 {
	if p.Sit {
		return 0
	}
	n := clamp01((p.Speed-footQuietSpeed)/(footLoudSpeed-footQuietSpeed)) * footNoiseMax
	if p.Crouch {
		n *= crouchFootCut
	}
	return n
}

// MergeHeard writes a hearing's evidence into an evidence map (a mystery's or a
// species entry's) and returns the keys it changed. A value from the primary call
// overwrites; one from a secondary call (alarm, contact call) only fills a gap, so
// the evidence does not flap between a bird's different voices.
func MergeHeard(dst map[string]string, h Heard) (changed []string) {
	if dst == nil {
		return nil
	}
	for _, k := range [...]string{"pitch", "pattern", "habitat"} {
		v, ok := h.Evidence[k]
		if !ok || v == "" {
			continue
		}
		old, had := dst[k]
		if had && (old == v || !h.Primary || k == "habitat") {
			continue
		}
		dst[k] = v
		changed = append(changed, k)
	}
	return changed
}

var compassWords = [16]string{
	"North", "North-northeast", "Northeast", "East-northeast",
	"East", "East-southeast", "Southeast", "South-southeast",
	"South", "South-southwest", "Southwest", "West-southwest",
	"West", "West-northwest", "Northwest", "North-northwest",
}

// directionWord names a heading on an 8-point compass, or 16-point when precise.
func directionWord(bearing float32, precise bool) string {
	t := float64(wrapTwoPi(bearing)) / (2 * math.Pi)
	if precise {
		return compassWords[int(t*16+0.5)%16]
	}
	return compassWords[(int(t*8+0.5)%8)*2]
}

func confidenceWord(strength float32) string {
	switch {
	case strength >= strengthClear:
		return "Clear"
	case strength >= strengthFair:
		return "Fair"
	case strength >= strengthUncertain:
		return "Uncertain"
	}
	return "Faint"
}

func elevationWord(pitch float32) string {
	switch {
	case pitch > rad(elevationDeg):
		return "above"
	case pitch < -rad(elevationDeg):
		return "below"
	}
	return "level"
}

// distanceBand returns a rounded min/max band that always contains dist. The centre
// is deliberately off by a random fraction of the half-width so the middle of the
// band is not a give-away.
func distanceBand(dist, acc float32, rng *rand.Rand) (lo, hi float32) {
	rel := lerp(bandWide, bandTight, acc)
	centre := dist
	if rng != nil {
		centre *= 1 + (float32(rng.Float64())*2-1)*bandOffset*rel
	}
	lo, hi = centre*(1-rel), centre*(1+rel)
	// Guard the invariant against rounding: the truth stays inside.
	lo, hi = minf(lo, dist), maxf(hi, dist)
	step := float32(5)
	if hi >= 100 {
		step = 10
	}
	lo = float32(math.Floor(float64(lo/step))) * step
	hi = float32(math.Ceil(float64(hi/step))) * step
	if hi < step {
		hi = step // 0,0 means "unknown" on the wire
	}
	return lo, hi
}

// perchHint is Habitat Reading's guess at where the singer sits. It describes the
// kind of place, never the spot.
func perchHint(b core.BirdState, above float32) string {
	switch {
	case b.Act.Airborne():
		return "on the wing"
	case b.Act == core.ActSwimming:
		return "out on the water"
	case b.Act == core.ActWading:
		return "at the water's edge"
	case b.Act == core.ActClimbing:
		return "on a trunk"
	case above >= 6 && b.Cover >= 0.5:
		return "high in the canopy"
	case above >= 6:
		return "on a high, open perch"
	case above >= 2.2 && b.Cover >= 0.5:
		return "among mid-level foliage"
	case above >= 2.2:
		return "on an open branch"
	case b.Cover >= 0.45:
		return "low in dense cover"
	case above >= 0.6:
		return "on a low perch"
	}
	return "on or near the ground"
}

// isUnusual reports whether Natural Instinct would sense something out of the
// ordinary about this bird: a rare species, an out-of-range visitor or odd plumage.
func isUnusual(sp *core.Species, flags uint8) bool {
	return sp.Rarity >= core.Rare || flags&(core.FlagVagrant|core.FlagRarePlumage) != 0
}
