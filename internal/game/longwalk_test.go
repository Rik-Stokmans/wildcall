package game

import (
	"math"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestLongWalk runs 3 km out through the real world and back at running speed,
// one pose per tick, requesting chunks like the client does.
func TestLongWalk(t *testing.T) {
	if testing.Short() {
		t.Skip("long walk")
	}
	h := newHarness(t, true)
	s := h.s
	cabin, _ := s.world.POI("cabin")
	start := s.feet
	home := map[uint32]bool{}
	for _, b := range s.sim.Near(cabin.Pos, 150, nil) {
		home[b.ID] = true
	}
	if len(home) < 10 {
		t.Fatalf("only %d birds around the cabin", len(home))
	}
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	heap0 := ms.HeapAlloc

	const speed = 4.4 // m/s running
	const out = 3000.0
	// Pick a heading that stays mostly on land for the first kilometre.
	yaw := float32(math.Pi / 2)
	bestLand := -1
	for a := 0; a < 16; a++ {
		y := float32(a) / 16 * 2 * math.Pi
		land := 0
		for d := float32(50); d <= out; d += 50 {
			p := start.Add(core.HeadingDir(y).Scale(d))
			if s.world.HeightAt(p.X, p.Z) > 0 {
				land++
			}
		}
		if land > bestLand {
			bestLand, yaw = land, y
		}
	}
	t.Logf("heading %.2f rad: %d/60 samples on land", yaw, bestLand)

	var tickTimes []float64
	chunksAsked, chunkTime := 0, time.Duration(0)
	lastChunk := map[[2]int]bool{}
	poisMsgs, birdsSeen := 0, 0
	minBirds := math.MaxInt
	steps := int(math.Round(2 * out / (speed * 0.1)))
	pos := start
	for i := 0; i < steps; i++ {
		heading := yaw
		if i >= steps/2 {
			heading = yaw + math.Pi
		}
		step := core.HeadingDir(heading).Scale(speed * 0.1)
		pos = pos.Add(step)
		pos.Y = s.world.HeightAt(pos.X, pos.Z)
		eyeY := pos.Y
		if eyeY < 0 {
			eyeY = 0 // wading: the client would keep the eye above water
		}
		h.send(proto.CPose, proto.Pose{X: pos.X, Y: eyeY + core.EyeHeight, Z: pos.Z, Yaw: heading, Speed: speed, Move: "run",
			Tool: "none", FOV: 70, Zoom: 1, Sharp: 1})
		t0 := time.Now()
		s.Tick(0.1)
		tickTimes = append(tickTimes, time.Since(t0).Seconds())
		if d := time.Since(t0); d > 8*time.Millisecond {
			t.Logf("slow tick %d at %.0f m: %v", i, pos.DistXZ(start), d)
		}

		// The client's chunk ring (lod 0 within 2 chunks, lod 1 to 4, lod 2 to 7),
		// asked for as the player crosses chunk borders.
		ccx, ccz := int(math.Floor(float64(pos.X/64))), int(math.Floor(float64(pos.Z/64)))
		if !lastChunk[[2]int{ccx, ccz}] && !noChunks {
			lastChunk = map[[2]int]bool{{ccx, ccz}: true}
			c0 := time.Now()
			for dz := -7; dz <= 7; dz++ {
				for dx := -7; dx <= 7; dx++ {
					r := max(abs(dx), abs(dz))
					lod := 2
					if r <= 2 {
						lod = 0
					} else if r <= 4 {
						lod = 1
					}
					if _, err := s.Terrain().Chunk(ccx+dx, ccz+dz, lod); err != nil {
						t.Fatalf("chunk %d,%d: %v", ccx+dx, ccz+dz, err)
					}
					chunksAsked++
				}
			}
			chunkTime += time.Since(c0)
		}
		for _, m := range h.take() {
			switch m.T {
			case proto.SPois:
				poisMsgs++
			case proto.SBirds:
				n := countBirds(t, m.D)
				birdsSeen += n
				if i%50 == 0 && n < minBirds {
					minBirds = n
				}
			}
		}
		h.all = h.all[:0]
	}
	runtime.GC()
	runtime.ReadMemStats(&ms)
	heap1 := ms.HeapAlloc

	sort.Float64s(tickTimes)
	p50, p99, worst := tickTimes[len(tickTimes)/2], tickTimes[len(tickTimes)*99/100], tickTimes[len(tickTimes)-1]
	t.Logf("%d ticks: p50 %.2f ms, p99 %.2f ms, worst %.2f ms", len(tickTimes), p50*1e3, p99*1e3, worst*1e3)
	t.Logf("chunks asked %d in %v (%.2f ms each incl. cache hits)", chunksAsked, chunkTime, chunkTime.Seconds()*1e3/float64(chunksAsked))
	t.Logf("pois messages %d, min birds in snapshot %d, heap %d MB -> %d MB, birds active %d",
		poisMsgs, minBirds, heap0>>20, heap1>>20, s.sim.Count())
	if worst > 0.020 && !raceEnabled {
		t.Errorf("a tick took %.1f ms (budget 20 ms)", worst*1e3)
	}
	if poisMsgs < 5 {
		t.Errorf("only %d pois messages over a 6 km walk", poisMsgs)
	}
	if heap1 > heap0+400<<20 {
		t.Errorf("heap grew from %d MB to %d MB", heap0>>20, heap1>>20)
	}
	if pos.DistXZ(start) > 5 {
		t.Fatalf("did not return home: %v vs %v", pos, start)
	}
	// Run the observation and snapshot a few more ticks at home.
	h.tick(20)
	back := 0
	for _, b := range s.sim.Near(cabin.Pos, 400, nil) {
		if home[b.ID] {
			back++
		}
	}
	t.Logf("home birds: %d before, %d of them found again", len(home), back)
	if float64(back) < 0.9*float64(len(home)) {
		t.Errorf("only %d of %d home birds are the same individuals on return", back, len(home))
	}
}

var noChunks = os.Getenv("WILDCALL_NOCHUNKS") != ""

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func countBirds(t *testing.T, d []byte) int {
	var bm struct {
		B [][]float64 `json:"b"`
	}
	bm2 := decodeAs[struct {
		B [][]float64 `json:"b"`
	}](t, d)
	bm = bm2
	return len(bm.B)
}
