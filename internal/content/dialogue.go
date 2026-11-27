package content

import (
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Action kinds returned by Choose. They are data: the session executes them
// against the profile and the world (contract §3.5).
const (
	ActionAcceptQuest = "accept_quest"  // Quest: Tracker.Accept(p, Quest, day); add Accepted.Items to the inventory
	ActionTurnInQuest = "turn_in_quest" // Quest: Tracker.TurnIn, then progress.ApplyReward on the result
	ActionOpenShop    = "open_shop"     // open Finn's shop screen
	ActionGiveItem    = "give_item"     // Item x Qty into the inventory (the session announces it)
	ActionSetFlag     = "set_flag"      // Flag = Value in Profile.Flags
	ActionClose       = "close"         // end the conversation (send a dialog with no lines and no choices)
	ActionLearnRecipe = "learn_recipe"  // Recipe: progress.LearnRecipe(p, Recipe); the session announces it if it was new
)

// Action is one thing the session must do as the result of a dialogue choice.
type Action struct {
	Kind  string `json:"kind"`
	Quest string `json:"quest,omitempty"`
	Item  string `json:"item,omitempty"`
	Qty   int    `json:"qty,omitempty"`
	Flag  string `json:"flag,omitempty"`
	Value bool   `json:"value,omitempty"`
	// Recipe is the recipe id of a learn_recipe action.
	Recipe string `json:"recipe,omitempty"`
}

// Dialogue choice kinds (proto.DialogChoice.Kind).
const (
	choiceNext    = "next"
	choiceAccept  = "accept"
	choiceDecline = "decline"
	choiceTurnIn  = "turnin"
	choiceShop    = "shop"
	choiceAsk     = "ask"
	choiceBye     = "bye"
)

// Choice ids with a fixed meaning for every NPC. Any other id is a node of that NPC's
// own conversation graph. Ids are stateless: Choose(npc, id, profile) is all the
// session needs, so a conversation survives a reconnect.
const (
	nodeHub      = "hub"      // the NPC's main menu
	nodeBye      = "bye"      // leave: Choose returns an empty node and a close action
	nodeProgress = "progress" // how are my errands going?
	nodeShop     = "shop"     // Finn: open the shop
	pfxOffer     = "offer:"   // offer:<quest>    the quest pitch (Story, rewards, accept / not now)
	pfxAccept    = "accept:"  // accept:<quest>   take it up
	pfxDecline   = "decline:" // decline:<quest>  not now
	pfxComplete  = "complete:"
	pfxTurnIn    = "turnin:" // turnin:<quest>   hand it in
)

// nodeDef is one beat of conversation before it is dressed as a proto.DialogNode.
type nodeDef struct {
	lines   []string
	quest   string
	rewards *proto.Reward
	choices []proto.DialogChoice
}

// topic is an "Ask about..." entry on an NPC's hub.
type topic struct {
	id, title string
	hidden    bool                               // reachable from other nodes, not listed in the hub
	lines     func(c *dctx) []string             // what the NPC says
	follow    func(c *dctx) []proto.DialogChoice // extra choices ahead of the usual way out (a lesson that continues)
	acts      func(c *dctx) []Action             // fired on arrival (tutorial flags, one-off gifts)
}

// voice holds the lines every NPC says in their own words for the generic parts of a
// conversation.
type voice struct {
	offer    string // lead-in before a quest's story
	taken    string // after accepting
	declined string // after "not now"
	report   string // when the player comes back with a finished quest
	thanks   string // after the hand-in
	busy     string // asked about a quest that cannot be taken up right now
	nothing  string // progress when there is nothing to report
	bye      string // the choice text for leaving
}

// speaker is an NPC's conversation graph.
type speaker struct {
	id     string
	voice  voice
	entry  func(c *dctx) string // first node of Talk; "" means complete:<quest> if one is ready, else the hub
	hub    func(c *dctx) []string
	topics []topic
	custom func(c *dctx, id string) (nodeDef, []Action, bool)
	report map[string][]string // per-quest lines when the finished quest is brought back
	taken  map[string][]string // per-quest lines after accepting
	done   map[string][]string // per-quest lines after the hand-in
	// shop marks the speaker that runs the shop (adds the shop choice to the hub).
	shop bool
}

// dctx is the state a node function reads. It never writes to the profile.
type dctx struct {
	p   *proto.Profile
	t   *Tracker
	sp  *speaker
	npc proto.NPCDef
}

func (c *dctx) flag(f string) bool     { return c.p.Flags[f] }
func (c *dctx) status(q string) string { return Status(c.p, q) }
func (c *dctx) turnedIn(q string) bool { return c.status(q) == StatusTurnedIn }
func (c *dctx) rank() int              { return rankOf(c.p) }

// owns reports whether the player carries, stores or has equipped an item.
func (c *dctx) owns(item string) bool {
	for _, id := range c.p.Equipped {
		if id == item {
			return true
		}
	}
	for _, list := range [][]proto.ItemStack{c.p.Inventory, c.p.Storage} {
		for _, s := range list {
			if s.Item == item && s.Qty > 0 {
				return true
			}
		}
	}
	return false
}

// facts summarises the journal for NPC small talk.
type facts struct {
	species, documented int
	rare                *proto.RareDiscovery // most recent, or nil
}

func (c *dctx) facts() facts {
	var f facts
	for _, e := range c.p.Journal.Species {
		if e == nil {
			continue
		}
		f.species++
		if e.Level >= proto.LevelDocumented {
			f.documented++
		}
	}
	if n := len(c.p.Journal.Rare); n > 0 {
		f.rare = c.p.Journal.Rare[n-1]
	}
	return f
}

// ownQuests lists, in catalog order, the quests this NPC gives.
func (c *dctx) ownQuests() []*proto.QuestDef {
	var out []*proto.QuestDef
	for i := range c.t.quests {
		if c.t.quests[i].Giver == c.npc.ID {
			out = append(out, &c.t.quests[i])
		}
	}
	return out
}

func (c *dctx) ready() []*proto.QuestDef {
	var out []*proto.QuestDef
	for _, q := range c.ownQuests() {
		if c.status(q.ID) == StatusComplete {
			out = append(out, q)
		}
	}
	return out
}

func (c *dctx) offers() []*proto.QuestDef {
	var out []*proto.QuestDef
	for _, id := range c.t.Available(c.p) {
		if q, _ := c.t.Quest(id); q.Giver == c.npc.ID {
			out = append(out, q)
		}
	}
	return out
}

func (c *dctx) active() []*proto.QuestDef {
	var out []*proto.QuestDef
	for _, q := range c.ownQuests() {
		if c.status(q.ID) == StatusActive {
			out = append(out, q)
		}
	}
	return out
}

// ---------------------------------------------------------------------------

// Talk returns the opening beat of a conversation with an NPC. It is what the
// session sends when the player presses E on the NPC; it changes nothing. The session
// should also emit Talked(npcID) so "talk" objectives advance.
func Talk(npcID string, p *proto.Profile) proto.DialogNode {
	c, ok := newCtx(npcID, p)
	if !ok {
		return proto.DialogNode{Lines: []string{}, Choices: []proto.DialogChoice{}}
	}
	start := ""
	if c.sp.entry != nil {
		start = c.sp.entry(c)
	}
	if start == "" {
		if r := c.ready(); len(r) > 0 {
			start = pfxComplete + r[0].ID
		} else {
			start = nodeHub
		}
	}
	nd, _ := c.node(start)
	return c.dress(nd)
}

// Choose resolves the player's pick (a proto.DialogChoice.ID from a node Talk or
// Choose returned) into the next node and the actions the session must execute. The
// node is empty (no lines, no choices) when the conversation ends. Unknown ids fall
// back to the NPC's main menu, so a stale client can never get stuck. Choose never
// modifies the profile.
func Choose(npcID, choiceID string, p *proto.Profile) (proto.DialogNode, []Action) {
	c, ok := newCtx(npcID, p)
	if !ok {
		return proto.DialogNode{Lines: []string{}, Choices: []proto.DialogChoice{}}, []Action{{Kind: ActionClose}}
	}
	nd, acts := c.node(choiceID)
	if choiceID != nodeBye && !c.flag("met:"+npcID) {
		acts = append(acts, Action{Kind: ActionSetFlag, Flag: "met:" + npcID, Value: true})
	}
	return c.dress(nd), acts
}

func newCtx(npcID string, p *proto.Profile) (*dctx, bool) {
	sp := speakers[npcID]
	npc, ok := NPC(npcID)
	if sp == nil || !ok {
		return nil, false
	}
	if p == nil {
		p = &proto.Profile{}
	}
	return &dctx{p: p, t: defaultTracker(), sp: sp, npc: npc}, true
}

// dress turns a nodeDef into the wire node. An empty nodeDef stays empty: that is how
// a conversation ends.
func (c *dctx) dress(nd nodeDef) proto.DialogNode {
	n := proto.DialogNode{
		NPC: c.npc.ID, Name: c.npc.Name, Role: c.npc.Role,
		Lines: nd.lines, Choices: nd.choices, Quest: nd.quest, Rewards: nd.rewards,
		Rep: c.p.Rep[c.npc.Faction],
	}
	if n.Lines == nil {
		n.Lines = []string{}
	}
	if n.Choices == nil {
		n.Choices = []proto.DialogChoice{}
	}
	return n
}

// node resolves an id into the node it leads to, plus the actions that arriving there
// fires.
func (c *dctx) node(id string) (nodeDef, []Action) {
	sp := c.sp
	switch {
	case id == nodeBye:
		return nodeDef{}, []Action{{Kind: ActionClose}}
	case id == nodeHub:
		return c.hubNode(nil), nil
	case id == nodeProgress:
		return c.progressNode(), nil
	case id == nodeShop && sp.shop:
		return nodeDef{
			lines:   []string{"Have a look. The price is on the tag and what the thing is bad at is on the back of it."},
			choices: c.tail(),
		}, []Action{{Kind: ActionOpenShop}}
	case strings.HasPrefix(id, pfxOffer):
		return c.offerNode(strings.TrimPrefix(id, pfxOffer)), nil
	case strings.HasPrefix(id, pfxAccept):
		return c.acceptNode(strings.TrimPrefix(id, pfxAccept))
	case strings.HasPrefix(id, pfxDecline):
		return c.hubNode([]string{sp.voice.declined}), nil
	case strings.HasPrefix(id, pfxComplete):
		return c.completeNode(strings.TrimPrefix(id, pfxComplete)), nil
	case strings.HasPrefix(id, pfxTurnIn):
		return c.turnInNode(strings.TrimPrefix(id, pfxTurnIn))
	}
	for _, tp := range sp.topics {
		if tp.id == id {
			var ch []proto.DialogChoice
			if tp.follow != nil {
				ch = tp.follow(c)
			}
			var acts []Action
			if tp.acts != nil {
				acts = tp.acts(c)
			}
			return nodeDef{lines: tp.lines(c), choices: append(ch, c.tail()...)}, acts
		}
	}
	if sp.custom != nil {
		if nd, acts, ok := sp.custom(c, id); ok {
			return nd, acts
		}
	}
	return c.hubNode(nil), nil
}

// tail is the pair of choices that close every ordinary node: back to the main menu,
// or leave. No conversation path dead-ends.
func (c *dctx) tail() []proto.DialogChoice {
	return []proto.DialogChoice{
		ask(nodeHub, "Can I ask about something else?"),
		c.byeChoice(),
	}
}

func (c *dctx) byeChoice() proto.DialogChoice {
	return proto.DialogChoice{ID: nodeBye, Text: c.sp.voice.bye, Kind: choiceBye}
}

// hubNode is the NPC's main menu: hand-ins first, then quests on offer, then errands
// in progress, then the shop and the topics.
func (c *dctx) hubNode(lead []string) nodeDef {
	lines := append([]string(nil), lead...)
	lines = append(lines, c.sp.hub(c)...)
	var ch []proto.DialogChoice
	for _, q := range c.ready() {
		ch = append(ch, proto.DialogChoice{ID: pfxTurnIn + q.ID, Text: "Hand in: " + q.Name, Kind: choiceTurnIn})
	}
	for i, q := range c.offers() {
		if i == 2 {
			break // two pitches at a time keeps the menu readable
		}
		ch = append(ch, ask(pfxOffer+q.ID, "About \""+q.Name+"\""))
	}
	if len(c.active()) > 0 {
		ch = append(ch, ask(nodeProgress, "How am I getting on with what you asked?"))
	}
	if c.sp.shop {
		ch = append(ch, proto.DialogChoice{ID: nodeShop, Text: "Let me see what you have.", Kind: choiceShop})
	}
	for _, tp := range c.sp.topics {
		if !tp.hidden {
			ch = append(ch, ask(tp.id, tp.title))
		}
	}
	ch = append(ch, c.byeChoice())
	return nodeDef{lines: lines, choices: ch}
}

// progressNode reminds the player where each errand stands, using the gentle Hint of
// the current objective.
func (c *dctx) progressNode() nodeDef {
	var lines []string
	for _, q := range c.active() {
		cur, ok := c.t.Current(c.p, q.ID)
		if !ok {
			continue
		}
		lines = append(lines, "\""+q.Name+"\": "+cur.Text+".")
		if cur.Hint != "" {
			lines = append(lines, cur.Hint)
		}
	}
	if len(lines) == 0 {
		lines = []string{c.sp.voice.nothing}
	}
	return nodeDef{lines: lines, choices: c.tail()}
}

func (c *dctx) ownQuest(id string) (*proto.QuestDef, bool) {
	q, ok := c.t.Quest(id)
	if !ok || q.Giver != c.npc.ID {
		return nil, false
	}
	return q, true
}

// offerNode is the pitch for a quest the player may take up.
func (c *dctx) offerNode(id string) nodeDef {
	q, ok := c.ownQuest(id)
	if !ok {
		return c.hubNode(nil)
	}
	if okAcc, why := c.t.canAccept(c.p, q); !okAcc {
		return c.hubNode([]string{c.sp.voice.busy, why})
	}
	rw := cloneReward(q.Rewards)
	// The NPC says only their own pitch line: the quest's Summary and Story are
	// written as narration ("Finn wants…", "Mara has heard…") and are shown on the
	// quest card beside the speech, never put in the giver's mouth.
	return nodeDef{
		lines:   []string{c.sp.voice.offer},
		quest:   q.ID,
		rewards: &rw,
		choices: []proto.DialogChoice{
			{ID: pfxAccept + q.ID, Text: "I'll take that on.", Kind: choiceAccept},
			{ID: pfxDecline + q.ID, Text: "Not just now.", Kind: choiceDecline},
			c.byeChoice(),
		},
	}
}

// acceptNode takes a quest up. The accept_quest action is the only thing the session
// needs: Tracker.Accept reports any accept-time items (the tutorial's recorder).
func (c *dctx) acceptNode(id string) (nodeDef, []Action) {
	q, ok := c.ownQuest(id)
	if !ok {
		return c.hubNode(nil), nil
	}
	if okAcc, why := c.t.canAccept(c.p, q); !okAcc {
		return c.hubNode([]string{c.sp.voice.busy, why}), nil
	}
	lines := c.sp.taken[id]
	if len(lines) == 0 {
		lines = []string{c.sp.voice.taken}
		if len(q.Objectives) > 0 {
			first := q.Objectives[0]
			lines = append(lines, "To start: "+strings.ToLower(first.Text[:1])+first.Text[1:]+". "+first.Hint)
		}
	}
	return nodeDef{lines: lines, quest: q.ID, choices: c.tail()},
		[]Action{{Kind: ActionAcceptQuest, Quest: q.ID}}
}

// completeNode is what the NPC says when the player walks up with a finished quest.
func (c *dctx) completeNode(id string) nodeDef {
	q, ok := c.ownQuest(id)
	if !ok || c.status(id) != StatusComplete {
		return c.hubNode(nil)
	}
	lines := c.sp.report[id]
	if len(lines) == 0 {
		lines = []string{c.sp.voice.report}
	}
	rw := cloneReward(q.Rewards)
	return nodeDef{
		lines:   lines,
		quest:   q.ID,
		rewards: &rw,
		choices: []proto.DialogChoice{
			{ID: pfxTurnIn + q.ID, Text: "Hand in: " + q.Name, Kind: choiceTurnIn},
			next(nodeHub, "Let me think about it first."),
			c.byeChoice(),
		},
	}
}

// turnInNode pays out a finished quest.
func (c *dctx) turnInNode(id string) (nodeDef, []Action) {
	q, ok := c.ownQuest(id)
	if !ok || c.status(id) != StatusComplete {
		return c.hubNode(nil), nil
	}
	lines := c.sp.done[id]
	if len(lines) == 0 {
		lines = []string{c.sp.voice.thanks}
	}
	rw := cloneReward(q.Rewards)
	return nodeDef{lines: lines, quest: q.ID, rewards: &rw, choices: c.tail()},
		[]Action{{Kind: ActionTurnInQuest, Quest: q.ID}}
}

// speakers is the conversation graph of every NPC.
var speakers = map[string]*speaker{
	NPCMara:  maraSpeaker(),
	NPCFinn:  finnSpeaker(),
	NPCAlder: alderSpeaker(),
	NPCJune:  juneSpeaker(),
}

// next is a "continue" choice.
func next(id, text string) proto.DialogChoice {
	return proto.DialogChoice{ID: id, Text: text, Kind: choiceNext}
}

func ask(id, text string) proto.DialogChoice {
	return proto.DialogChoice{ID: id, Text: text, Kind: choiceAsk}
}

// speciesWord phrases a species count for small talk.
func speciesWord(n int) string {
	if n == 1 {
		return "one species"
	}
	return strconv.Itoa(n) + " species"
}

// offerIfAvailable is a topic follow-up that leads on to a quest pitch when the NPC
// has that quest and the player could take it up now: a conversation about
// foraging can end in the errand about foraging, even when the hub's two pitch
// slots are taken.
func offerIfAvailable(questID, text string) func(*dctx) []proto.DialogChoice {
	return func(c *dctx) []proto.DialogChoice {
		q, ok := c.ownQuest(questID)
		if !ok {
			return nil
		}
		if okAcc, _ := c.t.canAccept(c.p, q); !okAcc {
			return nil
		}
		return []proto.DialogChoice{next(pfxOffer+questID, text)}
	}
}

// teachRecipe is a topic action that teaches a recipe. LearnRecipe is idempotent, so
// the topic can be asked again.
func teachRecipe(id string) func(*dctx) []Action {
	return func(*dctx) []Action { return []Action{{Kind: ActionLearnRecipe, Recipe: id}} }
}

// npcTeaches reports whether one of the NPC's topics fires a learn_recipe action for
// the recipe (Validate uses it to check "npc:<id>" learn rules).
func npcTeaches(npcID, recipeID string) bool {
	sp := speakers[npcID]
	if sp == nil {
		return false
	}
	c := &dctx{p: &proto.Profile{}, t: defaultTracker(), sp: sp}
	for _, tp := range sp.topics {
		if tp.acts == nil {
			continue
		}
		for _, a := range tp.acts(c) {
			if a.Kind == ActionLearnRecipe && a.Recipe == recipeID {
				return true
			}
		}
	}
	return false
}
