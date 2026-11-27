package content

import (
	"fmt"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/species"
)

var npcIDs = []string{NPCMara, NPCFinn, NPCAlder, NPCJune}

// profileVariants are the player states a conversation can meet: a beginner, the
// tutorial at every step, and every rank with the tutorial handed in, with finished
// and active quests of every giver, and a rare discovery in the journal.
func profileVariants() map[string]*proto.Profile {
	out := map[string]*proto.Profile{"fresh": newProfile()}

	met := newProfile()
	met.Flags["tutorial:intro"] = true
	out["intro done"] = met

	for _, st := range []string{StatusAvailable, StatusActive, StatusComplete} {
		p := newProfile()
		setStatus(p, st, TutorialQuest)
		out["tutorial "+st] = p
	}
	tr := NewTracker()
	steps := []Event{
		Heard(tutorialSpecies, false, noPlace), Observed(tutorialSpecies, "perched", noPlace),
		Recorded(tutorialSpecies, 2, noPlace), Identified(tutorialSpecies, "sound", 0, noPlace),
	}
	for n := 1; n <= len(steps); n++ {
		p := newProfile()
		tr.Accept(p, TutorialQuest, 1)
		for _, ev := range steps[:n] {
			tr.OnEvent(p, ev)
		}
		out[fmt.Sprintf("tutorial step %d", n)] = p
	}

	for rank := 1; rank <= 5; rank++ {
		p := afterTutorial()
		p.Rank = rank
		p.Credits = 400
		p.Rep = map[string]int{FactionNaturalists: 70 * rank, FactionOutfitters: 50 * rank, FactionResearch: 120, FactionRangers: 70}
		for i := 0; i < rank*6; i++ {
			speciesEntry(p, fmt.Sprintf("sp%d", i), 4+i%2, "sight")
		}
		p.Journal.Rare = []*proto.RareDiscovery{{ID: "r1", Kind: "out_of_range", Title: "A Wheatear in the Meadow"}}
		out[fmt.Sprintf("rank %d", rank)] = p

		q := *p
		q.Quests = map[string]*proto.QuestState{}
		setStatus(&q, StatusTurnedIn, TutorialQuest)
		for _, d := range Quests() {
			switch (len(d.ID) + rank) % 3 {
			case 0:
				setStatus(&q, StatusComplete, d.ID)
			case 1:
				setStatus(&q, StatusActive, d.ID)
			}
		}
		setStatus(&q, StatusTurnedIn, TutorialQuest)
		out[fmt.Sprintf("rank %d busy", rank)] = &q
	}
	every := afterTutorial()
	every.Rank = 5
	for _, d := range Quests() {
		setStatus(every, StatusTurnedIn, d.ID)
	}
	out["everything done"] = every
	return out
}

// walkNPC visits every node reachable from Talk by any sequence of choices (the
// conversation graph is stateless, so this is a plain graph search) and checks the
// invariants of a good conversation.
func walkNPC(t *testing.T, npc string, p *proto.Profile, visit func(proto.DialogNode)) {
	t.Helper()
	first := Talk(npc, p)
	if len(first.Lines) == 0 {
		t.Errorf("%s: Talk opens with an empty node", npc)
	}
	seen := map[string]bool{}
	type item struct {
		node proto.DialogNode
		via  string
	}
	queue := []item{{first, "Talk"}}
	for len(queue) > 0 {
		it := queue[0]
		queue = queue[1:]
		n := it.node
		visit(n)
		where := fmt.Sprintf("%s via %s", npc, it.via)
		if n.NPC != npc || n.Name == "" || n.Role == "" {
			t.Errorf("%s: node header %+v", where, n)
		}
		if len(n.Lines) == 0 {
			t.Errorf("%s: an empty node in the middle of a conversation", where)
			continue
		}
		exit := false
		ids := map[string]bool{}
		for _, c := range n.Choices {
			if c.ID == "" || c.Text == "" || c.Kind == "" {
				t.Errorf("%s: malformed choice %+v", where, c)
			}
			if ids[c.ID] {
				t.Errorf("%s: duplicate choice id %q", where, c.ID)
			}
			ids[c.ID] = true
			if c.Kind == choiceBye {
				exit = true
			}
			if seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			next, acts := Choose(npc, c.ID, p)
			if c.Kind == choiceBye {
				if len(next.Lines) != 0 || len(next.Choices) != 0 || len(acts) == 0 || acts[len(acts)-1].Kind != ActionClose {
					t.Errorf("%s: leaving must close the conversation, got %+v %+v", where, next, acts)
				}
				continue
			}
			queue = append(queue, item{next, c.ID})
		}
		if !exit {
			t.Errorf("%s: no way to leave from %q", where, n.Lines[0])
		}
		if n.Rewards != nil && n.Quest == "" {
			t.Errorf("%s: rewards without a quest", where)
		}
	}
}

