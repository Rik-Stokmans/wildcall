package content

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// poiKinds is the core.POI.Kind vocabulary (contract §2.2).
var poiKinds = []string{
	"cabin", "ranger_station", "watchtower", "shop", "research_site", "abandoned_station",
	"hidden_cabin", "camp", "viewpoint", "hide", "landmark", "pond", "npc", "feather", "page",
	"relic", "cache", "sign",
}

// collectKinds are the kinds a collect objective or event may use.
var collectKinds = []string{"feather", "page", "relic", "cache"}

// rareKinds is the proto.RareDiscovery.Kind vocabulary.
var rareKinds = []string{
	"rare_species", "unusual_plumage", "out_of_range", "behavior", "exceptional_photo",
	"migration", "hidden_habitat", "relic",
}

var (
	researchTargets = []string{"study", "analyze", "submit"}
	identifyMethods = []string{"sight", "sound", "photo", "mixed"}
	rarityKeys      = []string{"common", "uncommon", "rare", "legendary"}
	phaseKeys       = []string{"dawn", "morning", "midday", "afternoon", "evening", "night"}
	researchWhat    = []string{"photo", "recording"}
)

var knownParams = []string{
	ParamBehavior, ParamMinStars, ParamMethod, ParamRegion, ParamHabitat, ParamRarity,
	ParamPhase, ParamDistinct, ParamSpecies, ParamWhat, ParamSlot,
}

var slotKeys = []string{"drink", "meal", "snack"}

// paramValues returns the alternatives of a parameter value ("a|b").
func paramValues(v string) []string { return strings.Split(v, "|") }

