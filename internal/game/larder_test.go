package game

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/save"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

func TestCatalogsValidate(t *testing.T) {
	h := newHarness(t, false)
	if errs := ValidateCatalogs(h.s.HomePOIIDs()); len(errs) > 0 {
		t.Fatalf("catalogs do not validate: %v", errs)
	}
}

// TestWelcomePhase2 checks the welcome carries the phase-2 catalogs and a profile
// whose new fields are present and never null.
func TestWelcomePhase2(t *testing.T) {
	h := newHarness(t, false)
	var raw json.RawMessage
	for _, m := range h.all {
		if m.T == proto.SWelcome {
			raw = m.D
		}
	}
	w := decodeAs[proto.Welcome](t, raw)
	if len(w.Trees) != 48 || len(w.Plants) != len(content.Plants()) || len(w.Recipes) != len(content.Recipes()) || len(w.Plants) < 18 || len(w.Recipes) < 19 {
		t.Fatalf("welcome: %d trees, %d plants, %d recipes", len(w.Trees), len(w.Plants), len(w.Recipes))
	}
	items := map[string]bool{}
	for _, it := range w.Items {
		items[it.ID] = true
	}
	for _, id := range []string{"blackberry", "pine_tips", "oats", "mint_tea", "forager_stew"} {
		if !items[id] {
			t.Errorf("welcome items lack %s", id)
		}
	}
	js := string(raw)
	for _, want := range []string{`"buffs":[]`, `"forage":{}`, `"plants":{}`, `"nests":[]`} {
		if !strings.Contains(js, want) {
			t.Errorf("welcome profile lacks %s", want)
		}
	}
	for _, r := range progress.StartingRecipes() {
		if !containsStr(w.Profile.Recipes, r) {
			t.Errorf("starting recipe %s not known", r)
		}
	}
}

// findPlant returns the nearest forage plant of a plant id around a point.
func findPlant(t *testing.T, w *world.World, at core.Vec3, plantID string) world.ForagePlant {
	t.Helper()
	pl, ok := content.Plant(plantID)
	if !ok {
		t.Fatalf("no plant %s", plantID)
	}
	var best world.ForagePlant
	bestD := float32(math.MaxFloat32)
	for _, fp := range w.ForageNear(at.X, at.Z, 450) {
		if int(fp.Veg.Kind) == pl.Veg && fp.Veg.Pos.Y > 0 {
			if d := fp.Veg.Pos.DistXZ(at); d < bestD {
				best, bestD = fp, d
			}
		}
	}
	if best.ID == "" {
		t.Fatalf("no %s within 450 m", plantID)
	}
	return best
}

// standBy stands the player 1.5 m from a plant on dry ground.
func (h *harness) standBy(fp world.ForagePlant) core.Vec3 {
	for a := 0; a < 8; a++ {
		p := fp.Veg.Pos.Add(core.HeadingDir(float32(a) * math.Pi / 4).Scale(1.5))
		p.Y = h.s.world.HeightAt(p.X, p.Z)
		if p.Y > 0 {
			h.stand(p, core.HeadingTo(p, fp.Veg.Pos))
			return p
		}
	}
	h.stand(fp.Veg.Pos, 0)
	return fp.Veg.Pos
}

func (h *harness) forage(id string) proto.ForagedMsg {
	h.t.Helper()
	h.send(proto.CForage, proto.ForageMsg{ID: id})
	d, ok := h.last(proto.SForaged)
	if !ok {
		h.t.Fatalf("no foraged reply for %s", id)
	}
	return decodeAs[proto.ForagedMsg](h.t, d)
}

func (h *harness) setSeason(se core.Season) {
	h.s.clock.SetSeason(se)
}

