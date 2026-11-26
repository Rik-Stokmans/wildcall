package progress

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// iconVocabulary is the pinned icon set of web/js/ui/kit.js. Unknown names render
// as a neutral dot on the client, so a typo here would be silent: Validate checks.
var iconVocabulary = toSet(strings.Fields(`
	binoculars camera recorder microphone headphones backpack compass map clothing lens journal film seed
	acoustics observation photography knowledge fieldcraft
	xp level rank skillpoint credits reputation star lock check quest badge
	bird feather leaf tree footprint nest egg pond mountain wave snow
	sunny cloudy rain wind mist moon dawn
	close back forward up down plus minus search filter sort pin play pause stop
	eye ear note info warning home shop upgrade storage desk wall settings
	cabin tower station camp viewpoint hide landmark npc page relic cache gate`))

var (
	itemKinds   = toSet([]string{KindEquipment, KindGadget, KindSupply, KindKeepsake})
	itemSources = toSet([]string{"start", "shop", "quest", "loot", "research"})
	itemUses    = toSet([]string{UseFilm, UseSeed})
	// The contract's skill ids, discipline by discipline in the spec's order.
	pinnedSkills = map[string][]string{
		DiscAcoustics:   {"keen_ears", "sound_direction", "acoustic_memory", "frequency_awareness", "deep_listening", "echo_reading", "natural_recognition"},
		DiscObservation: {"sharp_eyes", "movement_recognition", "patience", "habitat_reading", "peripheral_awareness", "tracking", "natural_instinct"},
		DiscPhotography: {"steady_hands", "quick_shot", "focus_control", "silent_shutter", "wildlife_composition", "long_lens_mastery", "perfect_moment"},
		DiscKnowledge:   {"field_experience", "species_recognition", "habitat_knowledge", "seasonal_awareness", "behavioral_insight", "ecological_knowledge", "master_naturalist"},
		DiscFieldcraft:  {"quiet_steps", "trail_sense", "weather_sense", "concealment", "campcraft", "wildlife_familiarity", "woodland_mastery"},
	}
	pinnedCabin = []string{CabinAudioLab, CabinPhotoWall, CabinWorkshop, CabinMapRoom, CabinGarden}
	// The six unique finds and the slot (or kind) the contract gives each.
	uniqueItems = map[string]string{
		"forgotten_journal":     KindKeepsake,
		"historical_binoculars": SlotOptics,
		"vintage_recorder":      SlotAudio,
		"explorers_lens":        KindGadget,
		"naturalists_compass":   SlotNavigation,
		"research_backpack":     SlotBackpack,
	}
)

// maxPrice is a sanity ceiling for anything sold: the economy is small (spec §22).
const maxPrice = 2000

func toSet(list []string) map[string]bool {
	s := make(map[string]bool, len(list))
	for _, x := range list {
		s[x] = true
	}
	return s
}

