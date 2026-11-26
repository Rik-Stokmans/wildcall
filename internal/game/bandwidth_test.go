package game

import (
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestBandwidthAtCabin measures what a client standing at the cabin receives.
func TestBandwidthAtCabin(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	// Spring: the breeding season, so nests are streamed too.
	s.clock.SetSeason(core.Spring)
	feet := h.standNear("cabin", 6)
	h.tick(10)
	h.take()
	b0 := s.BytesOut()
	byType := map[string]int{}
	const ticks = 600 // one minute
	t0 := time.Now()
	for i := 0; i < ticks; i++ {
		h.send(proto.CPose, standPose(feet, 1))
		h.tick(1)
		for _, m := range h.take() {
			byType[m.T] += len(m.D) + len(m.T) + 12
		}
		h.all = h.all[:0]
	}
	wall := time.Since(t0)
	rate := float64(s.BytesOut()-b0) / (ticks * 0.1)
	t.Logf("at the cabin: %.1f KB/s (%v, %v); by type (bytes/s): %v; %d birds in the last snapshot, %d nests within %d m; sim cost %.2f ms/tick",
		rate/1024, s.clock.Env().Season, s.clock.Env().Phase(), perSecond(byType, ticks*0.1), len(s.birdBuf), len(s.nestBuf), nestStreamR, wall.Seconds()*1e3/ticks)
	if rate > 200*1024 {
		t.Errorf("%.0f KB/s at the cabin", rate/1024)
	}
}

func perSecond(m map[string]int, secs float64) map[string]int {
	out := map[string]int{}
	for k, v := range m {
		out[k] = int(float64(v) / secs)
	}
	return out
}
