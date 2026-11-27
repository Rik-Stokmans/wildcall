package progress

import (
	"fmt"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Inventory model (contract §3.4, grid inventory):
//   - Profile.Inventory is the backpack: a grid of Stats.PackW x Stats.PackH cells
//     (the worn backpack sets the size). Every stack lies at (X, Y), turned if R,
//     and covers the item's footprint (ItemDef.W x H cells); stacks never overlap
//     or leave the grid (grid.go has the placement rules).
//   - Supplies, ingredients and food stack up to their stack limit per stack (a
//     little more in the backpack with the Research Backpack); everything else is
//     one item per stack and one of each per player.
//   - Profile.Equipped holds worn equipment (slot → item id). Equipped items are
//     NOT in any grid and take no room.
//   - Profile.Storage is the cabin chest: a StorageW x StorageH grid.
//
// The invariant every function keeps: both grids are valid (Grid.Valid). Every
// refusal is a RuleError and changes nothing.

// homeTrails are the home valley's hidden trails (contract §2.2). The Forgotten
// Field Journal's sketch maps reveal them: AddItem appends them to Profile.Trails
// when the journal is obtained.
var homeTrails = []string{"secret_pond", "secret_cabin", "secret_lookout", "secret_camp"}

// JournalTrails returns the hidden trail ids the Forgotten Field Journal reveals.
func JournalTrails() []string { return append([]string(nil), homeTrails...) }

func stackSize(def *proto.ItemDef) int {
	if def.Stack > 0 {
		return def.Stack
	}
	return 1
}

func indexOfItem(stacks []proto.ItemStack, id string) int {
	for i := range stacks {
		if stacks[i].Item == id {
			return i
		}
	}
	return -1
}

func countItem(stacks []proto.ItemStack, id string) int {
	n := 0
	for i := range stacks {
		if stacks[i].Item == id {
			n += stacks[i].Qty
		}
	}
	return n
}

// removeAt removes element i, in place (the caller owns the slice).
func removeAt(stacks []proto.ItemStack, i int) []proto.ItemStack {
	return append(stacks[:i], stacks[i+1:]...)
}

// smallestStack is the index of the smallest stack of an item (-1 if none): taking
// from it first frees cells soonest.
func smallestStack(stacks []proto.ItemStack, id string) int {
	best := -1
	for i := range stacks {
		if stacks[i].Item == id && (best < 0 || stacks[i].Qty < stacks[best].Qty) {
			best = i
		}
	}
	return best
}

// ---------------------------------------------------------------------------
// The grids of a profile

// packStackBonus is the organisation perk of a backpack: stacks in it hold this
// fraction more (rounded up).
var packStackBonus = map[string]float64{"research_backpack": 0.5}

func packDims(s core.Stats) (w, h int) {
	return max(1, roundInt(s.PackW)), max(1, roundInt(s.PackH))
}

// PackSize is the backpack grid, in cells.
func PackSize(p *proto.Profile) (w, h int) { return packDims(p.Stats) }

// StorageSize is the cabin storage grid, in cells: StorageW x StorageH, taller only
// while something lies in overflow rows below (see StorageH).
func StorageSize(p *proto.Profile) (w, h int) {
	return StorageW, max(StorageH, Bottom(p.Storage))
}

func packLimit(equip map[string]string) func(*proto.ItemDef) int {
	bonus := packStackBonus[equip[SlotBackpack]]
	return func(def *proto.ItemDef) int {
		n := stackSize(def)
		if n > 1 && bonus > 0 {
			n += int(math.Ceil(float64(n) * bonus))
		}
		return n
	}
}

// StackLimit is the most units of an item one stack may hold in a grid (where:
// ToInventory or ToStorage), 0 for an unknown item.
func StackLimit(p *proto.Profile, itemID, where string) int {
	def := itemIndex[itemID]
	if def == nil {
		return 0
	}
	if where == ToInventory {
		return packLimit(p.Equipped)(def)
	}
	return stackSize(def)
}

// PackGrid returns a Grid over a copy of the backpack.
func PackGrid(p *proto.Profile) *Grid {
	w, h := PackSize(p)
	g := NewGrid(w, h, p.Inventory)
	g.Limit = packLimit(p.Equipped)
	return g
}

// StorageGrid returns a Grid over a copy of cabin storage.
func StorageGrid(p *proto.Profile) *Grid {
	w, h := StorageSize(p)
	return NewGrid(w, h, p.Storage)
}

func gridOf(p *proto.Profile, where string) (*Grid, error) {
	switch where {
	case ToInventory:
		return PackGrid(p), nil
	case ToStorage:
		return StorageGrid(p), nil
	}
	return nil, fail(ErrInvalid, "Items can be moved to your pack or to storage.")
}

func setGrid(p *proto.Profile, where string, g *Grid) {
	if where == ToInventory {
		p.Inventory = g.Stacks
	} else {
		p.Storage = g.Stacks
	}
}

// storeForce puts qty units into cabin storage, merging and placing as usual, and —
// only if the chest is truly full — in overflow rows below it, so nothing given to
// the player is ever lost.
func storeForce(p *proto.Profile, id string, qty int) {
	if qty <= 0 {
		return
	}
	g := StorageGrid(p)
	left := g.Add(id, qty)
	lim := g.limitOf(id)
	for left > 0 {
		n := min(left, lim)
		g.Stacks = append(g.Stacks, proto.ItemStack{Item: id, Qty: n, X: 0, Y: max(StorageH, Bottom(g.Stacks))})
		left -= n
	}
	p.Storage = g.Stacks
}

// roomHint says what would make room in a grid for one more of an item: tidying,
// or taking out one particular thing (the smallest that would do).
func roomHint(g *Grid, def *proto.ItemDef) string {
	t := g.clone()
	if _, ok := layout(t.W, t.H, append(t.merged(), proto.ItemStack{Item: def.ID, Qty: 1}), false); ok {
		return "Tidy your pack and it will fit."
	}
	best, bestArea := -1, 0
	for i, st := range g.Stacks {
		w, h := Footprint(st.Item, false)
		if best >= 0 && w*h >= bestArea {
			continue
		}
		c := g.clone()
		c.Stacks = removeAt(c.Stacks, i)
		if c.Room(def.ID, 1) == 0 {
			if _, ok := layout(c.W, c.H, append(c.merged(), proto.ItemStack{Item: def.ID, Qty: 1}), false); !ok {
				continue
			}
		}
		best, bestArea = i, w*h
	}
	if best >= 0 {
		return fmt.Sprintf("Taking out the %s would make room.", itemName(g.Stacks[best].Item))
	}
	return "Leave something behind to make room."
}

func packFull(g *Grid, def *proto.ItemDef) error {
	return fail(ErrPackFull, "Your pack is full: no room for the %s. %s", def.Name, roomHint(g, def))
}

// fitPack lays a backpack out in a w x h grid together with extra stacks: the
// current layout is kept when it still fits (the extras go at (px, py) if they can,
// else wherever FindSpace finds room); otherwise everything is tidied into the new
// size. ok is false if it cannot be done at all.
func fitPack(stacks []proto.ItemStack, w, h int, limit func(*proto.ItemDef) int, extras []proto.ItemStack, px, py int) ([]proto.ItemStack, bool) {
	g := &Grid{W: w, H: h, Stacks: append([]proto.ItemStack{}, stacks...), Limit: limit}
	if g.Valid() {
		ok := true
		for _, e := range extras {
			if !g.PlaceStack(e, px, py, false) && !g.PlaceStack(e, px, py, true) && !g.PlaceAnywhere(e) {
				ok = false
				break
			}
		}
		if ok {
			return g.Stacks, true
		}
	}
	all := &Grid{W: w, H: h, Stacks: append(append([]proto.ItemStack{}, stacks...), extras...), Limit: limit}
	return layout(w, h, all.merged(), true)
}

// FreeSlots is how many cells of the backpack are empty.
func FreeSlots(p *proto.Profile) int { return PackGrid(p).FreeCells() }

// Capacity is the number of cells in the backpack grid (PackW x PackH).
func Capacity(p *proto.Profile) int {
	w, h := PackSize(p)
	return w * h
}

// ---------------------------------------------------------------------------
// Owning things

func equippedSlot(p *proto.Profile, id string) string {
	for _, slot := range slots {
		if p.Equipped[slot] == id {
			return slot
		}
	}
	return ""
}

// Where reports where the player keeps an item: "equipped", "inventory", "storage"
// or "" if they do not own it (checked in that order).
func Where(p *proto.Profile, itemID string) string {
	switch {
	case itemID == "":
		return ""
	case equippedSlot(p, itemID) != "":
		return "equipped"
	case indexOfItem(p.Inventory, itemID) >= 0:
		return ToInventory
	case indexOfItem(p.Storage, itemID) >= 0:
		return ToStorage
	}
	return ""
}

// Owned reports whether the player has the item anywhere: worn, carried or stored.
func Owned(p *proto.Profile, itemID string) bool { return Where(p, itemID) != "" }

// Carried is the number of units of an item in the backpack.
func Carried(p *proto.Profile, itemID string) int { return countItem(p.Inventory, itemID) }

// Stored is the number of units of an item in cabin storage.
func Stored(p *proto.Profile, itemID string) int { return countItem(p.Storage, itemID) }

// AddItem gives the player qty units of an item (found, rewarded, handed over). It
// goes into the backpack — topping up stacks of the same item first, then new
// stacks wherever they fit (Grid.Add) — and whatever does not fit is sent to cabin
// storage, so nothing found is ever lost; stored reports how many units went there.
//
// Equipment, gadgets and keepsakes are one-of-a-kind: adding one the player already
// owns returns ErrAlreadyOwned and changes nothing (ApplyReward turns such a
// duplicate into credits). Obtaining the Forgotten Field Journal also reveals the
// home valley's hidden trails (JournalTrails) in Profile.Trails.
func AddItem(p *proto.Profile, itemID string, qty int) (stored int, err error) {
	def := itemIndex[itemID]
	if def == nil {
		return 0, fail(ErrUnknown, "There is no such item.")
	}
	if qty <= 0 {
		return 0, fail(ErrInvalid, "Nothing to add.")
	}
	if !stackable(def) {
		if Owned(p, itemID) {
			return 0, fail(ErrAlreadyOwned, "You already have the %s.", def.Name)
		}
		qty = 1
	}
	g := PackGrid(p)
	stored = g.Add(itemID, qty)
	p.Inventory = g.Stacks
	storeForce(p, itemID, stored)
	if itemID == "forgotten_journal" {
		for _, t := range homeTrails {
			if !containsString(p.Trails, t) {
				p.Trails = append(p.Trails, t)
			}
		}
	}
	Recompute(p)
	return stored, nil
}

// AddToPack puts up to qty units of an item into the backpack only (nothing goes to
// storage): added is how many went in. If not even one fits it returns ErrPackFull,
// saying what would make room, and changes nothing. One-of-a-kind items the player
// already owns are refused as in AddItem.
func AddToPack(p *proto.Profile, itemID string, qty int) (added int, err error) {
	def := itemIndex[itemID]
	if def == nil {
		return 0, fail(ErrUnknown, "There is no such item.")
	}
	if qty <= 0 {
		return 0, fail(ErrInvalid, "Nothing to add.")
	}
	if !stackable(def) {
		if Owned(p, itemID) {
			return 0, fail(ErrAlreadyOwned, "You already have the %s.", def.Name)
		}
		qty = 1
	}
	g := PackGrid(p)
	left := g.Add(itemID, qty)
	if left == qty {
		return 0, packFull(PackGrid(p), def)
	}
	p.Inventory = g.Stacks
	Recompute(p)
	return qty - left, nil
}

// RemoveItem takes qty units of an item out of the backpack (smallest stacks
// first; the other stacks stay where they lie). It fails, changing nothing, if the
// player carries fewer than that.
func RemoveItem(p *proto.Profile, itemID string, qty int) error {
	def := itemIndex[itemID]
	if def == nil {
		return fail(ErrUnknown, "There is no such item.")
	}
	if qty <= 0 {
		return fail(ErrInvalid, "Nothing to remove.")
	}
	if Carried(p, itemID) < qty {
		return fail(ErrNotOwned, "You are not carrying enough %s.", def.Name)
	}
	takeFromPack(p, itemID, qty)
	Recompute(p)
	return nil
}

func takeFromPack(p *proto.Profile, id string, qty int) {
	g := &Grid{Stacks: p.Inventory}
	g.Remove(id, qty)
	p.Inventory = g.Stacks
}

// ---------------------------------------------------------------------------
// Equipment

// Equip puts on a piece of equipment the player owns. It is taken from the
// backpack (freeing its cells), or — only if allowStorage is true, i.e. the player
// is at the cabin — from cabin storage; the item previously in that slot goes where
// the new one came from (into its old cells when it fits there). Equipping what is
// already worn is a no-op.
//
// A new backpack resizes the pack grid. The layout is kept if everything still
// fits; otherwise the pack is tidied into the new size, and if even that cannot
// hold it all the swap is refused (nothing is ever spilled).
func Equip(p *proto.Profile, itemID string, allowStorage bool) error {
	def := itemIndex[itemID]
	if def == nil {
		return fail(ErrUnknown, "There is no such item.")
	}
	if def.Kind != KindEquipment {
		return fail(ErrInvalid, "The %s is not something you wear: it works from your pack.", def.Name)
	}
	prev := p.Equipped[def.Slot]
	if prev == itemID {
		return nil
	}
	inPack := indexOfItem(p.Inventory, itemID)
	inStore := indexOfItem(p.Storage, itemID)
	fromStorage := false
	switch {
	case inPack >= 0:
	case inStore >= 0 && allowStorage:
		fromStorage = true
	case inStore >= 0:
		return fail(ErrNotOwned, "The %s is in your cabin storage.", def.Name)
	default:
		return fail(ErrNotOwned, "You do not have the %s.", def.Name)
	}

	equip := make(map[string]string, len(slots))
	for k, v := range p.Equipped {
		equip[k] = v
	}
	equip[def.Slot] = itemID
	nw, nh := packDims(StatsFor(p, equip))

	pack := append([]proto.ItemStack{}, p.Inventory...)
	store := append([]proto.ItemStack{}, p.Storage...)
	px, py := -1, -1
	if fromStorage {
		store = removeAt(store, inStore)
	} else {
		px, py = pack[inPack].X, pack[inPack].Y
		pack = removeAt(pack, inPack)
	}
	var extras []proto.ItemStack
	if prev != "" && !fromStorage {
		extras = append(extras, proto.ItemStack{Item: prev, Qty: 1})
	}
	newPack, ok := fitPack(pack, nw, nh, packLimit(equip), extras, px, py)
	if !ok {
		if def.Slot == SlotBackpack {
			return fail(ErrPackFull, "Your things will not all fit in the %s (%d×%d). Move some to storage first.", def.Name, nw, nh)
		}
		return fail(ErrPackFull, "There is no room in your pack for the %s you would take off.", itemName(prev))
	}
	p.Inventory = newPack
	p.Storage = store
	if fromStorage && prev != "" {
		storeForce(p, prev, 1)
	}
	p.Equipped = equip
	Recompute(p)
	return nil
}

// Unequip takes off the item in a slot and puts it in the backpack, wherever it
// fits. It fails if the pack has no room for it — counting the room lost when the
// thing taken off is the backpack itself (the pack is tidied if that makes it fit).
func Unequip(p *proto.Profile, slot string) error {
	if !containsString(slots, slot) {
		return fail(ErrUnknown, "There is no such equipment slot.")
	}
	id := p.Equipped[slot]
	if id == "" {
		return fail(ErrInvalid, "Nothing is equipped there.")
	}
	equip := make(map[string]string, len(slots))
	for k, v := range p.Equipped {
		if k != slot {
			equip[k] = v
		}
	}
	nw, nh := packDims(StatsFor(p, equip))
	newPack, ok := fitPack(p.Inventory, nw, nh, packLimit(equip), []proto.ItemStack{{Item: id, Qty: 1}}, -1, -1)
	if !ok {
		if slot == SlotBackpack {
			return fail(ErrPackFull, "Without the %s your things and the %s itself would not fit in %d×%d. Move some to storage first.", itemName(id), itemName(id), nw, nh)
		}
		return fail(ErrPackFull, "There is no room in your pack for the %s. Make some room first.", itemName(id))
	}
	p.Inventory = newPack
	p.Equipped = equip
	Recompute(p)
	return nil
}

// ---------------------------------------------------------------------------
// Moving between the pack and storage

// MoveItem moves an item between the backpack and cabin storage, placing it
// automatically; to is ToStorage or ToInventory. One call moves one stack: to
// storage, the smallest stack carried (merged onto stored stacks first, then into
// the first free spot); to the backpack, one stored stack, as much of it as fits.
// Carried gadgets stop working once stored, and the stats follow. Equipped items
// must be unequipped (or swapped with Equip) first. PlaceItem moves to a chosen
// cell instead.
//
// Storage is only reachable at the cabin; that is the session's check, not this
// function's.
func MoveItem(p *proto.Profile, itemID, to string) error {
	def := itemIndex[itemID]
	if def == nil {
		return fail(ErrUnknown, "There is no such item.")
	}
	switch to {
	case ToStorage:
		i := smallestStack(p.Inventory, itemID)
		if i < 0 {
			if equippedSlot(p, itemID) != "" {
				return fail(ErrInvalid, "Take the %s off before storing it.", def.Name)
			}
			return fail(ErrNotOwned, "You are not carrying the %s.", def.Name)
		}
		sg := StorageGrid(p)
		qty := p.Inventory[i].Qty
		left := sg.Add(itemID, qty)
		if left == qty {
			return fail(ErrPackFull, "Your cabin storage is full: no room for the %s. Tidy it or take something out first.", def.Name)
		}
		p.Storage = sg.Stacks
		inv := append([]proto.ItemStack{}, p.Inventory...)
		inv[i].Qty = left
		if left == 0 {
			inv = removeAt(inv, i)
		}
		p.Inventory = inv
	case ToInventory:
		i := smallestStack(p.Storage, itemID)
		if i < 0 {
			return fail(ErrNotOwned, "There is no %s in your storage.", def.Name)
		}
		pg := PackGrid(p)
		want := p.Storage[i].Qty
		left := pg.Add(itemID, want)
		if left == want {
			return packFull(PackGrid(p), def)
		}
		p.Inventory = pg.Stacks
		store := append([]proto.ItemStack{}, p.Storage...)
		store[i].Qty = left
		if left == 0 {
			store = removeAt(store, i)
		}
		p.Storage = store
	default:
		return fail(ErrInvalid, "Items can be moved to your pack or to storage.")
	}
	Recompute(p)
	return nil
}

// PlaceItem moves a stack to a chosen cell of the backpack or storage grid, turning
// or merging it (proto.PlaceItem; the rules are Place's). Storage is only reachable
// at the cabin; that is the session's check.
func PlaceItem(p *proto.Profile, m proto.PlaceItem) error {
	from, err := gridOf(p, m.From)
	if err != nil {
		return err
	}
	to := from
	if m.To != m.From {
		if to, err = gridOf(p, m.To); err != nil {
			return err
		}
	}
	if err := Place(from, to, m.FX, m.FY, m.X, m.Y, m.R); err != nil {
		return err
	}
	setGrid(p, m.From, from)
	setGrid(p, m.To, to)
	Recompute(p)
	return nil
}

// TidyGrid re-packs the backpack or storage (where: ToInventory | ToStorage):
// stacks merged, biggest things first, compact (Grid.Tidy).
func TidyGrid(p *proto.Profile, where string) error {
	g, err := gridOf(p, where)
	if err != nil {
		return err
	}
	if !g.Tidy() {
		return fail(ErrInvalid, "That could not be packed any tighter.")
	}
	setGrid(p, where, g)
	Recompute(p)
	return nil
}

// RepairGrids makes both grids valid (save migration: stacks from before the grid
// all lie at 0,0). An invalid backpack is tidied; whatever still does not fit goes
// to cabin storage. Invalid storage, or storage holding stacks above the stack
// limit (it used to be unlimited), is tidied too, overflowing into extra rows
// rather than losing anything. It reports whether anything changed; Normalize
// calls it.
func RepairGrids(p *proto.Profile) bool {
	changed := false
	if pg := PackGrid(p); !pg.Valid() {
		changed = true
		if pg.Tidy() {
			p.Inventory = pg.Stacks
		} else {
			fresh := &Grid{W: pg.W, H: pg.H, Limit: pg.Limit}
			var spill []proto.ItemStack
			for _, st := range pg.merged() {
				if !fresh.PlaceAnywhere(st) {
					spill = append(spill, st)
				}
			}
			p.Inventory = fresh.Stacks
			for _, st := range spill {
				storeForce(p, st.Item, st.Qty)
			}
		}
	}
	sg := StorageGrid(p)
	over := false
	for _, st := range sg.Stacks {
		if st.Qty > sg.limitOf(st.Item) {
			over = true
		}
	}
	if !sg.Valid() || over {
		changed = true
		if sg.Tidy() {
			p.Storage = sg.Stacks
		} else {
			merged := sg.merged()
			p.Storage = []proto.ItemStack{}
			for _, st := range merged {
				storeForce(p, st.Item, st.Qty)
			}
		}
	}
	if p.Inventory == nil {
		p.Inventory = []proto.ItemStack{}
	}
	if p.Storage == nil {
		p.Storage = []proto.ItemStack{}
	}
	return changed
}

// UseItem consumes one unit of a supply carried in the backpack and returns its
// action (ItemDef.Use). UseFilm is fully handled here: the roll adds FilmPerRoll
// frames to Film.Cap until the film is next developed. UseSeed only consumes the
// seed: the session places the lure where the player stands.
func UseItem(p *proto.Profile, itemID string) (use string, err error) {
	def := itemIndex[itemID]
	if def == nil {
		return "", fail(ErrUnknown, "There is no such item.")
	}
	if def.Use == "" {
		return "", fail(ErrInvalid, "The %s is not something you use up.", def.Name)
	}
	if def.Use == UseEat {
		// Eating needs the game clock for the buff's end: that is Eat's job.
		return "", fail(ErrInvalid, "The %s is for eating: use Eat.", def.Name)
	}
	if Carried(p, itemID) <= 0 {
		if Stored(p, itemID) > 0 {
			return "", fail(ErrNotOwned, "Your %s is in cabin storage.", def.Name)
		}
		return "", fail(ErrNotOwned, "You have no %s left.", def.Name)
	}
	takeFromPack(p, itemID, 1)
	if def.Use == UseFilm {
		p.Film.Cap += FilmPerRoll
	}
	Recompute(p)
	return def.Use, nil
}

// ---------------------------------------------------------------------------
// Film (contract §3.6)

// FilmLeft is the number of frames left on this expedition.
func FilmLeft(p *proto.Profile) int { return max(0, p.Film.Cap-p.Film.Used) }

// TakeFrame uses one frame of film; false means the roll is finished.
func TakeFrame(p *proto.Profile) bool {
	if FilmLeft(p) <= 0 {
		return false
	}
	p.Film.Used++
	return true
}

// DevelopFilm empties the camera at the cabin: Film.Used returns to 0, Film.Cap to
// Stats.FilmCap (extra rolls loaded in the field are used up). It returns how many
// photographs were developed.
func DevelopFilm(p *proto.Profile) (developed int) {
	developed = p.Film.Used
	p.Film.Used = 0
	p.Film.Cap = roundInt(p.Stats.FilmCap)
	return developed
}

// ---------------------------------------------------------------------------
// Shop (spec §22.3, screen 10)

func discounted(p *proto.Profile, price int) int {
	if price <= 0 {
		return 0
	}
	d := float64(p.Stats.Discount)
	d = math.Min(math.Max(d, 0), 0.5)
	return max(1, int(math.Round(float64(price)*(1-d))))
}

// PriceFor is what Finn charges this player for an item: the list price less
// Stats.Discount. 0 means the item is not for sale (or does not exist).
func PriceFor(p *proto.Profile, itemID string) int {
	def := itemIndex[itemID]
	if def == nil {
		return 0
	}
	return discounted(p, def.Price)
}

// UpgradePriceFor is what an item upgrade costs this player (Stats.Discount applies).
func UpgradePriceFor(p *proto.Profile, itemID, upgradeID string) int {
	u := findUpgrade(itemIndex[itemID], upgradeID)
	if u == nil {
		return 0
	}
	return discounted(p, u.Price)
}

// CanBuy reports why the player cannot buy an item from Finn right now, or nil.
// Checked in this order: the item exists and is stocked; naturalist rank;
// reputation with the outfitters (ItemDef.ReqRep); not already owned (gear is
// one-of-a-kind); enough credits at the discounted price; room in the backpack
// grid as it is packed now (the refusal says what would make room).
// It changes nothing.
func CanBuy(p *proto.Profile, itemID string) error {
	def := itemIndex[itemID]
	if def == nil {
		return fail(ErrUnknown, "There is no such item.")
	}
	if def.Price <= 0 {
		return fail(ErrNotForSale, "The %s is not something money can buy.", def.Name)
	}
	if p.Rank < def.ReqRank {
		return fail(ErrRank, "Finn keeps the %s for naturalists of %s rank.", def.Name, RankTitle(def.ReqRank))
	}
	if rep := p.Rep[FactionOutfitters]; rep < def.ReqRep {
		return fail(ErrReputation, "Finn only sells the %s to customers he knows well (reputation %d of %d).", def.Name, rep, def.ReqRep)
	}
	if !stackable(def) && Owned(p, itemID) {
		return fail(ErrAlreadyOwned, "You already own the %s.", def.Name)
	}
	if price := discounted(p, def.Price); p.Credits < price {
		return fail(ErrCredits, "The %s costs %d Field Credits (you have %d).", def.Name, price, p.Credits)
	}
	if g := PackGrid(p); g.Room(itemID, 1) < 1 {
		return packFull(g, def)
	}
	return nil
}

// Buy buys one unit of an item from Finn into the backpack (see CanBuy for the
// rules). On failure the profile is unchanged.
func Buy(p *proto.Profile, itemID string) error {
	if err := CanBuy(p, itemID); err != nil {
		return err
	}
	def := itemIndex[itemID]
	p.Credits -= discounted(p, def.Price)
	g := PackGrid(p)
	g.Add(itemID, 1)
	p.Inventory = g.Stacks
	Recompute(p)
	return nil
}

// CanBuyUpgrade reports why an item upgrade cannot be bought right now, or nil.
// Checked in this order: item and upgrade exist; the player owns the item (worn,
// carried or stored); not already fitted; naturalist rank; the cabin upgrade it
// needs (UpgradeDef.ReqCabin, e.g. the workshop); credits at the discounted price.
func CanBuyUpgrade(p *proto.Profile, itemID, upgradeID string) error {
	def := itemIndex[itemID]
	if def == nil {
		return fail(ErrUnknown, "There is no such item.")
	}
	u := findUpgrade(def, upgradeID)
	if u == nil {
		return fail(ErrUnknown, "The %s has no such upgrade.", def.Name)
	}
	if !Owned(p, itemID) {
		return fail(ErrNotOwned, "You do not own the %s.", def.Name)
	}
	if containsString(p.Upgrades[itemID], upgradeID) {
		return fail(ErrAlreadyOwned, "The %s already has the %s.", def.Name, u.Name)
	}
	if p.Rank < u.ReqRank {
		return fail(ErrRank, "The %s needs the rank of %s.", u.Name, RankTitle(u.ReqRank))
	}
	if u.ReqCabin != "" && !HasCabin(p, u.ReqCabin) {
		return fail(ErrRequirement, "The %s needs the %s at your cabin.", u.Name, cabinName(u.ReqCabin))
	}
	if price := discounted(p, u.Price); p.Credits < price {
		return fail(ErrCredits, "The %s costs %d Field Credits (you have %d).", u.Name, price, p.Credits)
	}
	return nil
}

// BuyUpgrade fits an upgrade to an item the player owns (see CanBuyUpgrade). The
// upgrade stays with the item for good; its mods count whenever the item's do.
func BuyUpgrade(p *proto.Profile, itemID, upgradeID string) error {
	if err := CanBuyUpgrade(p, itemID, upgradeID); err != nil {
		return err
	}
	u := findUpgrade(itemIndex[itemID], upgradeID)
	p.Credits -= discounted(p, u.Price)
	if p.Upgrades == nil {
		p.Upgrades = make(map[string][]string)
	}
	p.Upgrades[itemID] = append(p.Upgrades[itemID], upgradeID)
	Recompute(p)
	return nil
}

func itemName(id string) string {
	if d := itemIndex[id]; d != nil {
		return d.Name
	}
	return id
}

func cabinName(id string) string {
	if c := cabinIndex[id]; c != nil {
		return c.Name
	}
	return id
}
