package game

import (
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Every action below validates first and changes nothing on failure: progress and
// content functions leave the profile untouched when they return an error.

func (s *Session) msgQuest(d []byte) {
	var m proto.QuestAction
	if err := decode(d, &m); err != nil {
		s.fail("That quest action could not be read.")
		return
	}
	if _, ok := content.QuestByID(m.ID); !ok {
		s.fail("There is no such quest.")
		return
	}
	var err error
	switch m.Action {
	case "accept":
		if err = s.questPlace(m.ID); err == nil {
			err = s.acceptQuest(m.ID)
		}
	case "turnin":
		if err = s.questPlace(m.ID); err == nil {
			var r proto.RewardsMsg
			if r, err = s.turnIn(m.ID); err == nil {
				s.send(proto.SRewards, r)
			}
		}
	case "track":
		err = s.tracker.Track(s.p, m.ID)
	case "untrack":
		err = s.tracker.Untrack(s.p, m.ID)
	case "abandon":
		err = s.tracker.Abandon(s.p, m.ID)
	default:
		err = gentleErr("Unknown quest action.")
	}
	if err != nil {
		s.failErr(err)
		return
	}
	s.changed()
}

func (s *Session) nearShop() bool {
	return s.near("shop_finn", shopUse) || s.near("npc_finn", shopUse)
}

func (s *Session) msgBuy(d []byte) {
	var m proto.ItemAction
	if err := decode(d, &m); err != nil {
		s.fail("That purchase could not be read.")
		return
	}
	if !s.nearShop() {
		s.fail("Finn's stall is at the Woodland Entrance.")
		return
	}
	if err := progress.Buy(s.p, m.Item); err != nil {
		s.failErr(err)
		return
	}
	if def, ok := progress.Item(m.Item); ok {
		s.toast("item", "Bought", def.Name, 0, def.Icon)
	}
	s.changed()
}

func (s *Session) msgUpgrade(d []byte) {
	var m proto.ItemAction
	if err := decode(d, &m); err != nil {
		s.fail("That upgrade could not be read.")
		return
	}
	if !s.nearShop() && !s.nearCabin() {
		s.fail("Upgrades are fitted at Finn's stall or at your cabin.")
		return
	}
	if err := progress.BuyUpgrade(s.p, m.Item, m.Upgrade); err != nil {
		s.failErr(err)
		return
	}
	if up, ok := progress.Upgrade(m.Item, m.Upgrade); ok {
		s.toast("item", "Upgrade fitted", up.Name, 0, "upgrade")
	}
	s.changed()
}

func (s *Session) msgEquip(d []byte) {
	var m proto.ItemAction
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if err := progress.Equip(s.p, m.Item, s.nearCabin()); err != nil {
		s.failErr(err)
		return
	}
	s.changed()
}

func (s *Session) msgUnequip(d []byte) {
	var m proto.SlotAction
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if err := progress.Unequip(s.p, m.Slot); err != nil {
		s.failErr(err)
		return
	}
	if m.Slot == progress.SlotAudio && s.rec != nil {
		s.rec = nil
	}
	s.changed()
}

func (s *Session) msgMove(d []byte) {
	var m proto.MoveItem
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if !s.nearCabin() {
		s.fail("Your storage is at the cabin.")
		return
	}
	if err := progress.MoveItem(s.p, m.Item, m.To); err != nil {
		s.failErr(err)
		return
	}
	s.changed()
}

func (s *Session) msgUse(d []byte) {
	var m proto.ItemAction
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if edible(m.Item) {
		if err := s.eat(m.Item); err != nil {
			s.failErr(err)
		}
		return
	}
	if def, ok := progress.Item(m.Item); ok && def.Use == progress.UseSeed && !s.havePose {
		s.fail("Find somewhere to scatter it first.")
		return
	}
	use, err := progress.UseItem(s.p, m.Item)
	if err != nil {
		s.failErr(err)
		return
	}
	switch use {
	case progress.UseFilm:
		s.toast("item", "Film loaded", itoa(progress.FilmLeft(s.p))+" frames left", 0, "camera")
	case progress.UseSeed:
		pos := s.feet.Add(core.HeadingDir(s.pose.Yaw).Scale(2))
		pos.Y = s.world.HeightAt(pos.X, pos.Z)
		if pos.Y < 0 {
			pos = s.feet
		}
		s.addLure(pos, "seed", 600, false)
		s.toast("item", "Seed scattered", "Back away and wait.", 0, "seed")
	}
	s.changed()
}

func (s *Session) msgSkill(d []byte) {
	var m proto.SkillAction
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if err := progress.BuySkill(s.p, m.ID); err != nil {
		s.failErr(err)
		return
	}
	if def, ok := progress.Skill(m.ID); ok {
		s.toast("info", "Skill learned", def.Name, 0, def.Icon)
	}
	s.changed()
}

// msgCabin handles the home-base actions; all require being at the cabin.
func (s *Session) msgCabin(d []byte) {
	var m proto.CabinAction
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	if !s.nearCabin() {
		s.fail("You need to be at the cabin for that.")
		return
	}
	var err error
	switch m.Action {
	case "upgrade":
		err = s.cabinUpgrade(m.ID)
	case "rest":
		err = s.rest(m.Until)
	case "pin":
		err = s.pin(m.ID, true)
	case "unpin":
		err = s.pin(m.ID, false)
	case "study":
		err = s.study(m.ID)
	case "analyze":
		err = s.analyze(m.ID)
	case "submit":
		err = s.submit(m.ID)
	case "develop":
		if n := progress.DevelopFilm(s.p); n > 0 {
			s.toast("info", "Film developed", itoa(n)+" photographs developed.", 0, "camera")
		}
	default:
		err = gentleErr("Unknown cabin action.")
	}
	if err != nil {
		s.failErr(err)
		return
	}
	s.changed()
}

func (s *Session) cabinUpgrade(id string) error {
	if err := progress.BuyCabinUpgrade(s.p, id); err != nil {
		return err
	}
	if def, ok := progress.CabinUpgrade(id); ok {
		s.toast("item", "Cabin upgraded", def.Name, 0, def.Icon)
	}
	if id == progress.CabinGarden {
		s.addGardenFeeder()
	}
	return nil
}

func (s *Session) rest(until float32) error {
	if !finite(until) || until < 0 || until >= 24 {
		return gentleErr("Rest until when?")
	}
	if s.rec != nil {
		s.rec = nil
	}
	hours := s.clock.SkipTo(until)
	e := s.clock.Env()
	s.sim.FastForward(hours, e)
	s.expireBuffs()
	for i := range s.lures {
		if !s.lures[i].permanent {
			s.lures[i].ttl -= hours * 3600
		}
	}
	s.board.Reset()
	s.watch.Reset()
	s.calls = field.CallLog{}
	s.send(proto.SEnv, s.envMsg())
	s.toast("info", "Rested", "You rest until "+clockText(e.Time)+".", 0, "rest")
	s.narrate(narrator.Event{Kind: narrator.Rested})
	return nil
}

func clockText(h float32) string {
	hh := int(h)
	mm := int((h - float32(hh)) * 60)
	return twoDigits(hh) + ":" + twoDigits(mm)
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + itoa(n)
	}
	return itoa(n)
}

