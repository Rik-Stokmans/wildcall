package game

import (
	"encoding/json"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// unidentified lists the ids of every species the player has not identified.
func (s *Session) unidentified() []string {
	var out []string
	for i := range s.species {
		if s.p.Journal.Species[s.species[i].ID] == nil {
			out = append(out, s.species[i].ID)
		}
	}
	return out
}

func mentionsAny(text string, ids []string) bool {
	for _, id := range ids {
		if strings.Contains(text, id) {
			return true
		}
	}
	return false
}

// clientView is the profile as the client may see it (contract §3.6, rule 1):
// every Mystery.Species is blanked and its candidate table recomputed from the
// player's evidence; nothing else that would name a species the player has not
// identified survives (anti-grind log keys, feathers of unidentified species, stray
// species fields).
func (s *Session) clientView() proto.Profile {
	raw, err := json.Marshal(s.p)
	if err != nil {
		s.logf("game: profile encode: %v", err)
		return proto.Profile{}
	}
	var v proto.Profile
	if err := json.Unmarshal(raw, &v); err != nil {
		s.logf("game: profile decode: %v", err)
		return proto.Profile{}
	}
	unknown := s.unidentified()
	known := func(id string) bool { return id != "" && s.p.Journal.Species[id] != nil }
	ctx := s.fieldCtx()

	for i, m := range v.Journal.Mysteries {
		if m == nil {
			continue
		}
		orig := s.p.Journal.Mysteries[i]
		m.Candidates = field.Candidates(m.Evidence, m.Wrong, field.MysteryContext(ctx, orig), s.p.Stats, s.species)
		m.Species = ""
		if m.Wrong == nil {
			m.Wrong = []string{}
		}
	}
	for k := range v.XPLog {
		if mentionsAny(k, unknown) {
			delete(v.XPLog, k)
		}
	}
	for k := range v.Flags {
		if mentionsAny(k, unknown) {
			delete(v.Flags, k)
		}
	}
	for k := range v.Journal.Collectibles {
		if strings.HasPrefix(k, "feather_") && !known(strings.TrimPrefix(k, "feather_")) {
			delete(v.Journal.Collectibles, k)
		}
	}
	for _, ph := range v.Journal.Photos {
		for j := range ph.Subjects {
			if !known(ph.Subjects[j].Species) {
				ph.Subjects[j].Species = ""
			}
		}
	}
	for _, r := range v.Journal.Recordings {
		if !known(r.Species) {
			r.Species = ""
		}
	}
	for _, o := range v.Journal.Observations {
		if !known(o.Species) {
			o.Species = ""
		}
	}
	for _, r := range v.Journal.Rare {
		if !known(r.Species) {
			r.Species = ""
		}
	}
	return v
}

// speciesObjective reports whether an objective names a species in its target.
func speciesObjective(o proto.ObjectiveDef) bool {
	switch o.Kind {
	case content.KindHear, content.KindObserve, content.KindIdentify, content.KindPhoto, content.KindRecord:
		return o.Target != "" && o.Target != content.TargetAny && o.Target != content.TargetUnknown &&
			!strings.HasPrefix(o.Target, content.TargetKind)
	}
	return false
}

// questView is the quest catalog as the client may see it: objectives that name a
// species the player has not identified have their Target (and species param)
// blanked, so the quest log cannot give the answer away.
func (s *Session) questView() []proto.QuestDef {
	qs := content.Quests()
	known := func(id string) bool { return s.p.Journal.Species[id] != nil }
	for qi := range qs {
		for oi := range qs[qi].Objectives {
			o := &qs[qi].Objectives[oi]
			if speciesObjective(*o) && !known(o.Target) {
				o.Target = ""
			}
			if sp, ok := o.Params[content.ParamSpecies]; ok && sp != "" && !known(sp) {
				params := make(map[string]string, len(o.Params))
				for k, v := range o.Params {
					if k != content.ParamSpecies {
						params[k] = v
					}
				}
				o.Params = params
			}
		}
	}
	return qs
}
