package game

import (
	"errors"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The field kitchen (contract §12): picking forage plants, cooking at the cabin or a
// camp's fire, eating and drinking for timed buffs.

const (
	forageReach = 3  // m from the player's feet to the plant's base (the client offers E within 2.5 m)
	campCook    = 12 // m from a camp POI: its fire is a kettle
)

// gameHours is the absolute game clock in hours, (day-1)*24 + time of day: the unit
// of proto.Buff.Until.
func (s *Session) gameHours() float64 {
	e := s.clock.Env()
	return float64(e.Day-1)*24 + float64(e.Time)
}

// expireBuffs removes buffs that have run out on the game clock; stats are
// recomputed and the profile pushed when anything changed. Called every tick, after
// resting and after loading a save.
func (s *Session) expireBuffs() {
	before := s.p.Buffs
	if !progress.ExpireBuffs(s.p, s.gameHours()) {
		return
	}
	kept := map[string]bool{}
	for _, b := range s.p.Buffs {
		kept[b.Slot+"/"+b.Item] = true
	}
	for _, b := range before {
		if !kept[b.Slot+"/"+b.Item] && s.out != nil && s.greeted {
			s.toast("info", "Worn off", b.Name, 0, "buff")
		}
	}
	s.changed()
}

// learnRecipe teaches a recipe and announces it; false if it was already known.
func (s *Session) learnRecipe(id string) bool {
	r, ok := content.Recipe(id)
	if !ok || !progress.LearnRecipe(s.p, id) {
		return false
	}
	s.toast("journal", "Recipe learned", r.Name, 0, "recipe")
	s.changed()
	return true
}

// syncLoreRecipes teaches the recipes whose Learn rule is "lore:<id>" for every
// Natural History entry the player has, whatever unlocked it (a quest reward, a
// journal page, a cache, a first pick).
func (s *Session) syncLoreRecipes() {
	for _, l := range s.p.Journal.Lore {
		for _, id := range content.RecipesLearnedBy(content.LearnLore + l) {
			if !progress.KnowsRecipe(s.p, id) {
				s.learnRecipe(id)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Foraging

func (s *Session) forageFail(id, plant, reason string) {
	s.send(proto.SForaged, proto.ForagedMsg{ID: id, OK: false, Plant: plant, Got: []proto.ItemStack{}, Learned: []string{}, Reason: reason})
}

// msgForage picks from a forage plant (contract §12).
func (s *Session) msgForage(d []byte) {
	var m proto.ForageMsg
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	id := trim(m.ID, 64)
	veg, ok := s.world.ForageAt(id)
	if !ok {
		s.forageFail(id, "", "There is nothing to pick there.")
		return
	}
	plant, ok := content.PlantByVeg(int(veg.Kind))
	if !ok {
		s.forageFail(id, "", "There is nothing to pick there.")
		return
	}
	if !s.havePose || veg.Pos.Dist(s.feet) > forageReach {
		s.forageFail(id, plant.ID, "That is too far away.")
		return
	}
	env := s.clock.Env()
	yields := content.YieldsIn(plant.ID, int(env.Season))
	if len(yields) == 0 {
		s.forageFail(id, plant.ID, "Nothing to pick this season.")
		return
	}
	if !progress.ForageReady(s.p, id, env.Day, plant.Regrow) {
		left := plant.Regrow - (env.Day - s.p.Forage[id])
		reason := "Already picked. It will bear again in a few days."
		if left == 1 {
			reason = "Already picked. It will bear again tomorrow."
		}
		s.forageFail(id, plant.ID, reason)
		return
	}
	var got []proto.ItemStack
	full := false
	for _, y := range yields {
		qty := y.Min
		if y.Max > y.Min {
			qty += s.rng.IntN(y.Max - y.Min + 1)
		}
		added, err := progress.AddForage(s.p, y.Item, qty)
		if err != nil {
			full = full || errors.Is(err, progress.ErrPackFull)
			continue
		}
		got = append(got, proto.ItemStack{Item: y.Item, Qty: added})
		if added < qty {
			full = true
		}
	}
	if len(got) == 0 {
		reason := "Your pack is full. Make some room first."
		if !full {
			reason = "There is nothing to pick there."
		}
		s.forageFail(id, plant.ID, reason)
		if full {
			s.narrate(narrator.Event{Kind: narrator.PackFull})
		}
		return
	}
	progress.MarkForaged(s.p, id, env.Day)
	progress.PruneForage(s.p, env.Day)
	region := s.world.RegionAt(veg.Pos.X, veg.Pos.Z)
	first, xp, _ := progress.RecordForage(s.p, plant.ID, int(region), env.Day)
	res := proto.ForagedMsg{ID: id, OK: true, Plant: plant.ID, Got: got, First: first, Learned: []string{}}
	if first {
		s.toast("journal", "Herbarium", plant.Name+" pressed into your herbarium.", xp, "herbarium")
		for _, r := range content.RecipesLearnedBy(content.LearnPlant + plant.ID) {
			if s.learnRecipe(r) {
				res.Learned = append(res.Learned, r)
			}
		}
		for _, l := range content.LoreFor("forage:" + plant.ID) {
			if s.addLore(l) {
				if def, ok := content.LoreByID(l); ok {
					s.toast("journal", "Natural History", def.Title, 0, "journal")
				}
			}
		}
	}
	s.changed()
	s.send(proto.SForaged, res)
	s.questEvent(content.Foraged(plant.ID, s.at(veg.Pos)))
	s.narrate(narrator.Event{Kind: narrator.Foraged, Item: plant.ID, Yield: got[0].Item, First: first})
	if full {
		s.narrate(narrator.Event{Kind: narrator.PackFull})
	}
}

// ---------------------------------------------------------------------------
// Cooking

// nearCamp reports whether the player stands within campCook metres of a camp POI.
func (s *Session) nearCamp() bool {
	if !s.havePose {
		return false
	}
	s.poiBuf = s.world.POIsNear(s.feet.X, s.feet.Z, campCook+1, s.poiBuf[:0])
	for _, poi := range s.poiBuf {
		if poi.Kind == "camp" && poi.Pos.DistXZ(s.feet) <= campCook {
			return true
		}
	}
	return false
}

// msgCook prepares a recipe (contract §12).
func (s *Session) msgCook(d []byte) {
	var m proto.CookMsg
	if err := decode(d, &m); err != nil {
		s.fail("That could not be read.")
		return
	}
	r, ok := content.Recipe(m.Recipe)
	if !ok {
		s.fail("There is no such recipe.")
		return
	}
	if m.Qty == 0 {
		m.Qty = 1
	}
	atCabin, atCamp := s.nearCabin(), s.nearCamp()
	if !atCabin && !atCamp {
		s.fail("You need a fire for that: the cabin's kitchen, or a camp's fire.")
		return
	}
	if !content.RecipeStationOK(r, atCabin, atCamp) {
		s.fail(r.Name + " needs the stove at the cabin.")
		return
	}
	res, err := progress.Cook(s.p, r, m.Qty)
	if err != nil {
		if errors.Is(err, progress.ErrPackFull) {
			s.narrate(narrator.Event{Kind: narrator.PackFull})
		}
		s.failErr(err)
		return
	}
	def, _ := progress.Item(res.Item)
	slot := ""
	if def.Buff != nil {
		slot = def.Buff.Slot
	}
	s.toast("item", "Cooked", def.Name+" ×"+itoa(res.Made), res.XP, def.Icon)
	s.changed()
	s.questEvent(content.Cooked(r.ID, slot, m.Qty))
	s.narrate(narrator.Event{Kind: narrator.Cooked, Item: res.Item, First: res.FirstTime})
}

// ---------------------------------------------------------------------------
// Eating

// eat eats or drinks one unit of a food or edible ingredient for its buff.
func (s *Session) eat(item string) error {
	b, err := progress.Eat(s.p, item, s.gameHours())
	if err != nil {
		return err
	}
	s.toast("buff", b.Name, b.Text, 0, "buff")
	s.changed()
	s.questEvent(content.Eaten(item, b.Slot))
	s.narrate(narrator.Event{Kind: narrator.Ate, Item: item})
	return nil
}

// edible reports whether an item is eaten (use "eat").
func edible(id string) bool {
	def, ok := progress.Item(id)
	return ok && def.Use == progress.UseEat
}

// sanitizeLarder repairs the field-kitchen part of a loaded profile: unknown
// recipes, plants and nest entries are dropped, buffs of unknown items removed.
func (s *Session) sanitizeLarder(p *proto.Profile) {
	recs := p.Recipes[:0]
	for _, id := range p.Recipes {
		if _, ok := content.Recipe(id); ok && !containsStr(recs, id) {
			recs = append(recs, id)
		}
	}
	p.Recipes = recs
	buffs := p.Buffs[:0]
	for _, b := range p.Buffs {
		if edible(b.Item) {
			buffs = append(buffs, b)
		}
	}
	p.Buffs = buffs
	for id, e := range p.Journal.Plants {
		if _, ok := content.Plant(id); !ok || e == nil {
			delete(p.Journal.Plants, id)
			continue
		}
		e.ID = id
	}
	for id := range p.Forage {
		if len(id) > 64 {
			delete(p.Forage, id)
		}
	}
	known := map[string]bool{}
	for i := range s.species {
		known[s.species[i].ID] = true
	}
	nests := p.Journal.Nests[:0]
	seen := map[string]bool{}
	for _, n := range p.Journal.Nests {
		if n == nil || n.ID == "" || seen[n.ID] {
			continue
		}
		seen[n.ID] = true
		if !known[n.Species] {
			n.Species = ""
		}
		nests = append(nests, n)
	}
	p.Journal.Nests = nests
}