func TestForaging(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	cabin, _ := s.world.POI("cabin")
	fp := findPlant(t, s.world, cabin.Pos, "bramble")
	h.standBy(fp)
	h.tick(2)
	h.take()

	// Out of season: brambles bear in late summer and autumn.
	h.setSeason(core.Spring)
	if r := h.forage(fp.ID); r.OK || !strings.Contains(r.Reason, "season") || r.Plant != "bramble" {
		t.Fatalf("spring bramble: %+v", r)
	}
	if len(s.p.Journal.Plants) != 0 || len(s.p.Forage) != 0 {
		t.Fatal("a refused pick changed the profile")
	}

	// In season: 1..3 blackberries, the herbarium, XP once, recipes taught.
	h.setSeason(core.Autumn)
	// Make the accepted tea quest track forage events (it follows the tutorial).
	s.p.Quests["unseen_singer"] = &proto.QuestState{Status: "turned_in", Progress: map[string]int{}}
	s.tracker.Sync(s.p)
	if _, err := s.tracker.Accept(s.p, "tea_at_the_cabin", s.clock.Env().Day); err != nil {
		t.Fatalf("accept: %v", err)
	}
	xp0 := s.p.XPTotal
	r := h.forage(fp.ID)
	if !r.OK || !r.First || len(r.Got) != 1 || r.Got[0].Item != "blackberry" || r.Got[0].Qty < 1 || r.Got[0].Qty > 3 {
		t.Fatalf("autumn bramble: %+v", r)
	}
	if got := progress.Carried(s.p, "blackberry"); got != r.Got[0].Qty {
		t.Fatalf("carrying %d blackberries, reply said %d", got, r.Got[0].Qty)
	}
	e := s.p.Journal.Plants["bramble"]
	if e == nil || e.Picked != 1 || e.Region != int(core.RegionGreenhollow) {
		t.Fatalf("herbarium entry %+v", e)
	}
	if s.p.XPTotal-xp0 < progress.XPPlant {
		t.Fatalf("first pick paid %d XP", s.p.XPTotal-xp0)
	}
	want := content.RecipesLearnedBy("plant:bramble")
	for _, id := range want {
		if !progress.KnowsRecipe(s.p, id) {
			t.Errorf("recipe %s not learned from the first bramble", id)
		}
	}
	t.Logf("first bramble: got %v, learned %v (rule says %v)", r.Got, r.Learned, want)
	if h.questProgress("tea_at_the_cabin", firstObjective(t, "tea_at_the_cabin", content.KindForage)) != 1 {
		t.Errorf("forage objective not advanced")
	}
	if s.p.Forage[fp.ID] != s.clock.Env().Day {
		t.Fatalf("forage record %v", s.p.Forage)
	}

	// Regrowth: picked today, so refused; bears again after Regrow days, without XP.
	if r := h.forage(fp.ID); r.OK || !strings.Contains(r.Reason, "Already picked") {
		t.Fatalf("second pick the same day: %+v", r)
	}
	pl, _ := content.Plant("bramble")
	e0 := s.clock.Env()
	s.clock.Set(e0.Time, e0.Day+pl.Regrow)
	h.setSeason(core.Autumn)
	xp1 := s.p.XPTotal
	if r := h.forage(fp.ID); !r.OK || r.First {
		t.Fatalf("pick after regrowth: %+v", r)
	}
	if s.p.XPTotal != xp1 || s.p.Journal.Plants["bramble"].Picked != 2 {
		t.Fatalf("repeat pick paid %d XP, picked %d", s.p.XPTotal-xp1, s.p.Journal.Plants["bramble"].Picked)
	}
	// Old records are pruned.
	s.p.Forage["fg@999,999,0"] = 1
	e1 := s.clock.Env()
	s.clock.Set(e1.Time, e1.Day+progress.MaxRegrowDays)
	h.setSeason(core.Autumn)
	h.forage(fp.ID)
	if _, ok := s.p.Forage["fg@999,999,0"]; ok {
		t.Fatal("old forage record not pruned")
	}

	// A plant that teaches a recipe on its first pick.
	h.setSeason(core.Summer)
	cham := findPlant(t, s.world, cabin.Pos, "chamomile")
	h.standBy(cham)
	h.tick(150) // time passes between picks, as in play (the narrator paces itself)
	if r := h.forage(cham.ID); !r.OK || !r.First || len(r.Learned) != 1 || r.Learned[0] != "chamomile_tea" {
		t.Fatalf("first chamomile: %+v", r)
	}
	if !progress.KnowsRecipe(s.p, "chamomile_tea") {
		t.Fatal("chamomile tea not learned")
	}
	// The elder gives flowers in spring and berries in autumn (and its first pick
	// teaches the cordial and unlocks a Natural History entry).
	elder := findPlant(t, s.world, cabin.Pos, "elder")
	h.standBy(elder)
	h.tick(150)
	h.setSeason(core.Spring)
	if r := h.forage(elder.ID); !r.OK || r.Got[0].Item != "elderflower" || !containsStr(r.Learned, "elderflower_cordial") {
		t.Fatalf("spring elder: %+v", r)
	}
	if len(content.LoreFor("forage:elder")) > 0 && !containsStr(s.p.Journal.Lore, content.LoreFor("forage:elder")[0]) {
		t.Fatal("first elder pick unlocked no lore")
	}
	delete(s.p.Forage, elder.ID)
	h.setSeason(core.Autumn)
	if r := h.forage(elder.ID); !r.OK || r.Got[0].Item != "elderberry" {
		t.Fatalf("autumn elder: %+v", r)
	}

	// Too far, and ids that are not plants.
	far := fp.Veg.Pos.Add(core.V(9, 0, 0))
	far.Y = s.world.HeightAt(far.X, far.Z)
	h.stand(far, 0)
	if r := h.forage(fp.ID); r.OK || !strings.Contains(r.Reason, "too far") {
		t.Fatalf("pick from 9 m: %+v", r)
	}
	for _, bad := range []string{"", "fg@0,0,99999", "fg@00,0,1", "cabin", "fg@1,2,3x"} {
		if r := h.forage(bad); r.OK {
			t.Fatalf("pick of %q succeeded", bad)
		}
	}
	activity := 0
	for _, n := range narrationSpoilers(t, h) {
		t.Logf("narrator [%s]: %s", n.Kind, n.Text)
		if n.Kind == "activity" {
			activity++
		}
	}
	if activity == 0 {
		t.Error("no foraging mumble from the narrator for three first picks")
	}
}

