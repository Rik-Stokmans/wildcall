package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// Photography wall sizes: the wall exists from the start (spec §21.1); the upgrade
// turns a corner of it into a gallery.
const (
	PinSlotsBase     = 4
	PinSlotsUpgraded = 12
)

// workshopRank is the rank at which the Equipment Workshop can be built; upgrades
// that need the workshop cannot honestly list a lower one.
const workshopRank = 2

// cabinUpgrades are the five home-base improvements (spec §21.2). Two of them have
// no stat modifiers because what they do is not a stat: the workshop gates
// UpgradeDef.ReqCabin, and the garden is a permanent feeder lure the session keeps
// alive at the cabin.
var cabinUpgrades = []proto.CabinUpgradeDef{
	{
		ID: CabinPhotoWall, Name: "Photography Wall",
		Desc:   "Cork, picture rail and a north-facing lamp along the cabin's long wall. Your best frames, where visitors can see them.",
		Effect: "Pin up to 12 photographs instead of 4. Work on show builds your name: +5% Field Credits from everything that pays.",
		Price:  150, ReqRank: 1, Mods: mods{"creditMult": 0.05}, Icon: "wall",
	},
	{
		ID: CabinGarden, Name: "Observation Garden",
		Desc:   "A feeder, a shallow bird bath and a bench by the porch, planted round with seed-heads and berries.",
		Effect: "Seed-eating birds visit the cabin all day, every day: a calm place to watch, sketch evidence and practise photography without leaving home.",
		Price:  140, ReqRank: 1, Mods: mods{}, Icon: "seed",
	},
	{
		ID: CabinWorkshop, Name: "Equipment Workshop",
		Desc:   "A bench, a vice, a jeweller's loupe and drawers of small screws under the window.",
		Effect: "Unlocks workshop-grade equipment upgrades: stabilising braces, focus motors, shutter dampers, pack dividers and more.",
		Price:  280, ReqRank: workshopRank, Mods: mods{}, Icon: "upgrade",
	},
	{
		ID: CabinAudioLab, Name: "Audio Laboratory",
		Desc:   "A quiet corner with a reference deck, proper monitors and a wall of labelled reels.",
		Effect: "Your recordings tell you more: +1 audio assistance (pitch and pattern evidence from recordings, sharper identification from sound) and +5% recording fidelity.",
		Price:  340, ReqRank: 2, Mods: mods{"audioAssist": 1, "recQuality": 0.05}, Icon: "recorder",
	},
	{
		ID: CabinMapRoom, Name: "Map Room",
		Desc:   "A plan chest, a great table map of the country and pins for everything you have found.",
		Effect: "Your map gains a level of detail (trails, then habitats), and hidden trails and secret places reveal from 6 m farther away.",
		Price:  360, ReqRank: 3, Mods: mods{"mapDetail": 1, "trailSense": 6}, Icon: "map",
	},
}

var cabinIndex = func() map[string]*proto.CabinUpgradeDef {
	idx := make(map[string]*proto.CabinUpgradeDef, len(cabinUpgrades))
	for i := range cabinUpgrades {
		idx[cabinUpgrades[i].ID] = &cabinUpgrades[i]
	}
	return idx
}()

// CabinUpgrades returns the five cabin upgrades in display order.
func CabinUpgrades() []proto.CabinUpgradeDef {
	out := make([]proto.CabinUpgradeDef, len(cabinUpgrades))
	for i, c := range cabinUpgrades {
		c.Mods = cloneMods(c.Mods)
		out[i] = c
	}
	return out
}

// CabinUpgrade looks up a cabin upgrade. Treat the result as read-only.
func CabinUpgrade(id string) (proto.CabinUpgradeDef, bool) {
	c := cabinIndex[id]
	if c == nil {
		return proto.CabinUpgradeDef{}, false
	}
	return *c, true
}

// HasCabin reports whether the player owns a cabin upgrade.
func HasCabin(p *proto.Profile, id string) bool { return containsString(p.Cabin, id) }

// PinSlots is how many photographs fit on the cabin's photography wall.
func PinSlots(p *proto.Profile) int {
	if HasCabin(p, CabinPhotoWall) {
		return PinSlotsUpgraded
	}
	return PinSlotsBase
}

// BuyCabinUpgrade buys a home-base improvement: it must exist, not be owned yet,
// the rank must be high enough and the credits must be there. Cabin upgrades are
// not Finn's to discount. (That the player is at the cabin is the session's check.)
func BuyCabinUpgrade(p *proto.Profile, id string) error {
	c := cabinIndex[id]
	if c == nil {
		return fail(ErrUnknown, "There is no such cabin upgrade.")
	}
	if HasCabin(p, id) {
		return fail(ErrAlreadyOwned, "The %s is already built.", c.Name)
	}
	if p.Rank < c.ReqRank {
		return fail(ErrRank, "The %s needs the rank of %s.", c.Name, RankTitle(c.ReqRank))
	}
	if p.Credits < c.Price {
		return fail(ErrCredits, "The %s costs %d Field Credits (you have %d).", c.Name, c.Price, p.Credits)
	}
	p.Credits -= c.Price
	p.Cabin = append(p.Cabin, id)
	Recompute(p)
	return nil
}
