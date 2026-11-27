package progress

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// fillPack puts a stack of item into every free cell of the backpack (a valid grid).
func fillPack(p *proto.Profile, item string, qty int) {
	g := PackGrid(p)
	for i, v := range g.occupancy(-1) {
		if v == 0 {
			g.Stacks = append(g.Stacks, proto.ItemStack{Item: item, Qty: qty, X: i % g.W, Y: i / g.W})
		}
	}
	p.Inventory = g.Stacks
	Recompute(p)
}

// counts totals every item in a list of stacks.
func counts(stacks ...[]proto.ItemStack) map[string]int {
	m := map[string]int{}
	for _, l := range stacks {
		for _, st := range l {
			m[st.Item] += st.Qty
		}
	}
	return m
}

func sameCounts(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func TestFootprints(t *testing.T) {
	want := map[string][2]int{
		"basic_binoculars": {2, 2}, "explorer_binoculars": {2, 2}, "specialist_binoculars": {2, 3},
		"spotting_scope": {1, 4}, "historical_binoculars": {2, 2}, "starter_camera": {2, 2},
		"basic_recorder": {1, 2}, "directional_microphone": {1, 3}, "parabolic_microphone": {3, 3},
		"explorers_lens": {1, 1}, "naturalists_compass": {1, 1}, "forgotten_journal": {1, 2},
		"camouflage_smock": {2, 3}, "film_roll": {1, 1}, "seed_mix": {1, 1}, "blackberry": {1, 1},
	}
	for id, fp := range want {
		if w, h := Footprint(id, false); w != fp[0] || h != fp[1] {
			t.Errorf("%s: %dx%d, want %dx%d", id, w, h, fp[0], fp[1])
		}
	}
	for _, it := range Items() {
		if it.W < 1 || it.H < 1 || it.W > MaxItemSide || it.H > MaxItemSide {
			t.Errorf("%s: footprint %dx%d", it.ID, it.W, it.H)
		}
		if w, h := Footprint(it.ID, true); w != it.H || h != it.W {
			t.Errorf("%s: turned footprint %dx%d", it.ID, w, h)
		}
		for _, c := range it.Cons {
			if c == packRoomCon {
				t.Errorf("%s: pack-room line not filled in", it.ID)
			}
		}
	}
	if w, h := Footprint("no_such_thing", false); w != 1 || h != 1 {
		t.Errorf("unknown item %dx%d", w, h)
	}
}

func TestPackSizes(t *testing.T) {
	cases := map[string][2]int{
		"canvas_satchel": {5, 4}, "explorer_pack": {6, 5}, "expedition_pack": {7, 6}, "research_backpack": {8, 6},
	}
	for id, want := range cases {
		p := NewProfile("t")
		p.Equipped[SlotBackpack] = id
		Recompute(p)
		if w, h := PackSize(p); w != want[0] || h != want[1] || Capacity(p) != w*h || p.Stats.Capacity != float32(w*h) {
			t.Errorf("%s: %dx%d (capacity %d), want %v", id, w, h, Capacity(p), want)
		}
	}
	// Bigger packs weigh on you (spec §9.3).
	for _, id := range []string{"explorer_pack", "expedition_pack", "research_backpack"} {
		def, _ := Item(id)
		if def.Mods["stamina"] >= 0 {
			t.Errorf("%s: no weight tradeoff: %v", id, def.Mods)
		}
	}
	// The research backpack's organisation: stacks hold half as much again.
	p := NewProfile("t")
	if StackLimit(p, "film_roll", ToInventory) != 6 {
		t.Fatal("base film stack")
	}
	p.Equipped[SlotBackpack] = "research_backpack"
	Recompute(p)
	if StackLimit(p, "film_roll", ToInventory) != 9 || StackLimit(p, "film_roll", ToStorage) != 6 ||
		StackLimit(p, "blackberry", ToInventory) != 30 || StackLimit(p, "headphones", ToInventory) != 1 {
		t.Errorf("research stack limits: film %d/%d", StackLimit(p, "film_roll", ToInventory), StackLimit(p, "film_roll", ToStorage))
	}
	AddItem(p, "film_roll", 9)
	if len(p.Inventory) != 1 || p.Inventory[0].Qty != 9 {
		t.Errorf("9 rolls in one sleeve: %+v", p.Inventory)
	}
}

func TestGridValidity(t *testing.T) {
	g := NewGrid(5, 4, []proto.ItemStack{
		{Item: "headphones", Qty: 1, X: 0, Y: 0},  // 2x2
		{Item: "tripod", Qty: 1, X: 4, Y: 0},      // 1x4
		{Item: "field_stool", Qty: 1, X: 2, Y: 0}, // 2x3
	})
	if !g.Valid() || g.UsedCells() != 14 || g.FreeCells() != 6 {
		t.Fatalf("valid %v used %d", g.Valid(), g.UsedCells())
	}
	if g.At(3, 2) != 2 || g.At(0, 3) != -1 || g.TopLeft(2, 0) != 2 || g.TopLeft(3, 0) != -1 {
		t.Error("At / TopLeft")
	}
	// overlap
	bad := NewGrid(5, 4, append(g.Stacks, proto.ItemStack{Item: "seed_mix", Qty: 1, X: 1, Y: 1}))
	if bad.Valid() {
		t.Error("overlap accepted")
	}
	// out of bounds, turned: a tripod lying across at x=2 reaches x=5
	oob := NewGrid(5, 4, []proto.ItemStack{{Item: "tripod", Qty: 1, X: 2, Y: 3, R: true}})
	if oob.Valid() {
		t.Error("out of bounds accepted")
	}
	if !NewGrid(5, 4, []proto.ItemStack{{Item: "tripod", Qty: 1, X: 1, Y: 3, R: true}}).Valid() {
		t.Error("a turned tripod along the bottom row should fit")
	}
	if NewGrid(5, 4, []proto.ItemStack{{Item: "seed_mix", Qty: 0}}).Valid() {
		t.Error("an empty stack accepted")
	}
}

func TestFindSpace(t *testing.T) {
	g := NewGrid(5, 4, nil)
	x, y, r, ok := g.FindSpace("field_stool")
	if !ok || x != 0 || y != 0 || r {
		t.Fatalf("empty grid: %d,%d r=%v ok=%v", x, y, r, ok)
	}
	g.Stacks = []proto.ItemStack{{Item: "headphones", Qty: 1, X: 0, Y: 0}, {Item: "headphones", Qty: 1, X: 2, Y: 0}}
	// 2x3 upright no longer fits in rows 0..3 at x 0..3 (rows 2..3 only); x=3 has
	// column 4 free for one cell... so it lies down: 3x2 at (0,2).
	x, y, r, ok = g.FindSpace("field_stool")
	if !ok || !r || x != 0 || y != 2 {
		t.Errorf("turned fit: %d,%d r=%v ok=%v", x, y, r, ok)
	}
	// A 1x4 tripod stands in the free right-hand column.
	if x, y, r, ok = g.FindSpace("tripod"); !ok || r || x != 4 || y != 0 {
		t.Errorf("tripod: %d,%d r=%v ok=%v", x, y, r, ok)
	}
	full := NewGrid(2, 2, []proto.ItemStack{{Item: "headphones", Qty: 1}})
	if _, _, _, ok := full.FindSpace("seed_mix"); ok {
		t.Error("found space in a full grid")
	}
}

func TestGridAddAndRemove(t *testing.T) {
	g := NewGrid(3, 3, []proto.ItemStack{{Item: "film_roll", Qty: 4, X: 2, Y: 2}})
	// tops up the existing stack first (to 6), then opens new stacks top-left first
	if left := g.Add("film_roll", 9); left != 0 {
		t.Fatalf("left %d", left)
	}
	if g.Stacks[0].Qty != 6 || len(g.Stacks) != 3 || g.Stacks[1].X != 0 || g.Stacks[1].Y != 0 || g.Stacks[2].Qty != 1 {
		t.Errorf("add: %+v", g.Stacks)
	}
	if left := g.Add("parabolic_microphone", 1); left != 1 {
		t.Errorf("a 3x3 dish fitted a part-full 3x3 grid: %+v", g.Stacks)
	}
	if room := g.Room("seed_mix", 100); room != 6*8 {
		t.Errorf("room %d", room)
	}
	// remove takes the smallest stack first; the others keep their places
	if n := g.Remove("film_roll", 2); n != 2 || len(g.Stacks) != 2 || g.Stacks[0].X != 2 || g.Stacks[1].X != 0 || g.Count("film_roll") != 11 {
		t.Errorf("remove: %d %+v", n, g.Stacks)
	}
	if n := g.Remove("film_roll", 50); n != 11 || len(g.Stacks) != 0 {
		t.Errorf("remove all: %d %+v", n, g.Stacks)
	}
}

func TestPlace(t *testing.T) {
	mk := func() (*Grid, *Grid) {
		pack := NewGrid(5, 4, []proto.ItemStack{
			{Item: "headphones", Qty: 1, X: 0, Y: 0},
			{Item: "film_roll", Qty: 4, X: 2, Y: 0},
			{Item: "film_roll", Qty: 5, X: 3, Y: 0},
			{Item: "tripod", Qty: 1, X: 4, Y: 0},
		})
		store := NewGrid(StorageW, StorageH, []proto.ItemStack{{Item: "seed_mix", Qty: 2, X: 0, Y: 0}})
		return pack, store
	}
	snap := func(gs ...*Grid) string {
		b, _ := json.Marshal(gs)
		return string(b)
	}
	refuse := func(name string, kind error, want string, f func(pack, store *Grid) error) {
		t.Helper()
		pack, store := mk()
		before := snap(pack, store)
		err := f(pack, store)
		if !errors.Is(err, kind) || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: %v", name, err)
		}
		if snap(pack, store) != before {
			t.Errorf("%s: a refusal changed the grids", name)
		}
	}
	refuse("unknown source", ErrNotOwned, "nothing there", func(p, s *Grid) error { return Place(p, p, 1, 1, 0, 3, false) })
	refuse("out of bounds", ErrInvalid, "does not fit", func(p, s *Grid) error { return Place(p, p, 0, 0, 4, 3, false) })
	refuse("turned out of bounds", ErrInvalid, "does not fit", func(p, s *Grid) error { return Place(p, p, 4, 0, 2, 3, true) })
	refuse("overlap", ErrInvalid, "Field Headphones", func(p, s *Grid) error { return Place(p, p, 4, 0, 1, 0, false) })
	refuse("full stack", ErrInvalid, "already full", func(p, s *Grid) error {
		p.Stacks[2].Qty = 6
		before := snap(p, s)
		err := Place(p, p, 2, 0, 3, 0, false)
		if snap(p, s) != before {
			return errors.New("changed")
		}
		p.Stacks[2].Qty = 5 // restore for the outer snapshot
		return err
	})

	// move within the grid
	pack, store := mk()
	if err := Place(pack, pack, 0, 0, 0, 2, false); err != nil || pack.Stacks[0].Y != 2 || !pack.Valid() {
		t.Errorf("move: %v %+v", err, pack.Stacks)
	}
	// turn in place: the tripod overlaps its own old cells
	if err := Place(pack, pack, 4, 0, 1, 3, true); err == nil {
		t.Error("turned tripod over the headphones should be refused")
	}
	if err := Place(pack, pack, 4, 0, 2, 1, true); err == nil {
		t.Errorf("turned tripod would cross the film: %+v", pack.Stacks)
	}
	pack, store = mk()
	pack.Stacks = pack.Stacks[3:] // only the tripod
	if err := Place(pack, pack, 4, 0, 1, 0, true); err != nil || !pack.Stacks[0].R || pack.Stacks[0].X != 1 {
		t.Errorf("turn: %v %+v", err, pack.Stacks)
	}
	// merge onto a stack of the same item, as far as the limit allows
	pack, store = mk()
	if err := Place(pack, pack, 3, 0, 2, 0, false); err != nil {
		t.Fatal(err)
	}
	if pack.Stacks[1].Qty != 6 || pack.Stacks[2].Qty != 3 || len(pack.Stacks) != 4 {
		t.Errorf("partial merge: %+v", pack.Stacks)
	}
	if err := Place(pack, pack, 3, 0, 2, 0, false); err == nil {
		t.Error("merge into a full stack")
	}
	// whole merge removes the source
	pack, store = mk()
	pack.Stacks[1].Qty = 1
	if err := Place(pack, pack, 2, 0, 3, 0, false); err != nil || len(pack.Stacks) != 3 || countItem(pack.Stacks, "film_roll") != 6 {
		t.Errorf("full merge: %v %+v", err, pack.Stacks)
	}
	// between grids, turned
	pack, store = mk()
	if err := Place(pack, store, 4, 0, 5, 5, true); err != nil {
		t.Fatal(err)
	}
	if len(pack.Stacks) != 3 || len(store.Stacks) != 2 || store.Stacks[1] != (proto.ItemStack{Item: "tripod", Qty: 1, X: 5, Y: 5, R: true}) {
		t.Errorf("to storage: %+v / %+v", pack.Stacks, store.Stacks)
	}
	if err := Place(store, pack, 0, 0, 2, 0, false); err == nil {
		t.Error("seed onto film should be refused")
	}
	if err := Place(store, pack, 0, 0, 0, 3, false); err != nil || countItem(store.Stacks, "seed_mix") != 0 {
		t.Errorf("from storage: %v", err)
	}
	if !pack.Valid() || !store.Valid() {
		t.Error("grids invalid after moves")
	}
}