func firstObjective(t *testing.T, quest, kind string) string {
	q, ok := content.QuestByID(quest)
	if !ok {
		t.Fatalf("no quest %s", quest)
	}
	for _, o := range q.Objectives {
		if o.Kind == kind {
			return o.ID
		}
	}
	t.Fatalf("quest %s has no %s objective", quest, kind)
	return ""
}

// TestForagingFullPack: a full pack refuses the pick and changes nothing.
func TestForagingFullPack(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	cabin, _ := s.world.POI("cabin")
	fp := findPlant(t, s.world, cabin.Pos, "young_pine") // bears all year
	h.standBy(fp)
	h.tick(1)
	// Fill every free slot with full stacks of other ingredients.
	var other []string
	for _, id := range progress.ForagedIngredients() {
		if id != "pine_tips" {
			other = append(other, id)
		}
	}
	for i := 0; progress.FreeSlots(s.p) > 0; i++ {
		def, _ := progress.Item(other[i%len(other)])
		if _, err := progress.AddToPack(s.p, def.ID, def.Stack); err != nil {
			t.Fatalf("fill the pack: %v", err)
		}
	}
	before := profileJSON(s)
	r := h.forage(fp.ID)
	if r.OK || !strings.Contains(strings.ToLower(r.Reason), "full") || !strings.Contains(r.Reason, "would make room") {
		t.Fatalf("pick into a full pack: %+v", r)
	}
	if profileJSON(s) != before {
		t.Fatal("a refused pick changed the profile")
	}
}

// recipeOf returns a recipe of a station, and gives the player its inputs.
func (h *harness) stockFor(r proto.RecipeDef, batches int) {
	for _, in := range r.Inputs {
		if _, err := progress.AddItem(h.s.p, in.Item, in.Qty*batches); err != nil {
			h.t.Fatalf("give %s: %v", in.Item, err)
		}
	}
}

func recipeAt(t *testing.T, station string) proto.RecipeDef {
	for _, r := range content.Recipes() {
		if r.Station == station {
			return r
		}
	}
	t.Fatalf("no %s recipe", station)
	return proto.RecipeDef{}
}

