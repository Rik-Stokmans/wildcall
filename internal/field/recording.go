package field

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Recording tuning (spec §13.2 "Audio Recording"; contract §3.3.6).
//
// While a voice sounds, each tick samples
//
//	signal  = distance × aim × (1 − muffling)        (0..1, the level meter)
//	quality = signal × (1 − recNoiseCut × noise)
//
// and the take's quality is the mean sample × a duration factor × the recorder's
// fidelity, capped at 40 + 60·RecQuality. With the basic recorder (RecRange 25,
// RecQuality 0.4) a robin singing 10 m away on a calm day reaches the recorder's
// ceiling of 64 (three stars); at 50 m, or in a stiff wind, less than half that.
const (
	// Distance: a call of loudness 0.5 records cleanly out to Stats.RecRange; louder
	// calls carry farther. distance = 1 / (1 + recDistFall·(d / range)²).
	recLoudBase = 0.6
	recLoudGain = 0.8
	recDistFall = 0.35
	recMaxReach = 6 // voices beyond this × range are not on the tape at all

	recMuffle = 0.3 // signal lost behind full occlusion

	// Aim. The pickup beam narrows from recBeamWide (omni-ish, RecFocus 0) to
	// recBeamNarrow (parabolic, RecFocus 1); off the beam the gain falls to a floor
	// of recAimFloor − recAimFocus·RecFocus. A directional rig must be pointed.
	recBeamWide   = 150 // degrees
	recBeamNarrow = 20
	recAimFloor   = 0.75
	recAimFocus   = 0.70
	recAimMin     = 0.05

	// Noise: max(ambient, weather + wind rumble) × (1 − NoiseReduce) + handling,
	// then a directional mic rejects part of it.
	recWindRumble  = 0.25 // wind is worse for a microphone than for an ear
	recHandleSpeed = 3    // m/s at which handling noise peaks
	recHandleMax   = 0.5
	recFocusReject = 0.55 // share of noise a fully directional mic rejects
	recNoiseCut    = 0.8

	recUsable = 0.06 // a sample below this quality is not "capturing" the call

	// Duration: a take needs one full phrase; more is better up to recFullSeconds.
	recMinPhrase   = 0.3 // seconds, for calls whose phrase is shorter
	recFullSeconds = 8
	recShortFactor = 0.6 // duration factor of a bare single phrase

	recFidelity = 0.7 // quality multiplier at RecQuality 0 (1.0 at RecQuality 1)
	recCapBase  = 40  // quality ≤ recCapBase + recCapRange × RecQuality
	recCapRange = 60
)

// Recording is one recording window: from recStart to recStop. Create it with
// NewRecording (or CallLog.Start), feed it every EvCall that occurs while it runs
// (OnCall), tick it at 4 Hz for the live meter, and Stop it for the result. The
// best-captured voice wins.
type Recording struct {
	seconds float32
	voices  []*recVoice
	state   proto.RecState
}

type recVoice struct {
	bird    uint32
	species int
	call    int
	flags   uint8
	pos     core.Vec3
	start   float32 // window time at which the bout began (negative: before the window)
	end     float32

	captured float32 // seconds of usable signal
	quality  float32 // ∫ quality dt over captured time
	dist     float32 // ∫ distance dt
	noise    float32 // ∫ noise dt
	aim      float32 // ∫ aim dt
	off      float32 // ∫ angle off the microphone axis dt (rad)
	handling float32 // ∫ handling noise dt
}

// recAimedAngle: a voice the player kept within this angle of the microphone axis is
// the one they meant to record, and wins over a louder or longer voice off to the
// side (the take keeps one voice; "point it at the singer" must work).
const recAimedAngle = 30 * 3.14159265 / 180

// NewRecording starts an empty recording window.
func NewRecording() *Recording { return &Recording{} }

// Seconds is the length of the window so far.
func (r *Recording) Seconds() float32 { return r.seconds }

