package game

import (
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Active reports whether a greeted client is attached (the world runs only then).
func (s *Session) Active() bool { return s.out != nil && s.greeted }

// Tick advances the session by one simulation tick of dt real seconds (normally
// 0.1). Nothing happens while no greeted client is attached: the world waits for
// the player.
func (s *Session) Tick(dt float32) {
	if !s.Active() {
		return
	}
	defer s.recoverMsg("tick")
	start := time.Now()
	s.now += float64(dt)
	s.tick++

	// Clock → ecosystem.
	s.clock.Advance(dt)
	envNow := s.clock.Env()
	s.p.Totals.Seconds += dt
	if s.pose.Speed < 0.35 || s.pose.Sit {
		s.still += dt
	} else {
		s.still = 0
	}
	evs := s.sim.Step(dt, envNow, s.observer())
	s.noise = 0
	s.evBuf = append(s.evBuf[:0], evs...)

	ctx := s.fieldCtx()
	eye := s.eye()
	for i := range s.evBuf {
		s.onEvent(ctx, s.evBuf[i], eye)
	}
	s.board.Advance(dt)
	s.calls.Advance(dt)

	// Bird snapshot.
	s.birdBuf = s.sim.Near(eye, snapshotR, s.birdBuf[:0])
	s.sendRaw(proto.SBirds, s.birdsFrame(s.birdBuf))

	// Observation and recording at 4 Hz.
	s.obsAcc += float64(dt)
	if s.obsAcc >= observeEvery-1e-4 {
		step := float32(s.obsAcc)
		s.obsAcc = 0
		s.observe(ctx, step, s.birdBuf)
		if s.rec != nil {
			s.send(proto.SRecState, s.rec.Tick(ctx, step, s.pose, s.birdBuf))
			if s.rec.Seconds() >= recMaxSeconds {
				s.stopRecording()
			}
		}
	}

	// Lures expire.
	s.tickLures(dt)

	// Environment, POI streaming, discovery, narrator, autosave.
	s.envAcc += float64(dt)
	if s.envAcc >= envEvery {
		s.envAcc = 0
		s.send(proto.SEnv, s.envMsg())
	}
	s.poiAcc += float64(dt)
	if s.poiAcc >= poiEvery {
		s.poiAcc = 0
		s.streamPOIs()
	}
	s.discAcc += float64(dt)
	if s.discAcc >= 0.5 && s.havePose {
		s.discAcc = 0
		s.discover()
	}
	s.narrAcc += float64(dt)
	if s.narrAcc >= 1 {
		s.narrAcc = 0
		s.idleNarration()
	}
	s.saveAcc += float64(dt)
	if s.saveAcc >= autosaveEvery {
		s.saveAcc = 0
		s.autosave()
	}

	s.afterChange()
	s.flush()
	if d := time.Since(start).Seconds(); d > s.worstTick {
		s.worstTick = d
	}
}

// eye is the player's eye position (the latest pose, or the saved position).
func (s *Session) eye() core.Vec3 {
	if s.havePose {
		return field.Eye(s.pose)
	}
	return s.feet.Add(core.V(0, core.EyeHeight, 0))
}

// observer describes the player to the ecosystem, folding the stats in.
func (s *Session) observer() core.Observer {
	if !s.havePose {
		return core.Observer{}
	}
	st := s.p.Stats
	settle, fam := st.Settle, st.Familiarity
	if s.pose.Sit {
		// Campcraft: a sit-and-wait setup calms birds faster.
		settle *= 1 + st.Camp
		fam *= 1 + st.Camp
	}
	noise := s.noise
	if s.pose.Noise > noise {
		noise = s.pose.Noise
	}
	return core.Observer{
		Present: true, Pos: s.eye(), Vel: s.vel, Speed: s.pose.Speed,
		Crouch: s.pose.Crouch, Sitting: s.pose.Sit, Still: s.still, Noise: noise,
		Stealth: st.Stealth, CrouchBonus: st.CrouchBonus, Settle: settle, Familiarity: fam,
	}
}

// onEvent turns one ecosystem event into perception and messages.
func (s *Session) onEvent(ctx *field.Context, ev core.EcoEvent, eye core.Vec3) {
	switch ev.Kind {
	case core.EvCall:
		bird, _ := s.sim.Get(ev.Bird)
		s.calls.Add(ev, bird.Flags)
		if s.rec != nil {
			s.rec.OnCall(ev, bird.Flags, 0)
		}
		if ev.Pos.Dist(eye) > 380 { // beyond any call's reach (300 m × 1.3 headroom)
			return
		}
		h, ok := field.Hear(ctx, ev, bird, s.pose, s.rng)
		if h.Range > 0 && h.Dist <= callSendRange*h.Range {
			s.send(proto.SCall, proto.CallMsg{
				Bird: ev.Bird, Sp: ev.Species, Call: ev.Call, Repeats: ev.Repeats,
				X: ev.Pos.X, Y: ev.Pos.Y, Z: ev.Pos.Z, Occ: h.Occ, Seed: ev.Seed,
			})
		}
		if ok {
			s.onHeard(ctx, h, bird)
		}
	case core.EvMove, core.EvFlush:
		if cue, ok := field.MoveCue(ctx, ev, s.pose, s.rng); ok {
			s.send(proto.SCue, cue)
		}
		if ev.Kind == core.EvFlush && s.havePose && ev.Pos.Dist(eye) < 80 {
			s.p.Totals.Flushed++
			s.minor = true
			s.narrate(narrator.Event{Kind: narrator.Flushed, Known: s.knownSp(s.spAt(ev.Species))})
		}
	}
}

// onHeard handles an audible call: the mystery lifecycle, evidence, clue, quests.
func (s *Session) onHeard(ctx *field.Context, h field.Heard, bird core.BirdState) {
	sp := s.spAt(h.Species)
	if sp == nil {
		return
	}
	known := s.identified(sp.ID)
	if known {
		e := s.entry(sp.ID)
		s.noteEncounter(e, h.Pos, false)
		if len(field.MergeHeard(e.Evidence, h)) > 0 {
			s.maybeConfirm(e, sp, 0)
		}
	} else {
		m := s.ensureMystery(sp, proto.LevelHeard, h.Pos)
		m.Heard++
		if len(field.MergeHeard(m.Evidence, h)) > 0 {
			s.changed()
		}
		s.minor = true
		h.Clue.Mystery = m.ID
		s.mysteryBird[m.ID] = birdRef{id: bird.ID, flags: bird.Flags}
	}
	s.heardBirds[h.Bird] = true
	for _, c := range s.board.Offer(h, s.p.Stats.ClueSlots) {
		s.send(proto.SClue, c)
	}
	s.questEvent(content.Heard(sp.ID, known, s.at(h.Pos)))
	if h.Clue.New || (known && h.Clue.Known != "") {
		c := h.Clue
		s.narrate(narrator.Event{Kind: narrator.CallHeard, Clue: &c, Subject: c.Mystery, Known: s.knownSp(sp)})
	}
}

// observe runs one observation tick (4 Hz).
func (s *Session) observe(ctx *field.Context, dt float32, birds []core.BirdState) {
	if !s.havePose {
		return
	}
	eye := s.eye()
	// Closing in on a heard bird counts as investigating it.
	for i := range birds {
		b := &birds[i]
		if !s.heardBirds[b.ID] || s.investigated[b.ID] || b.Pos.Dist(eye) > investigateR {
			continue
		}
		if sp := s.spAt(b.Species); sp != nil {
			s.investigated[b.ID] = true
			s.questEvent(content.Observed(sp.ID, b.Act.Key(), s.at(b.Pos)))
		}
	}

	res := s.watch.Tick(ctx, dt, s.pose, birds)
	sp := s.spAt(res.Species)
	if res.Sighting.Bird == 0 || sp == nil {
		if s.sightBird != 0 {
			s.sightBird = 0
			s.send(proto.SSighting, res.Sighting)
		}
		return
	}
	b := res.Bird
	known := s.identified(sp.ID)
	if res.Encounter {
		if known {
			s.noteEncounter(s.entry(sp.ID), b.Pos, true)
		} else {
			m := s.ensureMystery(sp, proto.LevelEncountered, b.Pos)
			m.Seen++
			s.mysteryBird[m.ID] = birdRef{id: b.ID, flags: b.Flags}
			s.changed()
		}
		if xp := s.award(progress.SrcSpot, sp.ID, progress.XPSpot); xp > 0 {
			name := "A new bird"
			if known {
				name = sp.Name
			} else if m := s.mysteryOf(sp.ID); m != nil {
				name = m.Label
			}
			s.toast("discovery", "First sighting", name, xp, "binoculars")
		}
		s.questEvent(content.Observed(sp.ID, b.Act.Key(), s.at(b.Pos)))
	}
	if res.Recognised && known {
		s.noteEncounter(s.entry(sp.ID), b.Pos, true)
	}
	// Persist new evidence.
	if len(res.Reveals) > 0 {
		var dst map[string]string
		if known {
			dst = s.entry(sp.ID).Evidence
		} else if m := s.mysteryOf(sp.ID); m != nil {
			dst = m.Evidence
		}
		if dst != nil {
			for _, r := range res.Reveals {
				dst[r.Key] = r.Value
			}
			s.changed()
			if known {
				s.maybeConfirm(s.entry(sp.ID), sp, 0)
			}
		}
	}
	if !known {
		if m := s.mysteryOf(sp.ID); m != nil {
			res.Sighting.Mystery = m.ID
		}
	}
	if res.Behavior != "" {
		act := b.Act
		s.questEvent(content.Observed(sp.ID, res.Behavior, s.at(b.Pos)))
		if known {
			e := s.entry(sp.ID)
			var added bool
			if e.Behaviors, added = addUnique(e.Behaviors, res.Behavior); added {
				s.changed()
			}
		}
		if act.UncommonBehaviour() {
			if xp := s.award(progress.SrcBehavior, progress.BehaviorKey(sp.ID, res.Behavior), progress.BehaviorXP(s.p)); xp > 0 {
				s.toast("behavior", "New behaviour observed", actWord(act), xp, "behavior")
				s.autoObservation(sp, b, res.Behavior)
			}
			s.narrate(narrator.Event{Kind: narrator.Behaviour, Behavior: res.Behavior, Known: s.knownSp(sp), Subject: res.Sighting.Mystery, Evidence: res.Sighting.Evidence})
		}
	}
	for _, rd := range res.Rare {
		s.logRare(rd, sp.ID, b.Pos)
	}
	if res.Sighting.Bird != s.sightBird {
		s.narrate(narrator.Event{Kind: narrator.Watching, Known: s.knownSp(sp), Subject: res.Sighting.Mystery,
			Evidence: res.Sighting.Evidence, Behavior: res.Sighting.Behavior, Blocked: res.Sighting.Blocked, Clarity: res.Sighting.Clarity})
	} else if res.Sighting.NewKey != "" && !known {
		s.narrate(narrator.Event{Kind: narrator.NewEvidence, NewKey: res.Sighting.NewKey, Evidence: res.Sighting.Evidence, Subject: res.Sighting.Mystery})
	}
	s.sightBird = res.Sighting.Bird
	s.send(proto.SSighting, res.Sighting)
}

// actWord is a player-facing behaviour word ("bathing" → "Bathing").
func actWord(a core.BirdAct) string {
	k := a.Key()
	if k == "" {
		return ""
	}
	return string(k[0]-'a'+'A') + k[1:]
}

// autoObservation writes a game-generated field observation for an uncommon
// behaviour the player has watched.
func (s *Session) autoObservation(sp *core.Species, b core.BirdState, behavior string) {
	e := s.clock.Env()
	o := &proto.Observation{
		ID: s.nextObsID(), Day: e.Day, Time: e.Time, Behavior: behavior,
		Habitat: s.world.HabitatAt(b.Pos.X, b.Pos.Z).Key(), Weather: int(e.Weather),
		Region: int(s.world.RegionAt(b.Pos.X, b.Pos.Z)), Auto: true,
	}
	if s.identified(sp.ID) {
		o.Species = sp.ID
		o.Text = "Watched " + withArticleLower(sp.Name) + " " + behavior + "."
	} else if m := s.mysteryOf(sp.ID); m != nil {
		o.Mystery = m.ID
		o.Text = "Watched " + m.Label + " " + behavior + "."
	} else {
		o.Text = "Watched a bird " + behavior + "."
	}
	s.p.Journal.Observations = append(s.p.Journal.Observations, o)
	s.changed()
}

func withArticleLower(name string) string {
	if name == "" {
		return "a bird"
	}
	switch name[0] {
	case 'A', 'E', 'I', 'O', 'U':
		return "an " + name
	}
	return "a " + name
}

func (s *Session) nextObsID() string {
	s.seq.Obs++
	return "o" + itoa(s.seq.Obs)
}

// idleNarration gives the narrator its once-a-second chance to muse.
func (s *Session) idleNarration() {
	if !s.havePose {
		return
	}
	nc := narrator.Context{
		Region:  s.region,
		Habitat: s.world.HabitatAt(s.feet.X, s.feet.Z),
		Env:     s.clock.Env(),
		Still:   s.still,
		Moving:  s.pose.Speed > 0.5,
		AtCabin: s.atCabin,
		Busy:    s.pose.Focus || s.rec != nil,
	}
	s.safeNarrator(func() {
		if n, ok := s.narr.Idle(nc, s.now); ok {
			s.send(proto.SNarrate, n)
		}
	})
}

// poiResult is a finished background POI/trail query.
type poiResult struct {
	w      *world.World
	pois   []core.POI
	trails []core.Trail
	warm   map[[2]int32]bool
}

// Ecosystem cells (eco's 128 m population cells) are activated within 520 m of the
// player, each with a 96 m perch query. warmPerches runs those queries ahead of
// time on the helper goroutine so that activation finds the world's perch and
// height caches hot instead of generating terrain inside a simulation tick.
const (
	ecoCell    = 128
	warmInner  = 420 // cells closer than this are already active
	warmOuter  = 640 // warm cells out to here (activation is at 520 m)
	warmForget = 900
	ecoPerchR  = ecoCell * 0.75
)

func warmPerches(w *world.World, c core.Vec3, warmed map[[2]int32]bool) {
	for k := range warmed {
		cx, cz := (float32(k[0])+0.5)*ecoCell, (float32(k[1])+0.5)*ecoCell
		if dx, dz := cx-c.X, cz-c.Z; dx*dx+dz*dz > warmForget*warmForget {
			delete(warmed, k)
		}
	}
	var buf []core.Perch
	k0x, k0z := floorDiv(c.X-warmOuter, ecoCell), floorDiv(c.Z-warmOuter, ecoCell)
	k1x, k1z := floorDiv(c.X+warmOuter, ecoCell), floorDiv(c.Z+warmOuter, ecoCell)
	for kz := k0z; kz <= k1z; kz++ {
		for kx := k0x; kx <= k1x; kx++ {
			key := [2]int32{int32(kx), int32(kz)}
			if warmed[key] {
				continue
			}
			cx, cz := (float32(kx)+0.5)*ecoCell, (float32(kz)+0.5)*ecoCell
			dx, dz := cx-c.X, cz-c.Z
			d2 := dx*dx + dz*dz
			if d2 > warmOuter*warmOuter || d2 < warmInner*warmInner {
				continue
			}
			buf = w.PerchesNear(cx, cz, ecoPerchR, buf[:0])
			warmed[key] = true
		}
	}
}

// streamPOIs sends POIs and trails within 700 m that this connection has not been
// sent, and forgets those far behind so they are sent again on return. The query
// itself runs on a helper goroutine (the world is safe for concurrent use); its
// result is applied on the next call, so streaming lags the player by about a
// second.
func (s *Session) streamPOIs() {
	select {
	case res := <-s.poiCh:
		s.poiBusy = false
		if res.w == s.world {
			s.warmed = res.warm
			s.applyPOIs(res.pois, res.trails)
		}
	default:
	}
	if !s.poiBusy {
		s.poiBusy = true
		w, c, ch, warm := s.world, s.feet, s.poiCh, s.warmed
		if warm == nil || s.warmedW != w {
			warm, s.warmedW = map[[2]int32]bool{}, w
		}
		s.warmed = nil // owned by the helper until it reports back
		go func() {
			pois := w.POIsNear(c.X, c.Z, poiRadius, nil)
			trails := w.TrailsNear(c.X, c.Z, poiRadius, nil)
			warmPerches(w, c, warm)
			ch <- poiResult{w: w, pois: pois, trails: trails, warm: warm}
		}()
	}
}

func (s *Session) applyPOIs(pois []core.POI, trails []core.Trail) {
	c := s.feet
	for id, pos := range s.sentPOI {
		if pos.DistXZ(c) > poiForget {
			delete(s.sentPOI, id)
		}
	}
	for id, pos := range s.sentTrail {
		if pos.DistXZ(c) > poiForget+300 {
			delete(s.sentTrail, id)
		}
	}
	var msg proto.PoisMsg
	for _, poi := range pois {
		if _, ok := s.sentPOI[poi.ID]; !ok {
			s.sentPOI[poi.ID] = poi.Pos
			msg.POIs = append(msg.POIs, poi)
		}
	}
	for _, t := range trails {
		if _, ok := s.sentTrail[t.ID]; !ok && len(t.Points) > 0 {
			s.sentTrail[t.ID] = t.Points[len(t.Points)/2]
			msg.Trails = append(msg.Trails, t)
		}
	}
	if len(msg.POIs) == 0 && len(msg.Trails) == 0 {
		return
	}
	if msg.POIs == nil {
		msg.POIs = []core.POI{}
	}
	if msg.Trails == nil {
		msg.Trails = []core.Trail{}
	}
	s.send(proto.SPois, msg)
}
