package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// singerHushRange is how far beyond the edge of the tutorial singer's territory, and
// how far either side of the walk from the cabin to it, other wrens keep quiet while
// "The Unseen Singer" is under way. A singing male owns his patch: rivals inside it do
// not answer him. Along the way out from the cabin it is a tutorial kindness: the amber
// voice a beginner hears on the ring between the cabin and the search area is always
// him, never a second wren skulking in the bramble behind the cabin.
const singerHushRange = 45

// singerHushes reports whether a call should not be heard at all: an ordinary wren
// singing inside the singer's patch while the tutorial is active.
func (s *Session) singerHushes(ev core.EcoEvent) bool {
	if s.p == nil || s.singer.id == 0 || ev.Bird == s.singer.id || !s.singer.plan.ok {
		return false
	}
	if st := s.p.Quests[content.TutorialQuest]; st == nil || st.Status != content.StatusActive {
		return false
	}
	sp := s.spByID(content.TutorialSpecies)
	if sp == nil || ev.Species != sp.Index {
		return false
	}
	pl := s.singer.plan
	r := pl.radius + singerHushRange
	if ev.Pos.DistXZ(pl.centre) <= r {
		return true
	}
	cabin, ok := s.world.POI("cabin")
	if !ok {
		return false
	}
	d, _ := distToPolyline(ev.Pos, []core.Vec3{cabin.Pos, pl.centre})
	return d <= singerHushRange
}
