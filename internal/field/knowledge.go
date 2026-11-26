package field

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// Knowledge answers what the player already knows about a species, so perception
// does not depend on how the session stores the journal. Species are addressed by
// their stable id (core.Species.ID). Implementations must be cheap: they are asked
// several times per tick.
type Knowledge interface {
	// Identified reports whether the species is in the player's journal (a
	// "probable" identification counts: the player has put a name to it).
	Identified(speciesID string) bool
	// Recorded reports whether the player holds an audio recording of the species.
	Recorded(speciesID string) bool
	// Mystery returns the open mystery for a species the player has heard or seen
	// but not identified, or nil if there is none (yet).
	Mystery(speciesID string) *proto.Mystery
	// Evidence returns the evidence gathered so far for the species: its mystery's
	// while unidentified, its journal entry's afterwards. May be nil. Read-only.
	Evidence(speciesID string) map[string]string
}

// noKnowledge is the Knowledge of a player who knows nothing (nil Context.Know).
type noKnowledge struct{}

func (noKnowledge) Identified(string) bool            { return false }
func (noKnowledge) Recorded(string) bool              { return false }
func (noKnowledge) Mystery(string) *proto.Mystery     { return nil }
func (noKnowledge) Evidence(string) map[string]string { return nil }

// ProfileKnowledge reads Knowledge straight from a player profile's journal. It
// relies on proto.Mystery.Species holding the true species id server-side (it is
// blanked only in the client view) and on recordings of an identified species
// either carrying RecMeta.Species or being counted in SpeciesEntry.RecCount.
type ProfileKnowledge struct {
	P *proto.Profile
}

func (k ProfileKnowledge) entry(id string) *proto.SpeciesEntry {
	if k.P == nil || id == "" {
		return nil
	}
	return k.P.Journal.Species[id]
}

func (k ProfileKnowledge) Identified(id string) bool { return k.entry(id) != nil }

func (k ProfileKnowledge) Recorded(id string) bool {
	if k.P == nil || id == "" {
		return false
	}
	if e := k.entry(id); e != nil && (e.RecCount > 0 || e.BestRec != "") {
		return true
	}
	for _, r := range k.P.Journal.Recordings {
		if r != nil && r.Species == id {
			return true
		}
	}
	if m := k.Mystery(id); m != nil {
		if len(m.Recs) > 0 {
			return true
		}
		for _, r := range k.P.Journal.Recordings {
			if r != nil && r.Mystery == m.ID {
				return true
			}
		}
	}
	return false
}

func (k ProfileKnowledge) Mystery(id string) *proto.Mystery {
	if k.P == nil || id == "" {
		return nil
	}
	for _, m := range k.P.Journal.Mysteries {
		if m != nil && m.Species == id {
			return m
		}
	}
	return nil
}

func (k ProfileKnowledge) Evidence(id string) map[string]string {
	if e := k.entry(id); e != nil {
		return e.Evidence
	}
	if m := k.Mystery(id); m != nil {
		return m.Evidence
	}
	return nil
}

// Memory is a plain in-memory Knowledge, handy for tests and tools.
// The zero value knows nothing; nil maps are fine.
type Memory struct {
	Known     map[string]bool              // identified species ids
	Recs      map[string]bool              // species ids the player holds a recording of
	Mysteries map[string]*proto.Mystery    // open mysteries by true species id
	Evid      map[string]map[string]string // evidence of identified species by species id
}

func (m *Memory) Identified(id string) bool { return m != nil && m.Known[id] }
func (m *Memory) Recorded(id string) bool   { return m != nil && m.Recs[id] }

func (m *Memory) Mystery(id string) *proto.Mystery {
	if m == nil || m.Known[id] {
		return nil
	}
	return m.Mysteries[id]
}

func (m *Memory) Evidence(id string) map[string]string {
	if m == nil {
		return nil
	}
	if m.Known[id] {
		return m.Evid[id]
	}
	if my := m.Mysteries[id]; my != nil {
		return my.Evidence
	}
	return nil
}

var (
	_ Knowledge = ProfileKnowledge{}
	_ Knowledge = (*Memory)(nil)
	_ Knowledge = noKnowledge{}
)