// OnCall registers a vocalization bout. elapsed is how long ago the bout began
// (0 for an event that has just been emitted); flags are the caller's bird flags.
func (r *Recording) OnCall(ev core.EcoEvent, flags uint8, elapsed float32) {
	if ev.Kind != core.EvCall {
		return
	}
	start := r.seconds - maxf(elapsed, 0)
	end := start + maxf(ev.Dur, 0.5)
	if end <= r.seconds {
		return
	}
	for _, v := range r.voices {
		if v.bird == ev.Bird && v.call == ev.Call && v.species == ev.Species {
			// The same bird sings again: one voice, a longer performance.
			if end > v.end {
				v.end = end
			}
			v.pos, v.flags = ev.Pos, flags
			return
		}
	}
	r.voices = append(r.voices, &recVoice{
		bird: ev.Bird, species: ev.Species, call: ev.Call, flags: flags, pos: ev.Pos, start: start, end: end,
	})
}

// Tick advances the window by dt seconds and returns the live meter. p is the
// current pose (the microphone is at the eye, aimed where the player looks); birds
// are the birds around the player, used to follow a singer that moves.
func (r *Recording) Tick(c *Context, dt float32, p proto.Pose, birds []core.BirdState) proto.RecState {
	if dt < 0 {
		dt = 0
	}
	from := r.seconds
	r.seconds += dt
	st := c.Stats
	mic := Eye(p)
	axis := core.LookDir(p.Yaw, p.Pitch)
	noise, handling := micNoise(c, p)

	state := proto.RecState{Seconds: r.seconds, Noise: noise}
	for _, v := range r.voices {
		// Overlap of this tick with the bout.
		lo, hi := maxf(from, v.start), minf(r.seconds, v.end)
		if hi <= lo {
			continue
		}
		sp := c.SpeciesAt(v.species)
		if sp == nil || v.call < 0 || v.call >= len(sp.Calls) {
			continue
		}
		for i := range birds {
			if birds[i].ID == v.bird {
				v.pos = birds[i].Pos
				break
			}
		}
		reach := recReach(st, sp.Calls[v.call])
		d := mic.Dist(v.pos)
		if d > reach*recMaxReach {
			continue
		}
		offAxis := angleBetween(axis, v.pos.Sub(mic))
		aim := micAim(st, offAxis)
		floor := clamp(recAimFloor-recAimFocus*clamp01(st.RecFocus), recAimMin, 1)
		ratio := d / reach
		signal := 1 / (1 + recDistFall*ratio*ratio) * (floor + (1-floor)*aim) *
			(1 - recMuffle*clamp01(c.Terrain.Occlusion(mic, v.pos)))
		q := signal * (1 - recNoiseCut*noise)

		if signal > state.Level {
			state.Level, state.OnAxis = signal, aim
		}
		if q < recUsable {
			continue
		}
		state.Signal = true
		span := hi - lo
		v.captured += span
		v.quality += q * span
		v.dist += d * span
		v.noise += noise * span
		v.aim += aim * span
		v.off += offAxis * span
		v.handling += handling * span
	}
	r.state = state
	return state
}

// State returns the meter of the last Tick.
func (r *Recording) State() proto.RecState { return r.state }

// recReach is the distance at which this call records cleanly with this gear.
func recReach(st core.Stats, call core.Call) float32 {
	return maxf(st.RecRange, 1) * (recLoudBase + recLoudGain*clamp01(call.Loud))
}

// micAim is the 0..1 "on axis" reading for a source at the given angle off the
// microphone axis: 1 inside the beam's heart, 0 well outside it.
func micAim(st core.Stats, angle float32) float32 {
	beam := rad(lerp(recBeamWide, recBeamNarrow, clamp01(st.RecFocus)))
	x := angle / beam
	return clamp01(1 - 0.5*x*x)
}

