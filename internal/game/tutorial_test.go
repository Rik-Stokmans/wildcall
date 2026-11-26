package game

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

const wrenID = "eurasian_wren"

// talkUntil opens a conversation with an NPC and clicks through it until a choice
// with the wanted id is available, which it then picks. It returns the node that
// answered the wanted choice and the messages seen.
func (h *harness) talkUntil(npcPOI, npc, want string) (proto.DialogNode, []outMsg) {
	h.t.Helper()
	h.standNear(npcPOI, 2)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: npcPOI})
	var seen []outMsg
	ms := h.take()
	seen = append(seen, ms...)
	d, ok := lastOf(ms, proto.SDialog)
	if !ok {
		e, _ := hasError(ms)
		h.t.Fatalf("no dialog from %s (error %q)", npcPOI, e)
	}
	node := decodeAs[proto.DialogNode](h.t, d)
	for step := 0; step < 25; step++ {
		var pick string
		for _, c := range node.Choices {
			if c.ID == want {
				pick = c.ID
			}
		}
		final := pick != ""
		if !final {
			for _, pref := range []string{"accept:", "turnin:", "complete:", "offer:"} {
				for _, c := range node.Choices {
					if pick == "" && strings.HasPrefix(c.ID, pref) && strings.HasSuffix(want, c.ID[len(pref):]) {
						pick = c.ID
					}
				}
			}
		}
		if pick == "" {
			for _, c := range node.Choices {
				if pick == "" && c.Kind == "next" {
					pick = c.ID
				}
			}
		}
		if pick == "" {
			h.t.Fatalf("dialog with %s dead-ends before %q: %+v", npc, want, node)
		}
		h.send(proto.CDialogChoice, proto.DialogChoiceMsg{NPC: npc, Choice: pick})
		ms := h.take()
		seen = append(seen, ms...)
		d, ok := lastOf(ms, proto.SDialog)
		if !ok {
			h.t.Fatalf("no dialog answer to %q", pick)
		}
		node = decodeAs[proto.DialogNode](h.t, d)
		if final {
			return node, seen
		}
	}
	h.t.Fatalf("never reached %q", want)
	return node, seen
}

func lastOf(ms []outMsg, t string) (json.RawMessage, bool) {
	var d json.RawMessage
	ok := false
	for _, m := range ms {
		if m.T == t {
			d, ok = m.D, true
		}
	}
	return d, ok
}

func (h *harness) questStatus(id string) string {
	if q := h.s.p.Quests[id]; q != nil {
		return q.Status
	}
	return ""
}

func (h *harness) questProgress(id, obj string) int {
	if q := h.s.p.Quests[id]; q != nil {
		return q.Progress[obj]
	}
	return 0
}

// watcher keeps the player at a calm distance from a bird and looks at it.
type watcher struct {
	h    *harness
	bird uint32
	feet core.Vec3
	dist float32
}

// place moves the player (teleport) to a spot about w.dist from the bird on land.
func (w *watcher) place(b core.BirdState) {
	h := w.h
	from := w.feet
	if from == (core.Vec3{}) {
		from = h.s.feet
	}
	base := core.HeadingTo(b.Pos, from)
	for i := 0; i < 12; i++ {
		ang := base + float32(i)*math.Pi/6
		p := b.Pos.Add(core.HeadingDir(ang).Scale(w.dist))
		gy := h.s.world.HeightAt(p.X, p.Z)
		if gy < 0.3 {
			continue
		}
		feet := core.V(p.X, gy, p.Z)
		eye := feet.Add(core.V(0, 1.0, 0))
		if h.s.world.Occlusion(eye, b.Pos) < 0.5 {
			w.feet = feet
			h.s.Teleport(feet, core.HeadingTo(feet, b.Pos))
			return
		}
	}
	p := b.Pos.Add(core.HeadingDir(base).Scale(w.dist))
	w.feet = h.ground(p.X, p.Z)
	h.s.Teleport(w.feet, core.HeadingTo(w.feet, b.Pos))
}

