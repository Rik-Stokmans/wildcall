package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/save"
)

// msgPhoto scores a shutter press (contract §3.3.5, §3.6 film).
func (s *Session) msgPhoto(d []byte) {
	var ph proto.Photo
	if err := decode(d, &ph); err != nil || !finite(ph.X, ph.Y, ph.Z, ph.Yaw, ph.Pitch, ph.FOV, ph.Aspect, ph.Sharp, ph.Shake) {
		s.fail("That photograph could not be read.")
		return
	}
	if !s.havePose {
		s.fail("Take a step first: the camera has nowhere to stand.")
		return
	}
	if progress.FilmLeft(s.p) <= 0 {
		s.send(proto.SPhoto, proto.PhotoResult{NoFilm: true, FilmLeft: 0, Notes: []string{"Out of film. Load a roll, or head back to the cabin to develop this one."}})
		s.narrate(narrator.Event{Kind: narrator.OutOfFilm})
		return
	}
	if _, err := save.DecodePhoto(ph.Img); err != nil {
		s.fail("The photograph could not be kept: " + err.Error() + ".")
		return
	}
	// The camera is where the player is.
	eye := s.eye()
	if core.V(ph.X, ph.Y, ph.Z).Dist(eye) > 8 {
		ph.X, ph.Y, ph.Z = eye.X, eye.Y, eye.Z
	}
	ph.Sharp = clampf(ph.Sharp, 0, 1)
	ph.Shake = clampf(ph.Shake, 0, 1)

	s.seq.Photo++
	id := "p" + itoa(s.seq.Photo)
	if err := s.cfg.Store.SavePhoto(id, ph.Img); err != nil {
		s.seq.Photo--
		s.fail("The photograph could not be kept: " + err.Error() + ".")
		return
	}
	progress.TakeFrame(s.p)
	// The shutter is heard by the birds nearby.
	if s.p.Stats.CamNoise > s.noise {
		s.noise = s.p.Stats.CamNoise
	}

	ctx := s.fieldCtx()
	cam := core.V(ph.X, ph.Y, ph.Z)
	birds := s.sim.Near(cam, field.MaxSightRange, nil)
	nests := s.sim.Nests(cam, field.MaxSightRange, nil)
	sc := field.ScorePhotoWith(ctx, ph, birds, nests)
	meta := sc.Meta
	meta.ID, meta.URL = id, "/photos/"+id+".jpg"
	if meta.Subjects == nil {
		meta.Subjects = []proto.PhotoSubject{}
	}
	if meta.Tags == nil {
		meta.Tags = []string{}
	}
	// Unknown birds in the picture: a photo is a sighting (mystery level 3).
	for i := range meta.Subjects {
		if i >= len(sc.Birds) {
			break
		}
		sp := s.spAt(sc.Birds[i].Species)
		if sp == nil || s.identified(sp.ID) {
			continue
		}
		m := s.ensureMystery(sp, proto.LevelEncountered, birdPos(birds, sc.Birds[i].ID, meta))
		meta.Subjects[i].Mystery = m.ID
		if i == 0 {
			m.Photos = append(m.Photos, id)
		}
		s.mysteryBird[m.ID] = birdRef{id: sc.Birds[i].ID, flags: sc.Birds[i].Flags}
	}
	m := meta
	s.p.Journal.Photos = append(s.p.Journal.Photos, &m)
	s.p.Totals.Photos++
	s.changed()

	res := proto.PhotoResult{Photo: &m, Notes: nonNil(sc.Notes), FilmLeft: progress.FilmLeft(s.p)}
	var known *core.Species
	if meta.Stars > 0 && len(sc.Birds) > 0 {
		main := sc.Birds[0]
		sp := s.spAt(main.Species)
		if sp != nil {
			res.XP += s.award(progress.SrcPhoto, sp.ID, progress.PhotoXP(meta.Stars))
			if e := s.entry(sp.ID); e != nil {
				known = sp
				e.PhotoCount++
				if best := s.photoByID(e.BestPhoto); best == nil || meta.Stars > best.Stars || (meta.Stars == best.Stars && meta.Score > best.Score) {
					e.BestPhoto = id
				}
				s.raiseDocumented(e)
				s.maybeConfirm(e, sp, meta.Stars)
			}
			pos := birdPos(birds, main.ID, meta)
			s.questEvent(content.Photographed(sp.ID, main.Act.Key(), meta.Stars, s.at(pos)))
			if rd, ok := field.RareFromPhoto(ctx, sc); ok {
				rd.Photo = id
				s.logRare(rd, sp.ID, pos)
			}
		}
	}
	// Nests in the frame: found (journal, XP once per species), and the first nest
	// photo of each species pays the photo XP again.
	if len(sc.Nests) > 0 {
		res.XP += s.photoNests(sc, nests, id, meta.Stars)
	}
	if res.XP > 0 {
		s.toast("xp", "Photograph", starsText(meta.Stars), res.XP, "camera")
	}
	s.send(proto.SPhoto, res)
	if meta.Stars > 0 && !s.p.Flags["narr:first_stars"] {
		s.p.Flags["narr:first_stars"] = true
		s.narrate(narrator.Event{Kind: narrator.TutorialBeat, Item: "first_stars"})
	} else {
		s.narrate(narrator.Event{Kind: narrator.Photographed, Stars: meta.Stars, Tags: meta.Tags, Known: known})
	}
	if progress.FilmLeft(s.p) == 0 {
		s.narrate(narrator.Event{Kind: narrator.OutOfFilm})
	}
}

