package game

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// fieldCtx builds the perception context for the current state.
func (s *Session) fieldCtx() *field.Context {
	return &field.Context{
		Terrain: s.world, Species: s.species, Env: s.clock.Env(), Stats: s.p.Stats,
		Know: field.ProfileKnowledge{P: s.p}, Regions: s.p.Regions,
	}
}

func (s *Session) spAt(i int) *core.Species {
	if i < 0 || i >= len(s.species) {
		return nil
	}
	return &s.species[i]
}

func (s *Session) spByID(id string) *core.Species {
	for i := range s.species {
		if s.species[i].ID == id {
			return &s.species[i]
		}
	}
	return nil
}

func (s *Session) entry(id string) *proto.SpeciesEntry { return s.p.Journal.Species[id] }

func (s *Session) identified(id string) bool { return s.entry(id) != nil }

// knownSp returns the species for the narrator only when the player has identified it.
func (s *Session) knownSp(sp *core.Species) *core.Species {
	if sp != nil && s.identified(sp.ID) {
		return sp
	}
	return nil
}

// at describes where and when something happened, for quest events.
func (s *Session) at(pos core.Vec3) content.At {
	return content.Place(s.world.RegionAt(pos.X, pos.Z), s.world.HabitatAt(pos.X, pos.Z), s.clock.Env().Phase())
}

// ---------------------------------------------------------------------------
// Mysteries

func mysteryLetters(n int) string {
	// 0 → A … 25 → Z, 26 → AA …
	var b []byte
	for n >= 0 {
		b = append([]byte{byte('A' + n%26)}, b...)
		n = n/26 - 1
	}
	return string(b)
}

// mysteryOf returns the open mystery of a species (nil if none).
func (s *Session) mysteryOf(spID string) *proto.Mystery {
	for _, m := range s.p.Journal.Mysteries {
		if m != nil && m.Species == spID {
			return m
		}
	}
	return nil
}

func (s *Session) mysteryByID(id string) *proto.Mystery {
	for _, m := range s.p.Journal.Mysteries {
		if m != nil && m.ID == id {
			return m
		}
	}
	return nil
}

// ensureMystery returns the species' mystery, creating it at the given discovery
// level (2 heard, 3 encountered) if it does not exist, and raising its level.
func (s *Session) ensureMystery(sp *core.Species, level int, pos core.Vec3) *proto.Mystery {
	m := s.mysteryOf(sp.ID)
	if m == nil {
		n := s.seq.Mystery
		s.seq.Mystery++
		m = &proto.Mystery{
			ID:       "m" + strconv.Itoa(n+1),
			Label:    "Unknown bird " + mysteryLetters(n),
			Level:    level,
			Evidence: map[string]string{},
			Photos:   []string{}, Recs: []string{}, Wrong: []string{},
			FirstDay: s.clock.Env().Day,
			Region:   int(s.world.RegionAt(pos.X, pos.Z)),
			Pos:      pos, Candidates: []proto.Candidate{},
			Species: sp.ID,
		}
		s.p.Journal.Mysteries = append(s.p.Journal.Mysteries, m)
		s.changed()
	}
	if level > m.Level {
		m.Level = level
		s.changed()
	}
	m.Pos = pos
	return m
}

// ---------------------------------------------------------------------------
// Species entries

func (s *Session) nearestPlace(pos core.Vec3) string {
	best, name := float32(math.MaxFloat32), ""
	for _, l := range s.p.Journal.Locations {
		if d := l.Pos.DistXZ(pos); d < best {
			best, name = d, l.Name
		}
	}
	return name
}

func addUnique(list []string, v string) ([]string, bool) {
	for _, x := range list {
		if x == v {
			return list, false
		}
	}
	return append(list, v), true
}