func TestPlaceItemProfile(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "headphones", 1)
	if p.Stats.NoiseReduce == 0 {
		t.Fatal("headphones should work when carried")
	}
	hp := p.Inventory[0]
	if err := PlaceItem(p, proto.PlaceItem{From: ToInventory, FX: hp.X, FY: hp.Y, To: ToStorage, X: 8, Y: 10}); err != nil {
		t.Fatal(err)
	}
	if len(p.Inventory) != 0 || Stored(p, "headphones") != 1 || p.Stats.NoiseReduce != 0 {
		t.Errorf("stored headphones still work or did not move: %+v %v", p.Storage, p.Stats.NoiseReduce)
	}
	wantErr(t, PlaceItem(p, proto.PlaceItem{From: "moon", To: ToStorage}), ErrInvalid)
	wantErr(t, PlaceItem(p, proto.PlaceItem{From: ToStorage, FX: 8, FY: 10, To: ToInventory, X: 4, Y: 0}), ErrInvalid)
	if err := PlaceItem(p, proto.PlaceItem{From: ToStorage, FX: 8, FY: 10, To: ToInventory, X: 3, Y: 2}); err != nil {
		t.Fatal(err)
	}
	if err := TidyGrid(p, ToInventory); err != nil || p.Inventory[0].X != 0 || p.Inventory[0].Y != 0 {
		t.Errorf("tidy: %v %+v", err, p.Inventory)
	}
	wantErr(t, TidyGrid(p, "attic"), ErrInvalid)
}

