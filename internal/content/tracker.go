package content

import (
	"errors"
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Errors returned by the Tracker. The wrapped message is a gentle player-facing
// sentence; compare with errors.Is.
var (
	ErrUnknownQuest = errors.New("unknown quest")
	ErrNotAvailable = errors.New("quest not available")
	ErrNotActive    = errors.New("quest not active")
	ErrNotComplete  = errors.New("quest not complete")
)

// Progress reports one objective that an event (or an acceptance) moved forward.
// The session turns these into toasts; Text never names a species the quest is
// keeping secret.
type Progress struct {
	Quest     string `json:"quest"`
	Objective string `json:"objective"`
	Text      string `json:"text"`     // the objective's Text
	Count     int    `json:"count"`    // progress after the event
	Need      int    `json:"need"`     // count required
	Done      bool   `json:"done"`     // this objective has just been completed
	Complete  bool   `json:"complete"` // the whole quest has just become ready to turn in
}

// Accepted is the result of accepting a quest.
type Accepted struct {
	// Items are handed to the player on acceptance (for example Mara's field
	// recorder for the tutorial). They are granted once per save, however often the
	// quest is abandoned and taken up again. The session adds them to the inventory.
	Items []string
	// Progress lists objectives that were already satisfied by what the player had
	// done before accepting (a place already discovered, a species already named).
	Progress []Progress
}

// Tracker is the quest engine: pure logic over proto.Profile.Quests. It holds only
// the quest catalog, so one Tracker can serve any number of profiles and is safe for
// concurrent use.
type Tracker struct {
	quests []proto.QuestDef
	index  map[string]int
	accept map[string][]string
}

// NewTracker returns a tracker over the authored quest catalog.
func NewTracker() *Tracker {
	t := NewTrackerFor(Quests())
	t.accept = acceptItems
	return t
}

// NewTrackerFor returns a tracker over a custom quest list (tests, tools).
func NewTrackerFor(quests []proto.QuestDef) *Tracker {
	t := &Tracker{quests: quests, index: make(map[string]int, len(quests))}
	for i := range quests {
		t.index[quests[i].ID] = i
	}
	return t
}

// Quest returns a quest definition by id.
func (t *Tracker) Quest(id string) (*proto.QuestDef, bool) {
	i, ok := t.index[id]
	if !ok {
		return nil, false
	}
	return &t.quests[i], true
}

// Status returns the quest's status for this profile, or "" if it has never been
// listed.
func Status(p *proto.Profile, id string) string {
	if p == nil {
		return ""
	}
	if st := p.Quests[id]; st != nil {
		return st.Status
	}
	return ""
}

func started(status string) bool {
	return status == StatusActive || status == StatusComplete || status == StatusTurnedIn
}

func rankOf(p *proto.Profile) int {
	if p == nil || p.Rank < 1 {
		return 1
	}
	return p.Rank
}

// revealFlag marks a Hidden quest as discovered.
func revealFlag(id string) string { return "quest:" + id }

// Reveal makes a Hidden quest visible to the player (it still has to meet the
// quest's Requires and ReqRank to be accepted). TurnIn does this for every
// "quest:<id>" entry in a reward's Unlock list.
func Reveal(p *proto.Profile, id string) {
	if p.Flags == nil {
		p.Flags = map[string]bool{}
	}
	p.Flags[revealFlag(id)] = true
}

// canAccept reports whether the quest could be accepted right now, with a gentle
// reason when it cannot.
func (t *Tracker) canAccept(p *proto.Profile, q *proto.QuestDef) (bool, string) {
	if started(Status(p, q.ID)) {
		return false, "You have already taken that on."
	}
	if q.Hidden && !p.Flags[revealFlag(q.ID)] {
		return false, "You have not come across that yet."
	}
	if rankOf(p) < q.ReqRank {
		return false, fmt.Sprintf("That is work for a %s. It will keep.", RankTitle(q.ReqRank))
	}
	for _, r := range q.Requires {
		if Status(p, r) != StatusTurnedIn {
			name := r
			if rq, ok := t.Quest(r); ok {
				name = rq.Name
			}
			return false, fmt.Sprintf("Finish \"%s\" first.", name)
		}
	}
	return true, ""
}

// Available lists, in catalog order, the quests the player could accept right now:
// not yet started, every quest in Requires turned in, naturalist rank at least
// ReqRank, and (for Hidden quests) revealed. It does not change the profile.
func (t *Tracker) Available(p *proto.Profile) []string {
	var out []string
	if p == nil {
		return out
	}
	for i := range t.quests {
		if ok, _ := t.canAccept(p, &t.quests[i]); ok {
			out = append(out, t.quests[i].ID)
		}
	}
	return out
}

// Sync writes a QuestState with status "available" for every available quest that
// has none yet, so the client's quest log can list them, and returns the ids that
// are newly listed. Call it after loading a profile, after a rank change and after
// TurnIn.
func (t *Tracker) Sync(p *proto.Profile) []string {
	var added []string
	for _, id := range t.Available(p) {
		if p.Quests == nil {
			p.Quests = map[string]*proto.QuestState{}
		}
		if p.Quests[id] == nil {
			p.Quests[id] = &proto.QuestState{Status: StatusAvailable, Progress: map[string]int{}}
			added = append(added, id)
		}
	}
	return added
}

// Accept starts a quest. day is the current in-game day (kept for the quest log).
// The first quest accepted while nothing is tracked becomes the tracked quest.
func (t *Tracker) Accept(p *proto.Profile, id string, day int) (Accepted, error) {
	q, ok := t.Quest(id)
	if !ok {
		return Accepted{}, fmt.Errorf("%w: %s", ErrUnknownQuest, id)
	}
	if ok, why := t.canAccept(p, q); !ok {
		return Accepted{}, fmt.Errorf("%w: %s", ErrNotAvailable, why)
	}
	if p.Quests == nil {
		p.Quests = map[string]*proto.QuestState{}
	}
	st := &proto.QuestState{Status: StatusActive, Progress: map[string]int{}, Day: day, Tracked: Tracked(p) == ""}
	p.Quests[id] = st

	var res Accepted
	if items := t.accept[id]; len(items) > 0 {
		// Granted once per save: abandoning and re-accepting must not mint items.
		flag := "granted:" + id
		if !p.Flags[flag] {
			if p.Flags == nil {
				p.Flags = map[string]bool{}
			}
			p.Flags[flag] = true
			res.Items = append([]string(nil), items...)
		}
	}
	res.Progress = t.settle(p, q, st, nil)
	return res, nil
}

// OnEvent advances every active quest the event is relevant to and returns what
// moved. Ordered quests only ever look at their current objective, so events that
// arrive out of order are ignored; unordered quests advance every unfinished
// objective that matches. A quest whose objectives are all done becomes "complete"
// (ready to turn in).
func (t *Tracker) OnEvent(p *proto.Profile, ev Event) []Progress {
	if p == nil || len(p.Quests) == 0 || ev.Kind == "" {
		return nil
	}
	var out []Progress
	for i := range t.quests {
		q := &t.quests[i]
		st := p.Quests[q.ID]
		if st == nil || st.Status != StatusActive {
			continue
		}
		if st.Progress == nil {
			st.Progress = map[string]int{}
		}
		before := len(out)
		if q.Ordered {
			if o := current(q, st); o != nil && matches(o, ev) {
				out = bump(q, st, o, ev, out)
			}
		} else {
			for j := range q.Objectives {
				o := &q.Objectives[j]
				if st.Progress[o.ID] < need(o) && matches(o, ev) {
					out = bump(q, st, o, ev, out)
				}
			}
		}
		if len(out) > before {
			out = t.settle(p, q, st, out)
		}
	}
	return out
}

// TurnIn pays out a completed quest: it marks the quest turned in and returns its
// reward for the session to apply (progress.ApplyReward). It succeeds exactly once
// per quest. It also performs the two unlocks that live in this package's own
// state: "quest:<id>" reveals a Hidden quest, and "feature:trail_<trail id>" adds a
// hidden trail to Profile.Trails (the "map expansion" reward).
func (t *Tracker) TurnIn(p *proto.Profile, id string) (proto.Reward, error) {
	q, ok := t.Quest(id)
	if !ok {
		return proto.Reward{}, fmt.Errorf("%w: %s", ErrUnknownQuest, id)
	}
	st := p.Quests[id]
	if st == nil || st.Status != StatusComplete {
		if st != nil && st.Status == StatusTurnedIn {
			return proto.Reward{}, fmt.Errorf("%w: \"%s\" has already been handed in", ErrNotComplete, q.Name)
		}
		return proto.Reward{}, fmt.Errorf("%w: \"%s\" still has something left to do", ErrNotComplete, q.Name)
	}
	st.Status = StatusTurnedIn
	st.Tracked = false
	for _, u := range q.Rewards.Unlock {
		switch {
		case strings.HasPrefix(u, "quest:"):
			Reveal(p, strings.TrimPrefix(u, "quest:"))
		case strings.HasPrefix(u, trailFeature):
			trail := strings.TrimPrefix(u, trailFeature)
			if !oneOf(trail, p.Trails...) {
				p.Trails = append(p.Trails, trail)
			}
		}
	}
	return cloneReward(q.Rewards), nil
}

// trailFeature is the Reward.Unlock prefix that reveals a hidden trail on the map.
const trailFeature = "feature:trail_"

// Track makes the quest the one shown on the HUD and map. Only one quest is tracked
// at a time.
func (t *Tracker) Track(p *proto.Profile, id string) error {
	if _, ok := t.Quest(id); !ok {
		return fmt.Errorf("%w: %s", ErrUnknownQuest, id)
	}
	st := p.Quests[id]
	if st == nil || (st.Status != StatusActive && st.Status != StatusComplete) {
		return fmt.Errorf("%w: accept it first", ErrNotActive)
	}
	for _, other := range p.Quests {
		if other != nil {
			other.Tracked = false
		}
	}
	st.Tracked = true
	return nil
}

// Untrack stops tracking the quest.
func (t *Tracker) Untrack(p *proto.Profile, id string) error {
	if _, ok := t.Quest(id); !ok {
		return fmt.Errorf("%w: %s", ErrUnknownQuest, id)
	}
	if st := p.Quests[id]; st != nil {
		st.Tracked = false
	}
	return nil
}

// Abandon sets an active (or complete but not handed in) quest aside. Its progress
// is cleared and it goes back to being available; nothing else is lost.
func (t *Tracker) Abandon(p *proto.Profile, id string) error {
	if _, ok := t.Quest(id); !ok {
		return fmt.Errorf("%w: %s", ErrUnknownQuest, id)
	}
	st := p.Quests[id]
	if st == nil || (st.Status != StatusActive && st.Status != StatusComplete) {
		return fmt.Errorf("%w: there is nothing to set aside", ErrNotActive)
	}
	st.Status = StatusAvailable
	st.Progress = map[string]int{}
	st.Tracked = false
	return nil
}

// Tracked returns the id of the tracked quest, or "".
func Tracked(p *proto.Profile) string {
	if p == nil {
		return ""
	}
	best := ""
	for id, st := range p.Quests {
		// Map order is random; pick deterministically should a save ever hold two.
		if st != nil && st.Tracked && (best == "" || id < best) {
			best = id
		}
	}
	return best
}

// Current returns the objective the player should be working on: the first
// unfinished one. ok is false if the quest is not active or has nothing left.
func (t *Tracker) Current(p *proto.Profile, id string) (proto.ObjectiveDef, bool) {
	q, found := t.Quest(id)
	if !found || p == nil {
		return proto.ObjectiveDef{}, false
	}
	st := p.Quests[id]
	if st == nil || st.Status != StatusActive {
		return proto.ObjectiveDef{}, false
	}
	if o := current(q, st); o != nil {
		return *o, true
	}
	return proto.ObjectiveDef{}, false
}

// ---------------------------------------------------------------------------

func need(o *proto.ObjectiveDef) int {
	if o.Count < 1 {
		return 1
	}
	return o.Count
}

// current is the first unfinished objective, or nil.
func current(q *proto.QuestDef, st *proto.QuestState) *proto.ObjectiveDef {
	for i := range q.Objectives {
		if st.Progress[q.Objectives[i].ID] < need(&q.Objectives[i]) {
			return &q.Objectives[i]
		}
	}
	return nil
}

// matches reports whether an event satisfies an objective's kind, target and
// parameter filters.
func matches(o *proto.ObjectiveDef, ev Event) bool {
	if o.Kind != ev.Kind {
		return false
	}
	switch {
	case o.Target == "" || o.Target == TargetAny:
	case o.Target == TargetUnknown:
		if ev.Params[paramKnown] != "false" {
			return false
		}
	case strings.HasPrefix(o.Target, TargetKind):
		if ev.Params[paramKind] != strings.TrimPrefix(o.Target, TargetKind) {
			return false
		}
	default:
		if ev.Target != o.Target {
			return false
		}
	}
	for k, want := range o.Params {
		switch k {
		case ParamDistinct:
			// Not a filter: handled when counting.
		case ParamMinStars:
			min, err := strconv.Atoi(want)
			got, err2 := strconv.Atoi(ev.Params[paramStars])
			if err != nil || err2 != nil || got < min {
				return false
			}
		default:
			got := ev.Params[k]
			if got == "" || !oneOf(got, strings.Split(want, "|")...) {
				return false
			}
		}
	}
	return true
}

// distinctKey is where a "distinct" objective remembers a target it has already
// counted. The target is hashed: Profile.Quests is sent to the client, and a quest
// must never leak the species of a bird the player has not identified.
func distinctKey(o *proto.ObjectiveDef, target string) string {
	h := fnv.New32a()
	h.Write([]byte(target))
	return o.ID + "#" + strconv.FormatUint(uint64(h.Sum32()), 36)
}

// bump adds an event to an objective and reports the progress.
func bump(q *proto.QuestDef, st *proto.QuestState, o *proto.ObjectiveDef, ev Event, out []Progress) []Progress {
	n := ev.Count
	if n < 1 {
		n = 1
	}
	if o.Params[ParamDistinct] == "true" {
		key := distinctKey(o, ev.Target)
		if st.Progress[key] > 0 {
			return out
		}
		st.Progress[key] = 1
		n = 1
	}
	c := st.Progress[o.ID] + n
	if c > need(o) {
		c = need(o)
	}
	st.Progress[o.ID] = c
	return append(out, Progress{
		Quest: q.ID, Objective: o.ID, Text: o.Text,
		Count: c, Need: need(o), Done: c >= need(o),
	})
}

// satisfied reports whether the profile already shows an objective to be done. It
// only covers one-time facts that can never happen again and so could otherwise
// strand a quest: a named species already identified, a named place already
// discovered, a named collectible or cache already taken.
func satisfied(o *proto.ObjectiveDef, p *proto.Profile) bool {
	if need(o) != 1 || o.Target == "" || o.Target == TargetAny || o.Target == TargetUnknown || strings.HasPrefix(o.Target, TargetKind) {
		return false
	}
	switch o.Kind {
	case KindIdentify:
		e := p.Journal.Species[o.Target]
		if e == nil {
			return false
		}
		for k, want := range o.Params {
			if k != ParamMethod {
				return false // where and when it was first identified is not on record
			}
			if e.Method != "mixed" && !oneOf(e.Method, strings.Split(want, "|")...) {
				return false
			}
		}
		return true
	case KindDiscover:
		if len(o.Params) > 0 {
			return false
		}
		_, ok := p.Journal.Locations[o.Target]
		return ok
	case KindCollect:
		if len(o.Params) > 0 {
			return false
		}
		if _, ok := p.Journal.Collectibles[o.Target]; ok {
			return true
		}
		return p.Flags["taken:"+o.Target]
	}
	return false
}

// settle completes objectives the profile already satisfies (see satisfied) and
// marks the quest complete when nothing is left. For ordered quests it only ever
// looks at the current objective, so the order still holds.
func (t *Tracker) settle(p *proto.Profile, q *proto.QuestDef, st *proto.QuestState, out []Progress) []Progress {
	mark := func(o *proto.ObjectiveDef) {
		st.Progress[o.ID] = 1
		out = append(out, Progress{Quest: q.ID, Objective: o.ID, Text: o.Text, Count: 1, Need: 1, Done: true})
	}
	if q.Ordered {
		for o := current(q, st); o != nil && satisfied(o, p); o = current(q, st) {
			mark(o)
		}
	} else {
		for i := range q.Objectives {
			o := &q.Objectives[i]
			if st.Progress[o.ID] < need(o) && satisfied(o, p) {
				mark(o)
			}
		}
	}
	if len(q.Objectives) > 0 && current(q, st) == nil && st.Status == StatusActive {
		st.Status = StatusComplete
		if len(out) == 0 || out[len(out)-1].Quest != q.ID {
			// Cannot happen with authored data, but never lose a completion.
			out = append(out, Progress{Quest: q.ID})
		}
		out[len(out)-1].Complete = true
	}
	return out
}

func cloneReward(r proto.Reward) proto.Reward {
	c := r
	if r.Rep != nil {
		c.Rep = make(map[string]int, len(r.Rep))
		for k, v := range r.Rep {
			c.Rep[k] = v
		}
	}
	c.Items = append([]string(nil), r.Items...)
	c.Unlock = append([]string(nil), r.Unlock...)
	c.Lore = append([]string(nil), r.Lore...)
	return c
}