// micNoise is the 0..1 background noise on the tape and the part of it that is the
// player's own handling noise.
func micNoise(c *Context, p proto.Pose) (noise, handling float32) {
	st, env := c.Stats, c.Env
	weather := clamp01(env.WeatherNoise() + recWindRumble*clamp01(env.Wind))
	base := maxf(c.Terrain.AmbientNoise(p.X, p.Z), weather) * (1 - clamp01(st.NoiseReduce))
	if !p.Sit {
		handling = clamp01(p.Speed/recHandleSpeed) * recHandleMax
		if p.Crouch {
			handling *= crouchFootCut
		}
	}
	reject := 1 - recFocusReject*clamp01(st.RecFocus)
	return clamp01(base+handling) * reject, handling * reject
}

// RecOutcome is the result of a finished recording.
type RecOutcome struct {
	// OK is false when nothing usable was captured (proto.RecResult.Rec = nil).
	OK bool
	// Meta carries Day, Time, Region, Species / Mystery, SpIndex, Call, Dur, Dist,
	// Noise, Quality and Stars. The session assigns ID. Species is set only if the
	// player has identified the species; SpIndex is for playback synthesis only.
	Meta proto.RecMeta
	// Notes are feedback lines for proto.RecResult.Notes.
	Notes []string

	Bird    uint32  // the recorded individual
	Species int     // true species index, -1 if !OK. Server-side only.
	Flags   uint8   // its bird flags (vagrant, rare plumage)
	Phrases float32 // full phrases captured
	// Evidence is what analysing the take adds to the species' evidence: pitch and
	// pattern, only with Stats.AudioAssist >= 1. Primary is true when it is the
	// species' primary call. Apply like a Heard (primary overwrites, others fill gaps).
	Evidence map[string]string
	Primary  bool
	// Capped: the recorder's fidelity limited the quality.
	Capped bool
}

// Stop ends the window and scores it. p is the player's pose at the end (for the
// region stamp). The winner is the voice with the best quality among those captured
// for at least one full phrase.
func (r *Recording) Stop(c *Context, p proto.Pose) RecOutcome {
	st, env := c.Stats, c.Env
	out := RecOutcome{Species: -1, Evidence: map[string]string{}}

	var best *recVoice
	var bestQ, bestPhrases float32
	bestCapped, bestAimed := false, false
	fragments, faint := false, false
	for _, v := range r.voices {
		sp := c.SpeciesAt(v.species)
		if sp == nil || v.call < 0 || v.call >= len(sp.Calls) {
			continue
		}
		if v.captured <= 0 {
			faint = true
			continue
		}
		phrase := maxf(sp.Calls[v.call].PhraseDur(), recMinPhrase)
		if v.captured < phrase {
			fragments = true
			continue
		}
		dur := recShortFactor + (1-recShortFactor)*clamp01((v.captured-phrase)/maxf(recFullSeconds-phrase, 0.1))
		q := 100 * (v.quality / v.captured) * dur * (recFidelity + (1-recFidelity)*clamp01(st.RecQuality))
		capped := false
		if limit := recCapBase + recCapRange*clamp01(st.RecQuality); q > limit {
			q, capped = limit, true
		}
		aimed := v.off/v.captured <= recAimedAngle
		if best == nil || (aimed && !bestAimed) || (aimed == bestAimed && q > bestQ) {
			best, bestQ, bestCapped, bestAimed = v, q, capped, aimed
			bestPhrases = v.captured / maxf(phrase+sp.Calls[v.call].Gap, phrase)
		}
	}

	if best == nil {
		switch {
		case fragments:
			out.Notes = []string{"Only a fragment - let the bird finish a full phrase before stopping"}
		case faint:
			out.Notes = []string{"Too faint to make anything out - move closer to the singer"}
		default:
			out.Notes = []string{"Only the hush of the place itself - no call was captured"}
		}
		return out
	}

	sp := c.SpeciesAt(best.species)
	call := sp.Calls[best.call]
	meanDist := best.dist / best.captured
	meanNoise := best.noise / best.captured
	meanAim := best.aim / best.captured
	meanHandling := best.handling / best.captured

	out.OK = true
	out.Bird, out.Species, out.Flags = best.bird, best.species, best.flags
	out.Phrases, out.Capped = bestPhrases, bestCapped
	out.Primary = best.call == 0
	out.Meta = proto.RecMeta{
		Day: env.Day, Time: env.Time,
		Region:  int(c.Terrain.RegionAt(p.X, p.Z)),
		SpIndex: best.species, Call: best.call,
		Dur: r.seconds, Dist: meanDist, Noise: clamp01(meanNoise),
		Quality: pct(bestQ),
	}
	out.Meta.Stars = starsFor(out.Meta.Quality)
	know := c.know()
	if know.Identified(sp.ID) {
		out.Meta.Species = sp.ID
	} else if m := know.Mystery(sp.ID); m != nil {
		out.Meta.Mystery = m.ID
	}
	if st.AudioAssist >= 1 {
		if call.Pitch != "" {
			out.Evidence["pitch"] = call.Pitch
		}
		if call.Pattern != "" {
			out.Evidence["pattern"] = call.Pattern
		}
	}

	// Feedback: what held the take back, most important first.
	add := func(line string) {
		if len(out.Notes) < 4 {
			out.Notes = append(out.Notes, line)
		}
	}
	if meanDist > 1.3*recReach(st, call) {
		add("Too distant for a clean recording - the song is thin")
	}
	if meanHandling > 0.12 {
		add("Your own movement is on the tape - stand still while recording")
	}
	switch {
	case env.Wind > 0.5 && meanNoise > 0.25:
		add("Wind rumbled across the microphone")
	case env.Rain > 0.4 && meanNoise > 0.25:
		add("Rain pattered over the recording")
	case meanNoise > 0.45:
		add("A lot of background noise here - try a quieter spot")
	}
	if st.RecFocus >= 0.2 && meanAim < 0.6 {
		add("Keep the microphone pointed at the singer")
	}
	if best.captured < 3 {
		add("Short - a longer take would hold more of the song")
	}
	if bestCapped {
		add("This recorder has given all it can - better gear would do the voice justice")
	}
	if len(out.Notes) == 0 {
		// Nothing in particular went wrong; say how good it is honestly.
		switch {
		case out.Meta.Stars >= 4:
			add("A clean, clear recording")
		case out.Meta.Stars == 3:
			add("A good, usable recording")
		default:
			add("Faint but usable - closer would be clearer")
		}
	}
	return out
}