func (s *Session) pin(id string, on bool) error {
	if s.photoByID(id) == nil {
		return gentleErr("There is no such photograph.")
	}
	j := &s.p.Journal
	if !on {
		if !containsStr(j.Pinned, id) {
			return gentleErr("That photograph is not on the wall.")
		}
		out := j.Pinned[:0]
		for _, x := range j.Pinned {
			if x != id {
				out = append(out, x)
			}
		}
		j.Pinned = out
		return nil
	}
	if containsStr(j.Pinned, id) {
		return gentleErr("It is already on the wall.")
	}
	if len(j.Pinned) >= progress.PinSlots(s.p) {
		return gentleErr("The wall is full. Take one down first.")
	}
	j.Pinned = append(j.Pinned, id)
	return nil
}

// study is desk research on an identified, documented species: once per in-game
// day, raising Study toward 100 (discovery level 6).
func (s *Session) study(spID string) error {
	e := s.entry(spID)
	sp := s.spByID(spID)
	if e == nil || sp == nil {
		return gentleErr("You can only study species you have identified.")
	}
	if e.Level < proto.LevelDocumented {
		return gentleErr("Document it first: a photograph, a recording or a field note.")
	}
	if e.Study >= 100 {
		return gentleErr("There is nothing more the desk can teach you about it.")
	}
	day := s.clock.Env().Day
	flag := "study:" + spID + ":" + itoa(day)
	if s.p.Flags[flag] {
		return gentleErr("You have studied it today. Sleep on it.")
	}
	gain := 25
	if e.PhotoCount > 0 {
		gain += 5
	}
	if e.RecCount > 0 {
		gain += 5
	}
	gain += int(10 * s.p.Stats.EcoKnow)
	s.p.Flags[flag] = true
	e.Study += gain
	if e.Study >= 100 {
		e.Study = 100
		e.Level = proto.LevelStudied
		s.toast("journal", "Studied", sp.Name+" is fully studied.", 0, "knowledge")
	}
	xp := s.award("study", spID+"@"+itoa(day), 20)
	s.toast("journal", "Desk research", sp.Name+": "+itoa(e.Study)+"%", xp, "knowledge")
	s.questEvent(content.Researched("study", spID, "", 0))
	return nil
}