// Validate checks the authored catalogs for internal consistency and returns every
// problem found (nil means all is well): unique ids, modifier keys that are real
// core.Stats JSON names (verified against the marshalled struct), existing
// prerequisites, the tier / rank / cost structure of the skill tree, tradeoffs on
// tier 2+ equipment, pinned ids, sane prices, known icons and complete text.
// It is run by the tests and may be run at startup.
func Validate() []error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }

	// The stat vocabulary straight from the wire format, independent of the
	// reflection table in stats.go.
	wire := map[string]float64{}
	raw, err := json.Marshal(core.BaseStats())
	if err == nil {
		err = json.Unmarshal(raw, &wire)
	}
	if err != nil {
		bad("stats: cannot marshal core.Stats: %v", err)
	}
	if len(wire) != len(statNames) {
		bad("stats: %d JSON names but %d fields indexed", len(wire), len(statNames))
	}
	for _, name := range statNames {
		base, ok := wire[name]
		if !ok {
			bad("stats: field %q is not a JSON name of core.Stats", name)
			continue
		}
		lim, ok := statLimits[name]
		if !ok {
			bad("stats: %q has no clamp range", name)
			continue
		}
		if lim[0] >= lim[1] || base < lim[0] || base > lim[1] {
			bad("stats: base value %g of %q is outside its clamp range %v", base, name, lim)
		}
	}
	for name := range statLimits {
		if _, ok := wire[name]; !ok {
			bad("stats: clamp range for unknown stat %q", name)
		}
	}
	for name := range lowerIsBetter {
		if _, ok := wire[name]; !ok {
			bad("stats: lowerIsBetter lists unknown stat %q", name)
		}
	}
	if !reflect.DeepEqual(ComputeStats(&proto.Profile{Rank: 1}), core.BaseStats()) {
		bad("stats: a bare profile does not compute to core.BaseStats()")
	}

	checkMods := func(owner string, m map[string]float32, required bool) {
		if required && len(m) == 0 {
			bad("%s: has no stat modifiers", owner)
		}
		for k, v := range m {
			if _, ok := wire[k]; !ok {
				bad("%s: modifier key %q is not a core.Stats JSON name", owner, k)
			}
			if v == 0 || math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				bad("%s: modifier %q has a useless value %v", owner, k, v)
			}
		}
	}
	checkIcon := func(owner, icon string) {
		if !iconVocabulary[icon] {
			bad("%s: icon %q is not in the kit vocabulary", owner, icon)
		}
	}
	checkText := func(owner string, fields ...string) {
		for i, f := range fields {
			if strings.TrimSpace(f) == "" {
				bad("%s: text field #%d is empty", owner, i+1)
			}
		}
	}

	// --- Ranks
	if len(ranks) != MaxRank {
		bad("ranks: want %d, have %d", MaxRank, len(ranks))
	}
	for i := range ranks {
		r := &ranks[i]
		owner := fmt.Sprintf("rank %d", i+1)
		if r.Index != i+1 {
			bad("%s: index is %d", owner, r.Index)
		}
		checkText(owner, r.Title, r.Desc)
		if len(r.Unlocks) == 0 {
			bad("%s: no unlock lines", owner)
		}
		if i == 0 {
			if r.ReqLevel|r.ReqSpecies|r.ReqDocs|r.ReqRep != 0 || r.ReqQuest != "" || r.SkillPoints != 0 {
				bad("%s: the starting rank must have no requirements or bonus", owner)
			}
			continue
		}
		prev := &ranks[i-1]
		if r.ReqLevel <= prev.ReqLevel || r.ReqSpecies <= prev.ReqSpecies || r.ReqDocs < prev.ReqDocs || r.ReqRep < prev.ReqRep {
			bad("%s: requirements do not rise above rank %d", owner, i)
		}
		if r.ReqLevel > MaxLevel {
			bad("%s: needs level %d, above the cap", owner, r.ReqLevel)
		}
		if r.SkillPoints != RankSkillPoints {
			bad("%s: grants %d skill points, want %d", owner, r.SkillPoints, RankSkillPoints)
		}
	}
	if len(ranks) > 1 && ranks[1].ReqQuest != TutorialQuest {
		bad("rank 2: milestone quest is %q, want %q", ranks[1].ReqQuest, TutorialQuest)
	}
	for rank, m := range rankPerks {
		if rank < 1 || rank > MaxRank {
			bad("rank perk for unknown rank %d", rank)
		}
		checkMods(fmt.Sprintf("rank %d perk", rank), m, true)
	}

	// --- Disciplines, tiers, skills
	discIDs := map[string]bool{}
	for _, d := range disciplines {
		if discIDs[d.ID] {
			bad("discipline %q: duplicate id", d.ID)
		}
		discIDs[d.ID] = true
		checkText("discipline "+d.ID, d.Name, d.Title, d.Desc, d.Color)
		checkIcon("discipline "+d.ID, d.Icon)
		if _, ok := pinnedSkills[d.ID]; !ok {
			bad("discipline %q is not one of the five pinned disciplines", d.ID)
		}
	}
	if len(disciplines) != len(pinnedSkills) {
		bad("disciplines: want %d, have %d", len(pinnedSkills), len(disciplines))
	}
	if len(skillTiers) != 4 {
		bad("skill tiers: want 4, have %d", len(skillTiers))
	}
	for i, t := range skillTiers {
		if t.Tier != i+1 || t.Label == "" {
			bad("skill tier %d: bad tier number or label", i+1)
		}
		if i > 0 && t.Points <= skillTiers[i-1].Points {
			bad("skill tier %d: point requirement does not rise", i+1)
		}
		if t.Rank > MaxRank {
			bad("skill tier %d: needs rank %d", i+1, t.Rank)
		}
	}

	skillIDs := map[string]bool{}
	modSigs := map[string]string{}
	perDisc := map[string][]*proto.SkillDef{}
	for i := range skills {
		s := &skills[i]
		owner := "skill " + s.ID
		if skillIDs[s.ID] {
			bad("%s: duplicate id", owner)
		}
		skillIDs[s.ID] = true
		if !discIDs[s.Discipline] {
			bad("%s: unknown discipline %q", owner, s.Discipline)
		}
		perDisc[s.Discipline] = append(perDisc[s.Discipline], s)
		checkText(owner, s.Name, s.Desc, s.Effect)
		checkIcon(owner, s.Icon)
		checkMods(owner, s.Mods, true)
		if s.Tier < 1 || s.Tier > len(skillTiers) {
			bad("%s: tier %d", owner, s.Tier)
		}
		// Two skills with the same modifier map would be the same skill twice.
		sig := modSignature(s.Mods)
		if other, dup := modSigs[sig]; dup {
			bad("%s: has exactly the same effect as skill %s", owner, other)
		}
		modSigs[sig] = s.ID
		// A skill must do something measurable at every rank, starting from a bare
		// profile (i.e. its first rank is not swallowed by a clamp).
		prev := core.BaseStats()
		for rank := 1; rank <= s.MaxRank; rank++ {
			now := ComputeStats(&proto.Profile{Rank: 1, Skills: map[string]int{s.ID: rank}})
			if reflect.DeepEqual(now, prev) {
				bad("%s: rank %d changes no stat", owner, rank)
			}
			prev = now
		}
	}
	for disc, want := range pinnedSkills {
		have := perDisc[disc]
		if len(have) != len(want) {
			bad("discipline %s: want %d skills, have %d", disc, len(want), len(have))
			continue
		}
		for i, s := range have {
			sh := tierShape[i]
			if s.ID != want[i] {
				bad("discipline %s: skill #%d is %q, want %q", disc, i+1, s.ID, want[i])
			}
			if s.Tier != sh.tier || s.MaxRank != sh.maxRank || s.Cost != sh.cost {
				bad("skill %s: tier/maxRank/cost = %d/%d/%d, want %d/%d/%d",
					s.ID, s.Tier, s.MaxRank, s.Cost, sh.tier, sh.maxRank, sh.cost)
			}
		}
	}

	// --- Cabin upgrades
	cabinIDs := map[string]bool{}
	for i := range cabinUpgrades {
		c := &cabinUpgrades[i]
		owner := "cabin upgrade " + c.ID
		if cabinIDs[c.ID] {
			bad("%s: duplicate id", owner)
		}
		cabinIDs[c.ID] = true
		checkText(owner, c.Name, c.Desc, c.Effect)
		checkIcon(owner, c.Icon)
		checkMods(owner, c.Mods, false)
		if c.Mods == nil {
			bad("%s: Mods must not be nil", owner)
		}
		if c.Price <= 0 || c.Price > maxPrice {
			bad("%s: price %d", owner, c.Price)
		}
		if c.ReqRank < 1 || c.ReqRank > MaxRank {
			bad("%s: reqRank %d", owner, c.ReqRank)
		}
	}
	for _, id := range pinnedCabin {
		if !cabinIDs[id] {
			bad("cabin upgrade %q (pinned) is missing", id)
		}
	}
	if len(cabinUpgrades) != len(pinnedCabin) {
		bad("cabin upgrades: want %d, have %d", len(pinnedCabin), len(cabinUpgrades))
	}

	// --- Items
	itemIDs := map[string]bool{}
	upgradeIDs := map[string]bool{}
	slotTiers := map[string]map[int]bool{}
	for i := range items {
		it := &items[i]
		owner := "item " + it.ID
		if itemIDs[it.ID] {
			bad("%s: duplicate id", owner)
		}
		itemIDs[it.ID] = true
		checkText(owner, it.Name, it.Desc)
		checkIcon(owner, it.Icon)
		checkMods(owner, it.Mods, false)
		if it.Mods == nil || it.Pros == nil || it.Cons == nil || it.Upgrades == nil {
			bad("%s: Mods, Pros, Cons and Upgrades must not be nil", owner)
		}
		if !itemKinds[it.Kind] {
			bad("%s: unknown kind %q", owner, it.Kind)
		}
		if !itemSources[it.Source] {
			bad("%s: unknown source %q", owner, it.Source)
		}
		if it.Tier < 1 || it.Tier > 4 {
			bad("%s: tier %d", owner, it.Tier)
		}
		if it.Rarity < proto.RarityCommon || it.Rarity > proto.RarityLegendary {
			bad("%s: rarity %d", owner, it.Rarity)
		}
		if it.ReqRank < 1 || it.ReqRank > MaxRank {
			bad("%s: reqRank %d", owner, it.ReqRank)
		}
		if it.ReqRep < 0 || it.Price < 0 || it.Price > maxPrice {
			bad("%s: price %d / reqRep %d out of range", owner, it.Price, it.ReqRep)
		}
		if (it.Price > 0) != (it.Source == "shop") {
			bad("%s: price %d does not fit source %q (only shop items are priced)", owner, it.Price, it.Source)
		}
		if len(it.Pros) == 0 {
			bad("%s: no Pros", owner)
		}

		switch it.Kind {
		case KindEquipment:
			if !containsString(slots, it.Slot) {
				bad("%s: unknown slot %q", owner, it.Slot)
			}
			if slotTiers[it.Slot] == nil {
				slotTiers[it.Slot] = map[int]bool{}
			}
			slotTiers[it.Slot][it.Tier] = true
			if it.Tier == 1 {
				// Tier 1 is the baseline that core.BaseStats() describes.
				if len(it.Mods) != 0 {
					bad("%s: tier 1 equipment must be neutral (no mods)", owner)
				}
			} else {
				// Spec §9.3: real disadvantages. One modifier must be both negative
				// in value and worse for the player, and the text must own up to it.
				found := false
				for k, v := range it.Mods {
					if v < 0 && IsTradeoff(k, v) {
						found = true
					}
				}
				if !found {
					bad("%s: tier %d equipment needs a negative tradeoff modifier", owner, it.Tier)
				}
				if len(it.Mods) < 2 {
					bad("%s: tier %d equipment needs benefits as well as a tradeoff", owner, it.Tier)
				}
			}
			if len(it.Cons) == 0 {
				bad("%s: equipment needs Cons", owner)
			}
		case KindGadget, KindKeepsake:
			if it.Slot != "" {
				bad("%s: only equipment has a slot", owner)
			}
			if len(it.Mods) == 0 {
				bad("%s: a %s must do something while carried", owner, it.Kind)
			}
			if _, ok := it.Mods["capacity"]; ok {
				// Carrying it would change how much can be carried: the pack-room
				// checks assume this never happens.
				bad("%s: a carried item may not modify capacity", owner)
			}
		case KindSupply:
			if it.Slot != "" || len(it.Mods) != 0 || len(it.Upgrades) != 0 {
				bad("%s: a supply has no slot, mods or upgrades", owner)
			}
		}
		if it.Kind == KindSupply {
			if it.Stack < 2 || !itemUses[it.Use] {
				bad("%s: a supply needs a stack size and a use (stack %d, use %q)", owner, it.Stack, it.Use)
			}
		} else if it.Stack != 0 || it.Use != "" {
			bad("%s: only supplies stack or have a use", owner)
		}

		if it.Tier == 4 {
			if it.Price != 0 || it.Source == "shop" || it.Rarity < proto.RarityEpic {
				bad("%s: tier 4 items are unique finds: never sold, epic or legendary", owner)
			}
			checkText(owner+" (unique)", it.History, it.Special)
			if len(it.Mods) == 0 {
				bad("%s: a unique item needs unique functionality", owner)
			}
			if _, ok := uniqueItems[it.ID]; !ok {
				bad("%s: tier 4 but not one of the six pinned unique items", owner)
			}
		}
		if it.Price > 0 && it.Kind != KindSupply && it.ReqRank < it.Tier-1 {
			bad("%s: tier %d sold below rank %d", owner, it.Tier, it.Tier-1)
		}

		if len(it.Upgrades) > 3 {
			bad("%s: more than 3 upgrades", owner)
		}
		for j := range it.Upgrades {
			u := &it.Upgrades[j]
			uo := "upgrade " + u.ID
			if upgradeIDs[u.ID] || itemIDs[u.ID] {
				bad("%s: duplicate id", uo)
			}
			upgradeIDs[u.ID] = true
			if !strings.HasPrefix(u.ID, it.ID+"_") {
				bad("%s: id should start with its item id %q", uo, it.ID)
			}
			checkText(uo, u.Name, u.Desc)
			checkMods(uo, u.Mods, true)
			if u.Price <= 0 || u.Price > maxPrice {
				bad("%s: price %d", uo, u.Price)
			}
			if u.ReqRank < 1 || u.ReqRank > MaxRank {
				bad("%s: reqRank %d", uo, u.ReqRank)
			}
			if u.ReqCabin != "" && !cabinIDs[u.ReqCabin] {
				bad("%s: requires unknown cabin upgrade %q", uo, u.ReqCabin)
			}
			if u.ReqCabin != "" && u.ReqRank < cabinIndex[u.ReqCabin].ReqRank {
				// Otherwise the listed rank requirement would be a lie.
				bad("%s: needs the %s (rank %d) but lists rank %d", uo, u.ReqCabin, cabinIndex[u.ReqCabin].ReqRank, u.ReqRank)
			}
		}
	}
	if n := len(items); n < 36 || n > 44 {
		bad("items: catalog has %d items, want 36–44", n)
	}
	for _, id := range pinnedItems {
		if !itemIDs[id] {
			bad("item %q (pinned) is missing", id)
		}
	}
	for id, where := range uniqueItems {
		it := itemIndex[id]
		if it == nil {
			continue // reported above as a missing pinned item
		}
		if it.Tier != 4 {
			bad("item %s: unique items are tier 4", id)
		}
		if it.Slot != where && it.Kind != where {
			bad("item %s: should be %q, is kind %q slot %q", id, where, it.Kind, it.Slot)
		}
	}
	for _, slot := range slots {
		for tier := 1; tier <= 3; tier++ {
			if !slotTiers[slot][tier] {
				bad("slot %s: no tier %d equipment", slot, tier)
			}
		}
	}
	for slot, id := range startingKit {
		it := itemIndex[id]
		switch {
		case it == nil:
			bad("starting kit: item %q does not exist", id)
		case it.Slot != slot || it.Tier != 1 || it.Source != "start" || len(it.Mods) != 0:
			bad("starting kit: %s must be a neutral tier 1 %s item with source \"start\"", id, slot)
		}
	}
	if b := itemIndex["basic_recorder"]; b != nil && (b.Slot != SlotAudio || b.Tier != 1) {
		bad("item basic_recorder: must be tier 1 audio equipment")
	}
	if b := itemIndex["explorer_binoculars"]; b != nil && (b.Slot != SlotOptics || b.Tier != 2 || b.Price <= 0) {
		bad("item explorer_binoculars: must be purchasable tier 2 optics")
	}
	for _, id := range []string{"film_roll", "seed_mix"} {
		if it := itemIndex[id]; it != nil && (it.Kind != KindSupply || it.Price <= 0) {
			bad("item %s: must be a purchasable supply", id)
		}
	}

	return errs
}

// modSignature is a canonical text form of a modifier map.
func modSignature(m map[string]float32) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%g;", k, m[k])
	}
	return b.String()
}