// randomGrid builds a valid grid by random adds, moves and removals.
func randomGrid(rng *rand.Rand, ids []string) *Grid {
	g := NewGrid(3+rng.Intn(8), 3+rng.Intn(6), nil)
	n := rng.Intn(30) + rng.Intn(2)*150 // sparse, or packed to the brim
	for i := 0; i < n; i++ {
		id := ids[rng.Intn(len(ids))]
		def := itemIndex[id]
		if !stackable(def) && g.Count(id) > 0 {
			continue
		}
		switch rng.Intn(4) {
		case 0, 1:
			g.Add(id, 1+rng.Intn(max(1, stackSize(def))))
		case 2:
			// drop a stack at a random spot, as a player would
			w, h := Footprint(id, false)
			r := rng.Intn(2) == 0
			if r {
				w, h = h, w
			}
			x, y := rng.Intn(g.W), rng.Intn(g.H)
			if g.Fits(x, y, w, h, -1) {
				g.Stacks = append(g.Stacks, proto.ItemStack{Item: id, Qty: 1 + rng.Intn(stackSize(def)), X: x, Y: y, R: r})
			}
		case 3:
			if len(g.Stacks) > 0 {
				st := g.Stacks[rng.Intn(len(g.Stacks))]
				_ = Place(g, g, st.X, st.Y, rng.Intn(g.W), rng.Intn(g.H), rng.Intn(2) == 0)
			}
		}
	}
	return g
}

