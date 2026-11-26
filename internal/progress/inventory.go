package progress

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Inventory model (contract §3.4):
//   - Profile.Inventory is the backpack. Each entry is one slot; Stats.Capacity
//     limits the number of entries. Supplies stack up to ItemDef.Stack per slot;
//     everything else is one item per slot and one of each per player.
//   - Profile.Equipped holds worn equipment (slot → item id). Equipped items are
//     NOT in the backpack and do not use capacity.
//   - Profile.Storage is the cabin chest: unlimited, one entry per item id.
//
// The invariant every function keeps: len(Inventory) <= Capacity.

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

func removeAt(stacks []proto.ItemStack, i int) []proto.ItemStack {
	return append(stacks[:i], stacks[i+1:]...)
}

// smallestStack is the index of the smallest stack of an item (-1 if none): taking
// from it first frees slots soonest.
func smallestStack(stacks []proto.ItemStack, id string) int {
	best := -1
	for i := range stacks {
		if stacks[i].Item == id && (best < 0 || stacks[i].Qty < stacks[best].Qty) {
			best = i
		}
	}
	return best
}

// packIn puts up to qty units into the backpack — topping up existing stacks, then
// opening new slots while capacity allows — and returns how many did not fit.
func packIn(p *proto.Profile, def *proto.ItemDef, qty, capacity int) (left int) {
	size := stackSize(def)
	if size > 1 {
		for i := range p.Inventory {
			if qty == 0 {
				break
			}
			if st := &p.Inventory[i]; st.Item == def.ID && st.Qty < size {
				n := min(qty, size-st.Qty)
				st.Qty += n
				qty -= n
			}
		}
	}
	for qty > 0 && len(p.Inventory) < capacity {
		n := min(qty, size)
		p.Inventory = append(p.Inventory, proto.ItemStack{Item: def.ID, Qty: n})
		qty -= n
	}
	return qty
}

// roomFor is how many units of an item the backpack can still take.
func roomFor(p *proto.Profile, def *proto.ItemDef, capacity int) int {
	size := stackSize(def)
	room := max(0, capacity-len(p.Inventory)) * size
	if size > 1 {
		for i := range p.Inventory {
			if p.Inventory[i].Item == def.ID {
				room += max(0, size-p.Inventory[i].Qty)
			}
		}
	}
	return room
}

func storeIn(p *proto.Profile, id string, qty int) {
	if qty <= 0 {
		return
	}
	if i := indexOfItem(p.Storage, id); i >= 0 {
		p.Storage[i].Qty += qty
		return
	}
	p.Storage = append(p.Storage, proto.ItemStack{Item: id, Qty: qty})
}

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
// goes into the backpack — supplies top up their stacks first — and whatever does
// not fit is sent to cabin storage, so nothing found is ever lost; stored reports
// how many units went there.
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
	if def.Kind != KindSupply {
		if Owned(p, itemID) {
			return 0, fail(ErrAlreadyOwned, "You already have the %s.", def.Name)
		}
		qty = 1
	}
	stored = packIn(p, def, qty, Capacity(p))
	storeIn(p, itemID, stored)
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

// RemoveItem takes qty units of an item out of the backpack (smallest stacks
// first). It fails, changing nothing, if the player carries fewer than that.
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
	for qty > 0 {
		i := smallestStack(p.Inventory, id)
		if i < 0 {
			return
		}
		n := min(qty, p.Inventory[i].Qty)
		p.Inventory[i].Qty -= n
		qty -= n
		if p.Inventory[i].Qty <= 0 {
			p.Inventory = removeAt(p.Inventory, i)
		}
	}
}

// Equip puts on a piece of equipment the player owns. It is taken from the
// backpack, or — only if allowStorage is true, i.e. the player is at the cabin —
// from cabin storage; the item previously in that slot takes its place there, so a
// swap never needs a free slot. Equipping what is already worn is a no-op.
//
// It fails if the new outfit would leave the backpack over capacity (swapping to a
// smaller pack, or to bulky gear that takes up pack slots, with a full bag).
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

	carried := len(p.Inventory)
	if !fromStorage && prev == "" {
		carried-- // the item leaves the pack and nothing comes back
	}
	if capacity := roundInt(StatsFor(p, equip).Capacity); carried > capacity {
		return fail(ErrPackFull, "With the %s you could carry %d things, and your pack holds %d. Lighten it first.",
			def.Name, capacity, carried)
	}

	switch {
	case fromStorage:
		p.Storage = removeAt(p.Storage, inStore)
		if prev != "" {
			storeIn(p, prev, 1)
		}
	case prev != "":
		p.Inventory[inPack] = proto.ItemStack{Item: prev, Qty: 1}
	default:
		p.Inventory = removeAt(p.Inventory, inPack)
	}
	p.Equipped = equip
	Recompute(p)
	return nil
}

// Unequip takes off the item in a slot and puts it in the backpack. It fails if the
// pack has no room for it — counting the room that is lost when the thing taken off
// is the backpack itself.
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
	if capacity := roundInt(StatsFor(p, equip).Capacity); len(p.Inventory)+1 > capacity {
		return fail(ErrPackFull, "There is no room in your pack for the %s.", itemName(id))
	}
	p.Inventory = append(p.Inventory, proto.ItemStack{Item: id, Qty: 1})
	p.Equipped = equip
	Recompute(p)
	return nil
}

// MoveItem moves an item between the backpack and cabin storage; to is ToStorage or
// ToInventory. One call moves one slot's worth: a piece of gear, or one stack of a
// supply (to storage: the smallest stack carried; to the backpack: up to a full
// stack, as much as fits). Carried gadgets stop working once stored, and the stats
// follow. Equipped items must be unequipped (or swapped with Equip) first.
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
		storeIn(p, itemID, p.Inventory[i].Qty)
		p.Inventory = removeAt(p.Inventory, i)
	case ToInventory:
		i := indexOfItem(p.Storage, itemID)
		if i < 0 {
			return fail(ErrNotOwned, "There is no %s in your storage.", def.Name)
		}
		want := min(p.Storage[i].Qty, stackSize(def))
		left := packIn(p, def, want, Capacity(p))
		if left == want {
			return fail(ErrPackFull, "Your pack is full. Leave something behind to take the %s.", def.Name)
		}
		p.Storage[i].Qty -= want - left
		if p.Storage[i].Qty <= 0 {
			p.Storage = removeAt(p.Storage, i)
		}
	default:
		return fail(ErrInvalid, "Items can be moved to your pack or to storage.")
	}
	Recompute(p)
	return nil
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
// one-of-a-kind); enough credits at the discounted price; room in the backpack.
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
	if def.Kind != KindSupply && Owned(p, itemID) {
		return fail(ErrAlreadyOwned, "You already own the %s.", def.Name)
	}
	if price := discounted(p, def.Price); p.Credits < price {
		return fail(ErrCredits, "The %s costs %d Field Credits (you have %d).", def.Name, price, p.Credits)
	}
	if roomFor(p, def, Capacity(p)) < 1 {
		return fail(ErrPackFull, "Your pack is full. Make room before buying the %s.", def.Name)
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
	packIn(p, def, 1, Capacity(p))
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