// look sends a crouched, still pose aimed at the bird with a tool raised, after
// repositioning if the bird has wandered off. It returns false if the bird is gone.
func (w *watcher) look(tool string, zoom float32, focus bool) (core.BirdState, bool) {
	b, ok := w.h.s.sim.Get(w.bird)
	if !ok {
		return b, false
	}
	if w.feet == (core.Vec3{}) || b.Pos.DistXZ(w.feet) > w.dist*1.8 || b.Pos.DistXZ(w.feet) < w.dist*0.4 {
		w.place(b)
	}
	eye := w.feet.Add(core.V(0, 1.0, 0))
	yaw, pitch := aim(eye, b.Pos)
	p := proto.Pose{X: eye.X, Y: eye.Y, Z: eye.Z, Yaw: yaw, Pitch: pitch, Move: "crouch", Crouch: true,
		Focus: focus, Tool: tool, Raised: tool != "none", Zoom: zoom, Sharp: 1}
	switch tool {
	case "binoculars":
		p.FOV = w.h.s.p.Stats.BinoFOV / zoom
	case "camera":
		p.FOV = 50 / zoom
	default:
		p.FOV = 70
	}
	w.h.send(proto.CPose, p)
	return b, true
}

// playTutorialToIdentify plays the tutorial from Mara's offer up to the moment the
// wren could be identified: accept, hear it (focus listening), investigate and
// observe it, record it, gather more evidence. It does NOT identify it.
func playTutorialToIdentify(t *testing.T, h *harness) (birdID uint32, m *proto.Mystery, w *watcher) {
	t.Helper()
	s := h.s
	wren := s.spByID(wrenID)
	if wren == nil {
		t.Fatal("no wren in the catalog")
	}
	// 1. Mara offers the tutorial; accepting it hands over her recorder.
	_, _ = h.talkUntil("npc_mara", "mara", "accept:unseen_singer")
	if st := h.questStatus("unseen_singer"); st != "active" {
		t.Fatalf("tutorial status %q after accepting", st)
	}
	if s.p.Equipped[progress.SlotAudio] != "basic_recorder" && progress.Carried(s.p, "basic_recorder") == 0 {
		t.Fatalf("no recorder after accepting: equipped %v inv %v", s.p.Equipped, s.p.Inventory)
	}
	if s.p.Equipped[progress.SlotAudio] == "" {
		h.send(proto.CEquip, proto.ItemAction{Item: "basic_recorder"})
	}

	// 2. A wren near a quiet spot in the woods, in the morning.
	if _, err := s.Debug("time", "7"); err != nil {
		t.Fatal(err)
	}
	h.standNear("old_oak", 30)
	if msg, err := s.Debug("spawn", wrenID); err != nil {
		t.Fatalf("spawn: %v", err)
	} else {
		t.Log(msg)
	}
	near := s.sim.Near(s.eye(), 40, nil)
	for _, b := range near {
		if b.Species == wren.Index && (birdID == 0 || b.Pos.Dist(s.eye()) < 30) {
			birdID = b.ID
		}
	}
	if birdID == 0 {
		t.Fatal("spawned wren not found")
	}
	w = &watcher{h: h, bird: birdID, dist: 11}

	// Hear it (focus-listening), approach to investigate.
	heard := false
	for i := 0; i < 3000 && h.questProgress("unseen_singer", "hear") == 0; i++ {
		if _, ok := w.look("none", 1, true); !ok {
			t.Fatal("the wren vanished")
		}
		h.tick(1)
	}
	heard = h.questProgress("unseen_singer", "hear") > 0
	if !heard {
		t.Fatal("never heard the wren")
	}
	m = s.mysteryOf(wrenID)
	if m == nil || m.Level < proto.LevelHeard {
		t.Fatalf("no heard-level mystery for the wren: %+v", m)
	}
	t.Logf("heard: mystery %s evidence %v", m.ID, m.Evidence)

	// Observe through binoculars until we have a few pieces of evidence.
	for i := 0; i < 2400 && (h.questProgress("unseen_singer", "investigate") == 0 || len(m.Evidence) < 4); i++ {
		if _, ok := w.look("binoculars", s.p.Stats.BinoZoom, false); !ok {
			t.Fatal("the wren vanished")
		}
		h.tick(1)
	}
	if h.questProgress("unseen_singer", "investigate") == 0 {
		t.Fatal("investigate objective not reached")
	}
	t.Logf("observed: level %d evidence %v", m.Level, m.Evidence)

	// Record its song.
	recorded := false
	for attempt := 0; attempt < 12 && !recorded; attempt++ {
		h.take()
		h.send(proto.CRecStart, struct{}{})
		if e, bad := hasError(h.take()); bad {
			t.Fatalf("recStart: %s", e)
		}
		sang := false
		for i := 0; i < 400; i++ {
			if _, ok := w.look("recorder", 1, false); !ok {
				t.Fatal("the wren vanished")
			}
			h.tick(1)
			for _, mm := range h.take() {
				if mm.T == proto.SCall && decodeAs[proto.CallMsg](t, mm.D).Bird == birdID {
					sang = true
				}
			}
			if sang && i > 80 {
				break
			}
		}
		h.send(proto.CRecStop, struct{}{})
		d, ok := h.last(proto.SRec)
		if !ok {
			t.Fatal("no recResult")
		}
		res := decodeAs[proto.RecResult](t, d)
		recorded = res.Rec != nil && h.questProgress("unseen_singer", "record") > 0
		if res.Rec != nil && res.Rec.Species != "" {
			t.Fatalf("recording of an unidentified bird names it: %+v", res.Rec)
		}
		t.Logf("recording attempt %d: sang=%v rec=%v notes=%v", attempt, sang, res.Rec != nil, res.Notes)
	}
	if !recorded {
		t.Fatal("could not record the wren")
	}

	// More evidence before naming it.
	for i := 0; i < 2400 && len(m.Evidence) < 6; i++ {
		if _, ok := w.look("binoculars", s.p.Stats.BinoZoom, false); !ok {
			break
		}
		h.tick(1)
	}
	t.Logf("evidence before identify: %v", m.Evidence)

	return birdID, m, w
}

