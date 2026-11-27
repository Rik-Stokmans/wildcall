package game

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/eco"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// The tutorial's singer. "The Unseen Singer" must succeed for a new player within a
// few minutes, so while it is open the world holds one particular wren a beginner
// can find: a resident male with a small territory beside the old woodland trail
// between the cabin and the Woodland Entrance, working a round of three or four
// low, exposed song posts (stump tops, fallen logs, the tops of brambles) within
// about ten metres of each other, in open view from the trail, singing a full
// phrase every 8-14 s and tolerating a quiet watcher close by (eco.Circuit). The
// quest's tracker points at the place (QuestState.Area). He is chosen
// deterministically from the world, so a reloaded save finds him again; once the
// quest is complete he becomes an ordinary memory and leaves when nobody is
// looking.
const (
	singerCabinMin = 60   // m from the cabin: a short walk
	singerCabinMax = 140  //
	singerTrailMin = 2.0  // m from the trail's centre line: off the path itself
	singerTrailMax = 15   // ... but in open view from it
	singerPostMinH = 0.35 // m above the ground: knee to head height (a stump top)
	singerPostMaxH = 1.8
	singerCover    = 0.32 // the post is exposed: cover at most this
	singerViewOcc  = 0.35 // occlusion from the trail (eye height) to the post at most this
	singerLeg      = 10   // m: posts of the round at most this far apart
	singerGap      = 2.5  // m: ... and at least this far apart
	singerPosts    = 4
	singerKey      = 0x5349_4E47_4552 // eco.Circuit key salt
)

// singerPlan is where the tutorial's singer lives in a world.
type singerPlan struct {
	ok     bool
	posts  []core.Perch
	centre core.Vec3
	radius float32
	name   string
	relax  int // 0 = found with the strict rules; 1, 2 = with relaxed ones (fallback)
}

// singerState is the session's handle on the singer.
type singerState struct {
	planned bool
	plan    singerPlan
	id      uint32 // eco id while he is special (0 = none)
}

type postCand struct {
	pc    core.Perch
	trail float32 // distance from the trail line
	occ   float32 // occlusion seen from the nearest trail point
	cabin float32 // distance from the cabin
	bush  bool    // the top of a bush (bramble, shrub)
}

// planSinger chooses the singer's territory and round for a world (deterministic).
func planSinger(w *world.World) singerPlan {
	cabin, ok := w.POI("cabin")
	if !ok {
		return singerPlan{}
	}
	toward := cabin.Pos
	if we, ok := w.POI("woodland_entrance"); ok {
		toward = we.Pos
	}
	trail := trailNearCabin(w, cabin.Pos, toward)
	if len(trail) < 2 {
		// No trail (should not happen): a line from the cabin to the entrance.
		trail = []core.Vec3{cabin.Pos, toward}
	}
	for relax := 0; relax < 3; relax++ {
		if pl := planSingerWith(w, cabin.Pos, trail, relax); pl.ok {
			return pl
		}
	}
	return singerPlan{}
}

// trailNearCabin is the main trail's polyline from the cabin towards the Woodland
// Entrance and a little beyond (the part within singerCabinMax + 40 m of the cabin).
func trailNearCabin(w *world.World, cabin, toward core.Vec3) []core.Vec3 {
	var best []core.Vec3
	for _, t := range w.TrailsNear(cabin.X, cabin.Z, singerCabinMax+60, nil) {
		if t.Hidden || len(t.Points) < 2 {
			continue
		}
		if t.ID == "main" {
			best = t.Points
			break
		}
		if best == nil {
			best = t.Points
		}
	}
	var out []core.Vec3
	for _, p := range best {
		if p.DistXZ(cabin) <= singerCabinMax+40 {
			out = append(out, p)
		}
	}
	return out
}

// distToPolyline is the XZ distance from p to the polyline and the nearest point on it.
func distToPolyline(p core.Vec3, line []core.Vec3) (float32, core.Vec3) {
	best, at := float32(math.MaxFloat32), core.Vec3{}
	for i := 0; i+1 < len(line); i++ {
		a, b := line[i], line[i+1]
		dx, dz := b.X-a.X, b.Z-a.Z
		l2 := dx*dx + dz*dz
		t := float32(0)
		if l2 > 1e-6 {
			t = ((p.X-a.X)*dx + (p.Z-a.Z)*dz) / l2
			t = max(0, min(1, t))
		}
		q := core.V(a.X+dx*t, a.Y+(b.Y-a.Y)*t, a.Z+dz*t)
		if d := q.DistXZ(p); d < best {
			best, at = d, q
		}
	}
	return best, at
}

