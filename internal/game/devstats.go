package game

import (
	"encoding/json"
	"runtime"
	"sort"
	"strings"
	"time"
)

// Dev-only soak metrics (tools/soak): with -dev the session logs, every
// devStatsEvery seconds of ticking, its tick cost, the Go heap and the size of every
// internal collection that could grow over a long session, plus the bytes sent per
// message type. Nothing here runs without -dev.

const devStatsEvery = 30.0 // s

type devStats struct {
	acc    float64
	n      int
	sum    float64
	max    float64
	bytes  map[string]int64
	counts map[string]int
	wall   time.Time     // start of the interval
	cpu    time.Duration // process CPU time (user+sys) at the start of the interval
}

// devTick records one tick's cost and logs a summary every devStatsEvery seconds.
func (s *Session) devTick(dt float32, start time.Time) {
	if !s.cfg.Dev || s.cfg.Logf == nil {
		return
	}
	d := time.Since(start).Seconds()
	st := &s.dev
	if st.wall.IsZero() {
		st.wall, st.cpu = start, processCPU()
	}
	st.n++
	st.sum += d
	if d > st.max {
		st.max = d
	}
	st.acc += float64(dt)
	if st.acc < devStatsEvery {
		return
	}
	cpuNow, wallNow := processCPU(), time.Now()
	cpuPct := 100 * float64(cpuNow-st.cpu) / float64(wallNow.Sub(st.wall))
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	eco := s.sim.Stats()
	prof, _ := json.Marshal(s.p)
	view, _ := json.Marshal(s.clientView())
	var b strings.Builder
	keys := make([]string, 0, len(st.bytes))
	for k := range st.bytes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		b.WriteString(" " + k + "=" + itoa(st.counts[k]) + "/" + itoa(int(st.bytes[k]/1024)) + "k")
	}
	s.logf("SOAK engine t=%.0f cpuPct=%.1f tickMean=%.2fms tickMax=%.2fms heapMB=%.1f heapObjs=%d gcs=%d goroutines=%d "+
		"ecoCells=%d ecoPending=%d birds=%d lures=%d sessLures=%d sentPOI=%d sentTrail=%d warmed=%d heardBirds=%d investigated=%d mysteryBird=%d "+
		"clueBoard=%d callLog=%d mysteries=%d observations=%d photos=%d recs=%d locations=%d nestsJ=%d flags=%d xpLog=%d explored=%d forage=%d expTiles=%d profileBytes=%d viewBytes=%d | per %.0fs msgs:%s",
		s.now, cpuPct, st.sum/float64(st.n)*1000, st.max*1000, float64(ms.HeapAlloc)/(1<<20), ms.HeapObjects, ms.NumGC, runtime.NumGoroutine(),
		eco.Cells, eco.Pending, eco.Birds, eco.Lures, len(s.lures), len(s.sentPOI), len(s.sentTrail), len(s.warmed), len(s.heardBirds), len(s.investigated), len(s.mysteryBird),
		s.board.Len(), s.calls.Sounding(), len(s.p.Journal.Mysteries), len(s.p.Journal.Observations), len(s.p.Journal.Photos), len(s.p.Journal.Recordings),
		len(s.p.Journal.Locations), len(s.p.Journal.Nests), len(s.p.Flags), len(s.p.XPLog), len(s.p.Explored), len(s.p.Forage), s.expCount(), len(prof), len(view),
		st.acc, b.String())
	*st = devStats{bytes: st.bytes, counts: st.counts, wall: wallNow, cpu: cpuNow}
	clear(st.bytes)
	clear(st.counts)
}

// devCount records one outbound message for the soak metrics (dev only).
func (s *Session) devCount(t string, n int) {
	if !s.cfg.Dev {
		return
	}
	if s.dev.bytes == nil {
		s.dev.bytes, s.dev.counts = map[string]int64{}, map[string]int{}
	}
	s.dev.bytes[t] += int64(n)
	s.dev.counts[t]++
}

func (s *Session) expCount() int {
	s.expMu.RLock()
	defer s.expMu.RUnlock()
	return len(s.expTiles)
}
