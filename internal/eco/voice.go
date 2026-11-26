package eco

import "github.com/Rik-Stokmans/wildcall/internal/core"

// Vocalization. The per-species bout rate for the hour and weather is computed once
// per Step (Sim.rate); voiceFactor scales it by what the bird is doing right now.
// Disturbed birds (fear, the quiet timer) do not call at all.

// voiceFactor is how likely a bird is to start a bout now relative to its species'
// base rate: highest on its song post, lower while busy, zero when asleep, hiding,
// alarmed or fleeing.
func (s *Sim) voiceFactor(b *bird, p *profile) float32 {
	switch b.mode {
	case mRoost, mAlert, mHide, mAway, mLeave:
		return 0
	}
	if p.asleep[s.birdPhase(b)] {
		return 0 // its night (or an owl's day): on its way to roost, not singing
	}
	if b.moving {
		switch {
		case b.act == core.ActFleeing || b.act == core.ActHiding || b.act == core.ActDiving:
			return 0
		case b.mv == mvFly:
			return 0.25 // flight calls
		}
		return 0.5
	}
	switch b.act {
	case core.ActRoosting, core.ActHiding, core.ActAlert, core.ActFleeing:
		return 0
	case core.ActFeeding:
		return 0.25
	case core.ActForaging, core.ActSwimming, core.ActWading, core.ActClimbing:
		return 0.6
	case core.ActSoaring, core.ActHovering:
		return 0.5
	case core.ActBathing:
		return 0.1
	case core.ActNesting, core.ActPreening:
		return 0.35
	case core.ActSocial:
		return 1.5
	case core.ActDiving:
		return 0
	}
	if b.cur == memSong {
		return 2.2
	}
	return 1
}

// sing starts a vocal bout: which call depends on what the bird is doing.
func (s *Sim) sing(b *bird, p *profile) {
	calls := p.sp.Calls
	if len(calls) == 0 {
		return
	}
	ci := 0
	u := s.rng.Float32()
	switch {
	case p.callDrum >= 0 && (b.act == core.ActClimbing || b.destKind == core.PerchTrunk) && u < 0.5:
		ci = p.callDrum
	case p.callContact >= 0 && b.moving:
		ci = p.callContact
	case p.callContact >= 0 && b.cur != memSong && u < 0.4:
		ci = p.callContact
	}
	c := calls[ci]
	lo, hi := c.Repeat[0], c.Repeat[1]
	if lo < 1 {
		lo = 1
	}
	if hi < lo {
		hi = lo
	}
	s.voice(b, p, ci, lo+s.rng.IntN(hi-lo+1))
}

// voice emits one bout of call ci with the given phrase repeats.
func (s *Sim) voice(b *bird, p *profile, ci, repeats int) {
	if s.silent {
		return
	}
	c := p.sp.Calls[ci]
	dur := float32(repeats)*c.PhraseDur() + float32(repeats-1)*c.Gap
	if dur < 0.1 {
		dur = 0.1
	}
	b.singT = dur
	b.flags |= core.FlagSinging
	pause := s.rnd(2, 7)
	if s.phase == core.PhaseDawn {
		pause *= 0.5 // the dawn chorus: bout after bout
	}
	b.callCD = dur + pause
	s.events = append(s.events, core.EcoEvent{
		Kind: core.EvCall, Bird: b.id, Species: int(b.sp), Call: ci, Repeats: repeats,
		Pos: b.pos, Dur: dur, Seed: s.rng.Uint32(),
	})
}
