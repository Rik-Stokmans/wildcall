package field

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func heardAt(t *testing.T, c *Context, id uint32, dist float32) Heard {
	t.Helper()
	return mustHear(t, c, birdAt(id, spBlackbird, north(dist, 4), core.ActPerched, 0.4), standing())
}

func TestClueBoardSlotCap(t *testing.T) {
	c, _ := newCtx()
	var b ClueBoard
	slots := c.Stats.ClueSlots // 2

	far := heardAt(t, c, 1, 150)
	mid := heardAt(t, c, 2, 90)
	if out := b.Offer(far, slots); len(out) != 1 || out[0].ID != 1 {
		t.Fatalf("first clue should be accepted: %+v", out)
	}
	if out := b.Offer(mid, slots); len(out) != 1 || out[0].ID != 2 {
		t.Fatalf("second clue should be accepted: %+v", out)
	}
	// A third, weaker voice cannot win a slot.
	faint := heardAt(t, c, 3, 190)
	if out := b.Offer(faint, slots); len(out) != 0 {
		t.Errorf("a weaker voice should not displace a live clue: %+v", out)
	}
	// A strong, close voice evicts the weakest live clue.
	close := heardAt(t, c, 4, 15)
	out := b.Offer(close, slots)
	if len(out) != 2 || out[0].ID != 1 || out[0].TTL != 0 || out[0].Strength != 0 || out[1].ID != 4 {
		t.Fatalf("expected eviction of clue 1 then clue 4: %+v", out)
	}
	if b.Len() != 2 {
		t.Fatalf("board holds %d clues, cap is 2", b.Len())
	}
	live := b.Live()
	if live[0].ID != 4 || live[1].ID != 2 {
		t.Errorf("Live should be strongest first: %+v", live)
	}

	// More slots, more voices.
	for i := uint32(10); i < 16; i++ {
		b.Offer(heardAt(t, c, i, 20+float32(i)), 4)
	}
	if b.Len() != 4 {
		t.Errorf("with 4 slots the board should hold 4 clues, has %d", b.Len())
	}
	// Losing slots drops the weakest on the next offer.
	b.Offer(heardAt(t, c, 4, 15), 1)
	if b.Len() != 1 || b.Live()[0].ID != 4 {
		t.Errorf("after shrinking to one slot: %+v", b.Live())
	}
}

func TestClueBoardUpdateRefineAndExpire(t *testing.T) {
	c, _ := newCtx()
	var b ClueBoard
	h := heardAt(t, c, 7, 40)
	b.Offer(h, 2)
	first := b.Live()[0].Spread
	for i := 0; i < 5; i++ {
		b.Offer(heardAt(t, c, 7, 40), 2)
	}
	if b.Len() != 1 {
		t.Fatalf("the same source must upsert, not add: %d", b.Len())
	}
	if got := b.Live()[0].Spread; got >= first {
		t.Errorf("listening again should tighten the spread: %.3f >= %.3f", got, first)
	}
	if !b.SetMystery(7, "m3") || b.Live()[0].Mystery != "m3" {
		t.Errorf("SetMystery should stamp the live clue")
	}
	if b.SetMystery(99, "m4") {
		t.Errorf("SetMystery on an unknown source should report false")
	}
	b.Advance(h.Clue.TTL + 0.1)
	if b.Len() != 0 {
		t.Errorf("clues should expire after their TTL")
	}
	b.Offer(h, 2)
	b.Reset()
	if b.Len() != 0 {
		t.Errorf("Reset should clear the board")
	}
	var empty ClueBoard
	if out := empty.Offer(Heard{Clue: proto.Clue{ID: 1, Strength: 0.5, TTL: 5}}, 0); len(out) != 1 {
		t.Errorf("at least one slot always exists")
	}
}

func TestMoveCue(t *testing.T) {
	c, _ := newCtx()
	p := standing()
	ev := func(kind core.EcoEventKind, sp int, pos core.Vec3) core.EcoEvent {
		return core.EcoEvent{Kind: kind, Bird: 1, Species: sp, Pos: pos}
	}
	// In view, within MoveSense (18 m).
	cue, ok := MoveCue(c, ev(core.EvMove, spRobin, north(12, 0)), p, seeded())
	if !ok || !cue.InView || cue.Strength <= 0 {
		t.Fatalf("in-view hop at 12 m should cue: %+v %v", cue, ok)
	}
	if d := absf(wrapPi(cue.Bearing)); d > rad(10) {
		t.Errorf("cue bearing off by %.1f°", d*180/3.14159)
	}
	// In view, too far.
	if _, ok := MoveCue(c, ev(core.EvMove, spRobin, north(40, 0)), p, seeded()); ok {
		t.Errorf("a hop at 40 m should go unnoticed with the naked eye")
	}
	// A flush carries farther than a hop.
	if _, ok := MoveCue(c, ev(core.EvFlush, spRobin, north(22, 0)), p, seeded()); !ok {
		t.Errorf("a flush at 22 m should be noticed")
	}
	// Binoculars extend the in-view range.
	bp := withBinoculars(p, 6)
	if _, ok := MoveCue(c, ev(core.EvMove, spRobin, north(60, 0)), bp, seeded()); !ok {
		t.Errorf("through binoculars a hop at 60 m should be noticed")
	}
	// Behind the player: only with Peripheral awareness.
	behind := core.V(origin.X, origin.Y, origin.Z+8)
	if _, ok := MoveCue(c, ev(core.EvMove, spRobin, behind), p, seeded()); ok {
		t.Errorf("out-of-view movement needs Peripheral > 0")
	}
	c.Stats.Peripheral = 15
	cue, ok = MoveCue(c, ev(core.EvMove, spRobin, behind), p, seeded())
	if !ok || cue.InView {
		t.Errorf("peripheral cue expected: %+v %v", cue, ok)
	}
	// Calls never produce movement cues.
	if _, ok := MoveCue(c, ev(core.EvCall, spRobin, north(5, 0)), p, seeded()); ok {
		t.Errorf("EvCall must not produce a movement cue")
	}
}

// TestClueBoardTriangulates: hearing the same singer again from a new spot sharpens
// the clue more than listening again from where one stands.
func TestClueBoardTriangulates(t *testing.T) {
	c, _ := newCtx()
	b := birdAt(5, spWren, north(30, 0), core.ActPerched, 0.3)
	rng := seeded()
	hearFrom := func(dx float32) Heard {
		p := standing()
		p.X += dx
		h, ok := Hear(c, callFrom(b, 3), b, p, rng)
		if !ok {
			t.Fatal("inaudible")
		}
		return h
	}
	var same, moved ClueBoard
	first := same.Offer(hearFrom(0), 2)[0].Spread
	moved.Offer(hearFrom(0), 2)
	var sSame, sMoved float32
	for i := 1; i <= 3; i++ {
		sSame = same.Offer(hearFrom(0), 2)[0].Spread
		sMoved = moved.Offer(hearFrom(float32(i)*4), 2)[0].Spread
	}
	t.Logf("30 m: single ±%.1f°, 3 repeats ±%.1f°, 3 new spots ±%.1f°", first*180/math.Pi, sSame*180/math.Pi, sMoved*180/math.Pi)
	if !(sSame < first && sMoved < sSame) {
		t.Errorf("spread: first %.3f, repeated %.3f, triangulated %.3f", first, sSame, sMoved)
	}
	if l := moved.Live()[0]; l.ElevSpread <= 0 || l.DistMax-l.DistMin > 10 {
		t.Errorf("a triangulated clue at 30 m should have a tight band and an elevation: %+v", l)
	}
}
