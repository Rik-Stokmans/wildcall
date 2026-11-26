package game

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestPhase2DebugCommands runs the field-kitchen and nest debug commands.
func TestPhase2DebugCommands(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	h.standNear("cabin", 6)
	h.tick(2)
	s.clock.SetSeason(core.Spring)
	h.tick(2)

	msg, err := s.Debug("forage", "young_pine")
	if err != nil || !strings.HasPrefix(msg, "young_pine fg@") {
		t.Fatalf("forage: %q %v", msg, err)
	}
	id := strings.Fields(msg)[1]
	id = strings.TrimSuffix(id, ":")
	if r := h.forage(id); !r.OK {
		t.Fatalf("pick after debug forage: %+v", r)
	}
	if _, err := s.Debug("regrow"); err != nil || len(s.p.Forage) != 0 {
		t.Fatalf("regrow: %v %v", err, s.p.Forage)
	}
	if _, err := s.Debug("forage", "no_such_plant"); err == nil {
		t.Fatal("forage of an unknown plant")
	}

	msg, err = s.Debug("nest")
	if err != nil || !strings.HasPrefix(msg, "n") {
		t.Fatalf("nest: %q %v", msg, err)
	}
	t.Logf("debug nest: %s", msg)
	for i := range s.species {
		if strings.Contains(strings.ToLower(msg), strings.ToLower(s.species[i].Name)) || strings.Contains(msg, s.species[i].ID) {
			t.Fatalf("debug nest names a species: %q", msg)
		}
	}
	if msg, err = s.Debug("nests"); err != nil {
		t.Fatal(err)
	}
	t.Logf("debug nests: %s", msg)

	if _, err := s.Debug("buff", "bilberry_tart"); err != nil {
		t.Fatal(err)
	}
	if len(s.p.Buffs) != 1 || s.p.Buffs[0].Slot != progress.SlotSnack {
		t.Fatalf("buff: %+v", s.p.Buffs)
	}
	if _, err := s.Debug("buff", "elderberry"); err == nil {
		t.Fatal("buff of an inedible item")
	}
	if _, err := s.Debug("clearbuffs"); err != nil || len(s.p.Buffs) != 0 {
		t.Fatalf("clearbuffs: %v", err)
	}
	if _, err := s.Debug("learn", "all"); err != nil || !progress.KnowsRecipe(s.p, "forager_stew") {
		t.Fatalf("learn all: %v", err)
	}
	if _, err := s.Debug("pantry"); err != nil || progress.Carried(s.p, "oats")+progress.Stored(s.p, "oats") < 3 {
		t.Fatalf("pantry: %v", err)
	}
	if _, err := s.Debug("give", "nettle_soup", "2"); err != nil {
		t.Fatal(err)
	}
	// Without -dev nothing of this works.
	h2 := newHarness(t, false)
	h2.send(proto.CDebug, proto.DebugMsg{Cmd: "buff", Args: []string{"mint_tea"}})
	if _, bad := hasError(h2.take()); !bad || len(h2.s.p.Buffs) != 0 {
		t.Fatal("debug buff without -dev")
	}
}
