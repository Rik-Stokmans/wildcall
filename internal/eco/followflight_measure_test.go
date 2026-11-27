package eco

import (
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Measuring flushes on the real generated world: a walking observer goes from bird
// to bird around the home valley, walks straight at each one until it flushes, then
// stands and watches it go. For every flush we record what the player could have
// seen of the escape and the landing, and how long the bird stayed away.
//
// Run the full 200-flush report with
//
//	WC_FLUSH_N=200 go test ./internal/eco -run TestFlushMeasure -v

type flushRec struct {
	sp        int
	class     int // 0 small, 1 medium, 2 big (flushClass)
	dist      float32
	dur       float32
	peak      float32 // highest point above the ground (or water) during the flight
	avgSpeed  float32 // dist / dur in multiples of cruise speed
	maxSpeed  float32 // fastest 0.1 s step in multiples of cruise speed
	maxHSpeed float32 // ...horizontally
	occ       float32 // Terrain.Occlusion from the player's eye at the flush to the landing
	angle     float32 // radians between "eye to bird" at take-off and "eye to landing"
	cover     float32 // cover of the landing perch
	landed    bool
	alertT    float32 // seconds it stayed in the open (cover < 0.5, not hidden) after landing, up to 20
	calledT   float32 // seconds from landing to its first call (-1 = none within 20 s)
	returnT   float32 // seconds from the flush until it started home (-1 = not within the run)
	hid       bool    // dived into cover instead of flying off
	grass     bool    // landed on the ground in tall grass though it perches up (lost to the player)
	stepMs    float32 // wall time of the Sim step in which it was flushed (ms)
	kind      core.PerchKind
	hideShowT float32 // seconds until a hidden bird was visible again (-1 = not within 25 s)
}

type flushTrack struct {
	rec     *flushRec
	id      uint32
	from    core.Vec3
	eye     core.Vec3
	t       float32
	prev    core.Vec3
	landedT float32
	gone    bool
}

// flushClass is the size class the follow-flight rules use (followflight.go).
func flushClassOf(p *profile) int { return int(fleeClass(p)) }

func flushMeasure(t *testing.T, text string, n int, at func(w *world.World) core.Vec3) []flushRec {
	t.Helper()
	s, w, _ := realSim(t, text)
	start := at(w)
	env := envAt(1, 7.5)
	obs := stillObserver(w, start)
	s.Step(0.1, env, obs)
	for i := 0; i < 300; i++ {
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
	}
	recs := make([]flushRec, 0, n)
	var live []*flushTrack
	perSp := map[int16]int{}
	here := start
	visited := map[uint32]bool{}

	step := func(o core.Observer) []core.EcoEvent {
		evs := s.Step(0.1, env, o)
		env = advanceEnv(env, 0.1/60)
		for _, tr := range live {
			if tr.gone {
				continue
			}
			tr.t += 0.1
			b := s.find(tr.id)
			if b == nil {
				tr.gone = true
				continue
			}
			r := tr.rec
			p := &s.prof[b.sp]
			if !r.landed && !r.hid {
				if h := heightAbove(w, b.pos); h > r.peak {
					r.peak = h
				}
				if v := b.pos.Sub(tr.prev).Len() / 0.1 / p.speed; v > r.maxSpeed && tr.t > 0.15 {
					r.maxSpeed = v
				}
				if v := b.pos.DistXZ(tr.prev) / 0.1 / p.speed; v > r.maxHSpeed && tr.t > 0.15 {
					r.maxHSpeed = v
				}
				tr.prev = b.pos
				if !b.moving {
					r.landed = true
					r.dur = tr.t
					r.dist = b.pos.DistXZ(tr.from)
					r.avgSpeed = b.pos.Sub(tr.from).Len() / max32(r.dur, 0.1) / p.speed
					up := core.V(b.pos.X, b.pos.Y+0.08, b.pos.Z)
					r.occ = w.Occlusion(tr.eye, up)
					r.angle = angleOf(tr.from.Sub(tr.eye), b.pos.Sub(tr.eye))
					r.cover = b.cover
					r.kind = b.destKind
					r.grass = b.destKind == core.PerchGround && usesRaised(p) && tallGrass(w.HabitatAt(b.pos.X, b.pos.Z))
					tr.landedT = tr.t
				}
			} else if r.hid {
				if b.flags&core.FlagHidden != 0 {
					tr.landedT = 1 // it has reached its cover
				}
				if r.hideShowT < 0 && tr.landedT > 0 && b.flags&core.FlagHidden == 0 && !b.moving {
					r.hideShowT = tr.t
				}
			} else {
				since := tr.t - tr.landedT
				if since <= 20 && b.mode == mAway && !b.moving && b.cover < 0.5 && b.flags&core.FlagHidden == 0 && r.alertT >= since-0.11 {
					r.alertT = since
				}
			}
			if r.landed && r.calledT < 0 && b.flags&core.FlagSinging != 0 && tr.t-tr.landedT <= 20 {
				r.calledT = tr.t - tr.landedT
			}
			if r.returnT < 0 && b.mode != mAway && b.mode != mHide && !r.hid {
				r.returnT = tr.t
				tr.gone = true
			}
			if tr.t > 400 {
				tr.gone = true
			}
		}
		return evs
	}

	for len(recs) < n {
		// The next subject: a settled bird 15-70 m away, of the species flushed least
		// so far (so the sample spans the roster), preferring the nearest.
		var best *bird
		bestK := float32(1e9)
		for i := range s.birds {
			b := &s.birds[i]
			if !b.alive || visited[b.id] || b.moving || b.airborne() || b.mode == mAway || b.mode == mHide || b.mode == mLeave || b.mode == mRoost || b.mode == mNest {
				continue
			}
			d := b.pos.DistXZ(here)
			if d < 15 || d > 90 {
				continue
			}
			k := float32(perSp[b.sp])*100 + d
			if k < bestK {
				best, bestK = b, k
			}
		}
		if best == nil {
			// Nothing left around here: walk on.
			a := float64(len(recs)) * 2.4
			here = core.V(start.X+float32(140*math.Sin(a)), 0, start.Z+float32(140*math.Cos(a)))
			here.Y = w.HeightAt(here.X, here.Z)
			o := stillObserver(w, here)
			for i := 0; i < 30; i++ {
				step(o)
			}
			if len(recs) == 0 && len(visited) > 4000 {
				t.Fatal("no birds to flush")
			}
			continue
		}
		visited[best.id] = true
		p := &s.prof[best.sp]
		// Walk in from 6 flush distances out (or 6 m), straight at the bird.
		dirX, dirZ := float32(1), float32(0)
		if hl := best.pos.DistXZ(here); hl > 0.5 {
			dirX, dirZ = (best.pos.X-here.X)/hl, (best.pos.Z-here.Z)/hl
		}
		fd := p.shy * moveWalk * approachDirect
		d0 := clamp(fd*1.6, 6, 120)
		pos := core.V(best.pos.X-dirX*d0, 0, best.pos.Z-dirZ*d0)
		if g := w.HeightAt(pos.X, pos.Z); g < 0.05 {
			continue // would stand in the water
		}
		id := best.id
		flushed := false
		hid := false
		var flushMs float32
		for k := 0; k < 400 && !flushed; k++ {
			pos.Y = w.HeightAt(pos.X, pos.Z)
			o := observerAt(pos)
			o.Move, o.Speed, o.Vel = "walk", 2.2, core.V(dirX*2.2, 0, dirZ*2.2)
			t0 := time.Now()
			evs := step(o)
			flushMs = float32(time.Since(t0).Seconds() * 1000)
			b := s.find(id)
			if b == nil {
				break
			}
			for _, ev := range evs {
				if ev.Kind == core.EvFlush && ev.Bird == id {
					flushed = true
				}
			}
			if !flushed && b.mode == mHide && b.moving {
				flushed, hid = true, true
			}
			if b.pos.DistXZ(pos) < 2 {
				break
			}
			pos.X += dirX * 0.22
			pos.Z += dirZ * 0.22
		}
		here = pos
		if !flushed {
			continue
		}
		b := s.find(id)
		if b == nil {
			continue
		}
		perSp[b.sp]++
		eye := core.V(pos.X, w.HeightAt(pos.X, pos.Z)+core.EyeHeight, pos.Z)
		r := flushRec{sp: int(b.sp), class: flushClassOf(p), hid: hid, returnT: -1, calledT: -1, hideShowT: -1, stepMs: flushMs}
		recs = append(recs, r)
		tr := &flushTrack{rec: &recs[len(recs)-1], id: id, from: b.pos, eye: eye, prev: b.pos}
		live = append(live, tr)
		// Stand and watch for 20 s.
		o := stillObserver(w, pos)
		for i := 0; i < 200; i++ {
			o.Still += 0.1
			step(o)
		}
	}
	// Let the last ones come home.
	o := stillObserver(w, here)
	for i := 0; i < 1500; i++ {
		o.Still += 0.1
		step(o)
	}
	return recs
}

func angleOf(a, b core.Vec3) float32 {
	la, lb := a.Len(), b.Len()
	if la < 1e-4 || lb < 1e-4 {
		return 0
	}
	c := (a.X*b.X + a.Y*b.Y + a.Z*b.Z) / (la * lb)
	return float32(math.Acos(float64(clamp(c, -1, 1))))
}

// flushSummary is the report the measurement prints, per size class and overall.
type flushSummary struct {
	n, landed, hid                                  int
	hideT                                           []float32
	dist, dur, peak, avgSp, maxSp, occ, cover       []float32
	maxH                                            []float32
	los, inCone, alert8, called5, hideShow, return_ int
	grass, clear                                    int
	returnT                                         []float32
}

func summarize(recs []flushRec, class int) flushSummary {
	var f flushSummary
	for _, r := range recs {
		if class >= 0 && r.class != class {
			continue
		}
		f.n++
		if r.hid {
			f.hid++
			if r.hideShowT >= 0 && r.hideShowT <= 25 {
				f.hideShow++
			}
			if r.hideShowT >= 0 {
				f.hideT = append(f.hideT, r.hideShowT)
			}
			continue
		}
		if !r.landed {
			continue
		}
		f.landed++
		f.dist = append(f.dist, r.dist)
		f.dur = append(f.dur, r.dur)
		f.peak = append(f.peak, r.peak)
		f.avgSp = append(f.avgSp, r.avgSpeed)
		f.maxSp = append(f.maxSp, r.maxSpeed)
		f.maxH = append(f.maxH, r.maxHSpeed)
		f.occ = append(f.occ, r.occ)
		f.cover = append(f.cover, r.cover)
		if r.occ < 0.5 {
			f.los++
		}
		if r.grass {
			f.grass++
		}
		if r.occ < 0.2 {
			f.clear++
		}
		if r.angle < 60*math.Pi/180 {
			f.inCone++
		}
		if r.alertT >= 8 {
			f.alert8++
		}
		if r.calledT >= 0 && r.calledT <= 5 {
			f.called5++
		}
		if r.returnT >= 0 {
			f.return_++
			f.returnT = append(f.returnT, r.returnT)
		}
	}
	return f
}

func med(v []float32) float32 {
	if len(v) == 0 {
		return 0
	}
	c := append([]float32(nil), v...)
	sort.Slice(c, func(i, j int) bool { return c[i] < c[j] })
	return c[len(c)/2]
}

func pct(v []float32, q float64) float32 {
	if len(v) == 0 {
		return 0
	}
	c := append([]float32(nil), v...)
	sort.Slice(c, func(i, j int) bool { return c[i] < c[j] })
	return c[int(q*float64(len(c)-1))]
}

func (f flushSummary) String() string {
	share := func(k, n int) string {
		if n == 0 {
			return "  -"
		}
		return fmt.Sprintf("%3.0f%%", 100*float64(k)/float64(n))
	}
	return fmt.Sprintf("n=%3d landed=%3d hid=%2d | dist med %5.1f [p10 %5.1f p90 %5.1f] m | dur med %4.1f s | peak med %4.1f m | speed avg %.2fx max %.2fx (horiz %.2fx) cruise | LOS(occ<0.5) %s clear(occ<0.2) %s | within 60deg %s | landing cover med %.2f | in long grass %s | open>=8s %s | call<=5s %s | hidden reappear<=25s %s/%d (med %.0f s) | back home med %5.0f s (%d)",
		f.n, f.landed, f.hid, med(f.dist), pct(f.dist, 0.1), pct(f.dist, 0.9), med(f.dur), med(f.peak),
		med(f.avgSp), med(f.maxSp), med(f.maxH), share(f.los, f.landed), share(f.clear, f.landed), share(f.inCone, f.landed), med(f.cover), share(f.grass, f.landed),
		share(f.alert8, f.landed), share(f.called5, f.landed), share(f.hideShow, f.hid), f.hid, med(f.hideT), med(f.returnT), f.return_)
}

func flushReport(t *testing.T, recs []flushRec, spp []core.Species) {
	t.Logf("ALL    %v", summarize(recs, -1))
	var ms []float32
	for _, r := range recs {
		if !r.hid {
			ms = append(ms, r.stepMs)
		}
	}
	kinds := map[core.PerchKind]int{}
	landed := 0
	for _, r := range recs {
		if r.landed && !r.hid {
			kinds[r.kind]++
			landed++
		}
	}
	var ks []string
	for k, v := range kinds {
		ks = append(ks, fmt.Sprintf("%s %.0f%%", k.Key(), 100*float64(v)/float64(max(landed, 1))))
	}
	sort.Strings(ks)
	t.Logf("landing perch kinds: %s", strings.Join(ks, ", "))
	sort.Slice(ms, func(i, j int) bool { return ms[i] < ms[j] })
	if len(ms) > 0 {
		t.Logf("flush step wall time: median %.3f ms, p90 %.3f ms, max %.3f ms (n=%d)", ms[len(ms)/2], ms[len(ms)*9/10], ms[len(ms)-1], len(ms))
	}
	for c, name := range []string{"small ", "medium", "big   "} {
		t.Logf("%s %v", name, summarize(recs, c))
	}
	if os.Getenv("WC_FLUSH_SPECIES") != "" {
		bySp := map[int][]flushRec{}
		for _, r := range recs {
			bySp[r.sp] = append(bySp[r.sp], r)
		}
		var ids []int
		for k := range bySp {
			ids = append(ids, k)
		}
		sort.Ints(ids)
		for _, k := range ids {
			t.Logf("  %-24s %v", spp[k].ID, summarize(bySp[k], -1))
		}
	}
}

func flushN(def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv("WC_FLUSH_N"))); err == nil && v > 0 {
		return v
	}
	return def
}

// TestFlushMeasure prints the flush report (and, with the default small sample,
// checks the follow-flight rules hold on the real world).
func TestFlushMeasure(t *testing.T) {
	if testing.Short() {
		t.Skip("real world")
	}
	n := flushN(36)
	if os.Getenv("WC_FLUSH_LEGACY") != "" {
		followFlight = false
		defer func() { followFlight = true }()
	}
	recs := flushMeasure(t, "followflight", n-n/4, func(w *world.World) core.Vec3 { return cabinPos(t, w) })
	// A quarter at the water: herons, ducks, the bigger and warier birds.
	recs = append(recs, flushMeasure(t, "followflight", n/4, func(w *world.World) core.Vec3 {
		p, ok := regionLand(w, core.RegionMurmurMarsh)
		if !ok {
			t.Skip("no marsh")
		}
		return p
	})...)
	_, _, spp := realSim(t, "followflight")
	flushReport(t, recs, spp)
	if followFlight {
		checkFollowable(t, recs)
	}
}