// TestTutorialUnseenSinger plays the tutorial quest end to end on the real world and
// checks that nothing names the wren before it is identified.
func TestTutorialUnseenSinger(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	wren := s.spByID(wrenID)
	// Leak scan over every message from here until the identification.
	scanFrom := len(h.all)
	h.take()
	birdID, m, w := playTutorialToIdentify(t, h)

	// Leak scan: nothing sent so far may carry the wren's id or name, except the
	// candidate tables (built from the player's own evidence) and numeric indices.
	h.take()
	name := strings.ToLower(wren.Name)
	for _, mm := range h.all[scanFrom:] {
		if mm.T == proto.SWelcome || mm.T == proto.SBirds {
			continue
		}
		js := strings.ToLower(stripCandidates(string(mm.D)))
		if strings.Contains(js, wrenID) || strings.Contains(js, name) || strings.Contains(js, "wren") {
			t.Errorf("message %q leaks the unidentified wren: %s", mm.T, trimForLog(string(mm.D)))
		}
	}

	// Identify it.
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: wrenID})
	d, ok := h.last(proto.SIdentify)
	if !ok {
		t.Fatal("no identifyResult")
	}
	idr := decodeAs[proto.IdentifyResult](t, d)
	t.Logf("identify: %+v", idr)
	if idr.Outcome != "certain" && idr.Outcome != "probable" {
		t.Fatalf("identification outcome %q", idr.Outcome)
	}
	if s.entry(wrenID) == nil || s.mysteryOf(wrenID) != nil {
		t.Fatal("the mystery did not become a species entry")
	}
	if h.questProgress("unseen_singer", "identify") == 0 {
		t.Fatal("identify objective not reached")
	}

	// Photograph it.
	photographed := false
	for attempt := 0; attempt < 11 && !photographed; attempt++ {
		var b core.BirdState
		for i := 0; i < 15; i++ {
			b, ok = w.look("camera", s.p.Stats.CamZoom, false)
			if !ok {
				t.Fatal("the wren vanished")
			}
			h.tick(1)
		}
		eye := w.feet.Add(core.V(0, 1.0, 0))
		b, _ = s.sim.Get(birdID)
		yaw, pitch := aim(eye, b.Pos)
		zoom := s.p.Stats.CamZoom
		h.take()
		h.send(proto.CPhoto, proto.Photo{X: eye.X, Y: eye.Y, Z: eye.Z, Yaw: yaw, Pitch: pitch,
			FOV: 50 / zoom, Aspect: 1.6, Sharp: 1, Shake: 0, Img: testJPEG})
		d, ok := h.last(proto.SPhoto)
		if !ok {
			t.Fatal("no photoResult")
		}
		pr := decodeAs[proto.PhotoResult](t, d)
		if pr.Photo != nil {
			t.Logf("photo %d: %d stars score %d notes %v", attempt, pr.Photo.Stars, pr.Photo.Score, pr.Notes)
		}
		photographed = h.questStatus("unseen_singer") == "complete"
	}
	if !photographed {
		t.Fatalf("the tutorial is not complete: %+v", s.p.Quests["unseen_singer"])
	}

	// Hand it in to Mara.
	sp0, cr0 := s.p.SkillPoints, s.p.Credits
	_, seen := h.talkUntil("npc_mara", "mara", "turnin:unseen_singer")
	rd, ok := lastOf(append(seen, h.take()...), proto.SRewards)
	if !ok {
		t.Fatal("no rewards message on turn-in")
	}
	rw := decodeAs[proto.RewardsMsg](t, rd)
	t.Logf("rewards: %+v", rw)
	if h.questStatus("unseen_singer") != "turned_in" || rw.XP <= 0 || rw.Credits <= 0 || s.p.Credits <= cr0 {
		t.Fatalf("turn-in did not pay out: status %q rewards %+v", h.questStatus("unseen_singer"), rw)
	}
	if s.p.SkillPoints <= sp0 {
		t.Fatalf("no skill point from the tutorial (%d -> %d)", sp0, s.p.SkillPoints)
	}

	// Spend a skill point.
	h.take()
	h.send(proto.CSkill, proto.SkillAction{ID: "keen_ears"})
	if e, bad := hasError(h.take()); bad {
		t.Fatalf("buy skill: %s", e)
	}
	if s.p.Skills["keen_ears"] != 1 {
		t.Fatal("keen_ears not learned")
	}

	// Explorer binoculars at Finn's.
	h.standNear("shop_finn", 3)
	h.send(proto.CBuy, proto.ItemAction{Item: "explorer_binoculars"})
	if e, bad := hasError(h.take()); bad {
		t.Fatalf("buy binoculars: %s (credits %d)", e, s.p.Credits)
	}
	h.send(proto.CEquip, proto.ItemAction{Item: "explorer_binoculars"})
	if e, bad := hasError(h.take()); bad {
		t.Fatalf("equip binoculars: %s", e)
	}
	if s.p.Equipped[progress.SlotOptics] != "explorer_binoculars" || s.p.Stats.BinoZoom < 8 {
		t.Fatalf("binoculars not equipped: %v zoom %v", s.p.Equipped, s.p.Stats.BinoZoom)
	}

	// Home: open the cabin and rest until dawn.
	h.standNear("cabin", 6)
	h.tick(2)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: "cabin"})
	if _, ok := h.last(proto.SBase); !ok {
		t.Fatal("the cabin did not open the home base")
	}
	day0 := s.clock.Env().Day
	h.send(proto.CCabin, proto.CabinAction{Action: "rest", Until: 5})
	if e, bad := hasError(h.take()); bad {
		t.Fatalf("rest: %s", e)
	}
	if e := s.clock.Env(); e.Day == day0 && e.Time < 5 || math.Abs(float64(e.Time-5)) > 0.1 {
		t.Fatalf("rest did not reach 05:00: day %d time %v", e.Day, e.Time)
	}

	// Save, reload, and find everything intact.
	before := profileJSON(s)
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	s2 := newSession(t, h.dir, "ignored-seed", true)
	if s2.Seed() != s.Seed() {
		t.Fatalf("seed changed on reload: %d -> %d", s.Seed(), s2.Seed())
	}
	p2 := s2.Profile()
	if p2.Quests["unseen_singer"].Status != "turned_in" || p2.Journal.Species[wrenID] == nil ||
		p2.Equipped[progress.SlotOptics] != "explorer_binoculars" || p2.Skills["keen_ears"] != 1 ||
		p2.Credits != s.p.Credits || p2.XPTotal != s.p.XPTotal || len(p2.Journal.Photos) != len(s.p.Journal.Photos) ||
		len(p2.Journal.Recordings) != len(s.p.Journal.Recordings) {
		t.Fatalf("reloaded profile differs")
	}
	if after := profileJSON(s2); after != before {
		// Allowed to differ only in derived stats recomputation; report.
		t.Logf("profile JSON differs after reload (len %d vs %d)", len(before), len(after))
	}
	if e1, e2 := s.clock.Env(), s2.Clock().Env(); e1.Day != e2.Day || math.Abs(float64(e1.Time-e2.Time)) > 0.01 {
		t.Fatalf("clock not restored: %+v vs %+v", e1, e2)
	}
	for _, ph := range p2.Journal.Photos {
		if _, ok := s2.cfg.Store.PhotoPath(ph.ID); !ok {
			t.Fatalf("photo file %s missing after reload", ph.ID)
		}
	}
}

