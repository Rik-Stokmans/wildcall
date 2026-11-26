package field

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Clue board tuning (contract §3.3.1: "at most ClueSlots clues are live at once,
// strongest win").
const (
	// A live clue loses up to this fraction of its strength over its TTL when
	// competing for a slot, so a fading voice gives way to a fresh one.
	clueAgeFade = 0.6
	// A newcomer must beat the weakest live clue by this margin: no slot flicker
	// between two voices of the same loudness.
	clueEvictMargin = 0.05
	// Hearing the same singer again from the same spot refines the bearing
	// ("listen again", spec §4.1) down to this fraction of a single estimate's
	// spread. A bird that has moved more than clueSamePlace metres starts afresh.
	clueRefineFloor = 0.45
	clueSamePlace   = 5
)

// ClueBoard holds the audio clues the player is currently attending to. The player
// can separate only Stats.ClueSlots sound sources at once (Deep Listening raises
// it); the strongest voices win a slot. The zero value is ready to use.
//
// The board is session state: one per player, discarded on a new game.
type ClueBoard struct {
	live []liveClue
}

type liveClue struct {
	clue   proto.Clue
	age    float32   // seconds since the last update
	pos    core.Vec3 // true source position at the last update
	sigma  float32   // single-estimate bearing sigma at the last update
	weight float32   // accumulated precision (1/sigma²) of the bearing estimate
	dir16  bool
}

func (l *liveClue) effective() float32 {
	if l.clue.TTL <= 0 {
		return 0
	}
	return l.clue.Strength * (1 - clueAgeFade*clamp01(l.age/l.clue.TTL))
}

// Offer presents a heard call to the board and returns the clue messages to send to
// the client, in order: at most one evicted clue (a copy with TTL 0 and Strength 0,
// telling the client to fade it now) followed by the accepted clue. A voice that
// cannot win a slot returns nothing: the call is still audible in the world, the
// player just cannot pick it apart from the others.
//
// slots is Stats.ClueSlots (floored; at least one slot always exists).
func (b *ClueBoard) Offer(h Heard, slots float32) []proto.Clue {
	n := int(slots)
	if n < 1 {
		n = 1
	}
	var out []proto.Clue

	// Slots lost since the last call (gear unequipped): drop the weakest.
	for len(b.live) > n {
		out = append(out, b.evict(b.weakest()))
	}

	fresh := liveClue{clue: h.Clue, pos: h.Pos, sigma: h.sigma, dir16: h.dir16}
	if h.sigma > 0 {
		fresh.weight = 1 / (h.sigma * h.sigma)
	}

	if i := b.index(h.Clue.ID); i >= 0 {
		old := &b.live[i]
		if old.pos.Dist(h.Pos) <= clueSamePlace && old.weight > 0 && fresh.weight > 0 {
			refine(&fresh, old)
		}
		b.live[i] = fresh
		return append(out, fresh.clue)
	}
	if len(b.live) >= n {
		w := b.weakest()
		if h.Clue.Strength <= b.live[w].effective()+clueEvictMargin {
			return out
		}
		out = append(out, b.evict(w))
	}
	b.live = append(b.live, fresh)
	return append(out, fresh.clue)
}

// refine merges a new bearing estimate with the previous one for the same,
// unmoved source: a precision-weighted circular mean with a tighter spread.
func refine(fresh, old *liveClue) {
	sx := fresh.weight*sin32(fresh.clue.Bearing) + old.weight*sin32(old.clue.Bearing)
	cx := fresh.weight*cos32(fresh.clue.Bearing) + old.weight*cos32(old.clue.Bearing)
	if absf(sx) < 1e-6 && absf(cx) < 1e-6 {
		return // exactly opposed estimates: keep the fresh one
	}
	fresh.weight += old.weight
	sigma := maxf(1/sqrt32(fresh.weight), clueRefineFloor*fresh.sigma)
	fresh.weight = 1 / (sigma * sigma)
	fresh.clue.Bearing = wrapTwoPi(float32(math.Atan2(float64(sx), float64(cx))))
	fresh.clue.Spread = sigma * spreadSigmas
	fresh.clue.Dir = directionWord(fresh.clue.Bearing, fresh.dir16)
}

// Advance ages the board by dt seconds and forgets clues past their TTL (the client
// fades those on its own; nothing needs to be sent).
func (b *ClueBoard) Advance(dt float32) {
	kept := b.live[:0]
	for _, l := range b.live {
		l.age += dt
		if l.age < l.clue.TTL {
			kept = append(kept, l)
		}
	}
	b.live = kept
}

// Live returns the clues currently holding a slot, strongest first.
func (b *ClueBoard) Live() []proto.Clue {
	out := make([]proto.Clue, 0, len(b.live))
	for _, l := range b.live {
		out = append(out, l.clue)
	}
	// Insertion sort: there are only ever a handful.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Strength > out[j-1].Strength; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Len is the number of live clues.
func (b *ClueBoard) Len() int { return len(b.live) }

// SetMystery stamps a mystery id on the live clue of a sound source (used when a
// mystery is created after the clue was accepted). It reports whether the source
// holds a slot.
func (b *ClueBoard) SetMystery(source uint32, mysteryID string) bool {
	if i := b.index(source); i >= 0 {
		b.live[i].clue.Mystery = mysteryID
		return true
	}
	return false
}

// Reset forgets every clue.
func (b *ClueBoard) Reset() { b.live = b.live[:0] }

func (b *ClueBoard) index(id uint32) int {
	for i := range b.live {
		if b.live[i].clue.ID == id {
			return i
		}
	}
	return -1
}

func (b *ClueBoard) weakest() int {
	w := 0
	for i := range b.live {
		if b.live[i].effective() < b.live[w].effective() {
			w = i
		}
	}
	return w
}

// evict removes a live clue and returns the "fade now" message for it.
func (b *ClueBoard) evict(i int) proto.Clue {
	gone := b.live[i].clue
	b.live = append(b.live[:i], b.live[i+1:]...)
	gone.TTL, gone.Strength, gone.New = 0, 0, false
	return gone
}

func sin32(x float32) float32 { return float32(math.Sin(float64(x))) }
func cos32(x float32) float32 { return float32(math.Cos(float64(x))) }