func addUniqueInt(list []int, v int) []int {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

// noteEncounter records that an identified species was seen or heard at pos.
func (s *Session) noteEncounter(e *proto.SpeciesEntry, pos core.Vec3, seen bool) {
	if seen {
		e.Seen++
		ph := int(s.clock.Env().Phase())
		if ph >= 0 && ph < len(e.Phases) {
			e.Phases[ph]++
		}
	} else {
		e.Heard++
	}
	hab := s.world.HabitatAt(pos.X, pos.Z).Key()
	e.Habitats, _ = addUnique(e.Habitats, hab)
	if r := s.world.RegionAt(pos.X, pos.Z); r < core.RegionCount {
		e.Regions = addUniqueInt(e.Regions, int(r))
	}
	s.minor = true
}

// documented reports whether a species (or its mystery) has a photo, a recording
// or a typed observation: discovery level 5.
func (s *Session) documented(spID, mysteryID string) bool {
	for _, ph := range s.p.Journal.Photos {
		if ph.Stars > 0 && len(ph.Subjects) > 0 {
			sub := ph.Subjects[0]
			if (spID != "" && sub.Species == spID) || (mysteryID != "" && sub.Mystery == mysteryID) {
				return true
			}
		}
	}
	for _, r := range s.p.Journal.Recordings {
		if (spID != "" && r.Species == spID) || (mysteryID != "" && r.Mystery == mysteryID) {
			return true
		}
	}
	for _, o := range s.p.Journal.Observations {
		if !o.Auto && ((spID != "" && o.Species == spID) || (mysteryID != "" && o.Mystery == mysteryID)) {
			return true
		}
	}
	return false
}

func (s *Session) raiseDocumented(e *proto.SpeciesEntry) {
	if e.Level < proto.LevelDocumented && s.documented(e.ID, "") {
		e.Level = proto.LevelDocumented
		s.changed()
	}
}

// ---------------------------------------------------------------------------
// Identification (contract §3.6 mystery lifecycle)

func (s *Session) msgIdentify(d []byte) {
	var m proto.Identify
	if err := decode(d, &m); err != nil {
		s.fail("That identification could not be read.")
		return
	}
	res, err := s.identify(m.Mystery, m.Species)
	if err != nil {
		s.failErr(err)
		return
	}
	s.send(proto.SIdentify, res)
}

type gentleErr string

func (e gentleErr) Error() string { return string(e) }

func (s *Session) identify(mysteryID, guess string) (proto.IdentifyResult, error) {
	m := s.mysteryByID(mysteryID)
	if m == nil {
		return proto.IdentifyResult{}, gentleErr("That bird is no longer an open mystery in your journal.")
	}
	gsp := s.spByID(guess)
	if gsp == nil {
		return proto.IdentifyResult{}, gentleErr("There is no such species in the field guide.")
	}
	res := proto.IdentifyResult{Mystery: m.ID, Guess: guess, Notes: []string{}}
	ctx := s.fieldCtx()
	ic := field.MysteryContext(ctx, m)
	if field.EvidenceCount(m.Evidence) < field.MinEvidence {
		res.Outcome = "insufficient"
		res.Feedback = "You need at least two pieces of evidence before you can name it. Keep watching and listening."
		s.narrate(narrator.Event{Kind: narrator.Identified, Outcome: res.Outcome, Subject: m.ID})
		return res, nil
	}
	conf := field.ConfidenceFor(guess, m.Evidence, m.Wrong, ic, s.p.Stats, s.species)
	res.Confidence = conf
	if guess != m.Species {
		res.Outcome = "wrong"
		res.Feedback = field.MisfitNote(gsp, m.Evidence)
		if res.Feedback == "" {
			res.Feedback = "On reflection the evidence does not quite point there. Keep looking."
		}
		key, _, _ := field.Misfit(gsp, m.Evidence)
		var added bool
		m.Wrong, added = addUnique(m.Wrong, guess)
		if added {
			s.changed()
		}
		s.narrate(narrator.Event{Kind: narrator.Identified, Outcome: res.Outcome, Mismatch: key, Subject: m.ID})
		return res, nil
	}
	sp := gsp
	probable := conf < field.CertainConfidence
	res.Outcome = "certain"
	if probable {
		res.Outcome = "probable"
	}
	e := s.promote(m, sp, conf, probable)
	res.Species = sp.ID
	res.First = true
	res.XP = s.award(progress.SrcIdentify, sp.ID, progress.IdentifyXP(sp.FirstIDXP(), probable))
	if probable {
		res.Notes = append(res.Notes, "Logged as a probable identification. It will be confirmed once the evidence is stronger or you have a good photo or recording.")
	}
	at := content.Place(core.RegionID(m.Region), s.world.HabitatAt(m.Pos.X, m.Pos.Z), s.clock.Env().Phase())
	s.questEvent(content.Identified(sp.ID, e.Method, sp.Rarity, at))
	for _, l := range content.LoreFor("identify:" + sp.ID) {
		if added := s.addLore(l); added {
			res.Notes = append(res.Notes, "New Natural History entry")
		}
	}
	ref := s.mysteryBird[m.ID]
	for _, rd := range field.RareFromIdentification(sp, ref.id, ref.flags, core.RegionID(m.Region)) {
		s.logRare(rd, sp.ID, m.Pos)
	}
	s.narrate(narrator.Event{Kind: narrator.Identified, Outcome: res.Outcome, Known: sp, Subject: m.ID})
	return res, nil
}

// promote turns a mystery into a species entry.
func (s *Session) promote(m *proto.Mystery, sp *core.Species, conf int, probable bool) *proto.SpeciesEntry {
	e := &proto.SpeciesEntry{
		ID: sp.ID, Level: proto.LevelIdentified, Probable: probable, Confidence: conf,
		Method:   field.IDMethod(m.Evidence),
		Evidence: map[string]string{},
		FirstDay: m.FirstDay, FirstRegion: m.Region, FirstPlace: s.nearestPlace(m.Pos),
		Seen: m.Seen, Heard: m.Heard,
		Behaviors: []string{}, Habitats: []string{}, Regions: []int{},
	}
	for k, v := range m.Evidence {
		e.Evidence[k] = v
	}
	if b := m.Evidence["behavior"]; b != "" {
		e.Behaviors = append(e.Behaviors, b)
	}
	if h := m.Evidence["habitat"]; h != "" {
		e.Habitats = append(e.Habitats, h)
	}
	if m.Region >= 0 && m.Region < int(core.RegionCount) {
		e.Regions = append(e.Regions, m.Region)
	}
	// Re-label everything the player documented about the mystery.
	bestPhoto, bestRec := -1, -1
	for _, ph := range s.p.Journal.Photos {
		for j := range ph.Subjects {
			if ph.Subjects[j].Mystery == m.ID {
				ph.Subjects[j].Species = sp.ID
				ph.Subjects[j].Mystery = ""
				if j == 0 {
					e.PhotoCount++
					if ph.Stars > bestPhoto {
						bestPhoto, e.BestPhoto = ph.Stars, ph.ID
					}
				}
			}
		}
		if len(ph.Subjects) > 0 && ph.Subjects[0].Species == sp.ID && sp.Rarity >= core.Rare {
			ph.Tags, _ = addUnique(ph.Tags, "rare")
		}
	}
	for _, r := range s.p.Journal.Recordings {
		if r.Mystery == m.ID {
			r.Species, r.Mystery = sp.ID, ""
			e.RecCount++
			if r.Stars > bestRec {
				bestRec, e.BestRec = r.Stars, r.ID
			}
		}
	}
	for _, o := range s.p.Journal.Observations {
		if o.Mystery == m.ID {
			o.Species, o.Mystery = sp.ID, ""
		}
	}
	for _, rd := range s.p.Journal.Rare {
		if rd.Kind == field.RareKindPlumage && rd.Species == "" && rd.ID != "" {
			if ref, ok := s.mysteryBird[m.ID]; ok && rd.ID == field.RareKindPlumage+":"+strconv.FormatUint(uint64(ref.id), 10) {
				rd.Species = sp.ID
			}
		}
	}
	// Remove the mystery.
	out := s.p.Journal.Mysteries[:0]
	for _, x := range s.p.Journal.Mysteries {
		if x != m {
			out = append(out, x)
		}
	}
	s.p.Journal.Mysteries = out
	s.p.Journal.Species[sp.ID] = e
	s.raiseDocumented(e)
	// The species entry now holds the evidence; let the observation state forget it.
	s.watch.Forget(sp.Index)
	if bestPhoto >= 2 || bestRec >= 2 {
		// A good photo or recording already exists: confirm at once.
		s.confirm(e, sp)
	}
	s.changed()
	return e
}

// maybeConfirm confirms a probable identification once the evidence reaches the
// certain line or a ≥ 2-star photo / recording exists.
func (s *Session) maybeConfirm(e *proto.SpeciesEntry, sp *core.Species, stars int) {
	if e == nil || !e.Probable || sp == nil {
		return
	}
	if stars >= 2 {
		s.confirm(e, sp)
		return
	}
	ctx := s.fieldCtx()
	ic := field.IDContext{Region: core.RegionNone, Season: ctx.Env.Season, Unlocked: s.p.Regions, Include: []string{sp.ID}}
	if c := field.ConfidenceFor(sp.ID, e.Evidence, nil, ic, s.p.Stats, s.species); c >= field.CertainConfidence {
		e.Confidence = c
		s.confirm(e, sp)
	}
}

func (s *Session) confirm(e *proto.SpeciesEntry, sp *core.Species) {
	if !e.Probable {
		return
	}
	e.Probable = false
	if e.Confidence < field.CertainConfidence {
		e.Confidence = field.CertainConfidence
	}
	xp := s.award(progress.SrcIdentify, sp.ID, sp.FirstIDXP())
	s.toast("journal", "Identification confirmed", sp.Name+" is now a certain identification.", xp, "check")
	s.changed()
}

// ---------------------------------------------------------------------------
// Rewards, XP, quests, ranks

// award pays XP through the anti-grind log and returns the XP granted.
func (s *Session) award(source, key string, base int) int {
	xp := progress.AwardXP(s.p, source, key, base)
	if xp > 0 {
		s.changed()
	}
	return xp
}

func (s *Session) addLore(id string) bool {
	if id == "" {
		return false
	}
	var added bool
	s.p.Journal.Lore, added = addUnique(s.p.Journal.Lore, id)
	if added {
		s.changed()
	}
	return added
}

// logRare records a rare discovery once, with XP and quest progress.
func (s *Session) logRare(rd proto.RareDiscovery, trueSpecies string, pos core.Vec3) {
	if field.HasRare(s.p.Journal.Rare, rd.ID) {
		return
	}
	rd.Day = s.clock.Env().Day
	d := rd
	s.p.Journal.Rare = append(s.p.Journal.Rare, &d)
	xp := s.award(progress.SrcRare, rd.ID, progress.XPRare)
	s.toast("discovery", rd.Title, rd.Text, xp, "rare")
	s.questEvent(content.RareFound(rd.Kind, trueSpecies, s.at(pos)))
	s.narrate(narrator.Event{Kind: narrator.RareFind, RareKind: rd.Kind, Known: s.knownSp(s.spByID(rd.Species))})
	s.changed()
}

// questEvent advances quests and reports progress.
func (s *Session) questEvent(ev content.Event) {
	prog := s.tracker.OnEvent(s.p, ev)
	s.reportProgress(prog)
}

func (s *Session) reportProgress(prog []content.Progress) {
	for _, pr := range prog {
		s.changed()
		q, _ := content.QuestByID(pr.Quest)
		if pr.Complete {
			s.toast("quest", q.Name, "Ready to hand in.", 0, "quest")
		} else if pr.Done {
			s.toast("quest", q.Name, pr.Text+" - done", 0, "quest")
		} else if pr.Need > 1 {
			s.toast("quest", q.Name, fmt.Sprintf("%s (%d/%d)", pr.Text, pr.Count, pr.Need), 0, "quest")
		}
	}
}

// afterChange runs the checks that follow any profile change: rank-ups (with their
// bonus skill points and region permits), level-ups and the quest list.
func (s *Session) afterChange() {
	if s.p == nil {
		return
	}
	if s.p.Level > s.lastLevel {
		for l := s.lastLevel + 1; l <= s.p.Level; l++ {
			s.toast("level", "Level "+strconv.Itoa(l), "A skill point to spend (K).", 0, "level")
		}
		s.lastLevel = s.p.Level
		s.changed()
	}
	before := s.p.Rank
	if rank, ok := progress.CheckRank(s.p, progress.FactsFromProfile(s.p)); ok {
		for r := before + 1; r <= rank; r++ {
			s.send(proto.SRankUp, proto.RankUpMsg{Rank: r})
			s.narrate(narrator.Event{Kind: narrator.RankReached, Rank: r, RankName: progress.RankTitle(r)})
		}
		for _, id := range content.UnlockedRegions(rank) {
			progress.UnlockRegionID(s.p, core.RegionID(id))
		}
		progress.Recompute(s.p)
		s.changed()
	}
	if added := s.tracker.Sync(s.p); len(added) > 0 {
		s.changed()
	}
}

// giveItems adds items to the player (backpack, overflowing into storage), equips
// new equipment into empty slots, and announces unique finds.
func (s *Session) giveItems(items []string, announce bool) []string {
	var got []string
	for _, id := range items {
		def, ok := progress.Item(id)
		if !ok {
			continue
		}
		if _, err := progress.AddItem(s.p, id, 1); err != nil {
			continue
		}
		got = append(got, id)
		if def.Kind == progress.KindEquipment && s.p.Equipped[def.Slot] == "" {
			_ = progress.Equip(s.p, id, true)
		}
		if announce {
			if unique(def) {
				s.send(proto.SRareItem, proto.RareItemMsg{Item: id})
			} else {
				s.toast("item", def.Name, "Added to your pack.", 0, def.Icon)
			}
		}
		s.changed()
	}
	return got
}

func unique(def proto.ItemDef) bool {
	return def.Tier >= 4 || def.Rarity >= proto.RarityEpic
}

func regionFlag(r core.RegionID) string { return "region:" + r.Key() }

func lower(s string) string { return strings.ToLower(s) }
