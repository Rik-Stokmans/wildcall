package progress

import (
	"math"
	"reflect"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The stat table is derived once from core.Stats by reflection: modifier maps are
// keyed by the JSON field names, so the struct itself is the vocabulary and a stat
// added to core is usable in the catalogs without touching this file (it only needs
// a clamp range below; Validate complains if one is missing).
var (
	statNames []string       // JSON names in struct field order
	statIndex map[string]int // JSON name -> field index
)

func init() {
	t := reflect.TypeOf(core.Stats{})
	statIndex = make(map[string]int, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		name, _, _ := strings.Cut(t.Field(i).Tag.Get("json"), ",")
		if name == "" || name == "-" {
			name = t.Field(i).Name
		}
		statNames = append(statNames, name)
		statIndex[name] = i
	}
}

// StatNames returns the JSON names of every core.Stats field, in field order. These
// are the only valid keys of a modifier map.
func StatNames() []string { return append([]string(nil), statNames...) }

// IsStat reports whether name is a core.Stats JSON field name.
func IsStat(name string) bool {
	_, ok := statIndex[name]
	return ok
}

// statLimits clamps every derived stat to a range its consumers can rely on, however
// many modifiers pile up (and however odd a hand-edited save is).
var statLimits = map[string][2]float64{
	// Acoustics
	"hearRange":     {0.5, 2.5},
	"focusBonus":    {0, 1},
	"dirAccuracy":   {0, 1},
	"distAcc":       {0, 1},
	"pitchInfo":     {0, 3},
	"patternInfo":   {0, 3},
	"habitatInfo":   {0, 3},
	"noiseReduce":   {0, 0.9}, // never total silence: the soundscape is the game
	"clueSlots":     {1, 6},
	"callMemory":    {0, 3},
	"callRecognise": {0, 3},
	// Audio recording
	"recRange":    {5, 150},
	"recQuality":  {0, 1},
	"recFocus":    {0, 1},
	"spectrogram": {0, 3},
	"audioAssist": {0, 3},
	// Optics
	"binoZoom":      {4, 30},
	"binoFov":       {30, 70},
	"binoStability": {0, 1},
	"binoFocus":     {0.3, 4},
	"binoClarity":   {0, 1},
	"binoWeight":    {0.2, 3},
	"lowLight":      {0, 1},
	// Camera
	"camZoom":      {1, 12},
	"camStability": {0, 1},
	"camFocus":     {0.3, 4},
	"camQuality":   {0, 1},
	"camBurst":     {0.5, 8},
	"camNoise":     {0, 1},
	"camReady":     {0.15, 1.5},
	"filmCap":      {4, 60},
	"composition":  {0, 1},
	"longLens":     {0, 1},
	"momentBonus":  {0, 1},
	// Observation
	"observeSpeed": {0.5, 3},
	"nakedEye":     {0.5, 2.5},
	"moveSense":    {0, 80},
	"peripheral":   {0, 40},
	"settle":       {0.5, 3},
	"perchHint":    {0, 3},
	"trackSigns":   {0, 40},
	"instinct":     {0, 3},
	// Knowledge
	"idAssist":        {0, 3},
	"recognise":       {0, 3},
	"journalInfo":     {0, 3},
	"habitatKnow":     {0, 3},
	"seasonKnow":      {0, 3},
	"behaviorInsight": {0, 1},
	"ecoKnow":         {0, 3},
	"rareId":          {0, 1},
	// Fieldcraft
	"stealth":     {0.4, 1.5},
	"crouchBonus": {0.35, 1},
	"moveSpeed":   {0.7, 1.4},
	"stamina":     {2, 20},
	"terrain":     {0, 1},
	"forecast":    {0, 12}, // the clock only decides 12 hours ahead
	"trailSense":  {0, 80},
	"camp":        {0, 1},
	"familiarity": {0.5, 3},
	"rainProof":   {0, 1},
	// Pack, navigation, general
	"capacity":    {4, 40},
	"compass":     {0, 2},
	"mapDetail":   {0, 2},
	"lensInspect": {0, 3},
	"xpMult":      {0.5, 2},
	"creditMult":  {0.5, 2},
	"discount":    {0, 0.5},
}

// lowerIsBetter marks the stats where a smaller number is the improvement, so that
// "tradeoff" can be decided per stat rather than by sign alone.
var lowerIsBetter = map[string]bool{
	"stealth":     true,
	"crouchBonus": true,
	"camNoise":    true,
	"camReady":    true,
	"binoWeight":  true,
}

// LowerIsBetter reports whether a smaller value of the stat is better for the player
// (flush-distance multipliers, shutter noise, raise time, weight).
func LowerIsBetter(stat string) bool { return lowerIsBetter[stat] }

// IsTradeoff reports whether a modifier makes the stat worse for the player.
func IsTradeoff(stat string, delta float32) bool {
	if lowerIsBetter[stat] {
		return delta > 0
	}
	return delta < 0
}

// StatLimits returns the clamp range applied to a derived stat.
func StatLimits(stat string) (min, max float32, ok bool) {
	l, ok := statLimits[stat]
	return float32(l[0]), float32(l[1]), ok
}

// accum sums modifiers in float64 so that the order of addition cannot leak into the
// result; values are rounded to 1e-4 before becoming float32 (so 0.25 + 3 × 0.15
// reads 0.7, and ">= 1 enables" thresholds are exact).
type accum []float64

func newAccum() accum {
	base := core.BaseStats()
	v := reflect.ValueOf(base)
	a := make(accum, len(statNames))
	for i := range a {
		a[i] = v.Field(i).Float()
	}
	return a
}

func (a accum) add(mods map[string]float32, times int) {
	if times <= 0 {
		return
	}
	for k, d := range mods {
		if i, ok := statIndex[k]; ok {
			a[i] += float64(d) * float64(times)
		}
	}
}

func (a accum) stats() core.Stats {
	var s core.Stats
	v := reflect.ValueOf(&s).Elem()
	for i, name := range statNames {
		x := a[i]
		if l, ok := statLimits[name]; ok {
			x = math.Min(math.Max(x, l[0]), l[1])
		}
		v.Field(i).SetFloat(math.Round(x*1e4) / 1e4)
	}
	return s
}

// Outfitters reputation thresholds for Finn's goodwill discount (spec §16.2:
// reputation unlocks discounts).
var repDiscounts = []struct {
	rep      int
	discount float32
}{{120, 0.15}, {60, 0.10}, {25, 0.05}}

// RepDiscount is the shop discount earned by reputation with the outfitters: 5 % at
// 25, 10 % at 60, 15 % at 120. It is already included in Stats.Discount.
func RepDiscount(outfittersRep int) float32 {
	for _, t := range repDiscounts {
		if outfittersRep >= t.rep {
			return t.discount
		}
	}
	return 0
}

// rankPerks are standing bonuses that come with a rank itself (RankDef has no Mods
// field; the matching player-facing lines are in the rank's Unlocks).
var rankPerks = map[int]map[string]float32{
	5: {"discount": 0.10, "creditMult": 0.15},
}

// ComputeStats derives the player's capabilities: core.BaseStats() + equipped item
// mods + the purchased upgrades of those items + mods of gadgets and keepsakes
// carried in the backpack (once per item, not per stack; nothing in cabin storage
// counts) + skill mods × rank + cabin upgrade mods + active food and drink buffs
// (one per slot) + the rank-5 standing perk + Finn's reputation discount, clamped
// to the ranges of StatLimits.
//
// Food and drink: every buff in Profile.Buffs counts. Profile.Buffs only ever holds
// buffs that are active — the session calls ExpireBuffs on its tick, which removes
// the ones that have run out and recomputes — so the clock never enters this
// function and it stays a pure function of the profile. Use ComputeStatsAt when you
// hold a clock and want to ignore buffs that ran out since the last tick.
func ComputeStats(p *proto.Profile) core.Stats { return statsWith(p, p.Equipped, p.Buffs) }

// ComputeStatsAt is ComputeStats counting only the buffs still running at the game
// clock now (absolute hours, (day-1)*24 + time). It does not change the profile.
func ComputeStatsAt(p *proto.Profile, now float64) core.Stats {
	return statsWith(p, p.Equipped, ActiveBuffs(p, now))
}

// StatsFor is ComputeStats with a hypothetical equipment map (slot → item id; a
// missing or empty slot is bare hands). Everything else — skills, carried gadgets,
// cabin, purchased upgrades of the hypothetical items — comes from the profile. Use
// it to preview a swap or a purchase; it changes nothing.
func StatsFor(p *proto.Profile, equip map[string]string) core.Stats {
	return statsWith(p, equip, p.Buffs)
}

func statsWith(p *proto.Profile, equip map[string]string, buffs []proto.Buff) core.Stats {
	a := newAccum()

	addItem := func(def *proto.ItemDef) {
		a.add(def.Mods, 1)
		owned := p.Upgrades[def.ID]
		if len(owned) == 0 {
			return
		}
		for i := range def.Upgrades {
			if containsString(owned, def.Upgrades[i].ID) {
				a.add(def.Upgrades[i].Mods, 1)
			}
		}
	}

	for _, slot := range slots {
		// An item only works in its own slot: a hand-edited or stale map cannot put
		// a spotting scope in the clothing slot.
		if def := itemIndex[equip[slot]]; def != nil && def.Kind == KindEquipment && def.Slot == slot {
			addItem(def)
		}
	}

	var seen map[string]bool
	for _, st := range p.Inventory {
		def := itemIndex[st.Item]
		if def == nil || st.Qty <= 0 || (def.Kind != KindGadget && def.Kind != KindKeepsake) || seen[def.ID] {
			continue
		}
		if seen == nil {
			seen = make(map[string]bool)
		}
		seen[def.ID] = true
		addItem(def)
	}

	// Catalog order, not map order, keeps the sum deterministic.
	for i := range skills {
		if r := p.Skills[skills[i].ID]; r > 0 {
			a.add(skills[i].Mods, min(r, skills[i].MaxRank))
		}
	}
	for i := range cabinUpgrades {
		if containsString(p.Cabin, cabinUpgrades[i].ID) {
			a.add(cabinUpgrades[i].Mods, 1)
		}
	}
	// Buffs add last. One per slot: a hand-edited save holding two drinks counts the
	// one that lasts longest, not both.
	for _, slot := range buffSlots {
		if b := bestBuff(buffs, slot); b != nil {
			a.add(b.Mods, 1)
		}
	}
	a.add(rankPerks[p.Rank], 1)
	a[statIndex["discount"]] += float64(RepDiscount(p.Rep[FactionOutfitters]))

	return a.stats()
}

// bestBuff is the buff of a slot that lasts longest (nil if there is none).
func bestBuff(buffs []proto.Buff, slot string) *proto.Buff {
	var best *proto.Buff
	for i := range buffs {
		if buffs[i].Slot == slot && (best == nil || buffs[i].Until > best.Until) {
			best = &buffs[i]
		}
	}
	return best
}

// Recompute refreshes everything derived in the profile: Stats, XPNext, and
// Film.Cap (= Stats.FilmCap plus any extra rolls loaded this expedition, which
// survive the recompute). Every mutating function in this package calls it; call it
// yourself after editing the profile by hand (loading a save, debug commands).
func Recompute(p *proto.Profile) {
	extra := 0
	if p.Stats.FilmCap > 0 {
		// Film.Cap above the stat is film the player loaded with a film roll.
		extra = max(0, p.Film.Cap-roundInt(p.Stats.FilmCap))
	}
	p.Stats = ComputeStats(p)
	p.Film.Cap = roundInt(p.Stats.FilmCap) + extra
	syncLevel(p)
}

// Capacity is the number of backpack slots (stacks) the player can carry.
func Capacity(p *proto.Profile) int { return roundInt(p.Stats.Capacity) }

// FreeSlots is how many more stacks fit in the backpack.
func FreeSlots(p *proto.Profile) int { return max(0, Capacity(p)-len(p.Inventory)) }

func roundInt(f float32) int { return int(math.Round(float64(f))) }

func containsString(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