// TestTidyProperty: for random valid inventories Tidy always succeeds, keeps every
// unit, leaves a valid grid with no stack over its limit (when none was before),
// and merges: at most one stack per item is not full.
func TestTidyProperty(t *testing.T) {
	var ids []string
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	rng := rand.New(rand.NewSource(7))
	fallbacks, fill := 0, 0.0
	for i := 0; i < 1500; i++ {
		g := randomGrid(rng, ids)
		if !g.Valid() {
			t.Fatalf("case %d: generator made an invalid grid", i)
		}
		before := counts(g.Stacks)
		fill += float64(g.UsedCells()) / float64(g.W*g.H)
		_, fresh := layout(g.W, g.H, g.merged(), true)
		if !fresh {
			fallbacks++
		}
		if !g.Tidy() {
			t.Fatalf("case %d: tidy refused a valid %dx%d grid: %+v", i, g.W, g.H, g.Stacks)
		}
		if !g.Valid() || !sameCounts(before, counts(g.Stacks)) {
			t.Fatalf("case %d: tidy broke the grid or lost units: %+v", i, g.Stacks)
		}
		partial := map[string]int{}
		for _, st := range g.Stacks {
			if lim := g.limitOf(st.Item); st.Qty > lim {
				t.Fatalf("case %d: stack over its limit: %+v", i, st)
			} else if st.Qty < lim {
				partial[st.Item]++
			}
		}
		for id, n := range partial {
			if n > 1 {
				t.Fatalf("case %d: %d part stacks of %s after tidy", i, n, id)
			}
		}
		// Tidying a tidy grid changes nothing.
		again := g.clone()
		again.Tidy()
		if fresh && fmt.Sprint(again.Stacks) != fmt.Sprint(g.Stacks) {
			t.Fatalf("case %d: tidy is not stable", i)
		}
	}
	t.Logf("1500 random grids (fill %.0f%% on average), %d needed the slide-up fallback", 100*fill/1500, fallbacks)
}