// Validate checks every reference the authored content makes against the real
// catalogs, plus the content's own internal consistency, and returns all the
// problems it finds (nil when everything is sound). The server stage calls it at
// start-up with the real species, item, POI and skill ids; the POI ids are the pinned
// home-valley ones of contract §2.2, since nothing else may be referenced by id.
func Validate(speciesIDs, itemIDs, poiIDs, skillIDs []string) []error {
	var errs []error
	bad := func(format string, a ...any) { errs = append(errs, fmt.Errorf("content: "+format, a...)) }
	species, items, pois, skills := set(speciesIDs), set(itemIDs), set(poiIDs), set(skillIDs)

	// Regions.
	regions := Regions()
	if len(regions) != int(core.RegionCount) {
		bad("regions: want %d, have %d", core.RegionCount, len(regions))
	}
	regionKeys := map[string]bool{}
	for i, r := range regions {
		regionKeys[r.Key] = true
		if r.ID != i || r.Key != core.RegionID(i).Key() {
			bad("region %d (%s): id/key do not match core.RegionID", i, r.Key)
		}
		if r.ReqRank != RegionGate(core.RegionID(i)) {
			bad("region %s: ReqRank %d disagrees with RegionGate %d", r.Key, r.ReqRank, RegionGate(core.RegionID(i)))
		}
		if r.Name == "" || r.Tagline == "" || r.Desc == "" || len(r.Habitats) == 0 || len(r.Emphasis) == 0 {
			bad("region %s: incomplete text", r.Key)
		}
		if len(r.Color) != 7 || r.Color[0] != '#' {
			bad("region %s: colour %q is not #rrggbb", r.Key, r.Color)
		}
		if r.ReqQuest != "" {
			bad("region %s: ReqQuest must be empty (gating is by rank)", r.Key)
		}
	}

	// NPCs.
	npcs := map[string]bool{}
	for _, n := range NPCs() {
		npcs[n.ID] = true
		if !pois[n.POI] {
			bad("npc %s: POI %q is not a known POI", n.ID, n.POI)
		}
		if n.Bio == "" || n.Role == "" || n.Faction == "" {
			bad("npc %s: incomplete", n.ID)
		}
		if !oneOf(n.Faction, factions...) {
			bad("npc %s: unknown faction %q", n.ID, n.Faction)
		}
		if _, ok := speakers[n.ID]; !ok {
			bad("npc %s: has no dialogue", n.ID)
		}
	}
	for _, id := range []string{NPCMara, NPCFinn, NPCAlder, NPCJune} {
		if !npcs[id] {
			bad("npc %s (pinned) is missing", id)
		}
	}

	// Collectibles, badges and lore, which quests refer to.
	collectibles := map[string]bool{}
	for _, c := range Collectibles(nil) {
		collectibles[c.ID] = true
	}
	for id := range species {
		collectibles[FeatherID(id)] = true
	}
	badgeIDs := map[string]bool{}
	for id := range collectibles {
		if strings.HasPrefix(id, "badge_") {
			badgeIDs[id] = true
		}
	}
	lore := map[string]bool{}
	for _, l := range Lore() {
		if lore[l.ID] {
			bad("lore %s: duplicate id", l.ID)
		}
		lore[l.ID] = true
		if l.Title == "" || l.Text == "" || !oneOf(l.Category, LoreEcology, LoreHistory, LoreFieldcraft, LoreSpecies) {
			bad("lore %s: incomplete or unknown category %q", l.ID, l.Category)
		}
	}
	for trig, ids := range loreUnlocks {
		for _, id := range ids {
			if !lore[id] {
				bad("lore trigger %s: unknown entry %q", trig, id)
			}
		}
		if p, ok := strings.CutPrefix(trig, "forage:"); ok {
			if _, known := Plant(p); !known {
				bad("lore trigger %s: unknown plant", trig)
			}
		}
		if strings.HasPrefix(trig, "identify:") && !species[strings.TrimPrefix(trig, "identify:")] {
			bad("lore trigger %s: unknown species", trig)
		}
	}
	for _, id := range cacheLore {
		if !lore[id] {
			bad("cache lore: unknown entry %q", id)
		}
	}
	for i := 0; i < PageCount; i++ {
		if len(LoreFor(pageID(i))) == 0 {
			bad("page %d unlocks no lore", i)
		}
	}
	for i := 0; i < RelicCount; i++ {
		if len(LoreFor(relicID(i))) == 0 {
			bad("relic %d unlocks no lore", i)
		}
	}

	// Cache loot and gifts.
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		for _, it := range CacheLoot(r.Key()) {
			if !items[it] {
				bad("cache loot %s: unknown item %q", r.Key(), it)
			}
		}
	}
	for _, it := range []string{itemFilm, itemSeed} {
		if !items[it] {
			bad("cache find item %q is not a known item", it)
		}
	}

	// The field kitchen: plants, recipes and the items they reference.
	larder := larderRefs{plants: map[string]bool{}, recipes: map[string]bool{}, items: items}
	errs = append(errs, validateLarder(items, lore, npcs, larder.plants, larder.recipes)...)

	// Quests.
	quests := Quests()
	ids := map[string]bool{}
	for _, q := range quests {
		if ids[q.ID] {
			bad("quest %s: duplicate id", q.ID)
		}
		ids[q.ID] = true
	}
	boardCount, tutorials := 0, 0
	for _, q := range quests {
		w := "quest " + q.ID
		if q.Name == "" || q.Summary == "" || q.Story == "" || len(q.Objectives) == 0 {
			bad("%s: incomplete", w)
		}
		if !oneOf(q.Category, questCategories...) {
			bad("%s: unknown category %q", w, q.Category)
		}
		if q.Giver == BoardGiver {
			boardCount++
		} else if !npcs[q.Giver] {
			bad("%s: unknown giver %q", w, q.Giver)
		}
		if q.Tutorial {
			tutorials++
		}
		for _, r := range q.Requires {
			if !ids[r] {
				bad("%s: requires unknown quest %q", w, r)
			}
			if r == q.ID {
				bad("%s: requires itself", w)
			}
		}
		for f, n := range q.ReqRep {
			if !oneOf(f, factions...) || n <= 0 || n > 400 {
				bad("%s: ReqRep %s=%d", w, f, n)
			}
		}
		if q.ReqRank < 0 || q.ReqRank > 5 {
			bad("%s: ReqRank %d out of range", w, q.ReqRank)
		}
		seen := map[string]bool{}
		for _, ob := range q.Objectives {
			if ob.ID == "" || seen[ob.ID] {
				bad("%s: objective id %q empty or duplicate", w, ob.ID)
			}
			seen[ob.ID] = true
			for _, e := range validateObjective(ob, species, pois, collectibles, npcs, regionKeys, larder) {
				bad("%s objective %s: %s", w, ob.ID, e)
			}
		}
		errs = append(errs, validateReward(w, q.Rewards, items, lore, ids, badgeIDs, skills)...)
	}
	if tutorials != 1 {
		bad("exactly one tutorial quest expected, have %d", tutorials)
	}
	if boardCount < 4 {
		bad("at least 4 cabin research contracts expected, have %d", boardCount)
	}
	for id, list := range acceptItems {
		if !ids[id] {
			bad("accept-time items for unknown quest %q", id)
		}
		for _, it := range list {
			if !items[it] {
				bad("quest %s hands out unknown item %q", id, it)
			}
		}
	}
	return errs
}

