// Package progress holds WILDCALL's RPG progression rules (spec §7–§10, §21.2, §22;
// contract §3.4): levels and XP with the anti-grind log, naturalist ranks, the five
// skill disciplines, the item catalog with its tradeoffs and upgrades, cabin
// upgrades, the derived core.Stats, inventory and shop rules, and reward payout.
//
// Everything is a pure function over *proto.Profile plus the authored catalogs in
// this package: no clocks, no randomness, no I/O. Functions that enforce a rule
// return a *RuleError (errors.Is-comparable against the Err… sentinels) whose text
// is a gentle, player-facing sentence, and they leave the profile untouched when
// they fail. Every function that changes something stats depend on calls Recompute,
// so Profile.Stats is always current after a call into this package.
//
// The single progression currency is core.Stats: skills, items, upgrades and cabin
// upgrades are additive modifier maps keyed by the JSON names of core.Stats fields.
// Adding a skill or an item is therefore one entry of data in the catalog files.
package progress

// Item kinds (proto.ItemDef.Kind).
const (
	KindEquipment = "equipment" // worn in a slot; mods apply while equipped
	KindGadget    = "gadget"    // works passively while carried in the backpack
	KindSupply    = "supply"    // consumable, stackable
	KindKeepsake  = "keepsake"  // story item; its mods apply while carried

	KindIngredient = "ingredient" // foraged or pantry, stackable; some are edible as they are
	KindFood       = "food"       // cooked, stackable; eaten for a timed Buff
)

// Buff slots (proto.BuffDef.Slot, proto.Buff.Slot): one active buff per slot, a new
// drink replacing the current drink and so on.
const (
	SlotDrink = "drink"
	SlotMeal  = "meal"
	SlotSnack = "snack"
)

var buffSlots = []string{SlotDrink, SlotMeal, SlotSnack}

// BuffSlots returns the three buff slots in display order.
func BuffSlots() []string { return append([]string(nil), buffSlots...) }

// Equipment slots (proto.ItemDef.Slot, keys of proto.Profile.Equipped).
const (
	SlotOptics     = "optics"
	SlotCamera     = "camera"
	SlotAudio      = "audio"
	SlotBackpack   = "backpack"
	SlotNavigation = "navigation"
	SlotClothing   = "clothing"
)

// slots lists the six equipment slots in display order.
var slots = []string{SlotOptics, SlotCamera, SlotAudio, SlotBackpack, SlotNavigation, SlotClothing}

// Slots returns the six equipment slots in display order.
func Slots() []string { return append([]string(nil), slots...) }

// Reputation factions (proto.NPCDef.Faction, keys of proto.Profile.Rep).
const (
	FactionNaturalists = "naturalists" // Mara
	FactionOutfitters  = "outfitters"  // Finn; gates ItemDef.ReqRep and earns shop discounts
	FactionResearch    = "research"    // Professor Alder
	FactionRangers     = "rangers"     // June
)

var factions = []string{FactionNaturalists, FactionOutfitters, FactionResearch, FactionRangers}

// Factions returns the four reputation tracks.
func Factions() []string { return append([]string(nil), factions...) }

// Supply actions (proto.ItemDef.Use).
const (
	UseFilm = "film" // load an extra roll: +FilmPerRoll shots this expedition
	UseSeed = "seed" // scatter seed: the session places a lure
	UseEat  = "eat"  // eat or drink it: Eat applies its Buff (needs the game clock, so not UseItem)
)

// Cabin upgrade ids (pinned by the contract).
const (
	CabinAudioLab  = "audio_lab"
	CabinPhotoWall = "photo_wall"
	CabinWorkshop  = "workshop"
	CabinMapRoom   = "map_room"
	CabinGarden    = "garden"
)

// Storage targets for MoveItem.
const (
	ToStorage   = "storage"
	ToInventory = "inventory"
)