func planSingerWith(w *world.World, cabin core.Vec3, trail []core.Vec3, relax int) singerPlan {
	minH, maxH, maxCover, maxOcc := float32(singerPostMinH), float32(singerPostMaxH), float32(singerCover), float32(singerViewOcc)
	cMin, cMax, tMax := float32(singerCabinMin), float32(singerCabinMax), float32(singerTrailMax)
	need := 3
	if relax >= 1 {
		minH, maxH, maxCover, maxOcc = 0.3, 2.3, 0.45, 0.5
		cMin, cMax, tMax = 45, 150, 18
	}
	if relax >= 2 {
		need = 2
	}
	// Candidate posts along the trail.
	seen := map[[2]int32]bool{}
	var cands []postCand
	var buf []core.Perch
	for i := 0; i+1 < len(trail); i++ {
		a, b := trail[i], trail[i+1]
		segL := a.DistXZ(b)
		for s := float32(0); s <= segL; s += 8 {
			t := s / max(segL, 1e-3)
			q := core.V(a.X+(b.X-a.X)*t, 0, a.Z+(b.Z-a.Z)*t)
			dc := q.DistXZ(cabin)
			if dc < cMin-tMax || dc > cMax+tMax {
				continue
			}
			buf = w.PerchesNear(q.X, q.Z, tMax+2, buf[:0])
			for _, pc := range buf {
				k := [2]int32{int32(pc.Pos.X * 4), int32(pc.Pos.Z * 4)}
				if seen[k] {
					continue
				}
				seen[k] = true
				if c, ok := postCandidate(w, pc, cabin, trail, minH, maxH, maxCover, maxOcc, cMin, cMax, tMax, relax); ok {
					cands = append(cands, c)
				}
			}
		}
	}
	// Deterministic order whatever the query order was.
	sort.Slice(cands, func(i, j int) bool {
		a, b := cands[i].pc.Pos, cands[j].pc.Pos
		if a.X != b.X {
			return a.X < b.X
		}
		return a.Z < b.Z
	})

	// The best round: up to four posts, each pair between singerGap and singerLeg
	// apart, open to the trail, about 100 m from the cabin.
	var best []int
	bestScore := float32(-math.MaxFloat32)
	for i := range cands {
		pick := []int{i}
		order := make([]int, 0, 16)
		for j := range cands {
			if j != i && cands[j].pc.Pos.DistXZ(cands[i].pc.Pos) <= singerLeg {
				order = append(order, j)
			}
		}
		sort.SliceStable(order, func(x, y int) bool {
			return cands[order[x]].pc.Pos.DistXZ(cands[i].pc.Pos) < cands[order[y]].pc.Pos.DistXZ(cands[i].pc.Pos)
		})
		for _, j := range order {
			if len(pick) >= singerPosts {
				break
			}
			fits := true
			for _, k := range pick {
				d := cands[j].pc.Pos.DistXZ(cands[k].pc.Pos)
				if d < singerGap || d > singerLeg {
					fits = false
					break
				}
			}
			if fits {
				pick = append(pick, j)
			}
		}
		if len(pick) < need {
			continue
		}
		var sc, cab float32
		for _, k := range pick {
			c := cands[k]
			sc -= c.occ*4 + c.trail/8 + c.pc.Cover*3
			if c.pc.Kind == core.PerchRock || c.pc.Kind == core.PerchGround {
				sc -= 1.5 // the hints promise stumps, logs and bush tops
			}
			cab += c.cabin
		}
		cab /= float32(len(pick))
		sc /= float32(len(pick))
		sc += float32(len(pick)) * 3
		sc -= absf(cab-100) / 25
		if cab > singerCabinMax {
			sc -= (cab - singerCabinMax) / 5
		}
		if sc > bestScore {
			bestScore, best = sc, pick
		}
	}
	if best == nil {
		return singerPlan{}
	}
	pl := singerPlan{ok: true, relax: relax}
	var centre core.Vec3
	for _, k := range best {
		pl.posts = append(pl.posts, cands[k].pc)
		centre = centre.Add(cands[k].pc.Pos)
	}
	centre = centre.Scale(1 / float32(len(best)))
	// Work the posts as a round (by angle about the centre), so "the next post" is
	// always a neighbour.
	sort.SliceStable(pl.posts, func(i, j int) bool {
		ai := math.Atan2(float64(pl.posts[i].Pos.X-centre.X), float64(centre.Z-pl.posts[i].Pos.Z))
		aj := math.Atan2(float64(pl.posts[j].Pos.X-centre.X), float64(centre.Z-pl.posts[j].Pos.Z))
		return ai < aj
	})
	pl.centre = centre
	for _, pc := range pl.posts {
		pl.radius = max(pl.radius, pc.Pos.DistXZ(centre))
	}
	pl.radius = max(pl.radius+6, 10)
	pl.name = singerPlaceName(w, best, cands)
	return pl
}

