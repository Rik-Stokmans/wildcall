package game

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// While the tutorial runs, other wrens keep quiet in the singer's patch, so the amber
// voice a beginner follows there is always him; the singer himself, other species and
// wrens far away are unaffected, and the hush ends with the quest.
func TestSingerHushesRivals(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	_, _ = h.talkUntil("npc_mara", "mara", "accept:unseen_singer")
	h.tick(2)
	if s.SingerID() == 0 {
		t.Fatal("no singer")
	}
	wren := s.spByID(content.TutorialSpecies)
	if wren == nil {
		t.Fatal("no wren species")
	}
	c := s.singer.plan.centre
	near := core.EcoEvent{Kind: core.EvCall, Bird: 1, Species: wren.Index, Pos: c.Add(core.V(8, 0, 0))}
	cabin, _ := s.world.POI("cabin")
	away := c.Sub(cabin.Pos)
	away = away.Scale(1 / away.Len()) // from the cabin through the territory and on
	far := core.EcoEvent{Kind: core.EvCall, Bird: 1, Species: wren.Index, Pos: c.Add(away.Scale(s.singer.plan.radius + singerHushRange + 20))}
	onTheWay := near
	onTheWay.Pos = cabin.Pos.Add(c.Sub(cabin.Pos).Scale(0.4)).Add(core.V(10, 0, 0))
	other := near
	other.Species = wren.Index + 1
	him := near
	him.Bird = s.SingerID()
	if !s.singerHushes(near) {
		t.Error("a rival wren inside the patch still sings")
	}
	if !s.singerHushes(onTheWay) {
		t.Error("a wren between the cabin and the patch still sings")
	}
	if s.singerHushes(far) || s.singerHushes(other) || s.singerHushes(him) {
		t.Error("hushed the singer, another species or a far wren")
	}
	s.p.Quests[content.TutorialQuest].Status = content.StatusComplete
	if s.singerHushes(near) {
		t.Error("rivals stay quiet after the quest")
	}
}
