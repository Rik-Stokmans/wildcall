package game

import (
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
)

// quarryPrefix marks which mystery an active quest's species target is: the flag
// "quarry:<quest id>:<mystery id>" lets the quest tracker and the clue cards say
// "this is the voice Mara meant" by the mystery's own label ("Unknown bird E")
// without ever naming the species (spec §35 rule 1). Without it a beginner who has
// heard half a dozen unknown voices cannot tell which one the quest is about.
const quarryPrefix = "quarry:"

func quarryFlag(questID, mysteryID string) string {
	return quarryPrefix + questID + ":" + mysteryID
}

// noteQuarry is called whenever a mystery is noticed: every active quest with an
// objective targeting that species points at the mystery.
func (s *Session) noteQuarry(speciesID, mysteryID string) {
	if s.p == nil || s.p.Flags == nil || mysteryID == "" {
		return
	}
	for id, st := range s.p.Quests {
		if st == nil || st.Status != content.StatusActive {
			continue
		}
		key := quarryFlag(id, mysteryID)
		if s.p.Flags[key] {
			continue
		}
		q, ok := content.QuestByID(id)
		if !ok {
			continue
		}
		targets := false
		for _, o := range q.Objectives {
			if o.Target == speciesID {
				targets = true
				break
			}
		}
		if !targets {
			continue
		}
		for k := range s.p.Flags {
			if strings.HasPrefix(k, quarryPrefix+id+":") {
				delete(s.p.Flags, k)
			}
		}
		s.p.Flags[key] = true
		s.changed()
	}
}

// rewardTrails maps a hidden trail id to the quest whose turn-in reveals it
// ("feature:trail_<id>" unlocks): such a trail is that quest's reward, so walking
// near its trailhead must not give it away first.
var rewardTrails = func() map[string]string {
	m := map[string]string{}
	for _, q := range content.Quests() {
		for _, u := range q.Rewards.Unlock {
			if id, ok := strings.CutPrefix(u, "feature:trail_"); ok {
				m[id] = q.ID
			}
		}
	}
	return m
}()

// trailIsAReward reports a hidden trail still waiting to be earned by a quest.
func (s *Session) trailIsAReward(trailID string) bool {
	q, ok := rewardTrails[trailID]
	if !ok {
		return false
	}
	st := s.p.Quests[q]
	return st == nil || st.Status != content.StatusTurnedIn
}