// larderRefs are the ids a forage, cook or eat objective may name.
type larderRefs struct{ plants, recipes, items map[string]bool }

func validateObjective(ob proto.ObjectiveDef, species, pois, collectibles, npcs, regions map[string]bool, larder larderRefs) []string {
	var out []string
	add := func(f string, a ...any) { out = append(out, fmt.Sprintf(f, a...)) }
	if ob.Text == "" {
		add("no text")
	}
	if !oneOf(ob.Kind, objectiveKinds...) {
		add("kind %q is not in the vocabulary", ob.Kind)
		return out
	}
	speciesTarget := func(allowUnknown bool) {
		switch {
		case ob.Target == TargetAny, ob.Target == TargetUnknown && allowUnknown:
		case !species[ob.Target]:
			add("unknown species target %q", ob.Target)
		}
	}
	switch ob.Kind {
	case KindHear:
		speciesTarget(true)
	case KindObserve, KindIdentify, KindPhoto, KindRecord:
		speciesTarget(false)
	case KindDiscover:
		if k, ok := strings.CutPrefix(ob.Target, TargetKind); ok {
			if !oneOf(k, poiKinds...) {
				add("unknown POI kind %q", k)
			}
		} else if !pois[ob.Target] {
			add("target %q is not a known home-valley POI (use kind:<kind> with a region)", ob.Target)
		}
	case KindCollect:
		if k, ok := strings.CutPrefix(ob.Target, TargetKind); ok {
			if !oneOf(k, collectKinds...) {
				add("unknown collectible kind %q", k)
			}
		} else if !collectibles[ob.Target] && !pois[ob.Target] {
			add("target %q is neither a collectible nor a cache POI", ob.Target)
		}
	case KindTalk:
		if !npcs[ob.Target] {
			add("unknown npc %q", ob.Target)
		}
	case KindReturn:
		if ob.Target != "" {
			add("return takes no target")
		}
	case KindResearch:
		if !oneOf(ob.Target, researchTargets...) {
			add("research target %q", ob.Target)
		}
	case KindRare:
		if ob.Target != TargetAny && !oneOf(ob.Target, rareKinds...) {
			add("unknown rare kind %q", ob.Target)
		}
	case KindForage:
		if ob.Target != TargetAny && !larder.plants[ob.Target] {
			add("unknown plant %q", ob.Target)
		}
	case KindCook:
		if ob.Target != TargetAny && !larder.recipes[ob.Target] {
			add("unknown recipe %q", ob.Target)
		}
	case KindEat:
		if ob.Target != TargetAny && !larder.items[ob.Target] {
			add("unknown item %q", ob.Target)
		}
	}
	if ob.Kind != KindCook && ob.Kind != KindEat && ob.Params[ParamSlot] != "" {
		add("slot applies only to cook and eat objectives")
	}
	for k, v := range ob.Params {
		if !oneOf(k, knownParams...) {
			add("unknown parameter %q", k)
			continue
		}
		for _, one := range paramValues(v) {
			switch k {
			case ParamRegion:
				if !regions[one] {
					add("region %q", one)
				}
			case ParamMinStars:
				if n, err := strconv.Atoi(one); err != nil || n < 1 || n > 5 {
					add("minStars %q", one)
				}
			case ParamBehavior:
				if !validBehavior(one) {
					add("behavior %q", one)
				}
			case ParamHabitat:
				if _, ok := core.HabitatFromKey(one); !ok {
					add("habitat %q", one)
				}
			case ParamMethod:
				if !oneOf(one, identifyMethods...) {
					add("method %q", one)
				}
			case ParamRarity:
				if !oneOf(one, rarityKeys...) {
					add("rarity %q", one)
				}
			case ParamPhase:
				if !oneOf(one, phaseKeys...) {
					add("phase %q", one)
				}
			case ParamSpecies:
				if !species[one] {
					add("species %q", one)
				}
			case ParamWhat:
				if !oneOf(one, researchWhat...) {
					add("what %q", one)
				}
			case ParamSlot:
				if !oneOf(one, slotKeys...) {
					add("slot %q", one)
				}
			case ParamDistinct:
				if one != "true" {
					add("distinct must be \"true\"")
				}
			}
		}
	}
	return out
}

