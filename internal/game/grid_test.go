package game

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The grid inventory messages: place and tidy, and move / buy / unequip with a full
// pack.
func TestPlaceAndTidyMessages(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	h.tick(1)
	if _, err := progress.AddItem(s.p, "headphones", 1); err != nil {
		t.Fatal(err)
	}
	progress.AddItem(s.p, "film_roll", 4)
	h.take()

	// Within the backpack works anywhere.
	h.send(proto.CPlace, proto.PlaceItem{From: "inventory", FX: 0, FY: 0, To: "inventory", X: 3, Y: 2})
	if msg, bad := hasError(h.take()); bad {
		t.Fatalf("place in pack: %s", msg)
	}
	if st := s.p.Inventory[0]; st.Item != "headphones" || st.X != 3 || st.Y != 2 {
		t.Fatalf("headphones at %+v", st)
	}
	// A refusal changes nothing and says why.
	before := profileJSON(s)
	h.send(proto.CPlace, proto.PlaceItem{From: "inventory", FX: 3, FY: 2, To: "inventory", X: 4, Y: 3})
	if msg, bad := hasError(h.take()); !bad || !strings.Contains(msg, "does not fit") || profileJSON(s) != before {
		t.Fatalf("out of bounds: %q", msg)
	}
	// Storage is out of reach away from the cabin, for place and tidy alike.
	h.standNear("shop_finn", 3)
	h.take()
	h.send(proto.CPlace, proto.PlaceItem{From: "inventory", FX: 3, FY: 2, To: "storage", X: 0, Y: 0})
	if msg, bad := hasError(h.take()); !bad || !strings.Contains(msg, "cabin") {
		t.Fatalf("storage from afar: %q", msg)
	}
	h.send(proto.CTidy, proto.TidyMsg{Where: "storage"})
	if _, bad := hasError(h.take()); !bad {
		t.Fatal("tidy storage from afar")
	}
	h.send(proto.CTidy, proto.TidyMsg{Where: "inventory"})
	if msg, bad := hasError(h.take()); bad {
		t.Fatalf("tidy pack: %s", msg)
	}
	if st := s.p.Inventory[0]; st.Item != "headphones" || st.X != 0 || st.Y != 0 {
		t.Fatalf("tidy should put the biggest thing first: %+v", s.p.Inventory)
	}
	// Buying with no room is refused before any credits change hands.
	s.p.Credits = 1000
	for i := 0; progress.FreeSlots(s.p) > 0; i++ {
		progress.AddToPack(s.p, []string{"oats", "flour", "honey", "nettle", "hazelnut", "chestnut", "rosehip"}[i%7], 20)
	}
	h.take()
	inv0 := mustJSON(s.p.Inventory)
	h.send(proto.CBuy, proto.ItemAction{Item: "pocket_guide"})
	if msg, bad := hasError(h.take()); !bad || !strings.Contains(msg, "full") || s.p.Credits != 1000 || mustJSON(s.p.Inventory) != inv0 {
		t.Fatalf("buy into a full pack: %q", msg)
	}
	// Unequipping with no room is refused.
	h.send(proto.CUnequip, proto.SlotAction{Slot: "camera"})
	if msg, bad := hasError(h.take()); !bad || !strings.Contains(msg, "no room") || mustJSON(s.p.Inventory) != inv0 || s.p.Equipped["camera"] == "" {
		t.Fatalf("unequip into a full pack: %q", msg)
	}

	// At the cabin: place into storage, move back with the auto-placing "move".
	h.standNear("cabin", 6)
	h.take()
	h.send(proto.CPlace, proto.PlaceItem{From: "inventory", FX: 0, FY: 0, To: "storage", X: 6, Y: 9, R: true})
	if msg, bad := hasError(h.take()); bad {
		t.Fatalf("place into storage: %s", msg)
	}
	if progress.Stored(s.p, "headphones") != 1 || s.p.Stats.NoiseReduce != 0 {
		t.Fatalf("stored headphones: %+v", s.p.Storage)
	}
	h.send(proto.CMove, proto.MoveItem{Item: "headphones", To: "inventory"})
	if msg, bad := hasError(h.take()); bad || progress.Carried(s.p, "headphones") != 1 {
		t.Fatalf("move back: %q", msg)
	}
	if !progress.PackGrid(s.p).Valid() || !progress.StorageGrid(s.p).Valid() {
		t.Fatal("grids invalid")
	}
	h.send(proto.CTidy, proto.TidyMsg{Where: "storage"})
	if msg, bad := hasError(h.take()); bad {
		t.Fatalf("tidy storage at the cabin: %s", msg)
	}
	h.send(proto.CTidy, proto.TidyMsg{Where: "attic"})
	if _, bad := hasError(h.take()); !bad {
		t.Fatal("tidy of an unknown grid")
	}
}
