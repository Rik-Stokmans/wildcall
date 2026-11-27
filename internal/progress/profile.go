package progress

import (
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Unlock entry prefixes in proto.Reward.Unlock.
const (
	UnlockRegion  = "region:"  // "region:<region key>" → Profile.Regions
	UnlockQuest   = "quest:"   // "quest:<id>"   → Profile.Flags["unlock:quest:<id>"]
	UnlockFeature = "feature:" // "feature:<key>" → Profile.Flags["unlock:feature:<key>"]
	UnlockFlag    = "unlock:"  // prefix of the flags set for non-region unlocks
	// UnlockUpgrade fits an item upgrade for free: "upgrade:<item id>:<upgrade id>"
	// → Profile.Upgrades[item]. Already fitted, it is paid out as its price instead.
	UnlockUpgrade = "upgrade:"
)

// RewardUpgrade builds the Reward.Unlock entry that fits an item upgrade for free.
func RewardUpgrade(itemID, upgradeID string) string {
	return UnlockUpgrade + itemID + ":" + upgradeID
}

// ParseRewardUpgrade splits an "upgrade:<item>:<upgrade>" unlock entry.
func ParseRewardUpgrade(u string) (itemID, upgradeID string, ok bool) {
	rest, ok := strings.CutPrefix(u, UnlockUpgrade)
	if !ok {
		return "", "", false
	}
	itemID, upgradeID, ok = strings.Cut(rest, ":")
	return itemID, upgradeID, ok && itemID != "" && upgradeID != ""
}

// grantUpgrade fits a rewarded upgrade ("<item>:<upgrade>"). An upgrade that does
// not exist is ignored; one already fitted is paid out as its price, so a player
// who bought it before finishing the quest is not out of pocket.
func grantUpgrade(p *proto.Profile, key string) {
	item, upID, ok := ParseRewardUpgrade(UnlockUpgrade + key)
	if !ok {
		return
	}
	u, known := Upgrade(item, upID)
	if !known {
		return
	}
	if p.Upgrades == nil {
		p.Upgrades = map[string][]string{}
	}
	if containsString(p.Upgrades[item], upID) {
		p.Credits += u.Price
		return
	}
	p.Upgrades[item] = append(p.Upgrades[item], upID)
}

// NewProfile creates a brand-new naturalist: level 1, rank 1 (Beginner), 60 Field
// Credits, the starting kit equipped (no recorder yet — Mara provides it), an empty
// backpack, Greenhollow Woods unlocked, nothing explored, the three starting recipes
// of the field kitchen known, and every map and slice non-nil so the profile
// marshals without nulls.
func NewProfile(name string) *proto.Profile {
	p := &proto.Profile{
		Name:     strings.TrimSpace(name),
		Level:    1,
		Rank:     1,
		Credits:  StartingCredits,
		Equipped: StartingKit(),
		Regions:  []int{int(core.RegionGreenhollow)},
		Ledger:   []proto.LedgerEntry{{Day: 1, Amount: StartingCredits, Reason: "Starting funds"}},
	}
	Normalize(p)
	return p
}

// Normalize makes a profile safe to use and to send: nil maps and slices become
// empty ones, the four reputation tracks exist, level and rank are in range, the
// home region is unlocked, the field-kitchen fields are filled in (MigrateLarder:
// forage records, herbarium, recipes, buffs), the backpack and storage grids are
// made valid (RepairGrids), and everything derived is recomputed.
// Call it on a profile loaded from a save file. It never takes anything away from
// the player.
func Normalize(p *proto.Profile) {
	if p.Name == "" {
		p.Name = "Naturalist"
	}
	p.Level = min(max(p.Level, 1), MaxLevel)
	p.Rank = min(max(p.Rank, 1), MaxRank)
	if p.Skills == nil {
		p.Skills = map[string]int{}
	}
	if p.Ledger == nil {
		p.Ledger = []proto.LedgerEntry{}
	}
	if p.Rep == nil {
		p.Rep = map[string]int{}
	}
	for _, f := range factions {
		if _, ok := p.Rep[f]; !ok {
			p.Rep[f] = 0
		}
	}
	if p.Inventory == nil {
		p.Inventory = []proto.ItemStack{}
	}
	if p.Storage == nil {
		p.Storage = []proto.ItemStack{}
	}
	if p.Equipped == nil {
		p.Equipped = map[string]string{}
	}
	if p.Upgrades == nil {
		p.Upgrades = map[string][]string{}
	}
	if p.Cabin == nil {
		p.Cabin = []string{}
	}
	if p.Regions == nil {
		p.Regions = []int{}
	}
	UnlockRegionID(p, core.RegionGreenhollow)
	if p.Explored == nil {
		p.Explored = map[string][]byte{}
	}
	if p.Trails == nil {
		p.Trails = []string{}
	}
	if p.Quests == nil {
		p.Quests = map[string]*proto.QuestState{}
	}
	if p.Flags == nil {
		p.Flags = map[string]bool{}
	}
	if p.XPLog == nil {
		p.XPLog = map[string]int{}
	}

	j := &p.Journal
	if j.Species == nil {
		j.Species = map[string]*proto.SpeciesEntry{}
	}
	if j.Mysteries == nil {
		j.Mysteries = []*proto.Mystery{}
	}
	if j.Photos == nil {
		j.Photos = []*proto.PhotoMeta{}
	}
	if j.Recordings == nil {
		j.Recordings = []*proto.RecMeta{}
	}
	if j.Observations == nil {
		j.Observations = []*proto.Observation{}
	}
	if j.Locations == nil {
		j.Locations = map[string]*proto.LocEntry{}
	}
	if j.Lore == nil {
		j.Lore = []string{}
	}
	if j.Rare == nil {
		j.Rare = []*proto.RareDiscovery{}
	}
	if j.Collectibles == nil {
		j.Collectibles = map[string]int{}
	}
	if j.Pinned == nil {
		j.Pinned = []string{}
	}
	if j.Badges == nil {
		j.Badges = []string{}
	}

	MigrateLarder(p)

	Recompute(p)
	// Grid inventory: saves from before it have every stack at 0,0 (and unlimited
	// storage stacks). Re-pack them; what no longer fits the pack goes to storage.
	if RepairGrids(p) {
		Recompute(p)
	}
	if p.Film.Used < 0 {
		p.Film.Used = 0
	}
}

// UnlockRegionID adds a region type to Profile.Regions; false if it was already
// there (or is not a real region).
func UnlockRegionID(p *proto.Profile, r core.RegionID) bool {
	if r >= core.RegionCount {
		return false
	}
	for _, have := range p.Regions {
		if have == int(r) {
			return false
		}
	}
	p.Regions = append(p.Regions, int(r))
	return true
}

// RegionUnlocked reports whether the player may enter a region type.
func RegionUnlocked(p *proto.Profile, r core.RegionID) bool {
	for _, have := range p.Regions {
		if have == int(r) {
			return true
		}
	}
	return false
}

// ApplyReward pays out a quest, contract or discovery reward:
//
//   - Rep is added per faction.
//   - SkillPoints are added.
//   - Unlock entries: "region:<key>" adds the region to Profile.Regions (unknown
//     keys are ignored); "upgrade:<item>:<upgrade>" fits that item upgrade for free
//     (or pays its price if it is already fitted); every other entry — "quest:<id>", "feature:<key>" — sets
//     Profile.Flags["unlock:<entry>"].
//   - Lore ids are appended to Journal.Lore and Badge to Journal.Badges (no
//     duplicates).
//   - Credits are multiplied by Stats.CreditMult.
//   - Items: one unit per entry, into the backpack, overflowing to cabin storage.
//     A one-of-a-kind item the player already owns is paid out as its shop price in
//     credits instead; unknown ids are skipped. newItems lists the ids actually
//     received, in order (nil if none).
//   - XP is multiplied by Stats.XPMult; levels is the number of levels gained.
//
// It does not check ranks (CheckRank needs facts) and has no anti-grind log of its
// own: paying a reward once is the caller's rule (quests are turned in once).
func ApplyReward(p *proto.Profile, r proto.Reward) (levels int, newItems []string) {
	factionsSorted := make([]string, 0, len(r.Rep))
	for f := range r.Rep {
		factionsSorted = append(factionsSorted, f)
	}
	sort.Strings(factionsSorted)
	for _, f := range factionsSorted {
		AddRep(p, f, r.Rep[f])
	}

	if r.SkillPoints > 0 {
		p.SkillPoints += r.SkillPoints
	}

	for _, u := range r.Unlock {
		if key, ok := strings.CutPrefix(u, UnlockUpgrade); ok {
			grantUpgrade(p, key)
			continue
		}
		if key, ok := strings.CutPrefix(u, UnlockRegion); ok {
			if id, known := core.RegionFromKey(key); known {
				UnlockRegionID(p, id)
			}
			continue
		}
		if u == "" {
			continue
		}
		if p.Flags == nil {
			p.Flags = make(map[string]bool)
		}
		p.Flags[UnlockFlag+u] = true
	}

	for _, id := range r.Lore {
		if id != "" && !containsString(p.Journal.Lore, id) {
			p.Journal.Lore = append(p.Journal.Lore, id)
		}
	}
	if r.Badge != "" && !containsString(p.Journal.Badges, r.Badge) {
		p.Journal.Badges = append(p.Journal.Badges, r.Badge)
	}

	// Stats first: reputation and rank perks may have moved the multipliers.
	Recompute(p)
	GrantCredits(p, r.Credits)

	for _, id := range r.Items {
		def := itemIndex[id]
		if def == nil {
			continue
		}
		if _, err := AddItem(p, id, 1); err != nil {
			// Already owned: the gift becomes its worth, so a player who bought the
			// item before finishing the quest is not out of pocket.
			p.Credits += def.Price
			continue
		}
		newItems = append(newItems, id)
	}

	levels = GrantXP(p, ScaleXP(p, r.XP))
	Recompute(p)
	return levels, newItems
}
