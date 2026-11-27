package field

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
)

// trunkFlat is the flat test terrain with one tree trunk standing in every sight line
// whose target lies east of x = 210 (a stand-in for world.World.TrunkOcclusion).
type trunkFlat struct{ *coretest.Flat }

func (t trunkFlat) TrunkOcclusion(from, to core.Vec3) float32 {
	if to.X > 210 {
		return 1
	}
	return 0
}

// A bird squarely behind a trunk the client draws gives no clarity (no evidence
// through solid wood); without the optional interface nothing changes.
func TestSightlineTrunk(t *testing.T) {
	c, flat := newCtx()
	sp := &c.Species[spRobin]
	eye := origin
	open := core.BirdState{Species: spRobin, Act: core.ActPerched, Pos: core.V(205, 5, 200)}
	behind := core.BirdState{Species: spRobin, Act: core.ActPerched, Pos: core.V(215, 5, 200)}
	if v := sightline(c, eye, behind, sp); v <= 0.5 {
		t.Fatalf("plain terrain: sightline %.2f, want clear", v)
	}
	c.Terrain = trunkFlat{flat}
	if v := sightline(c, eye, behind, sp); v != 0 {
		t.Errorf("behind a trunk: sightline %.2f, want 0", v)
	}
	if v := sightline(c, eye, open, sp); v <= 0.5 {
		t.Errorf("beside the trunk: sightline %.2f, want clear", v)
	}
}