func allNodes(t *testing.T, npc string, p *proto.Profile) []proto.DialogNode {
	var out []proto.DialogNode
	walkNPC(t, npc, p, func(n proto.DialogNode) { out = append(out, n) })
	return out
}

func TestDialogueGraphWalkNeverDeadEnds(t *testing.T) {
	for name, p := range profileVariants() {
		for _, npc := range npcIDs {
			t.Run(npc+"/"+name, func(t *testing.T) { walkNPC(t, npc, p, func(proto.DialogNode) {}) })
		}
	}
}

func TestDialogueIsStatelessAndNeverMutatesTheProfile(t *testing.T) {
	p := afterTutorial()
	before := fmt.Sprintf("%+v %+v", *p, p.Quests)
	for _, npc := range npcIDs {
		a := Talk(npc, p)
		b := Talk(npc, p)
		if fmt.Sprint(a) != fmt.Sprint(b) {
			t.Errorf("%s: Talk is not deterministic", npc)
		}
		for _, c := range a.Choices {
			Choose(npc, c.ID, p)
		}
	}
	if after := fmt.Sprintf("%+v %+v", *p, p.Quests); after != before {
		t.Error("dialogue modified the profile")
	}
}

func TestUnknownIDsFallBackToTheMenu(t *testing.T) {
	p := afterTutorial()
	for _, npc := range npcIDs {
		n, acts := Choose(npc, "no_such_node", p)
		if len(n.Lines) == 0 || len(n.Choices) == 0 {
			t.Errorf("%s: stale id left the player stuck: %+v", npc, n)
		}
		for _, a := range acts {
			if a.Kind != ActionSetFlag {
				t.Errorf("%s: stale id fired %+v", npc, a)
			}
		}
	}
	if n, acts := Choose("ghost", "hub", p); len(n.Lines) != 0 || len(acts) != 1 || acts[0].Kind != ActionClose {
		t.Errorf("unknown npc: %+v %+v", n, acts)
	}
	if n := Talk("ghost", p); len(n.Lines) != 0 || n.Choices == nil {
		t.Errorf("unknown npc Talk: %+v", n)
	}
	if n := Talk(NPCMara, nil); len(n.Lines) == 0 {
		t.Error("Talk with a nil profile")
	}
}

