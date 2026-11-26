package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// sanitize repairs a loaded profile so that the session's invariants hold no matter
// what the file contained (Review Focus 2): no nil entries in journal lists or maps,
// no references to species, quests or items this build does not know, sane counters.
// progress.Normalize has already filled the top-level maps and clamped level/rank.
func (s *Session) sanitize(p *proto.Profile) {
	known := map[string]bool{}
	for i := range s.species {
		known[s.species[i].ID] = true
	}
	nonNilMap := func(m map[string]string) map[string]string {
		if m == nil {
			return map[string]string{}
		}
		return m
	}
	strs := func(l []string) []string {
		if l == nil {
			return []string{}
		}
		return l
	}
	j := &p.Journal

	for id, e := range j.Species {
		if e == nil || !known[id] {
			delete(j.Species, id)
			continue
		}
		e.ID = id
		e.Evidence = nonNilMap(e.Evidence)
		e.Behaviors, e.Habitats = strs(e.Behaviors), strs(e.Habitats)
		if e.Regions == nil {
			e.Regions = []int{}
		}
		e.Level = min(max(e.Level, proto.LevelIdentified), proto.LevelStudied)
		e.Study = min(max(e.Study, 0), 100)
	}
	seenSp := map[string]bool{}
	ms := j.Mysteries[:0]
	for _, m := range j.Mysteries {
		// One mystery per unidentified, known species.
		if m == nil || m.ID == "" || !known[m.Species] || j.Species[m.Species] != nil || seenSp[m.Species] {
			continue
		}
		seenSp[m.Species] = true
		m.Evidence = nonNilMap(m.Evidence)
		m.Photos, m.Recs, m.Wrong = strs(m.Photos), strs(m.Recs), strs(m.Wrong)
		if m.Candidates == nil {
			m.Candidates = []proto.Candidate{}
		}
		m.Level = min(max(m.Level, proto.LevelHeard), proto.LevelEncountered)
		ms = append(ms, m)
	}
	j.Mysteries = ms

	ph := j.Photos[:0]
	for _, x := range j.Photos {
		if x == nil || x.ID == "" {
			continue
		}
		if x.Subjects == nil {
			x.Subjects = []proto.PhotoSubject{}
		}
		x.Tags = strs(x.Tags)
		x.Stars = min(max(x.Stars, 0), 5)
		ph = append(ph, x)
	}
	j.Photos = ph
	rs := j.Recordings[:0]
	for _, x := range j.Recordings {
		if x == nil || x.ID == "" {
			continue
		}
		if x.SpIndex < 0 || x.SpIndex >= len(s.species) {
			x.SpIndex, x.Call = 0, -1 // unplayable; analyze refuses it
		}
		x.Stars = min(max(x.Stars, 0), 5)
		rs = append(rs, x)
	}
	j.Recordings = rs
	obs := j.Observations[:0]
	for _, x := range j.Observations {
		if x != nil {
			obs = append(obs, x)
		}
	}
	j.Observations = obs
	rare := j.Rare[:0]
	for _, x := range j.Rare {
		if x != nil && x.ID != "" {
			rare = append(rare, x)
		}
	}
	j.Rare = rare
	for id, l := range j.Locations {
		if l == nil {
			delete(j.Locations, id)
		}
	}
	if j.Lore == nil {
		j.Lore = []string{}
	}
	if j.Collectibles == nil {
		j.Collectibles = map[string]int{}
	}
	j.Pinned, j.Badges = strs(j.Pinned), strs(j.Badges)

	for id, q := range p.Quests {
		if _, ok := content.QuestByID(id); !ok || q == nil {
			delete(p.Quests, id)
			continue
		}
		if q.Progress == nil {
			q.Progress = map[string]int{}
		}
	}
	for k, v := range p.Explored {
		if len(v) != 32 {
			delete(p.Explored, k)
		}
	}
	clean := func(l []proto.ItemStack) []proto.ItemStack {
		out := l[:0]
		for _, st := range l {
			if _, ok := progress.Item(st.Item); ok && st.Qty > 0 {
				out = append(out, st)
			}
		}
		return out
	}
	p.Inventory, p.Storage = clean(p.Inventory), clean(p.Storage)
	for slot, id := range p.Equipped {
		def, ok := progress.Item(id)
		if !ok || def.Slot != slot || def.Kind != progress.KindEquipment {
			delete(p.Equipped, slot)
		}
	}
	p.Credits = max(p.Credits, 0)
	p.SkillPoints = max(p.SkillPoints, 0)
	p.Film.Used = max(p.Film.Used, 0)
}
