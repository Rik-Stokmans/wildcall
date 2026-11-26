package field

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// record runs a recording window of the given length while bird b sings a bout of
// boutDur seconds, with the microphone aimed by p.
func record(c *Context, b core.BirdState, p proto.Pose, boutDur, seconds float32) (RecOutcome, proto.RecState) {
	r := NewRecording()
	r.OnCall(callFrom(b, boutDur), b.Flags, 0)
	var st proto.RecState
	for t := float32(0); t < seconds; t += 0.25 {
		st = r.Tick(c, 0.25, p, []core.BirdState{b})
	}
	return r.Stop(c, p), st
}

func recCtx() *Context {
	c, _ := newCtx()
	c.Stats.RecQuality = 1 // no fidelity cap, so every effect shows
	return c
}

func TestRecordingQualityFallsWithDistance(t *testing.T) {
	c := recCtx()
	prev := 101
	for _, d := range []float32{8, 20, 40, 80} {
		b := birdAt(1, spRobin, north(d, 0), core.ActPerched, 0.2)
		o, _ := record(c, b, lookAt(standing(), b.Pos), 6, 6)
		if !o.OK {
			t.Fatalf("robin at %v m: nothing captured (%v)", d, o.Notes)
		}
		if o.Meta.Quality >= prev {
			t.Errorf("quality should fall with distance: %d at %v m (prev %d)", o.Meta.Quality, d, prev)
		}
		prev = o.Meta.Quality
	}
}

func TestRecordingQualityFallsWithWind(t *testing.T) {
	c := recCtx()
	b := birdAt(1, spRobin, north(10, 0), core.ActPerched, 0.2)
	p := lookAt(standing(), b.Pos)
	calm, _ := record(c, b, p, 6, 6)
	c.Env.Wind = 0.8
	windy, meter := record(c, b, p, 6, 6)
	if windy.Meta.Quality >= calm.Meta.Quality {
		t.Errorf("wind should spoil the take: %d >= %d", windy.Meta.Quality, calm.Meta.Quality)
	}
	if meter.Noise <= 0 || windy.Meta.Noise <= calm.Meta.Noise {
		t.Errorf("noise meter should rise with wind: %v / %v", meter.Noise, windy.Meta.Noise)
	}
	if !contains(windy.Notes, "Wind rumbled across the microphone") {
		t.Errorf("wind note missing: %v", windy.Notes)
	}
}

func TestRecordingAimMattersMoreWithRecFocus(t *testing.T) {
	c := recCtx()
	b := birdAt(1, spRobin, north(10, 0), core.ActPerched, 0.2)
	on := lookAt(standing(), b.Pos)
	off := on
	off.Yaw += rad(90)

	drop := func(focus float32) float32 {
		c.Stats.RecFocus = focus
		a, _ := record(c, b, on, 6, 6)
		z, _ := record(c, b, off, 6, 6)
		if z.OK && z.Meta.Quality >= a.Meta.Quality {
			t.Errorf("RecFocus %.1f: off-axis should be worse: %d >= %d", focus, z.Meta.Quality, a.Meta.Quality)
		}
		if !z.OK {
			return 1
		}
		return 1 - float32(z.Meta.Quality)/float32(a.Meta.Quality)
	}
	omni, directional := drop(0), drop(0.8)
	if directional <= omni {
		t.Errorf("a directional mic should punish poor aim more: %.2f <= %.2f", directional, omni)
	}

	// The live meter reflects the aim.
	c.Stats.RecFocus = 0.8
	_, onState := record(c, b, on, 6, 2)
	_, offState := record(c, b, off, 6, 2)
	if !onState.Signal || onState.OnAxis <= offState.OnAxis || onState.Level <= offState.Level {
		t.Errorf("meter: on %+v off %+v", onState, offState)
	}
}

