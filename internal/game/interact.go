package game

import (
	"hash/fnv"
	"sort"
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func takenFlag(poiID string) string { return "taken:" + poiID }

// dialogQuiet is how long after the last dialogue node the narrator assumes the
// conversation is still open (the client may close it without telling the server).
const dialogQuiet = 45

// msgInteract handles E on a POI, NPC, collectible or cache.
func (s *Session) msgInteract(d []byte) {
	var m proto.Interact
	if err := decode(d, &m); err != nil || m.POI == "" {
		s.fail("There is nothing there to use.")
		return
	}
	poi, ok := s.world.POI(m.POI)
	if !ok {
		s.fail("There is nothing there to use.")
		return
	}
	if !s.havePose || poi.Pos.DistXZ(s.feet) > poi.Radius+interactSlack {
		s.fail("That is too far away.")
		return
	}
	switch poi.Kind {
	case "npc":
		npc := poi.Data["npc"]
		if _, ok := content.NPC(npc); !ok {
			s.fail("There is nobody there.")
			return
		}
		s.talk(npc)
	case "shop":
		s.talk(content.NPCFinn)
	case "cabin":
		s.send(proto.SBase, proto.BaseMsg{FilmDeveloped: s.developed})
		s.developed = 0
		s.narrate(narrator.Event{Kind: narrator.CabinReturn})
	case "cache":
		s.openCache(poi)
	case "feather", "page", "relic":
		s.pickUp(poi)
	case "sign":
		text := poi.Data["text"]
		if text == "" {
			text = "A weathered signpost."
		}
		s.toast("info", poi.Name, text, 0, "map")
	default:
		s.toast("location", poi.Name, "", 0, "map")
	}
}

// talk opens a conversation.
func (s *Session) talk(npc string) {
	node := content.Talk(npc, s.p)
	s.questEvent(content.Talked(npc))
	s.send(proto.SDialog, node)
	s.dialogUntil = s.now + dialogQuiet
}

func (s *Session) msgDialogChoice(d []byte) {
	var m proto.DialogChoiceMsg
	if err := decode(d, &m); err != nil {
		s.fail("That choice could not be read.")
		return
	}
	def, ok := content.NPC(m.NPC)
	if !ok {
		s.send(proto.SDialog, proto.DialogNode{NPC: m.NPC, Lines: []string{}, Choices: []proto.DialogChoice{}})
		return
	}
	if !s.near(def.POI, npcUse) && !(m.NPC == content.NPCFinn && s.near("shop_finn", npcUse)) {
		s.send(proto.SDialog, proto.DialogNode{NPC: m.NPC, Lines: []string{}, Choices: []proto.DialogChoice{}})
		s.fail(def.Name + " is too far away to hear you.")
		return
	}
	node, acts := content.Choose(m.NPC, m.Choice, s.p)
	closing := false
	var rewards []proto.RewardsMsg
	for _, a := range acts {
		switch a.Kind {
		case content.ActionAcceptQuest:
			if err := s.acceptQuest(a.Quest); err != nil {
				s.failErr(err)
			}
		case content.ActionTurnInQuest:
			if r, err := s.turnIn(a.Quest); err != nil {
				s.failErr(err)
			} else {
				rewards = append(rewards, r)
			}
		case content.ActionGiveItem:
			qty := a.Qty
			if qty < 1 {
				qty = 1
			}
			for i := 0; i < qty; i++ {
				s.giveItems([]string{a.Item}, i == 0)
			}
		case content.ActionSetFlag:
			if a.Flag != "" {
				s.p.Flags[a.Flag] = a.Value
				s.changed()
			}
		case content.ActionClose:
			closing = true
		case content.ActionOpenShop:
			// The client opens the shop screen itself.
		}
	}
	if closing {
		node = proto.DialogNode{NPC: m.NPC, Name: def.Name, Role: def.Role, Lines: []string{}, Choices: []proto.DialogChoice{}}
	}
	s.send(proto.SDialog, node)
	if len(node.Lines) == 0 && len(node.Choices) == 0 {
		s.dialogUntil = 0
	} else {
		s.dialogUntil = s.now + dialogQuiet
	}
	for _, r := range rewards {
		s.send(proto.SRewards, r)
	}
}

// questPlace checks the player is where a quest is taken up or handed in: board
// contracts at the cabin, NPC quests with their giver.
func (s *Session) questPlace(id string) error {
	q, ok := content.QuestByID(id)
	if !ok {
		return gentleErr("There is no such quest.")
	}
	if q.Giver == content.BoardGiver {
		if !s.nearCabin() {
			return gentleErr("Research contracts are on the board at the cabin.")
		}
		return nil
	}
	if def, ok := content.NPC(q.Giver); ok && !s.near(def.POI, npcUse) {
		return gentleErr("Talk to " + def.Name + " about that.")
	}
	return nil
}

func (s *Session) acceptQuest(id string) error {
	acc, err := s.tracker.Accept(s.p, id, s.clock.Env().Day)
	if err != nil {
		return err
	}
	s.giveItems(acc.Items, true)
	s.reportProgress(acc.Progress)
	q, _ := content.QuestByID(id)
	s.toast("quest", "Quest accepted", q.Name, 0, "quest")
	s.changed()
	return nil
}

// turnIn pays a completed quest out and builds the Rewards screen.
func (s *Session) turnIn(id string) (proto.RewardsMsg, error) {
	q, _ := content.QuestByID(id)
	xp0, cr0, lvl0 := s.p.XPTotal, s.p.Credits, s.p.Level
	reward, err := s.tracker.TurnIn(s.p, id)
	if err != nil {
		return proto.RewardsMsg{}, err
	}
	_, items := progress.ApplyReward(s.p, reward)
	for _, it := range items {
		if def, ok := progress.Item(it); ok {
			if def.Kind == progress.KindEquipment && s.p.Equipped[def.Slot] == "" {
				_ = progress.Equip(s.p, it, true)
			}
			if unique(def) {
				s.send(proto.SRareItem, proto.RareItemMsg{Item: it})
			}
		}
	}
	r := proto.RewardsMsg{
		Title: q.Name, Subtitle: "Quest complete",
		XP: s.p.XPTotal - xp0, Credits: s.p.Credits - cr0,
		Items: nonNil(items), Rep: reward.Rep, SkillPoints: reward.SkillPoints,
		Journal: []string{},
	}
	if r.Rep == nil {
		r.Rep = map[string]int{}
	}
	for _, l := range reward.Lore {
		if def, ok := content.LoreByID(l); ok {
			r.Journal = append(r.Journal, "Natural History: "+def.Title)
		}
	}
	if reward.Badge != "" {
		r.Journal = append(r.Journal, "Badge earned")
	}
	if s.p.Level > lvl0 {
		r.LevelUp = s.p.Level
		s.lastLevel = s.p.Level // the Rewards screen announces it
	}
	s.changed()
	return r, nil
}

// ---------------------------------------------------------------------------
// Caches and collectibles (contract §3.6)

func (s *Session) openCache(poi core.POI) {
	if s.p.Flags[takenFlag(poi.ID)] {
		s.fail("It is empty now.")
		return
	}
	var items []string
	credits := 0
	lore := ""
	if it := poi.Data["item"]; it != "" && !progress.Owned(s.p, it) {
		items = []string{it}
	} else if poi.Data["item"] == "" {
		for _, it := range content.CacheLoot(regionKeyOf(poi)) {
			if !progress.Owned(s.p, it) {
				items = []string{it}
				break
			}
		}
	}
	if len(items) == 0 {
		f := content.ModestFind(poi.ID, s.p.Journal.Lore)
		items, credits, lore = f.Items, f.Credits, f.Lore
	}
	s.p.Flags[takenFlag(poi.ID)] = true
	s.giveItems(items, true)
	if credits > 0 {
		got := progress.GrantCredits(s.p, credits)
		s.toast("credits", "Field Credits", "+"+itoa(got), 0, "credits")
	}
	if s.addLore(lore) {
		if def, ok := content.LoreByID(lore); ok {
			s.toast("journal", "Natural History", def.Title, 0, "journal")
		}
	}
	xp := s.award(progress.SrcCollectible, poi.ID, progress.XPCollectible)
	s.toast("item", poi.Name, "Opened.", xp, "cache")
	s.questEvent(content.CacheOpened(poi.ID, s.at(poi.Pos)))
	s.changed()
}

func regionKeyOf(poi core.POI) string {
	if k := poi.Data["region"]; k != "" {
		return k
	}
	return poi.Region.Key()
}

func (s *Session) pickUp(poi core.POI) {
	if s.p.Flags[takenFlag(poi.ID)] {
		s.fail("There is nothing left here.")
		return
	}
	id := ""
	switch poi.Kind {
	case "feather":
		id = s.featherFor(poi)
	case "page":
		id = s.nextNumbered("page_", content.PageCount)
	case "relic":
		id = s.nextNumbered("relic_", content.RelicCount)
	}
	s.p.Flags[takenFlag(poi.ID)] = true
	s.changed()
	if id == "" {
		got := progress.GrantCredits(s.p, 15)
		s.toast("credits", poi.Name, "Nothing new, but a few coins: +"+itoa(got), 0, "credits")
		return
	}
	s.p.Journal.Collectibles[id] = s.clock.Env().Day
	xp := s.award(progress.SrcCollectible, id, progress.XPCollectible)
	for _, l := range content.LoreFor(id) {
		s.addLore(l)
	}
	title, text := "Collected", poi.Name
	if poi.Kind == "feather" {
		sp := s.spByID(id[len("feather_"):])
		if sp != nil && s.identified(sp.ID) {
			text = "A feather of " + withArticleLower(sp.Name) + "."
		} else {
			text = "A feather. Whose? You will know once you have identified its owner."
		}
	} else {
		for _, c := range content.Collectibles(nil) {
			if c.ID == id {
				text = c.Name
			}
		}
	}
	s.toast("item", title, text, xp, poi.Kind)
	s.questEvent(content.Collected(id, poi.Kind, s.at(poi.Pos)))
}

// featherFor resolves a feather POI to a species of its region type: deterministic
// per POI id, preferring feathers the player has not collected yet.
func (s *Session) featherFor(poi core.POI) string {
	r, ok := core.RegionFromKey(regionKeyOf(poi))
	if !ok {
		r = core.RegionGreenhollow
	}
	var ids []string
	for i := range s.species {
		for _, x := range s.species[i].Regions {
			if x == r {
				ids = append(ids, s.species[i].ID)
				break
			}
		}
	}
	if len(ids) == 0 {
		return ""
	}
	sort.Strings(ids)
	h := fnv.New32a()
	h.Write([]byte(poi.ID))
	start := int(h.Sum32() % uint32(len(ids)))
	for i := 0; i < len(ids); i++ {
		id := content.FeatherID(ids[(start+i)%len(ids)])
		if _, have := s.p.Journal.Collectibles[id]; !have {
			return id
		}
	}
	return ""
}

func (s *Session) nextNumbered(prefix string, n int) string {
	for i := 0; i < n; i++ {
		id := prefix + strconv.Itoa(i)
		if _, have := s.p.Journal.Collectibles[id]; !have {
			return id
		}
	}
	return ""
}