func validBehavior(key string) bool {
	for a := core.BirdAct(0); a < core.ActCount; a++ {
		if a.Key() == key {
			return true
		}
	}
	return false
}

func validateReward(w string, r proto.Reward, items, lore, quests, badges, skills map[string]bool) []error {
	var errs []error
	bad := func(format string, a ...any) { errs = append(errs, fmt.Errorf("content: "+w+": "+format, a...)) }
	if r.XP < 0 || r.Credits < 0 || r.SkillPoints < 0 {
		bad("negative reward")
	}
	if r.XP == 0 && r.Credits == 0 && len(r.Items) == 0 {
		bad("pays nothing")
	}
	for _, it := range r.Items {
		if !items[it] {
			bad("reward item %q is not a known item", it)
		}
	}
	for f := range r.Rep {
		if !oneOf(f, factions...) {
			bad("reward reputation faction %q", f)
		}
	}
	for _, l := range r.Lore {
		if !lore[l] {
			bad("reward lore %q is not a known entry", l)
		}
	}
	if r.Badge != "" && !badges[r.Badge] {
		bad("reward badge %q is not a known badge", r.Badge)
	}
	for _, u := range r.Unlock {
		switch {
		case strings.HasPrefix(u, "quest:"):
			if !quests[strings.TrimPrefix(u, "quest:")] {
				bad("unlock %q: unknown quest", u)
			}
		case strings.HasPrefix(u, "region:"):
			if _, ok := core.RegionFromKey(strings.TrimPrefix(u, "region:")); !ok {
				bad("unlock %q: unknown region", u)
			}
		case strings.HasPrefix(u, "skill:"):
			if !skills[strings.TrimPrefix(u, "skill:")] {
				bad("unlock %q: unknown skill", u)
			}
		case strings.HasPrefix(u, "feature:"):
		case strings.HasPrefix(u, "upgrade:"):
			parts := strings.Split(strings.TrimPrefix(u, "upgrade:"), ":")
			if len(parts) != 2 || parts[1] == "" || !items[parts[0]] {
				bad("unlock %q: want upgrade:<known item>:<upgrade id>", u)
			}
		default:
			bad("unlock %q has no known prefix", u)
		}
	}
	return errs
}

func set(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}