func TestMaraFirstConversationIsTheTutorial(t *testing.T) {
	p := newProfile()
	n := Talk(NPCMara, p)
	var said []string
	say := func(n proto.DialogNode) { said = append(said, n.Lines...) }
	say(n)
	// Follow "next" choices: welcome, movement, listening, binoculars, journal, quest offer.
	flags := map[string]bool{}
	var offer proto.DialogNode
	for step := 0; step < 12; step++ {
		var pick *proto.DialogChoice
		for i := range n.Choices {
			if n.Choices[i].Kind == choiceNext {
				pick = &n.Choices[i]
				break
			}
		}
		if pick == nil {
			t.Fatalf("the tutorial stopped after %d steps: %+v", step, n.Choices)
		}
		var acts []Action
		n, acts = Choose(NPCMara, pick.ID, p)
		for _, a := range acts {
			if a.Kind == ActionSetFlag {
				flags[a.Flag] = true
			}
		}
		say(n)
		if n.Quest == TutorialQuest {
			offer = n
			break
		}
	}
	if offer.Quest != TutorialQuest || offer.Rewards == nil || offer.Rewards.XP != 300 {
		t.Fatalf("the tutorial never led to the quest offer: %+v", offer)
	}
	text := strings.ToLower(strings.Join(said, " "))
	for _, want := range []string{"wasd", "shift", "hold f", "press 1", "right mouse", "press j", "press e", "press t"} {
		if !strings.Contains(text, want) {
			// The lessons use letters and phrases in prose; check the key concepts instead.
			alt := map[string]string{"wasd": "w, a, s and d", "hold f": "hold f", "press 1": "press 1", "press j": "press j"}[want]
			if alt == "" || !strings.Contains(text, alt) {
				t.Errorf("the tutorial never mentions %q", want)
			}
		}
	}
	for _, f := range []string{"tutorial:move", "tutorial:listen", "tutorial:binoculars", "tutorial:journal", "tutorial:intro"} {
		if !flags[f] {
			t.Errorf("flag %s never set", f)
		}
	}
	// Accepting returns the accept action; the recorder comes with Tracker.Accept.
	n, acts := Choose(NPCMara, "accept:"+TutorialQuest, p)
	if len(acts) == 0 || acts[0].Kind != ActionAcceptQuest || acts[0].Quest != TutorialQuest {
		t.Fatalf("accept actions = %+v", acts)
	}
	if !strings.Contains(strings.Join(n.Lines, " "), "recorder") {
		t.Errorf("Mara does not hand over the recorder: %v", n.Lines)
	}
	a, err := NewTracker().Accept(p, TutorialQuest, 1)
	if err != nil || len(a.Items) != 1 || a.Items[0] != "basic_recorder" {
		t.Errorf("Accept = %+v, %v", a, err)
	}
	// A later visit while the quest is active coaches the current step.
	n = Talk(NPCMara, p)
	if len(n.Lines) == 0 || !strings.Contains(strings.ToLower(strings.Join(n.Lines, " ")), "listen") {
		t.Errorf("progress coaching: %v", n.Lines)
	}
}

func TestMaraReactsToProgress(t *testing.T) {
	text := func(p *proto.Profile) string { return strings.Join(Talk(NPCMara, p).Lines, " ") }
	p := afterTutorial()
	p.Rank = 2
	low := text(p)
	if !strings.Contains(low, "0 species") && !strings.Contains(low, "0") {
		t.Errorf("Mara ignores the species count: %q", low)
	}
	for i := 0; i < 13; i++ {
		speciesEntry(p, fmt.Sprintf("s%d", i), 4, "sight")
	}
	p.Rank = 4
	p.Journal.Rare = []*proto.RareDiscovery{{Title: "Wheatear in the Meadow"}}
	hi := text(p)
	if hi == low || !strings.Contains(hi, "13 species") || !strings.Contains(hi, "Field Specialist") || !strings.Contains(hi, "Wheatear in the Meadow") {
		t.Errorf("Mara's reaction to rank, count and rare discovery: %q", hi)
	}
}

func TestQuestOfferAcceptAndTurnInFlow(t *testing.T) {
	p := afterTutorial()
	// June offers the watchtower quest in her hub; accepting returns the action.
	hub := Talk(NPCJune, p)
	var offerID string
	for _, c := range hub.Choices {
		if strings.HasPrefix(c.ID, pfxOffer) {
			offerID = c.ID
			break
		}
	}
	if offerID == "" {
		t.Fatalf("June offers nothing: %+v", hub.Choices)
	}
	offer, _ := Choose(NPCJune, offerID, p)
	if offer.Quest == "" || offer.Rewards == nil {
		t.Fatalf("offer node: %+v", offer)
	}
	kinds := map[string]bool{}
	for _, c := range offer.Choices {
		kinds[c.Kind] = true
	}
	if !kinds[choiceAccept] || !kinds[choiceDecline] || !kinds[choiceBye] {
		t.Errorf("offer choices: %+v", offer.Choices)
	}
	_, acts := Choose(NPCJune, "accept:"+offer.Quest, p)
	if len(acts) == 0 || acts[0].Kind != ActionAcceptQuest || acts[0].Quest != offer.Quest {
		t.Errorf("accept actions %+v", acts)
	}
	if n, acts := Choose(NPCJune, "decline:"+offer.Quest, p); len(n.Choices) == 0 || len(acts) > 1 {
		t.Errorf("decline: %+v %+v", n, acts)
	}

	// A finished quest greets the player with the hand-in.
	setStatus(p, StatusComplete, "old_watchtower")
	open := Talk(NPCJune, p)
	if open.Quest != "old_watchtower" || open.Rewards == nil {
		t.Fatalf("Talk should open on the hand-in: %+v", open)
	}
	n, acts := Choose(NPCJune, "turnin:old_watchtower", p)
	if len(acts) == 0 || acts[0].Kind != ActionTurnInQuest || acts[0].Quest != "old_watchtower" {
		t.Errorf("turn-in actions %+v", acts)
	}
	if !strings.Contains(strings.Join(n.Lines, " "), "Harrow") {
		t.Errorf("June's reaction: %v", n.Lines)
	}
	// Someone else's quest, an unfinished quest and an unavailable quest do nothing.
	for _, id := range []string{"turnin:perfect_moment", "turnin:quiet_creek", "accept:golden_flute", "accept:perfect_moment"} {
		if _, acts := Choose(NPCJune, id, p); len(acts) > 1 || (len(acts) == 1 && acts[0].Kind != ActionSetFlag) {
			t.Errorf("%s fired %+v", id, acts)
		}
	}
}