// postCandidate checks one perch as a possible song post.
func postCandidate(w *world.World, pc core.Perch, cabin core.Vec3, trail []core.Vec3,
	minH, maxH, maxCover, maxOcc, cMin, cMax, tMax float32, relax int) (postCand, bool) {
	switch pc.Kind {
	case core.PerchSnag, core.PerchShrub: // stumps, fallen logs, bush tops (what the hints promise)
	case core.PerchRock, core.PerchBranch:
		if relax < 1 {
			return postCand{}, false
		}
	case core.PerchGround:
		if relax < 2 {
			return postCand{}, false
		}
	default:
		return postCand{}, false
	}
	g := w.HeightAt(pc.Pos.X, pc.Pos.Z)
	if g < 0.2 {
		return postCand{}, false // at the water's edge or in it
	}
	bush := false
	if pc.Kind == core.PerchShrub {
		// He sings from the top of the bush (eco's topOf: the perch rises by 1.3 × its
		// height and keeps 45 % of its cover).
		if h := pc.Pos.Y - g; h > 0 {
			pc.Pos.Y = g + h*1.3
		}
		pc.Cover *= 0.45
		bush = true
	}
	h := pc.Pos.Y - g
	if pc.Kind == core.PerchGround {
		h = max(h, minH) // a ground post (fallback only) is low by definition
	} else if h < minH || h > maxH {
		return postCand{}, false
	}
	if pc.Cover > maxCover {
		return postCand{}, false
	}
	dc := pc.Pos.DistXZ(cabin)
	if dc < cMin || dc > cMax {
		return postCand{}, false
	}
	dt, at := distToPolyline(pc.Pos, trail)
	if dt < singerTrailMin || dt > tMax {
		return postCand{}, false
	}
	eye := core.V(at.X, w.HeightAt(at.X, at.Z)+core.EyeHeight, at.Z)
	occ, clear := viewOf(w, eye, pc.Pos.Add(core.V(0, 0.08, 0)))
	if occ > maxOcc || !clear {
		return postCand{}, false
	}
	return postCand{pc: pc, trail: dt, occ: occ, cabin: dc, bush: bush}, true
}

// trunkR is how close (m, XZ) a sight line may pass a trunk marker before the
// trunk hides what is behind it.
const trunkR = 0.45

// viewOf is the occlusion of the sight line from eye to target and whether no tree
// trunk stands in it. World.Occlusion counts foliage and terrain only; the trunks
// are found from the world's trunk perches (they sit on the trunk surface, 2-8 m up).
func viewOf(w *world.World, eye, target core.Vec3) (float32, bool) {
	occ := w.Occlusion(eye, target)
	mid := eye.Add(target).Scale(0.5)
	half := eye.DistXZ(target) / 2
	for _, pc := range w.PerchesNear(mid.X, mid.Z, half+1, nil) {
		if pc.Kind != core.PerchTrunk {
			continue
		}
		if d, _ := distToPolyline(pc.Pos, []core.Vec3{eye, target}); d < trunkR {
			// The trunk is in the line unless it stands right at either end.
			if pc.Pos.DistXZ(eye) > 0.6 && pc.Pos.DistXZ(target) > 0.6 {
				return occ, false
			}
		}
	}
	return occ, true
}

// singerPlaceName names the territory in plain words for the quest tracker.
func singerPlaceName(w *world.World, pick []int, cands []postCand) string {
	bramble, bush, wood, rock := 0, 0, 0, 0
	for _, k := range pick {
		c := cands[k]
		switch {
		case c.bush:
			bush++
			for _, f := range w.ForageNear(c.pc.Pos.X, c.pc.Pos.Z, 2.5) {
				if f.Veg.Kind == core.VegBramble {
					bramble++
					break
				}
			}
		case c.pc.Kind == core.PerchSnag:
			wood++
		case c.pc.Kind == core.PerchRock:
			rock++
		}
	}
	switch {
	case rock > wood+bush:
		return "the low rocks beside the old trail"
	case rock > 0 && wood > 0 && bush == 0:
		return "the stumps and low rocks beside the old trail"
	case bramble > 0 && wood > 0:
		return "the bramble and old stumps beside the old trail"
	case bramble > 0:
		return "the bramble beside the old trail"
	case bush > 0 && wood > 0:
		return "the bushes and old stumps beside the old trail"
	case wood > 0:
		return "the old stumps and fallen wood beside the old trail"
	case bush > 0:
		return "the low bushes beside the old trail"
	}
	return "the undergrowth beside the old trail"
}

// singerWanted reports whether the tutorial is still open (offered or under way).
func (s *Session) singerWanted() (st *proto.QuestState, want bool) {
	st = s.p.Quests[content.TutorialQuest]
	if st == nil {
		return nil, true
	}
	return st, st.Status == content.StatusAvailable || st.Status == content.StatusActive
}