func TestCooking(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	tea, _ := content.Recipe("pine_tip_tea")
	stove := recipeAt(t, content.StationStove)

	// Away from any fire: refused.
	cabin, _ := s.world.POI("cabin")
	away := cabin.Pos.Add(core.V(60, 0, 60))
	away.Y = s.world.HeightAt(away.X, away.Z)
	h.stand(away, 0)
	h.stockFor(tea, 2)
	h.take()
	before := profileJSON(s)
	h.send(proto.CCook, proto.CookMsg{Recipe: tea.ID, Qty: 1})
	if msg, ok := hasError(h.take()); !ok || !strings.Contains(msg, "fire") {
		t.Fatalf("cooking away from a fire: %q", msg)
	}
	if profileJSON(s) != before {
		t.Fatal("refused cook changed the profile")
	}

	// At the cabin: kettle recipe works, pays XP once.
	h.standNear("cabin", 6)
	h.take()
	xp0 := s.p.XPTotal
	h.send(proto.CCook, proto.CookMsg{Recipe: tea.ID, Qty: 1})
	ms := h.take()
	if msg, bad := hasError(ms); bad {
		t.Fatalf("cook at the cabin: %s", msg)
	}
	if progress.Carried(s.p, tea.Output) != tea.Qty || s.p.XPTotal-xp0 < progress.XPCook {
		t.Fatalf("made %d %s, XP +%d", progress.Carried(s.p, tea.Output), tea.Output, s.p.XPTotal-xp0)
	}
	if countType(ms, proto.SProfile) == 0 {
		t.Fatal("no profile push after cooking")
	}
	xp1 := s.p.XPTotal
	h.send(proto.CCook, proto.CookMsg{Recipe: tea.ID, Qty: 1})
	if msg, bad := hasError(h.take()); bad || s.p.XPTotal != xp1 {
		t.Fatalf("second cook: %q, XP +%d", msg, s.p.XPTotal-xp1)
	}

	// Unknown and unlearned recipes, missing inputs: refused, nothing changes.
	h.send(proto.CCook, proto.CookMsg{Recipe: "no_such_thing", Qty: 1})
	if _, bad := hasError(h.take()); !bad {
		t.Fatal("unknown recipe accepted")
	}
	before = profileJSON(s)
	h.send(proto.CCook, proto.CookMsg{Recipe: stove.ID, Qty: 1})
	if msg, bad := hasError(h.take()); !bad || profileJSON(s) != before {
		t.Fatalf("unlearned recipe: %q", msg)
	}
	progress.LearnRecipe(s.p, stove.ID)
	before = profileJSON(s)
	h.send(proto.CCook, proto.CookMsg{Recipe: stove.ID, Qty: 1})
	if msg, bad := hasError(h.take()); !bad || profileJSON(s) != before {
		t.Fatalf("cook without inputs: %q", msg)
	}
	h.stockFor(stove, 1)
	h.send(proto.CCook, proto.CookMsg{Recipe: stove.ID, Qty: 1})
	if msg, bad := hasError(h.take()); bad || progress.Carried(s.p, stove.Output) < stove.Qty {
		t.Fatalf("stove recipe at the cabin: %q", msg)
	}

	// At a camp's fire: kettle yes, stove no.
	h.standNear("camp_survey", 5)
	h.stockFor(tea, 1)
	h.stockFor(stove, 1)
	h.take()
	before = profileJSON(s)
	h.send(proto.CCook, proto.CookMsg{Recipe: stove.ID, Qty: 1})
	if msg, bad := hasError(h.take()); !bad || !strings.Contains(msg, "stove") || profileJSON(s) != before {
		t.Fatalf("stove recipe at a camp: %q", msg)
	}
	n0 := progress.Carried(s.p, tea.Output)
	h.send(proto.CCook, proto.CookMsg{Recipe: tea.ID})
	if msg, bad := hasError(h.take()); bad || progress.Carried(s.p, tea.Output) != n0+tea.Qty {
		t.Fatalf("kettle recipe at a camp: %q", msg)
	}
}