func TestRecordingNeedsAFullPhrase(t *testing.T) {
	c := recCtx()
	b := birdAt(1, spRobin, north(8, 0), core.ActPerched, 0.2)
	p := lookAt(standing(), b.Pos)
	// The robin's phrase lasts 0.8 s; half a second is a fragment.
	o, _ := record(c, b, p, 0.5, 0.5)
	if o.OK || o.Species != -1 {
		t.Errorf("a fragment must not count: %+v", o)
	}
	if len(o.Notes) == 0 {
		t.Errorf("a failed take should explain itself")
	}
	// Silence.
	r := NewRecording()
	r.Tick(c, 1, p, nil)
	if o := r.Stop(c, p); o.OK {
		t.Errorf("silence recorded something")
	}
	// A longer take is better than a bare phrase.
	short, _ := record(c, b, p, 1, 1)
	long, _ := record(c, b, p, 8, 8)
	if !short.OK || !long.OK || long.Meta.Quality <= short.Meta.Quality {
		t.Errorf("duration should help: short %+v long %+v", short.Meta, long.Meta)
	}
	if long.Phrases < 1 {
		t.Errorf("phrases %.2f", long.Phrases)
	}
}

func TestRecordingOutcomeAndCaps(t *testing.T) {
	c, _ := newCtx() // basic recorder: RecQuality 0.4 → cap 64
	b := birdAt(1, spRobin, north(5, 0), core.ActPerched, 0.2)
	p := lookAt(standing(), b.Pos)
	o, _ := record(c, b, p, 8, 8)
	if !o.OK || o.Meta.Quality > 64 || o.Meta.Stars < 2 {
		t.Errorf("basic recorder: %+v", o.Meta)
	}
	if o.Meta.Species != "" || o.Meta.SpIndex != spRobin || o.Bird != 1 {
		t.Errorf("unidentified species must not be named: %+v", o.Meta)
	}
	if len(o.Evidence) != 0 {
		t.Errorf("no AudioAssist, no evidence: %v", o.Evidence)
	}
	c.Stats.AudioAssist = 1
	c.Know = &Memory{Mysteries: map[string]*proto.Mystery{"test_robin": {ID: "m5"}}}
	o, _ = record(c, b, p, 8, 8)
	if o.Meta.Mystery != "m5" || o.Evidence["pitch"] != "high" || o.Evidence["pattern"] != "melodic" {
		t.Errorf("AudioAssist outcome: %+v %v", o.Meta, o.Evidence)
	}
	ev := map[string]string{}
	if ch := MergeRecorded(ev, o); len(ch) != 2 {
		t.Errorf("MergeRecorded changed %v", ch)
	}

	// The best-captured of two voices wins.
	near := birdAt(2, spWren, north(6, -0.6), core.ActPerched, 0.2)
	far := birdAt(3, spBlackbird, north(70, 4), core.ActPerched, 0.2)
	r := NewRecording()
	r.OnCall(callFrom(far, 6), 0, 0)
	r.OnCall(callFrom(near, 6), 0, 0)
	for i := 0; i < 24; i++ {
		r.Tick(c, 0.25, lookAt(standing(), near.Pos), []core.BirdState{near, far})
	}
	if out := r.Stop(c, standing()); out.Bird != 2 {
		t.Errorf("the closer singer should win, got bird %d", out.Bird)
	}
}

func TestCallLogStartsMidSong(t *testing.T) {
	c := recCtx()
	b := birdAt(1, spRobin, north(8, 0), core.ActPerched, 0.2)
	var log CallLog
	log.Add(callFrom(b, 6), 0)
	log.Advance(2) // the song has been going for 2 s
	if log.Sounding() != 1 {
		t.Fatalf("bout should still be sounding")
	}
	r := log.Start()
	p := lookAt(standing(), b.Pos)
	for i := 0; i < 24; i++ {
		r.Tick(c, 0.25, p, []core.BirdState{b})
	}
	o := r.Stop(c, p)
	if !o.OK {
		t.Fatalf("recording started mid-song should capture the rest: %v", o.Notes)
	}
	log.Advance(5)
	if log.Sounding() != 0 {
		t.Errorf("finished bouts should be forgotten")
	}
}
