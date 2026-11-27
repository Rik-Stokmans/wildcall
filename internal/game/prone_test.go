package game

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Lying flat: the feet stay where they are (eye 0.35 m above them) and the
// ecosystem hears about the prone posture and the crawl.
func TestPronePoseFeetAndObserver(t *testing.T) {
	h := newHarness(t, false)
	feet := h.s.feet
	p := standPose(feet, 0)
	p.Y = feet.Y + proneEye
	p.Prone, p.Move, p.Speed = true, "crawl", 0.7
	h.send(proto.CPose, p)
	if dy := h.s.feet.Y - feet.Y; dy > 0.01 || dy < -0.01 {
		t.Fatalf("prone feet off by %v m", dy)
	}
	o := h.s.observer()
	if !o.Prone || o.Move != "crawl" {
		t.Fatalf("observer prone %v move %q", o.Prone, o.Move)
	}
	// Any declared movement while prone is a crawl; still stays still.
	if moveMode(proto.Pose{Prone: true, Move: "walk"}) != "crawl" || moveMode(proto.Pose{Prone: true, Move: "still"}) != "still" {
		t.Fatal("prone moveMode")
	}
}