func TestTidyOrderAndExactSearch(t *testing.T) {
	g := NewGrid(5, 4, []proto.ItemStack{
		{Item: "seed_mix", Qty: 3, X: 0, Y: 0},
		{Item: "film_roll", Qty: 2, X: 1, Y: 0},
		{Item: "field_stool", Qty: 1, X: 2, Y: 1},
		{Item: "seed_mix", Qty: 4, X: 4, Y: 3},
	})
	if !g.Tidy() {
		t.Fatal("tidy")
	}
	if g.Stacks[0].Item != "field_stool" || g.Stacks[0].X != 0 || g.Stacks[0].Y != 0 {
		t.Errorf("biggest first: %+v", g.Stacks)
	}
	if countItem(g.Stacks, "seed_mix") != 7 || len(g.Stacks) != 3 {
		t.Errorf("merged: %+v", g.Stacks)
	}
	// A perfect fit first-fit cannot find: in a 4x4, a 3x3 dish forces the 1x4 to
	// stand at the edge and the 1x3 to lie under the dish.
	stacks := []proto.ItemStack{
		{Item: "parabolic_microphone", Qty: 1}, {Item: "tripod", Qty: 1}, {Item: "directional_microphone", Qty: 1},
	}
	out, ok := layout(4, 4, stacks, true)
	if !ok || !NewGrid(4, 4, out).Valid() {
		t.Fatalf("exact layout: %v %+v", ok, out)
	}
	// Too much for the space: an invalid grid that cannot be laid out is left as is.
	bad := NewGrid(3, 3, []proto.ItemStack{{Item: "parabolic_microphone", Qty: 1}, {Item: "seed_mix", Qty: 1}})
	if bad.Tidy() || len(bad.Stacks) != 2 {
		t.Error("an impossible tidy should refuse and change nothing")
	}
}

func TestEquipAndUnequipOnTheGrid(t *testing.T) {
	p := NewProfile("t")
	p.Credits, p.Rank = 5000, 3
	if err := Buy(p, "explorer_binoculars"); err != nil {
		t.Fatal(err)
	}
	if err := PlaceItem(p, proto.PlaceItem{From: ToInventory, To: ToInventory, X: 3, Y: 2}); err != nil {
		t.Fatal(err)
	}
	// Equipping from the pack frees its cells, and the old pair takes its place.
	if err := Equip(p, "explorer_binoculars", false); err != nil {
		t.Fatal(err)
	}
	if len(p.Inventory) != 1 || p.Inventory[0] != (proto.ItemStack{Item: "basic_binoculars", Qty: 1, X: 3, Y: 2}) {
		t.Errorf("swap: %+v", p.Inventory)
	}
	// Unequipping needs room.
	q := NewProfile("t")
	fillPack(q, "seed_mix", 8)
	snap := snapshot(t, q)
	err := Unequip(q, SlotCamera)
	wantErr(t, err, ErrPackFull)
	if !strings.Contains(err.Error(), "Starter Camera") || snapshot(t, q) != snap {
		t.Errorf("full unequip: %v", err)
	}
	// One free 2x2 corner is enough.
	var kept []proto.ItemStack
	for _, st := range q.Inventory {
		if !(st.X >= 3 && st.Y >= 2) {
			kept = append(kept, st)
		}
	}
	q.Inventory = kept
	if err := Unequip(q, SlotCamera); err != nil || !PackGrid(q).Valid() {
		t.Errorf("unequip into the corner: %v", err)
	}
	// Equipping from storage only at the cabin.
	r := NewProfile("t")
	AddItem(r, "explorer_binoculars", 1)
	MoveItem(r, "explorer_binoculars", ToStorage)
	wantErr(t, Equip(r, "explorer_binoculars", false), ErrNotOwned)
	if err := Equip(r, "explorer_binoculars", true); err != nil || Stored(r, "basic_binoculars") != 1 || !StorageGrid(r).Valid() {
		t.Errorf("equip from storage: %v %+v", err, r.Storage)
	}
}