// analyze examines a recording at the desk: its pitch and pattern become evidence.
func (s *Session) analyze(id string) error {
	r := s.recByID(id)
	if r == nil {
		return gentleErr("There is no such recording.")
	}
	if r.Analyzed {
		return gentleErr("You have already analysed that recording.")
	}
	sp := s.spAt(r.SpIndex)
	if sp == nil || r.Call < 0 || r.Call >= len(sp.Calls) {
		return gentleErr("The tape is unreadable.")
	}
	r.Analyzed = true
	call := sp.Calls[r.Call]
	h := field.Heard{Evidence: map[string]string{"pitch": call.Pitch, "pattern": call.Pattern}, Primary: r.Call == 0}
	if e := s.entry(sp.ID); e != nil {
		field.MergeHeard(e.Evidence, h)
		s.maybeConfirm(e, sp, 0)
	} else if m := s.mysteryByID(r.Mystery); m != nil {
		field.MergeHeard(m.Evidence, h)
	}
	known := ""
	if s.identified(sp.ID) {
		known = sp.ID
	}
	s.toast("journal", "Recording analysed", "Pitch: "+call.Pitch+" · Pattern: "+call.Pattern, 0, "recorder")
	s.questEvent(content.Researched("analyze", known, "recording", r.Stars))
	return nil
}

// submit sends a photo or recording to the research board: modest credits, once.
func (s *Session) submit(id string) error {
	var stars int
	var what, src, key, spID string
	if ph := s.photoByID(id); ph != nil {
		if ph.Submitted {
			return gentleErr("Already submitted.")
		}
		nest := s.nestOfPhoto(id)
		if ph.Stars <= 0 || (len(ph.Subjects) == 0 && nest == "") {
			return gentleErr("There is no bird in that photograph to submit.")
		}
		ph.Submitted = true
		stars, what, src = ph.Stars, "photo", progress.SrcSubmitPhoto
		if len(ph.Subjects) > 0 {
			spID, key = ph.Subjects[0].Species, ph.Subjects[0].Mystery
		} else {
			key = "nest:" + nest
		}
	} else if r := s.recByID(id); r != nil {
		if r.Submitted {
			return gentleErr("Already submitted.")
		}
		r.Submitted = true
		stars, what, src = r.Stars, "recording", progress.SrcSubmitRecording
		spID, key = r.Species, r.Mystery
	} else {
		return gentleErr("There is nothing with that id to submit.")
	}
	if spID != "" && s.identified(spID) {
		key = spID
	} else {
		spID = ""
	}
	if key == "" {
		key = id
	}
	got := progress.AwardCredits(s.p, src, key, progress.SubmissionCredits(stars))
	text := "Submitted to the research board."
	if got > 0 {
		text += " +" + itoa(got) + " credits"
	}
	s.toast("credits", "Research board", text, 0, "credits")
	s.questEvent(content.Researched("submit", spID, what, stars))
	return nil
}

// msgNote writes a personal note on a species, or a field observation.
func (s *Session) msgNote(d []byte) {
	var m proto.NoteMsg
	if err := decode(d, &m); err != nil {
		s.fail("That note could not be read.")
		return
	}
	text := strings.TrimSpace(trim(m.Text, 2000))
	if m.Species != "" {
		e := s.entry(m.Species)
		if e == nil {
			s.fail("You have not identified that species yet.")
			return
		}
		e.Notes = text
		s.changed()
		return
	}
	if text == "" {
		s.fail("The note is empty.")
		return
	}
	env := s.clock.Env()
	o := &proto.Observation{
		Day: env.Day, Time: env.Time, Weather: int(env.Weather),
		Habitat: s.world.HabitatAt(s.feet.X, s.feet.Z).Key(),
		Region:  int(s.world.RegionAt(s.feet.X, s.feet.Z)), Text: text,
	}
	switch {
	case m.Mystery != "":
		if s.mysteryByID(m.Mystery) == nil {
			s.fail("That bird is no longer an open mystery in your journal.")
			return
		}
		o.Mystery = m.Mystery
	default:
		// A field note made while watching a bird is about that bird.
		if b, ok := s.sim.Get(s.sightBird); ok && s.sightBird != 0 {
			if sp := s.spAt(b.Species); sp != nil {
				o.Behavior = b.Act.Key()
				if s.identified(sp.ID) {
					o.Species = sp.ID
				} else if mm := s.mysteryOf(sp.ID); mm != nil {
					o.Mystery = mm.ID
				}
			}
		}
	}
	o.ID = s.nextObsID()
	s.p.Journal.Observations = append(s.p.Journal.Observations, o)
	if o.Species != "" {
		if e := s.entry(o.Species); e != nil {
			s.raiseDocumented(e)
		}
	}
	s.changed()
}
