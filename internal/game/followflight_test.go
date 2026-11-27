package game

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestFollowAFlush: the player walks straight at a perched bird until it flushes and
// keeps it in view. The client is told the take-off and the landing (FlightMsg with
// the bird id and both ends of the flight), and the session counts the flush as
// followed to its landing.
func TestFollowAFlush(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	cabin := h.standNear("cabin", 6)
	h.tick(150)
	h.take()

	// A perched bird 25-60 m off, on land.
	var target core.BirdState
	for _, b := range s.sim.Near(cabin, 120, nil) {
		d := b.Pos.DistXZ(cabin)
		if b.Act == core.ActPerched && b.Speed == 0 && d > 25 && d < 60 && s.world.HeightAt(b.Pos.X, b.Pos.Z) > 0.3 {
			target = b
			break
		}
	}
	if target.ID == 0 {
		t.Skip("no perched bird near the cabin")
	}
	feet := cabin
	var flush, land *proto.FlightMsg
	for i := 0; i < 900 && land == nil; i++ {
		b, ok := s.sim.Get(target.ID)
		if !ok {
			t.Fatal("the bird left the world")
		}
		eye := feet.Add(core.V(0, core.EyeHeight, 0))
		yaw, pitch := aim(eye, b.Pos)
		p := standPose(feet, yaw)
		p.Pitch = pitch
		if flush == nil {
			// Walk straight at it.
			dir := b.Pos.Sub(feet)
			dir.Y = 0
			if dir.Len() > 3 {
				dir = dir.Norm()
				feet = feet.Add(dir.Scale(0.24))
				feet.Y = s.world.HeightAt(feet.X, feet.Z)
				p = standPose(feet, yaw)
				p.Pitch, p.Move, p.Speed = pitch, "walk", 2.4
			}
		}
		h.send(proto.CPose, p)
		h.tick(1)
		for _, m := range h.take() {
			if m.T != proto.SFlight {
				continue
			}
			fm := decodeAs[proto.FlightMsg](t, m.D)
			if fm.Bird != target.ID {
				continue
			}
			switch fm.Phase {
			case "flush":
				flush = &fm
			case "land":
				land = &fm
			}
		}
	}
	if flush == nil {
		t.Fatal("no flush message")
	}
	if land == nil {
		t.Fatal("no landing message")
	}
	if flush.Dur <= 0 || flush.From == flush.To {
		t.Errorf("flush message lacks the flight: %+v", *flush)
	}
	if land.To != flush.To {
		t.Errorf("landed at %v, flush said %v", land.To, flush.To)
	}
	if s.follow.watched != 1 {
		t.Errorf("the followed flush was not recognised as watched to its landing (%d)", s.follow.watched)
	}
}