func TestBackpackSwapResizesTheGrid(t *testing.T) {
	p := NewProfile("t")
	p.Credits, p.Rank = 5000, 3
	Buy(p, "expedition_pack")
	if err := Equip(p, "expedition_pack", false); err != nil {
		t.Fatal(err)
	}
	if w, h := PackSize(p); w != 7 || h != 6 || Where(p, "canvas_satchel") != ToInventory {
		t.Fatalf("expedition pack: %dx%d %+v", w, h, p.Inventory)
	}
	// Things scattered to the far corner of the big pack: going back to the
	// satchel re-packs them rather than refusing.
	MoveItem(p, "canvas_satchel", ToStorage)
	for _, st := range []proto.ItemStack{{Item: "headphones", Qty: 1, X: 5, Y: 4}, {Item: "seed_mix", Qty: 3, X: 6, Y: 0}} {
		p.Inventory = append(p.Inventory, st)
	}
	Recompute(p)
	if err := Equip(p, "canvas_satchel", true); err != nil {
		t.Fatal(err)
	}
	if w, h := PackSize(p); w != 5 || h != 4 || !PackGrid(p).Valid() || Carried(p, "headphones") != 1 || Stored(p, "expedition_pack") != 1 {
		t.Errorf("back to the satchel: %dx%d %+v", w, h, p.Inventory)
	}
	// Unequipping the satchel itself: the base grid is the same size, the satchel
	// must find room in it too.
	if err := Unequip(p, SlotBackpack); err != nil || Carried(p, "canvas_satchel") != 1 {
		t.Errorf("unequip satchel: %v", err)
	}
}

func TestBackpackSwapRefusedWhenFull(t *testing.T) {
	p := NewProfile("t")
	p.Credits, p.Rank = 5000, 3
	Buy(p, "explorer_pack")
	Equip(p, "explorer_pack", false)
	fillPack(p, "nettle", 20) // 30 cells, the satchel holds 20
	snap := snapshot(t, p)
	err := Equip(p, "canvas_satchel", false)
	wantErr(t, err, ErrPackFull)
	if !strings.Contains(err.Error(), "5×4") || snapshot(t, p) != snap {
		t.Errorf("refusal: %v", err)
	}
	err = Unequip(p, SlotBackpack)
	wantErr(t, err, ErrPackFull)
	if snapshot(t, p) != snap {
		t.Error("refused unequip changed the profile")
	}
}

func TestMoveItemAutoPlaces(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "film_roll", 4)
	AddItem(p, "field_stool", 1)
	p.Storage = []proto.ItemStack{{Item: "film_roll", Qty: 5, X: 9, Y: 11}}
	if err := MoveItem(p, "film_roll", ToStorage); err != nil {
		t.Fatal(err)
	}
	// 1 roll tops up the stored stack, 3 go into a new stack at the first free cell.
	if Stored(p, "film_roll") != 9 || p.Storage[0].Qty != 6 || p.Storage[1].X != 0 || p.Storage[1].Y != 0 {
		t.Errorf("to storage: %+v", p.Storage)
	}
	if err := MoveItem(p, "field_stool", ToStorage); err != nil || !StorageGrid(p).Valid() {
		t.Errorf("stool: %v %+v", err, p.Storage)
	}
	fillPack(p, "seed_mix", 8)
	snap := snapshot(t, p)
	err := MoveItem(p, "field_stool", ToInventory)
	wantErr(t, err, ErrPackFull)
	if snapshot(t, p) != snap {
		t.Error("refused move changed the profile")
	}
	// Storage full.
	s := NewProfile("t")
	AddItem(s, "headphones", 1)
	for y := 0; y < StorageH; y++ {
		for x := 0; x < StorageW; x++ {
			s.Storage = append(s.Storage, proto.ItemStack{Item: "nettle", Qty: 20, X: x, Y: y})
		}
	}
	err = MoveItem(s, "headphones", ToStorage)
	wantErr(t, err, ErrPackFull)
	if !strings.Contains(err.Error(), "storage is full") {
		t.Errorf("storage full: %v", err)
	}
}