func TestFinnOpensTheShop(t *testing.T) {
	p := afterTutorial()
	hub := Talk(NPCFinn, p)
	shop := false
	for _, c := range hub.Choices {
		shop = shop || c.Kind == choiceShop
	}
	if !shop {
		t.Fatal("Finn's menu has no shop choice")
	}
	n, acts := Choose(NPCFinn, nodeShop, p)
	if len(acts) == 0 || acts[0].Kind != ActionOpenShop || len(n.Choices) == 0 {
		t.Errorf("shop: %+v %+v", n, acts)
	}
	// Only Finn runs a shop.
	if _, acts := Choose(NPCMara, nodeShop, p); len(acts) > 0 && acts[0].Kind == ActionOpenShop {
		t.Error("Mara opened a shop")
	}
	// Finn points a player with enough credits at the binoculars after the tutorial.
	p.Credits = 320
	if !strings.Contains(strings.Join(Talk(NPCFinn, p).Lines, " "), "Explorer Binoculars") {
		t.Error("Finn does not mention the binoculars")
	}
}

func TestEveryNPCTeachesSeveralTopics(t *testing.T) {
	for _, npc := range npcIDs {
		n := Talk(npc, afterTutorial())
		hub, _ := Choose(npc, nodeHub, afterTutorial())
		topics := 0
		for _, c := range hub.Choices {
			if c.Kind == choiceAsk && !strings.HasPrefix(c.ID, pfxOffer) && c.ID != nodeProgress {
				topics++
			}
		}
		if topics < 3 {
			t.Errorf("%s has %d topics (opening %v)", npc, topics, n.Choices)
		}
	}
}

func TestJuneExplainsPermitsMatchingTheRegionGates(t *testing.T) {
	p := afterTutorial()
	n, _ := Choose(NPCJune, "j_permits", p)
	text := strings.Join(n.Lines, " ")
	for _, want := range []string{"Murmur Marsh", "Windpeak Highlands", "Whispering Coast", "Amberwood", "Frostveil", "Field Specialist"} {
		if !strings.Contains(text, want) {
			t.Errorf("permits text lacks %q", want)
		}
	}
	n, _ = Choose(NPCJune, "j_beyond", newProfile())
	if !strings.Contains(strings.Join(n.Lines, " "), "very long way") {
		t.Errorf("June does not say the land goes on: %v", n.Lines)
	}
}