// syncSinger keeps the singer and the quest's search area in step with the
// tutorial's status. Cheap; called every tick.
func (s *Session) syncSinger() {
	if s.p == nil || s.sim == nil || s.world == nil {
		return
	}
	st, want := s.singerWanted()
	if want && s.singer.id == 0 {
		if !s.singer.planned {
			s.singer.planned = true
			s.singer.plan = planSinger(s.world)
			if pl := s.singer.plan; pl.ok {
				s.logf("singer: %d posts, %s, %.0f m from the cabin (relax %d)", len(pl.posts), pl.name, s.cabinDist(pl.centre), pl.relax)
			} else {
				s.logf("singer: no territory found in this world")
			}
		}
		if pl := s.singer.plan; pl.ok {
			if sp := s.spByID(content.TutorialSpecies); sp != nil {
				s.singer.id = s.sim.AddCircuit(eco.Circuit{
					Species: sp.Index,
					Key:     uint64(s.seed) ^ singerKey,
					Posts:   pl.posts,
				})
			}
		}
	} else if !want && s.singer.id != 0 {
		s.sim.ReleaseCircuit(s.singer.id)
		s.singer.id = 0
	}

	// The search area rides on the quest state while the quest is under way.
	if st == nil {
		return
	}
	if st.Status == content.StatusActive && s.singer.plan.ok {
		pl := s.singer.plan
		a := proto.SearchArea{Name: pl.name, X: pl.centre.X, Z: pl.centre.Z, Radius: pl.radius}
		if st.Area == nil || *st.Area != a {
			st.Area = &a
			s.changed()
		}
	} else if st.Area != nil {
		st.Area = nil
		s.changed()
	}
}

func (s *Session) cabinDist(p core.Vec3) float32 {
	if c, ok := s.world.POI("cabin"); ok {
		return p.DistXZ(c.Pos)
	}
	return 0
}

// SingerID is the eco id of the tutorial's singer while he is special (0 = none).
func (s *Session) SingerID() uint32 { return s.singer.id }

// debugSinger reports on the singer ("singer"), or teleports to watch him from the
// trail ("singer go [metres]").
func (s *Session) debugSinger(args []string) (string, error) {
	pl := s.singer.plan
	if !pl.ok {
		return "", gentleErr("no singer in this world")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s, centre %.1f %.1f r %.0f, id %d:", pl.name, pl.centre.X, pl.centre.Z, pl.radius, s.singer.id)
	for i, pc := range pl.posts {
		fmt.Fprintf(&b, " [%d %s %.1f %.1f h%.2f c%.2f]", i, kindWord(pc.Kind), pc.Pos.X, pc.Pos.Z, pc.Pos.Y-s.world.HeightAt(pc.Pos.X, pc.Pos.Z), pc.Cover)
	}
	if len(args) > 0 && args[0] == "go" && s.singer.id != 0 {
		dist := float32(15)
		if d, ok := argF(args, 1); ok && d > 1 {
			dist = d
		}
		bs, ok := s.sim.Get(s.singer.id)
		if !ok {
			return b.String(), nil
		}
		// Stand dist metres away with a clear view of him, as close to the trail side
		// as the trees allow, facing him.
		cabin, _ := s.world.POI("cabin")
		trail := trailNearCabin(s.world, cabin.Pos, cabin.Pos)
		_, at := distToPolyline(bs.Pos, trail)
		base := core.HeadingTo(bs.Pos, at)
		var feet core.Vec3
		bestOcc := float32(2)
		for i := 0; i < 36; i++ {
			off := float32((i+1)/2) * (math.Pi / 18)
			if i%2 == 1 {
				off = -off
			}
			f := bs.Pos.Add(core.HeadingDir(base + off).Scale(dist))
			f.Y = s.world.HeightAt(f.X, f.Z)
			if f.Y < 0.2 {
				continue
			}
			occ, clear := viewOf(s.world, f.Add(core.V(0, core.EyeHeight, 0)), bs.Pos)
			if clear && occ < 0.2 {
				feet, bestOcc = f, occ
				break
			}
			if clear && occ < bestOcc {
				feet, bestOcc = f, occ
			}
		}
		if bestOcc > 1 {
			feet = bs.Pos.Add(core.HeadingDir(base).Scale(dist))
			feet.Y = s.world.HeightAt(feet.X, feet.Z)
		}
		s.Teleport(feet, core.HeadingTo(feet, bs.Pos))
		fmt.Fprintf(&b, " - standing %.0f m from him", dist)
	}
	return b.String(), nil
}

func kindWord(k core.PerchKind) string {
	switch k {
	case core.PerchSnag:
		return "stump/log"
	case core.PerchShrub:
		return "bush-top"
	case core.PerchRock:
		return "rock"
	case core.PerchBranch:
		return "branch"
	case core.PerchGround:
		return "ground"
	}
	return "perch"
}

func absf(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}