func TestBuyNeedsRoomAndSaysWhy(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 1000
	AddItem(p, "field_stool", 1)  // 2x3 at 0,0
	AddItem(p, "headphones", 1)   // 2x2 at 2,0
	AddItem(p, "pocket_guide", 1) // 1x2 at 4,0
	fillPack(p, "seed_mix", 8)
	// Free two seed cells side by side: a 2x2 still has no room.
	p.Inventory = removeAt(p.Inventory, PackGrid(p).At(2, 3))
	Recompute(p)
	snap := snapshot(t, p)
	err := Buy(p, "explorer_binoculars")
	wantErr(t, err, ErrPackFull)
	if snapshot(t, p) != snap || !strings.Contains(err.Error(), "Explorer Binoculars") {
		t.Errorf("refusal %v", err)
	}
	// A film roll fits in the hole.
	if err := Buy(p, "film_roll"); err != nil {
		t.Errorf("film into the hole: %v", err)
	}
	if !strings.Contains(err.Error(), "Taking out the Field Headphones") {
		t.Errorf("hint: %v", err)
	}
}

func TestPackFullHint(t *testing.T) {
	p := NewProfile("t")
	// Scattered singles: a 2x2 fits nowhere, but tidying makes room.
	p.Inventory = []proto.ItemStack{
		{Item: "seed_mix", Qty: 1, X: 1, Y: 0}, {Item: "seed_mix", Qty: 1, X: 3, Y: 0},
		{Item: "film_roll", Qty: 1, X: 1, Y: 2}, {Item: "film_roll", Qty: 1, X: 3, Y: 2},
		{Item: "nettle", Qty: 1, X: 0, Y: 1}, {Item: "nettle", Qty: 1, X: 2, Y: 1}, {Item: "nettle", Qty: 1, X: 4, Y: 1},
		{Item: "nettle", Qty: 1, X: 0, Y: 3}, {Item: "nettle", Qty: 1, X: 2, Y: 3}, {Item: "nettle", Qty: 1, X: 4, Y: 3},
	}
	Recompute(p)
	_, err := AddToPack(p, "headphones", 1)
	wantErr(t, err, ErrPackFull)
	if !strings.Contains(err.Error(), "Tidy") {
		t.Errorf("tidy hint: %v", err)
	}
	// Truly full: name the smallest thing that would make room.
	q := NewProfile("t")
	AddItem(q, "field_stool", 1)
	AddItem(q, "tripod", 1)
	fillPack(q, "seed_mix", 8)
	_, err = AddToPack(q, "headphones", 1)
	if err == nil || !strings.Contains(err.Error(), "Taking out the Folding Stool & Scrim") {
		t.Errorf("take-out hint: %v", err)
	}
}

func TestMigrationRepacksOldSaves(t *testing.T) {
	// A profile saved before the grid: stacks without positions, unlimited storage.
	old := `{"name":"Old","level":3,"rank":2,
		"inventory":[{"item":"headphones","qty":1},{"item":"field_stool","qty":1},{"item":"film_roll","qty":6},
			{"item":"film_roll","qty":2},{"item":"tripod","qty":1},{"item":"explorer_binoculars","qty":1},
			{"item":"pocket_guide","qty":1},{"item":"blackberry","qty":7}],
		"storage":[{"item":"oats","qty":45},{"item":"spotting_scope","qty":1}],
		"equipped":{"optics":"basic_binoculars","camera":"starter_camera","backpack":"canvas_satchel"}}`
	var p proto.Profile
	if err := json.Unmarshal([]byte(old), &p); err != nil {
		t.Fatal(err)
	}
	total := counts(p.Inventory, p.Storage)
	Normalize(&p)
	if !PackGrid(&p).Valid() || !StorageGrid(&p).Valid() {
		t.Fatalf("grids invalid after migration:\n%+v\n%+v", p.Inventory, p.Storage)
	}
	if !sameCounts(total, counts(p.Inventory, p.Storage)) {
		t.Fatalf("migration lost or made items: %v -> %v", total, counts(p.Inventory, p.Storage))
	}
	for _, st := range p.Storage {
		if st.Qty > StackLimit(&p, st.Item, ToStorage) {
			t.Errorf("storage stack over its limit: %+v", st)
		}
	}
	// 4 + 6 + 1 + 1 + 4 + 4 + 2 + 1 = 23 cells of gear and stacks: something had
	// to go to storage, and the pack is used well.
	if len(p.Storage) <= 4 || FreeSlots(&p) > 3 {
		t.Errorf("pack %+v\nstorage %+v", p.Inventory, p.Storage)
	}
	// A save already in grid form is left alone.
	snap := snapshot(t, &p)
	Normalize(&p)
	if snapshot(t, &p) != snap {
		t.Error("normalising a migrated profile changed it")
	}
	// A storage chest overflowing on migration grows rows rather than losing things.
	var q proto.Profile
	var big []proto.ItemStack
	for _, it := range items {
		if !stackable(&it) {
			big = append(big, proto.ItemStack{Item: it.ID, Qty: 1})
		}
	}
	big = append(big, proto.ItemStack{Item: "oats", Qty: 2000})
	q.Storage = big
	total = counts(q.Storage)
	Normalize(&q)
	if !sameCounts(total, counts(q.Storage)) || !StorageGrid(&q).Valid() {
		t.Errorf("overfull storage lost things")
	}
	if _, h := StorageSize(&q); h <= StorageH {
		t.Errorf("overflow rows expected, h=%d", h)
	}
}