func birdPos(birds []core.BirdState, id uint32, meta proto.PhotoMeta) core.Vec3 {
	for _, b := range birds {
		if b.ID == id {
			return b.Pos
		}
	}
	return core.Vec3{}
}

func (s *Session) photoByID(id string) *proto.PhotoMeta {
	if id == "" {
		return nil
	}
	for _, ph := range s.p.Journal.Photos {
		if ph.ID == id {
			return ph
		}
	}
	return nil
}

func (s *Session) recByID(id string) *proto.RecMeta {
	if id == "" {
		return nil
	}
	for _, r := range s.p.Journal.Recordings {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func starsText(n int) string {
	if n <= 0 {
		return "No bird in frame"
	}
	out := ""
	for i := 0; i < n; i++ {
		out += "★"
	}
	return out
}

// ---------------------------------------------------------------------------
// Recordings

func (s *Session) msgRecStart(d []byte) {
	if s.p.Equipped[progress.SlotAudio] == "" {
		s.fail("You have no recorder yet.")
		return
	}
	if s.rec != nil {
		s.fail("You are already recording.")
		return
	}
	s.rec = s.calls.Start()
	s.send(proto.SRecState, proto.RecState{})
}

func (s *Session) msgRecStop(d []byte) {
	if s.rec == nil {
		s.fail("The recorder is not running.")
		return
	}
	s.stopRecording()
}

// stopRecording ends the recording window and keeps what it captured.
func (s *Session) stopRecording() {
	rec := s.rec
	s.rec = nil
	ctx := s.fieldCtx()
	out := rec.Stop(ctx, s.pose)
	res := proto.RecResult{Notes: nonNil(out.Notes)}
	sp := s.spAt(out.Species)
	if !out.OK || sp == nil {
		s.send(proto.SRec, res)
		s.narrate(narrator.Event{Kind: narrator.Recorded, Stars: 0})
		return
	}
	s.seq.Rec++
	meta := out.Meta
	meta.ID = "r" + itoa(s.seq.Rec)
	bird, _ := s.sim.Get(out.Bird)
	pos := bird.Pos
	if out.Bird == 0 || pos == (core.Vec3{}) {
		pos = s.feet
	}
	if e := s.entry(sp.ID); e != nil {
		meta.Species, meta.Mystery = sp.ID, ""
		e.RecCount++
		if best := s.recByID(e.BestRec); best == nil || meta.Stars > best.Stars || (meta.Stars == best.Stars && meta.Quality > best.Quality) {
			e.BestRec = meta.ID
		}
		field.MergeRecorded(e.Evidence, out)
	} else {
		m := s.ensureMystery(sp, proto.LevelHeard, pos)
		meta.Mystery = m.ID
		m.Recs = append(m.Recs, meta.ID)
		field.MergeRecorded(m.Evidence, out)
		s.mysteryBird[m.ID] = birdRef{id: out.Bird, flags: out.Flags}
	}
	r := meta
	s.p.Journal.Recordings = append(s.p.Journal.Recordings, &r)
	s.p.Totals.Recordings++
	res.Rec = &r
	if progress.Awarded(s.p, progress.SrcRecording, sp.ID) == 0 && !firstRecordingCounts(meta, s.p.Stats) {
		// Kept, but too faint to be the species' first recording: no XP yet.
		res.Notes = append(res.Notes, "Saved to your journal. It is a little too faint to count as a first recording of this voice yet: get within about "+
			itoa(int(firstRecReach*s.p.Stats.RecRange+0.5))+" m, or wait for a quieter moment, and the next take will count.")
	} else {
		res.XP = s.award(progress.SrcRecording, sp.ID, progress.RecordingXP(meta.Stars))
	}
	var known *core.Species
	if e := s.entry(sp.ID); e != nil {
		known = sp
		s.raiseDocumented(e)
		s.maybeConfirm(e, sp, meta.Stars)
	}
	s.questEvent(content.Recorded(sp.ID, meta.Stars, s.at(pos)))
	if res.XP > 0 {
		// Say whose voice is on the tape: the recorder keeps the clearest singer, which
		// is not always the bird the player was pointing at.
		s.toast("xp", "Recording", s.subjectLabel(sp.ID)+" "+starsText(meta.Stars), res.XP, "recorder")
	}
	s.changed()
	s.send(proto.SRec, res)
	s.narrate(narrator.Event{Kind: narrator.Recorded, Stars: meta.Stars, Quality: meta.Quality, Known: known})
}

// subjectLabel names a species for the player: its name once identified, else its
// mystery label ("Unknown bird C"), never the hidden species.
func (s *Session) subjectLabel(spID string) string {
	if s.identified(spID) {
		if sp := s.spByID(spID); sp != nil {
			return sp.Name
		}
	}
	if m := s.mysteryOf(spID); m != nil {
		return m.Label
	}
	return "An unknown bird"
}
