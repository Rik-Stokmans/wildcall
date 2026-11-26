package eco

import "math"

// The spatial grid for Near: 32 m buckets, each a doubly linked list threaded
// through the birds themselves (no allocation when a bird changes bucket).
//
// The world is unbounded, so buckets are folded onto a fixed 64 x 64 table by
// taking the low bits of the bucket coordinates. Folding is injective within any
// window of up to 64 x 64 buckets (2 km), so a query never sees the same list
// twice; a far-away bird that happens to share a slot is simply filtered out by the
// distance test.
const (
	gridCell  = 32
	gridDim   = 64
	gridSlots = gridDim * gridDim
)

func gridCoord(v float32) int { return int(math.Floor(float64(v) / gridCell)) }

func gridSlot(gx, gz int) int32 { return int32(gx&(gridDim-1) | (gz&(gridDim-1))<<6) }

func (s *Sim) gridInsert(b *bird, idx int32) {
	slot := gridSlot(gridCoord(b.pos.X), gridCoord(b.pos.Z))
	b.gslot = slot
	b.gprev = -1
	b.gnext = s.grid[slot]
	if b.gnext >= 0 {
		s.birds[b.gnext].gprev = idx
	}
	s.grid[slot] = idx
}

func (s *Sim) gridRemove(b *bird) {
	if b.gprev >= 0 {
		s.birds[b.gprev].gnext = b.gnext
	} else {
		s.grid[b.gslot] = b.gnext
	}
	if b.gnext >= 0 {
		s.birds[b.gnext].gprev = b.gprev
	}
	b.gnext, b.gprev = -1, -1
}

// gridUpdate moves a bird to the bucket for its current position if it changed.
func (s *Sim) gridUpdate(b *bird, idx int32) {
	// Truncation instead of floor is enough to detect a change cheaply; the exact
	// slot is recomputed only when one is suspected.
	slot := gridSlot(gridCoord(b.pos.X), gridCoord(b.pos.Z))
	if slot == b.gslot {
		return
	}
	s.gridRemove(b)
	s.gridInsert(b, idx)
}