func TestNewProfileAndRewardsOverflow(t *testing.T) {
	p := NewProfile("t")
	if len(p.Inventory) != 0 || len(p.Storage) != 0 || p.Stats.PackW != 5 || p.Stats.PackH != 4 {
		t.Fatalf("new profile: %+v", p)
	}
	fillPack(p, "seed_mix", 8)
	levels, got := ApplyReward(p, proto.Reward{Items: []string{"spotting_scope", "explorers_lens"}})
	_ = levels
	if len(got) != 2 || Stored(p, "spotting_scope") != 1 || Stored(p, "explorers_lens") != 1 || !StorageGrid(p).Valid() {
		t.Errorf("rewards should overflow to storage: %v %+v", got, p.Storage)
	}
}

// TestBalanceStartingSatchel: the tutorial kit fits the satchel with room to spare,
// but a collector soon has to choose (spec §9.3).
func TestBalanceStartingSatchel(t *testing.T) {
	p := NewProfile("t")
	if _, err := AddItem(p, "basic_recorder", 1); err != nil {
		t.Fatal(err)
	}
	if err := Equip(p, "basic_recorder", false); err != nil {
		t.Fatal(err)
	}
	tutorial := []proto.ItemStack{
		{Item: "film_roll", Qty: 1}, {Item: "seed_mix", Qty: 3},
		{Item: "blackberry", Qty: 6}, {Item: "nettle", Qty: 4}, {Item: "pine_tips", Qty: 5},
		{Item: "water_mint", Qty: 3}, {Item: "hazelnut", Qty: 8},
		{Item: "headphones", Qty: 1}, {Item: "pocket_guide", Qty: 1},
	}
	for _, st := range tutorial {
		if stored, err := AddItem(p, st.Item, st.Qty); err != nil || stored != 0 {
			t.Fatalf("tutorial kit should fit: %s stored %d %v", st.Item, stored, err)
		}
	}
	t.Logf("tutorial kit: %d of %d cells used", PackGrid(p).UsedCells(), Capacity(p))
	if FreeSlots(p) < 4 {
		t.Errorf("tutorial kit leaves only %d cells", FreeSlots(p))
	}
	// A keen collector: stool, tripod, a spare pair of binoculars and a lens.
	overflow := 0
	for _, id := range []string{"field_stool", "tripod", "explorer_binoculars", "pocket_barometer"} {
		if stored, _ := AddItem(p, id, 1); stored > 0 {
			overflow++
		}
	}
	if overflow == 0 {
		t.Error("the satchel should not hold a collector's whole kit")
	}
	// Total gear vs the cabin: report it.
	cells := 0
	var gear []string
	for _, it := range items {
		if !stackable(&it) {
			cells += it.W * it.H
			gear = append(gear, it.ID)
		}
	}
	sort.Strings(gear)
	t.Logf("all %d pieces of gear take %d cells; storage has %d, the satchel %d", len(gear), cells, StorageW*StorageH, 20)
}

func TestTidyFallbackKeepsAValidLayout(t *testing.T) {
	g := NewGrid(5, 4, []proto.ItemStack{
		{Item: "seed_mix", Qty: 3, X: 4, Y: 0}, {Item: "headphones", Qty: 1, X: 3, Y: 2},
		{Item: "seed_mix", Qty: 7, X: 0, Y: 3}, {Item: "tripod", Qty: 1, X: 0, Y: 2, R: true},
	})
	g.Stacks[3].Y = 1 // tripod lying across row 1
	if !g.Valid() {
		t.Fatalf("setup %+v", g.Stacks)
	}
	before := counts(g.Stacks)
	g.mergeInPlace()
	settle(g)
	if !g.Valid() || !sameCounts(before, counts(g.Stacks)) || len(g.Stacks) != 4 || g.Stacks[0].Qty != 8 {
		t.Fatalf("fallback: %+v", g.Stacks)
	}
	if g.Stacks[3].Y != 0 || g.Stacks[0].X != 0 {
		t.Errorf("the tripod should slide to the top: %+v", g.Stacks)
	}
}