func trimForLog(s string) string {
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}

// TestNarratorNeverNamesTheUnidentifiedWren plays the tutorial up to (not including)
// the identification and checks the narrator's lines (contract §8, the non-spoiler
// rule): the narrator speaks along the way, and no line names the wren, or any other
// species the player has not identified.
func TestNarratorNeverNamesTheUnidentifiedWren(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	playTutorialToIdentify(t, h)
	h.take()

	var lines []proto.Narration
	for _, mm := range h.all {
		if mm.T == proto.SNarrate {
			lines = append(lines, decodeAs[proto.Narration](t, mm.D))
		}
	}
	for _, n := range lines {
		t.Logf("narrator [%s p%d]: %s", n.Kind, n.Priority, n.Text)
	}
	// The tutorial run covers several minutes of play with calls heard, a bird
	// watched, evidence gathered and a recording made: the narrator must have had
	// something to say, or this test proves nothing.
	if len(lines) < 3 {
		t.Fatalf("only %d narrator lines during the tutorial; expected the narrator to speak", len(lines))
	}
	if len(s.p.Journal.Species) != 0 {
		t.Fatalf("the test expects nothing identified yet, journal has %d species", len(s.p.Journal.Species))
	}
	for _, n := range lines {
		low := strings.ToLower(n.Text)
		if strings.Contains(low, "wren") {
			t.Errorf("narrator names the unidentified wren: %q", n.Text)
		}
		for i := range s.species {
			sp := &s.species[i]
			if strings.Contains(low, strings.ToLower(sp.Name)) || strings.Contains(low, sp.ID) {
				t.Errorf("narrator names unidentified species %s: %q", sp.ID, n.Text)
			}
		}
	}
}