func TestDialogueActionsReferenceKnownThings(t *testing.T) {
	pinned := set(pinnedItems)
	for name, p := range profileVariants() {
		for _, npc := range npcIDs {
			seen := map[string]bool{}
			var queue []string
			for _, c := range Talk(npc, p).Choices {
				queue = append(queue, c.ID)
			}
			for len(queue) > 0 {
				id := queue[0]
				queue = queue[1:]
				if seen[id] {
					continue
				}
				seen[id] = true
				n, acts := Choose(npc, id, p)
				for _, a := range acts {
					switch a.Kind {
					case ActionGiveItem:
						if !pinned[a.Item] || a.Qty < 1 {
							t.Errorf("%s/%s: bad give_item %+v", name, npc, a)
						}
					case ActionAcceptQuest, ActionTurnInQuest:
						if _, ok := QuestByID(a.Quest); !ok {
							t.Errorf("%s/%s: unknown quest in %+v", name, npc, a)
						}
					case ActionSetFlag:
						if a.Flag == "" || !a.Value {
							t.Errorf("%s/%s: bad set_flag %+v", name, npc, a)
						}
					case ActionLearnRecipe:
						if _, ok := Recipe(a.Recipe); !ok {
							t.Errorf("%s/%s: unknown recipe in %+v", name, npc, a)
						}
					case ActionOpenShop, ActionClose:
					default:
						t.Errorf("%s/%s: unknown action kind %q", name, npc, a.Kind)
					}
				}
				for _, c := range n.Choices {
					queue = append(queue, c.ID)
				}
			}
		}
	}
}

// Quest stories and summaries are narration ("Finn wants…", "Mara has heard…"): they
// belong on the quest card, never in the giver's own speech.
func TestQuestOffersDoNotPutNarrationInTheGiversMouth(t *testing.T) {
	for name, p := range profileVariants() {
		for _, npc := range npcIDs {
			for _, n := range allNodes(t, npc, p) {
				for _, l := range n.Lines {
					for _, q := range Quests() {
						if (q.Story != "" && l == q.Story) || (q.Summary != "" && l == q.Summary) {
							t.Errorf("%s / %s: %s speaks the narration of %q: %q", name, npc, npc, q.ID, l)
						}
					}
				}
			}
		}
	}
}

// hubHas reports whether the NPC's main menu lists a choice id.
func hubHas(npc, id string, p *proto.Profile) bool {
	hub, _ := Choose(npc, nodeHub, p)
	for _, c := range hub.Choices {
		if c.ID == id {
			return true
		}
	}
	return false
}

func withRep(p *proto.Profile, faction string, n int) *proto.Profile {
	p.Rep = map[string]int{FactionNaturalists: 0, FactionOutfitters: 0, FactionResearch: 0, FactionRangers: 0}
	p.Rep[faction] = n
	return p
}

func TestReputationGatedTopicsOpenAtTheirThreshold(t *testing.T) {
	for _, npc := range npcIDs {
		def, _ := NPC(npc)
		gated, at40 := 0, false
		for _, tp := range speakers[npc].topics {
			if tp.minRep == 0 {
				continue
			}
			gated++
			at40 = at40 || tp.minRep == 40
			if tp.hidden || tp.title == "" {
				t.Errorf("%s/%s: a gated topic must be listed when open", npc, tp.id)
			}
			// Below the threshold, even with every other faction maxed out.
			below := withRep(afterTutorial(), def.Faction, tp.minRep-1)
			for _, f := range factions {
				if f != def.Faction {
					below.Rep[f] = 999
				}
			}
			below.Rank = 5
			if hubHas(npc, tp.id, below) {
				t.Errorf("%s/%s listed at %d %s reputation (needs %d)", npc, tp.id, tp.minRep-1, def.Faction, tp.minRep)
			}
			hub, _ := Choose(npc, nodeHub, below)
			if n, _ := Choose(npc, tp.id, below); fmt.Sprint(n.Lines) != fmt.Sprint(hub.Lines) {
				t.Errorf("%s/%s: a locked topic answered by id: %v", npc, tp.id, n.Lines)
			}
			// At and above it.
			for _, rep := range []int{tp.minRep, tp.minRep + 200} {
				at := withRep(afterTutorial(), def.Faction, rep)
				if !hubHas(npc, tp.id, at) {
					t.Errorf("%s/%s missing at %d %s reputation", npc, tp.id, rep, def.Faction)
				}
				n, _ := Choose(npc, tp.id, at)
				if len(n.Lines) == 0 || fmt.Sprint(n.Lines) == fmt.Sprint(hub.Lines) {
					t.Errorf("%s/%s at %d: %v", npc, tp.id, rep, n.Lines)
				}
			}
		}
		if gated < 1 || gated > 2 || !at40 {
			t.Errorf("%s has %d reputation-gated topics (want 1-2, one at 40)", npc, gated)
		}
	}
}