// TestBuffs: eating applies the buff, the stats change and reach perception and the
// ecosystem observer, and the buff expires on the game clock (on the tick, after a
// rest and after loading a save).
func TestBuffs(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	feet := h.standNear("cabin", 8)
	h.tick(2)

	// A call just beyond the player's hearing.
	ctx := s.fieldCtx()
	sp := s.spByID("european_robin")
	ev := core.EcoEvent{Kind: core.EvCall, Bird: 1, Species: sp.Index, Call: 0, Repeats: 3, Seed: 7}
	pose := s.pose
	bird := core.BirdState{ID: 1, Species: sp.Index}
	dir := core.HeadingDir(1.3)
	place := func(d float32) {
		ev.Pos = s.eye().Add(dir.Scale(d))
		bird.Pos = ev.Pos
	}
	place(40)
	base, _ := field.Hear(ctx, ev, bird, pose, rand.New(rand.NewPCG(1, 2)))
	if base.Range <= 0 {
		t.Fatalf("robin inaudible: %+v", base)
	}
	baseCtx := *ctx
	obs0 := s.observer()
	hear0 := s.p.Stats.HearRange

	// Mint tea: sharper ears.
	progress.AddItem(s.p, "mint_tea", 1)
	h.take()
	h.send(proto.CUse, proto.ItemAction{Item: "mint_tea"})
	ms := h.take()
	if msg, bad := hasError(ms); bad {
		t.Fatalf("drink mint tea: %s", msg)
	}
	if len(s.p.Buffs) != 1 || s.p.Buffs[0].Item != "mint_tea" || s.p.Stats.HearRange <= hear0 {
		t.Fatalf("buffs %+v, hearRange %v -> %v", s.p.Buffs, hear0, s.p.Stats.HearRange)
	}
	pv := decodeAs[proto.Profile](t, lastPayload(t, ms, proto.SProfile))
	if len(pv.Buffs) != 1 || pv.Stats.HearRange != s.p.Stats.HearRange {
		t.Fatalf("pushed profile buffs %+v", pv.Buffs)
	}
	ctx = s.fieldCtx()
	if hd, _ := field.Hear(ctx, ev, bird, pose, rand.New(rand.NewPCG(1, 2))); hd.Range < base.Range*1.09 {
		t.Fatalf("mint tea did not extend hearing: range %.1f -> %.1f at the same spot", base.Range, hd.Range)
	}
	// An outcome flips: somewhere along the line a call goes from unheard to heard.
	flipped := false
	for d := float32(20); d < 300 && !flipped; d += 0.5 {
		place(d)
		_, before := field.Hear(&baseCtx, ev, bird, pose, rand.New(rand.NewPCG(1, 2)))
		_, after := field.Hear(ctx, ev, bird, pose, rand.New(rand.NewPCG(1, 2)))
		if after && !before {
			flipped = true
			t.Logf("a robin %.1f m away: unheard before the tea, heard after", d)
		}
	}
	if !flipped {
		t.Fatal("mint tea changed no hearing outcome")
	}

	// Chamomile tea replaces the drink: calmer wildlife, quieter approach.
	progress.AddItem(s.p, "chamomile_tea", 1)
	h.send(proto.CUse, proto.ItemAction{Item: "chamomile_tea"})
	if len(s.p.Buffs) != 1 || s.p.Buffs[0].Item != "chamomile_tea" {
		t.Fatalf("drink slot: %+v", s.p.Buffs)
	}
	obs1 := s.observer()
	if !(obs1.Settle > obs0.Settle && obs1.Stealth < obs0.Stealth) {
		t.Fatalf("observer not changed: settle %v->%v stealth %v->%v", obs0.Settle, obs1.Settle, obs0.Stealth, obs1.Stealth)
	}
	// A snack in its own slot stacks with the drink; raw berries count.
	progress.AddItem(s.p, "blackberry", 1)
	h.send(proto.CUse, proto.ItemAction{Item: "blackberry"})
	if len(s.p.Buffs) != 2 {
		t.Fatalf("snack + drink: %+v", s.p.Buffs)
	}
	// Not everything is edible.
	progress.AddItem(s.p, "elderberry", 1)
	h.take()
	h.send(proto.CUse, proto.ItemAction{Item: "elderberry"})
	if _, bad := hasError(h.take()); !bad {
		t.Fatal("raw elderberries eaten")
	}

	// Expiry on the tick: the snack (1 h) runs out first.
	e := s.clock.Env()
	s.clock.Set(e.Time+1.2, e.Day)
	h.send(proto.CPose, standPose(feet, 0))
	h.tick(1)
	ms = h.take()
	if len(s.p.Buffs) != 1 || s.p.Buffs[0].Item != "chamomile_tea" {
		t.Fatalf("after 1.2 h: %+v", s.p.Buffs)
	}
	if countType(ms, proto.SProfile) == 0 {
		t.Fatal("no profile push when a buff expired")
	}
	// Expiry through resting.
	until := float32(math.Mod(float64(s.clock.Env().Time)+5, 24))
	h.send(proto.CCabin, proto.CabinAction{Action: "rest", Until: until})
	if len(s.p.Buffs) != 0 || s.p.Stats.Settle != obs0.Settle || s.p.Stats.HearRange != hear0 {
		t.Fatalf("after resting: buffs %+v, settle %v", s.p.Buffs, s.p.Stats.Settle)
	}

	// Expiry across a save: a buff saved that has run out by the restored clock.
	progress.AddItem(s.p, "mint_tea", 1)
	h.send(proto.CUse, proto.ItemAction{Item: "mint_tea"})
	s.p.Buffs[0].Until = s.gameHours() - 0.5
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	s2 := newSession(t, h.dir, "", true)
	if len(s2.p.Buffs) != 0 || s2.p.Stats.HearRange != hear0 {
		t.Fatalf("expired buff survived loading: %+v", s2.p.Buffs)
	}
}