// validateLarder checks the plant and recipe catalogs and fills plants and recipes
// with their ids for the quests to check against. items are the real item ids the
// server passes in: every yield, input and output must be among them.
func validateLarder(items, lore, npcs, plants, recipes map[string]bool) []error {
	var errs []error
	bad := func(format string, a ...any) { errs = append(errs, fmt.Errorf("content: "+format, a...)) }

	for _, p := range Plants() {
		w := "plant " + p.ID
		if p.ID == "" || plants[p.ID] {
			bad("%s: empty or duplicate id", w)
		}
		plants[p.ID] = true
		if p.Veg < int(core.FirstForageKind) || p.Veg >= int(core.VegKindCount) {
			bad("%s: veg kind %d is not a forage kind", w, p.Veg)
		}
		if p.Name == "" || p.Sci == "" || len(p.Desc) < 80 || len(p.Uses) < 20 || p.Habitat == "" || p.Icon == "" {
			bad("%s: incomplete text", w)
		}
		if p.Regrow < 3 || p.Regrow > 8 {
			bad("%s: regrow %d days, want 3..8", w, p.Regrow)
		}
		if len(p.Regions) == 0 {
			bad("%s: grows nowhere", w)
		}
		for _, r := range p.Regions {
			if r < 0 || r >= int(core.RegionCount) {
				bad("%s: region %d", w, r)
			}
		}
		if len(p.Yields) == 0 {
			bad("%s: yields nothing", w)
		}
		for _, y := range p.Yields {
			if !items[y.Item] {
				bad("%s: yield item %q is not a known item", w, y.Item)
			}
			if y.Min < 1 || y.Max < y.Min || y.Max > 3 || y.Seasons == [4]bool{} {
				bad("%s: yield %s has bad amounts or seasons", w, y.Item)
			}
		}
	}
	seenVeg := map[int]bool{}
	for _, p := range Plants() {
		if seenVeg[p.Veg] {
			bad("plant %s: veg kind %d is used twice", p.ID, p.Veg)
		}
		seenVeg[p.Veg] = true
	}
	if n := len(Plants()); n != int(core.VegKindCount-core.FirstForageKind) {
		bad("plants: %d, want one per forage veg kind (%d)", n, core.VegKindCount-core.FirstForageKind)
	}

	for _, r := range Recipes() {
		w := "recipe " + r.ID
		if r.ID == "" || recipes[r.ID] {
			bad("%s: empty or duplicate id", w)
		}
		recipes[r.ID] = true
		if r.Name == "" || r.Desc == "" {
			bad("%s: incomplete text", w)
		}
		if !oneOf(r.Station, StationKettle, StationStove) {
			bad("%s: station %q", w, r.Station)
		}
		if !items[r.Output] {
			bad("%s: output %q is not a known item", w, r.Output)
		}
		if r.Qty < 1 || len(r.Inputs) == 0 {
			bad("%s: makes %d from %d inputs", w, r.Qty, len(r.Inputs))
		}
		for _, in := range r.Inputs {
			if !items[in.Item] || in.Qty < 1 {
				bad("%s: input %s x%d is not valid", w, in.Item, in.Qty)
			}
		}
		kind, arg, _ := strings.Cut(r.Learn, ":")
		switch {
		case r.Learn == LearnStart:
		case kind+":" == LearnPlant:
			if !plants[arg] {
				// Plants are all registered above, so this is a real mistake.
				bad("%s: learned from unknown plant %q", w, arg)
			}
		case kind+":" == LearnNPC:
			if !npcs[arg] {
				bad("%s: learned from unknown npc %q", w, arg)
			}
			if !npcTeaches(arg, r.ID) {
				bad("%s: npc %s has no dialogue that teaches it", w, arg)
			}
		case kind+":" == LearnLore:
			if !lore[arg] {
				bad("%s: learned from unknown lore entry %q", w, arg)
			}
		default:
			bad("%s: learn rule %q", w, r.Learn)
		}
	}
	return errs
}