func TestTopicRankGate(t *testing.T) {
	c, _ := newCtx(NPCAlder, withRep(afterTutorial(), FactionResearch, 50))
	c.p.Rank = 2
	for _, tc := range []struct {
		tp   topic
		want bool
	}{
		{topic{}, true},
		{topic{minRank: 2}, true},
		{topic{minRank: 3}, false},
		{topic{minRep: 50, minRank: 2}, true},
		{topic{minRep: 51, minRank: 2}, false},
		{topic{minRep: 50, minRank: 3}, false},
	} {
		if got := c.unlocked(&tc.tp); got != tc.want {
			t.Errorf("unlocked(minRep %d, minRank %d) = %v", tc.tp.minRep, tc.tp.minRank, got)
		}
	}
}

func TestFinnQuotesTheDiscountHeGives(t *testing.T) {
	for rep, want := range map[int]string{40: "5 off every hundred, and it goes up when you reach 60", 60: "10 off every hundred, and it goes up when you reach 120", 130: "top rate already, 15"} {
		n, _ := Choose(NPCFinn, "f_trade", withRep(afterTutorial(), FactionOutfitters, rep))
		if !strings.Contains(strings.Join(n.Lines, " "), want) {
			t.Errorf("Finn at %d outfitters reputation: %v", rep, n.Lines)
		}
	}
}

func TestMarasGreetingFollowsRankAndStanding(t *testing.T) {
	greet := func(rank, rep int) string {
		p := withRep(afterTutorial(), FactionNaturalists, rep)
		p.Rank = rank
		n, _ := Choose(NPCMara, nodeHub, p)
		return strings.Join(n.Lines, " ")
	}
	bands := []int{0, 19, 20, 59, 60, 149, 150, 400}
	seen := map[string]string{}
	for rank := 1; rank <= 5; rank++ {
		for i := 0; i < len(bands); i += 2 {
			lo, hi := greet(rank, bands[i]), greet(rank, bands[i+1])
			if lo != hi {
				t.Errorf("rank %d: reputation %d and %d are one band but greet differently", rank, bands[i], bands[i+1])
			}
			key := fmt.Sprintf("rank %d rep %d", rank, bands[i])
			if prev, dup := seen[lo]; dup {
				t.Errorf("%s greets exactly like %s: %q", key, prev, lo)
			}
			seen[lo] = key
		}
	}
}

// Discovery must be earned: outside a quest's own card, nothing an NPC says names a
// species the player has not identified, by name or by id.
func TestDialogueNeverNamesUnidentifiedSpecies(t *testing.T) {
	cat := species.All()
	profiles := profileVariants()
	for i, half := range []int{0, len(cat) / 2} {
		p := afterTutorial()
		p.Rank = 3 + i
		p.Rep = map[string]int{FactionNaturalists: 400, FactionOutfitters: 400, FactionResearch: 400, FactionRangers: 400}
		p.Inventory = []proto.ItemStack{{Item: "forgotten_journal", Qty: 1}}
		setStatus(p, StatusTurnedIn, "old_watchtower", "harrows_places")
		for _, sp := range cat[:half] {
			speciesEntry(p, sp.ID, proto.LevelIdentified, "sight")
		}
		profiles[fmt.Sprintf("high standing, %d identified", half)] = p
	}
	for name, p := range profiles {
		known := func(id string) bool {
			e := p.Journal.Species[id]
			return e != nil && e.Level >= proto.LevelIdentified
		}
		for _, npc := range npcIDs {
			for _, n := range allNodes(t, npc, p) {
				if n.Quest != "" {
					continue // a quest's offer and hand-in speak of that quest's own bird
				}
				for _, l := range n.Lines {
					low := strings.ToLower(l)
					for _, sp := range cat {
						if known(sp.ID) {
							continue
						}
						if strings.Contains(low, strings.ToLower(sp.Name)) || strings.Contains(low, sp.ID) || strings.Contains(low, strings.ReplaceAll(sp.ID, "_", " ")) {
							t.Errorf("%s / %s names %s: %q", name, npc, sp.Name, l)
						}
					}
				}
			}
		}
	}
}
