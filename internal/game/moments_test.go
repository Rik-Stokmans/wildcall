package game

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestMoments: the session notices climbing a tower, wading, sheltering from rain,
// sitting down and binoculars held up on nothing (the narrator's activity moments).
func TestMoments(t *testing.T) {
	h := newHarness(t, true)
	s := h.s

	// Climbing: feet 6 m above the ground beside the Old Watchtower.
	tower, _ := s.world.POI("old_watchtower")
	top := tower.Pos
	top.Y = s.world.HeightAt(top.X, top.Z) + 6
	h.stand(top, 0)
	h.tick(11)
	if !s.climbed {
		t.Error("climbing the watchtower not noticed")
	}
	// Back down re-arms it.
	down := top
	down.Y -= 6
	h.stand(down, 0)
	h.tick(11)
	if s.climbed {
		t.Error("still climbing after coming down")
	}

	// Wading: ground under the water plane near the creek.
	cabin, _ := s.world.POI("cabin")
	var wet core.Vec3
	for r := float32(10); r < 500 && wet == (core.Vec3{}); r += 5 {
		for a := 0; a < 64; a++ {
			p := cabin.Pos.Add(core.HeadingDir(float32(a) / 64 * 6.2832).Scale(r))
			if g := s.world.HeightAt(p.X, p.Z); g < -0.35 && g > -1.2 {
				wet = core.V(p.X, 0, p.Z)
				break
			}
		}
	}
	if wet == (core.Vec3{}) {
		t.Fatal("no wading depth near the cabin")
	}
	h.stand(wet, 0)
	h.tick(11)
	if !s.waded {
		t.Error("wading not noticed")
	}

	// Sheltering: rain, and the hide's roof.
	s.clock.SetWeather(core.WeatherRain)
	h.standNear("cabin", 3)
	for i := 0; i < 40 && s.clock.Env().Rain < shelterRain; i++ {
		h.tick(10)
	}
	if s.clock.Env().Rain < shelterRain {
		t.Fatalf("rain %.2f", s.clock.Env().Rain)
	}
	h.tick(11)
	if !s.sheltered {
		t.Error("sheltering under the cabin roof not noticed")
	}

	// Sitting down.
	feet := s.feet
	p := standPose(feet, 0)
	p.Sit, p.Y = true, feet.Y+0.85
	h.send(proto.CPose, p)
	if !s.lastSit {
		t.Error("sitting not noticed")
	}

	// Binoculars on the empty sky for a while.
	p = standPose(feet, 0)
	p.Tool, p.Raised, p.Zoom, p.FOV, p.Pitch = "binoculars", true, 6, 70.0/6, 1.2
	for i := 0; i < 80; i++ {
		h.send(proto.CPose, p)
		h.tick(1)
	}
	if !s.emptySaid && s.sightBird == 0 {
		t.Error("binoculars held on nothing not noticed")
	}
	narrationSpoilers(t, h)
}