func lastPayload(t *testing.T, ms []outMsg, typ string) json.RawMessage {
	d, ok := lastOf(ms, typ)
	if !ok {
		t.Fatalf("no %s message", typ)
	}
	return d
}

// TestRecipeLearning: an NPC teaches a recipe through dialogue actions, and lore
// unlocked from any source teaches its recipe.
func TestRecipeLearning(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	if progress.KnowsRecipe(s.p, "forager_stew") {
		t.Fatal("forager stew known from the start")
	}
	s.addLore("keepers_stew")
	h.tick(1)
	if !progress.KnowsRecipe(s.p, "forager_stew") {
		t.Fatal("keepers_stew lore did not teach forager_stew")
	}
	// The dialogue action.
	s.learnRecipe("elderberry_syrup")
	if !progress.KnowsRecipe(s.p, "elderberry_syrup") || s.learnRecipe("elderberry_syrup") {
		t.Fatal("learnRecipe")
	}
}

// TestOldSaveMigrates: a save made before phase 2 (format 1, none of the new
// profile fields) loads, gains the starting recipes and non-null maps and lists,
// learns recipes from lore it already had, and is written back in format 2.
func TestOldSaveMigrates(t *testing.T) {
	dir := t.TempDir()
	old := `{"version":1,"seed":5,"seedText":"old","profile":{"name":"Old Hand","level":4,"xpTotal":900,
		"inventory":[{"item":"film_roll","qty":1}],
		"journal":{"species":{},"lore":["keepers_stew"],"collectibles":{"page_0":1}},
		"flags":{"region:greenhollow":true}},
		"clock":{"hours":30},"seq":{"photo":0}}`
	if err := os.WriteFile(filepath.Join(dir, "save.json"), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	s := newSession(t, dir, "", false)
	out := &capture{}
	s.Attach(out)
	s.Handle(proto.CHello, []byte(`{"name":"Old Hand"}`))
	if s.p.Name != "Old Hand" || s.seed != 5 {
		t.Fatalf("not the old adventure: %s %d", s.p.Name, s.seed)
	}
	for _, r := range append(progress.StartingRecipes(), "forager_stew") {
		if !progress.KnowsRecipe(s.p, r) {
			t.Errorf("recipe %s missing after migration", r)
		}
	}
	var welcome json.RawMessage
	for _, m := range out.msgs {
		if m.T == proto.SWelcome {
			welcome = m.D
		}
	}
	js := string(welcome)
	for _, want := range []string{`"buffs":[]`, `"forage":{}`, `"plants":{}`, `"nests":[]`, `"recipes":["`} {
		if !strings.Contains(js, want) {
			t.Errorf("migrated profile lacks %s", want)
		}
	}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "save.json"))
	var v struct{ Version int }
	_ = json.Unmarshal(b, &v)
	if v.Version != save.Version || save.Version < 2 {
		t.Fatalf("saved as version %d", v.Version)
	}
}