// MergeRecorded writes a recording's evidence into an evidence map with the same
// precedence rule as MergeHeard and returns the keys it changed.
func MergeRecorded(dst map[string]string, o RecOutcome) (changed []string) {
	return MergeHeard(dst, Heard{Evidence: o.Evidence, Primary: o.Primary})
}

// ---------------------------------------------------------------------------

// CallLog remembers the vocalization bouts that are still sounding, so a recording
// started in the middle of a song captures the rest of it. The session keeps one:
// Advance it every simulation tick and Add every EvCall. The zero value is ready.
type CallLog struct {
	now   float64
	calls []loggedCall
}

type loggedCall struct {
	ev    core.EcoEvent
	flags uint8
	at    float64
}

// Advance moves the log's clock forward and forgets bouts that have ended.
func (l *CallLog) Advance(dt float32) {
	l.now += float64(dt)
	kept := l.calls[:0]
	for _, c := range l.calls {
		if c.at+float64(c.ev.Dur) > l.now {
			kept = append(kept, c)
		}
	}
	l.calls = kept
}

// Add logs a bout that begins now. flags are the caller's bird flags.
func (l *CallLog) Add(ev core.EcoEvent, flags uint8) {
	if ev.Kind == core.EvCall {
		l.calls = append(l.calls, loggedCall{ev: ev, flags: flags, at: l.now})
	}
}

// Start begins a recording window that already knows every bout still sounding.
func (l *CallLog) Start() *Recording {
	r := NewRecording()
	for _, c := range l.calls {
		r.OnCall(c.ev, c.flags, float32(l.now-c.at))
	}
	return r
}

// Sounding is the number of bouts currently in progress.
func (l *CallLog) Sounding() int { return len(l.calls) }
