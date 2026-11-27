package game

import (
	"math"
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func itoa(n int) string { return strconv.Itoa(n) }

func finite(vs ...float32) bool {
	for _, v := range vs {
		f := float64(v)
		if math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > 1e7 {
			return false
		}
	}
	return true
}

func clampf(v, lo, hi float32) float32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func tileKey(tx, tz int) string { return itoa(tx) + "," + itoa(tz) }

func floorDiv(v float32, size float32) int { return int(math.Floor(float64(v / size))) }

// msgPose handles the player's pose (10 Hz in play, 2 Hz otherwise).
func (s *Session) msgPose(d []byte) {
	var p proto.Pose
	if err := decode(d, &p); err != nil || !finite(p.X, p.Y, p.Z, p.Yaw, p.Pitch, p.Speed, p.FOV, p.Zoom, p.Sharp, p.Noise) {
		s.fail("That pose could not be read.")
		return
	}
	p.Speed = clampf(p.Speed, 0, 20)
	p.Sharp = clampf(p.Sharp, 0, 1)
	p.Noise = clampf(p.Noise, 0, 1)
	p.Pitch = clampf(p.Pitch, -math.Pi/2, math.Pi/2)
	s.applyPose(p)
}

// applyPose moves the player: totals, observer velocity, fog of war, region
// gating and cabin arrival. (Discovery of places runs at 2 Hz from Tick.)
func (s *Session) applyPose(p proto.Pose) {
	// Eye heights match the client controller (web/js/player/movement.js).
	eyeH := float32(core.EyeHeight)
	switch {
	case p.Sit:
		eyeH = 0.85
	case p.Crouch:
		eyeH = 1.0
	}
	feet := core.V(p.X, p.Y-eyeH, p.Z)
	if s.havePose {
		dt := s.now - s.lastPoseAt
		step := feet.DistXZ(s.feet)
		if step < 25 {
			s.p.Totals.Distance += step
		}
		if dt > 0.02 && step < 25 {
			s.vel = feet.Sub(s.feet).Scale(float32(1 / dt))
			s.vel.Y = 0
		} else if step >= 25 {
			s.vel = core.Vec3{}
		}
	}
	s.pose = p
	s.feet = feet
	s.havePose = true
	s.lastPoseAt = s.now
	s.p.Pos, s.p.Yaw = feet, p.Yaw
	if p.Focus && !s.lastFocus {
		s.narrate(narrator.Event{Kind: narrator.FocusBegin})
	}
	s.lastFocus = p.Focus
	if p.Sit && !s.lastSit {
		s.narrate(narrator.Event{Kind: narrator.SatDown})
	}
	s.lastSit = p.Sit

	s.explore(feet)
	s.checkRegion(feet)
	s.checkCabin(feet)
}

// explore marks the 32 m fog cells within 48 m of the player.
func (s *Session) explore(pos core.Vec3) {
	const cell = core.FogCell
	x0, x1 := floorDiv(pos.X-fogRadius, cell), floorDiv(pos.X+fogRadius, cell)
	z0, z1 := floorDiv(pos.Z-fogRadius, cell), floorDiv(pos.Z+fogRadius, cell)
	for cz := z0; cz <= z1; cz++ {
		for cx := x0; cx <= x1; cx++ {
			// Distance from the player to the nearest point of the cell.
			nx := clampf(pos.X, float32(cx*cell), float32(cx*cell+cell))
			nz := clampf(pos.Z, float32(cz*cell), float32(cz*cell+cell))
			if dx, dz := nx-pos.X, nz-pos.Z; dx*dx+dz*dz > fogRadius*fogRadius {
				continue
			}
			tx, tz := floorDivInt(cx, 16), floorDivInt(cz, 16)
			lx, lz := cx-tx*16, cz-tz*16
			key := tileKey(tx, tz)
			mask := s.p.Explored[key]
			if len(mask) != 32 {
				nm := make([]byte, 32)
				copy(nm, mask)
				mask = nm
				s.p.Explored[key] = mask
			}
			bit := lz*16 + lx
			if mask[bit/8]&(1<<(bit%8)) == 0 {
				mask[bit/8] |= 1 << (bit % 8)
				s.minor = true
				s.setExplored(key)
			}
		}
	}
}

func floorDivInt(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// checkRegion applies region gating (contract §3.6).
func (s *Session) checkRegion(pos core.Vec3) {
	r := s.world.RegionAt(pos.X, pos.Z)
	if r >= core.RegionCount {
		return
	}
	prev := s.region
	s.region = r
	if !progress.RegionUnlocked(s.p, r) {
		if last, ok := s.lockedAt[r]; ok && s.now-last < lockedRepeat {
			return
		}
		s.lockedAt[r] = s.now
		s.send(proto.SRegion, proto.RegionMsg{
			Region: int(r), Species: s.speciesIn(r), Unlocked: false,
			Reason: content.RegionLockReason(r, s.p.Rank), Hints: nonNil(content.RegionHints(r)),
		})
		s.narrate(narrator.Event{Kind: narrator.RegionLocked, Region: r})
		return
	}
	if s.p.Flags[regionFlag(r)] {
		return
	}
	_ = prev
	s.p.Flags[regionFlag(r)] = true
	xp := s.award(progress.SrcRegion, r.Key(), progress.XPRegion)
	if badge := content.RegionBadgeID(r); badge != "" {
		s.p.Journal.Badges, _ = addUnique(s.p.Journal.Badges, badge)
	}
	s.send(proto.SRegion, proto.RegionMsg{
		Region: int(r), Species: s.speciesIn(r), Unlocked: true, Hints: nonNil(content.RegionHints(r)),
	})
	if xp > 0 {
		s.toast("discovery", r.Name(), "A new region", xp, "map")
	}
	s.narrate(narrator.Event{Kind: narrator.RegionEntered, Region: r})
	s.changed()
}

func nonNil(l []string) []string {
	if l == nil {
		return []string{}
	}
	return l
}

func (s *Session) speciesIn(r core.RegionID) int {
	n := 0
	for i := range s.species {
		for _, x := range s.species[i].Regions {
			if x == r {
				n++
				break
			}
		}
	}
	return n
}

// checkCabin develops the film when the player arrives back at the cabin.
func (s *Session) checkCabin(pos core.Vec3) {
	cabin, ok := s.world.POI("cabin")
	if !ok {
		return
	}
	d := cabin.Pos.DistXZ(pos)
	switch {
	case !s.atCabin && d <= cabinEnter:
		s.atCabin = true
		if n := progress.DevelopFilm(s.p); n > 0 {
			s.developed += n
			s.toast("info", "Film developed", itoa(n)+" photographs developed. A fresh roll is loaded.", 0, "camera")
		}
		s.questEvent(content.Returned())
		s.changed()
	case s.atCabin && d > cabinLeave:
		s.atCabin = false
	}
}

func (s *Session) nearCabin() bool {
	cabin, ok := s.world.POI("cabin")
	return ok && s.havePose && cabin.Pos.DistXZ(s.feet) <= cabinUse
}

// near reports whether the player is within r metres (XZ) of a POI.
func (s *Session) near(poiID string, r float32) bool {
	poi, ok := s.world.POI(poiID)
	return ok && s.havePose && poi.Pos.DistXZ(s.feet) <= r
}

// discover finds POIs within discovery range and hidden trails within Trail Sense.
func (s *Session) discover() {
	pos := s.feet
	sense := s.p.Stats.TrailSense
	s.poiBuf = s.world.POIsNear(pos.X, pos.Z, max(40, sense+16), s.poiBuf[:0])
	for _, poi := range s.poiBuf {
		if !discoverable(poi.Kind) || s.p.Journal.Locations[poi.ID] != nil {
			continue
		}
		r := poi.Radius
		if poi.Hidden && sense > r {
			r = sense
		}
		if poi.Pos.DistXZ(pos) > r {
			continue
		}
		e := s.clock.Env()
		s.p.Journal.Locations[poi.ID] = &proto.LocEntry{
			Day: e.Day, Time: e.Time, Name: poi.Name, Kind: poi.Kind,
			Region: int(poi.Region), Pos: poi.Pos, Hidden: poi.Hidden,
		}
		xp := s.award(progress.SrcLandmark, poi.ID, progress.XPLandmark)
		title := "Discovered"
		if poi.Hidden {
			title = "A hidden place"
		}
		s.toast("location", title, poi.Name, xp, "map")
		s.questEvent(content.Discovered(poi.ID, poi.Kind, s.at(poi.Pos)))
		s.narrate(narrator.Event{Kind: narrator.PlaceFound, POIKind: poi.Kind, POIName: poi.Name, Hidden: poi.Hidden, Subject: poi.ID})
		s.changed()
	}
	if sense <= 0 {
		return
	}
	s.trailBuf = s.world.TrailsNear(pos.X, pos.Z, sense, s.trailBuf[:0])
	for _, t := range s.trailBuf {
		if !t.Hidden || containsStr(s.p.Trails, t.ID) || s.trailIsAReward(t.ID) {
			continue
		}
		for _, pt := range t.Points {
			if pt.DistXZ(pos) <= sense {
				s.p.Trails = append(s.p.Trails, t.ID)
				s.toast("location", "A hidden trail", t.Name, 0, "map")
				s.changed()
				break
			}
		}
	}
}

func discoverable(kind string) bool {
	switch kind {
	case "npc", "feather", "page", "relic", "cache", "sign":
		return false
	}
	return true
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Lures

func (s *Session) addLure(pos core.Vec3, kind string, ttl float32, permanent bool) {
	s.lureID++
	l := lure{id: s.lureID, pos: pos, kind: kind, ttl: ttl, permanent: permanent}
	s.lures = append(s.lures, l)
	s.sim.AddLure(core.Lure{Pos: pos, Radius: 30, TTL: ttl, Kind: kind})
	s.send(proto.SLure, proto.LureMsg{ID: l.id, Pos: pos, Kind: kind, Active: true})
}

// addGardenFeeder places the observation garden's permanent feeder beside the cabin.
func (s *Session) addGardenFeeder() {
	for _, l := range s.lures {
		if l.permanent {
			return
		}
	}
	cabin, ok := s.world.POI("cabin")
	if !ok {
		return
	}
	// A few metres beside the cabin, on a post 1.4 m above the ground.
	dir := core.HeadingDir(cabin.Yaw + math.Pi/2)
	pos := cabin.Pos.Add(dir.Scale(9))
	pos.Y = s.world.HeightAt(pos.X, pos.Z) + 1.4
	s.addLure(pos, "feeder", 1e9, true)
}

func (s *Session) tickLures(dt float32) {
	out := s.lures[:0]
	for _, l := range s.lures {
		if !l.permanent {
			l.ttl -= dt
			if l.ttl <= 0 {
				s.send(proto.SLure, proto.LureMsg{ID: l.id, Pos: l.pos, Kind: l.kind, Active: false})
				continue
			}
		}
		out = append(out, l)
	}
	s.lures = out
}

// ---------------------------------------------------------------------------
// Chunks (normally answered by the server off the simulation goroutine)

func (s *Session) msgChunk(d []byte) {
	var c proto.ChunkReq
	if err := decode(d, &c); err != nil || c.LOD < 0 || c.LOD > 2 {
		s.fail("Bad chunk request.")
		return
	}
	data, err := s.world.Chunk(c.CX, c.CZ, c.LOD)
	if err != nil {
		s.fail("Bad chunk request.")
		return
	}
	if bs, ok := s.out.(BinarySink); ok {
		bs.SendBinary(data)
	}
}
