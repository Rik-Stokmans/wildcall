package game

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// mysteryWith creates an encountered mystery for a species carrying the given
// evidence keys (true trait values).
func mysteryWith(h *harness, spID string, keys ...string) *proto.Mystery {
	h.t.Helper()
	sp := h.s.spByID(spID)
	if sp == nil {
		h.t.Fatalf("no species %s", spID)
	}
	m := h.s.ensureMystery(sp, proto.LevelEncountered, h.s.feet)
	for _, k := range keys {
		m.Evidence[k] = sp.TraitValue(k)
	}
	return m
}

func TestIdentifyOutcomes(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	robin := "european_robin"

	// Insufficient: one piece of evidence.
	m := mysteryWith(h, robin, "size")
	before := profileJSON(s)
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: robin})
	d, ok := h.last(proto.SIdentify)
	if !ok {
		t.Fatal("no identifyResult")
	}
	if r := decodeAs[proto.IdentifyResult](t, d); r.Outcome != "insufficient" || r.XP != 0 {
		t.Fatalf("one key: %+v", r)
	}
	if profileJSON(s) != before {
		t.Fatal("an insufficient identification changed the profile")
	}

	// Wrong: full evidence, wrong guess. Gentle feedback, guess ruled out, no XP.
	for _, k := range []string{"shape", "primary", "secondary", "bill", "marking"} {
		sp := s.spByID(robin)
		m.Evidence[k] = sp.TraitValue(k)
	}
	xp0 := s.p.XPTotal
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: "eurasian_wren"})
	d, _ = h.last(proto.SIdentify)
	r := decodeAs[proto.IdentifyResult](t, d)
	if r.Outcome != "wrong" || r.Feedback == "" || r.XP != 0 || s.p.XPTotal != xp0 {
		t.Fatalf("wrong guess: %+v", r)
	}
	if !containsStr(m.Wrong, "eurasian_wren") || s.mysteryOf(robin) == nil || s.identified(robin) {
		t.Fatalf("wrong guess bookkeeping: wrong %v", m.Wrong)
	}
	if strings.Contains(strings.ToLower(r.Feedback), "robin") {
		t.Fatalf("wrong-guess feedback names the true species: %q", r.Feedback)
	}
	// The client view of the mystery never carries the species.
	view := s.clientView()
	for _, mm := range view.Journal.Mysteries {
		if mm.Species != "" {
			t.Fatalf("client view leaks mystery species %q", mm.Species)
		}
	}

	// Guess cycling (design rule 1): with nothing new since the wrong guess, the
	// next guess is gently refused, without any penalty.
	snapCycle := profileJSON(s)
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: robin})
	d, _ = h.last(proto.SIdentify)
	if r := decodeAs[proto.IdentifyResult](t, d); r.Outcome != "insufficient" || r.Feedback == "" || r.XP != 0 {
		t.Fatalf("guess without new evidence: %+v", r)
	}
	if profileJSON(s) != snapCycle || s.identified(robin) {
		t.Fatal("a refused guess changed the profile")
	}
	// One new piece of evidence and guessing is open again.
	m.Evidence["pitch"] = s.spByID(robin).TraitValue("pitch")

	// Certain: full evidence, right guess.
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: robin})
	d, _ = h.last(proto.SIdentify)
	r = decodeAs[proto.IdentifyResult](t, d)
	if r.Outcome != "certain" || r.Confidence < 70 || r.XP != s.spByID(robin).FirstIDXP() {
		t.Fatalf("certain: %+v", r)
	}
	// A stale mystery id is refused.
	snap := profileJSON(s)
	h.send(proto.CIdentify, proto.Identify{Mystery: m.ID, Species: robin})
	ms := h.take()
	if _, bad := hasError(ms); !bad || profileJSON(s) != snap {
		t.Fatal("stale mystery id not refused cleanly")
	}

	// Probable: correct guess on thin evidence pays half, confirmed later.
	tit := "great_tit"
	sp := s.spByID(tit)
	m2 := mysteryWith(h, tit, "size", "shape")
	xp0 = s.p.XPTotal
	h.send(proto.CIdentify, proto.Identify{Mystery: m2.ID, Species: tit})
	d, _ = h.last(proto.SIdentify)
	r = decodeAs[proto.IdentifyResult](t, d)
	if r.Outcome != "probable" || r.Confidence >= 70 {
		t.Fatalf("probable: %+v", r)
	}
	e := s.entry(tit)
	if e == nil || !e.Probable || r.XP != progress.IdentifyXP(sp.FirstIDXP(), true) {
		t.Fatalf("probable entry %+v xp %d", e, r.XP)
	}
	// Later the evidence reaches the certain line: confirmed, the rest of the XP paid.
	for _, k := range []string{"primary", "secondary", "bill", "marking"} {
		e.Evidence[k] = sp.TraitValue(k)
	}
	s.maybeConfirm(e, sp, 0)
	if e.Probable || s.p.XPTotal-xp0 != sp.FirstIDXP() {
		t.Fatalf("not confirmed: probable=%v xp %d of %d", e.Probable, s.p.XPTotal-xp0, sp.FirstIDXP())
	}

	// Confirmation through a 2-star photo.
	bt := "blue_tit"
	m3 := mysteryWith(h, bt, "size", "shape")
	h.send(proto.CIdentify, proto.Identify{Mystery: m3.ID, Species: bt})
	d, _ = h.last(proto.SIdentify)
	if r := decodeAs[proto.IdentifyResult](t, d); r.Outcome != "probable" {
		t.Fatalf("blue tit: %+v", r)
	}
	s.maybeConfirm(s.entry(bt), s.spByID(bt), 1)
	if !s.entry(bt).Probable {
		t.Fatal("a 1-star photo must not confirm")
	}
	s.maybeConfirm(s.entry(bt), s.spByID(bt), 2)
	if s.entry(bt).Probable {
		t.Fatal("a 2-star photo did not confirm")
	}
}

func TestAntiGrind(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	id := "common_blackbird"
	if xp := s.award(progress.SrcSpot, id, progress.XPSpot); xp != progress.XPSpot {
		t.Fatalf("first spot %d", xp)
	}
	if xp := s.award(progress.SrcSpot, id, progress.XPSpot); xp != 0 {
		t.Fatalf("second spot paid %d", xp)
	}
	if xp := s.award(progress.SrcPhoto, id, progress.PhotoXP(3)); xp != progress.PhotoXP(3) {
		t.Fatalf("first photo %d", xp)
	}
	if xp := s.award(progress.SrcPhoto, id, progress.PhotoXP(3)); xp != 0 {
		t.Fatalf("same-star photo paid %d", xp)
	}
	if xp := s.award(progress.SrcPhoto, id, progress.PhotoXP(2)); xp != 0 {
		t.Fatalf("worse photo paid %d", xp)
	}
	if xp := s.award(progress.SrcPhoto, id, progress.PhotoXP(4)); xp != progress.PhotoXP(4)-progress.PhotoXP(3) {
		t.Fatalf("better photo paid %d", xp)
	}
	// The anti-grind log never names an unidentified species in the client view.
	for k := range s.clientView().XPLog {
		if strings.Contains(k, id) {
			t.Fatalf("client XP log leaks %q", k)
		}
	}

	// The real photo path: photographing the same bird again at no better rating pays nothing.
	sp := s.spByID("european_robin")
	h.standNear("meadow_clearing", 5)
	bird, _ := s.SpawnAhead(sp.Index, 9)
	if bird == 0 {
		t.Skip("could not place a robin")
	}
	w := &watcher{h: h, bird: bird, dist: 9}
	best, paid := 0, 0
	for attempt := 0; attempt < 10; attempt++ {
		for i := 0; i < 8; i++ {
			if _, ok := w.look("camera", s.p.Stats.CamZoom, false); !ok {
				t.Skip("robin left")
			}
			h.tick(1)
		}
		b, _ := s.sim.Get(bird)
		eye := w.feet.Add(core.V(0, 1.0, 0))
		yaw, pitch := aim(eye, b.Pos)
		h.take()
		h.send(proto.CPhoto, proto.Photo{X: eye.X, Y: eye.Y, Z: eye.Z, Yaw: yaw, Pitch: pitch, FOV: 50 / s.p.Stats.CamZoom, Aspect: 1.6, Sharp: 1, Img: testJPEG})
		d, ok := h.last(proto.SPhoto)
		if !ok {
			t.Fatal("no photoResult")
		}
		pr := decodeAs[proto.PhotoResult](t, d)
		if pr.Photo == nil || pr.Photo.Stars == 0 {
			continue
		}
		st := pr.Photo.Stars
		if st <= best && pr.XP != 0 {
			t.Fatalf("photo %d stars after best %d paid %d XP", st, best, pr.XP)
		}
		if st > best {
			if pr.XP <= 0 {
				t.Fatalf("better photo (%d > %d) paid nothing", st, best)
			}
			best = st
		}
		paid++
	}
	t.Logf("robin photos with a subject: %d, best %d stars", paid, best)
}

func TestFilmExhaustionAndDevelopment(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	h.standNear("old_oak", 20)
	s.p.Film.Used = s.p.Film.Cap
	before := profileJSON(s)
	h.send(proto.CPhoto, proto.Photo{X: s.eye().X, Y: s.eye().Y, Z: s.eye().Z, FOV: 40, Aspect: 1.6, Sharp: 1, Img: testJPEG})
	d, ok := h.last(proto.SPhoto)
	if !ok {
		t.Fatal("no photoResult")
	}
	if pr := decodeAs[proto.PhotoResult](t, d); !pr.NoFilm || pr.Photo != nil {
		t.Fatalf("out of film not refused: %+v", pr)
	}
	if profileJSON(s) != before {
		t.Fatal("a refused shot changed the profile")
	}
	// Walk home: arriving at the cabin develops the roll.
	h.standNear("cabin", 5)
	if s.p.Film.Used != 0 {
		t.Fatalf("film not developed on arrival: %+v", s.p.Film)
	}
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: "cabin"})
	d, ok = h.last(proto.SBase)
	if !ok {
		t.Fatal("no base message")
	}
	if b := decodeAs[proto.BaseMsg](t, d); b.FilmDeveloped != s.p.Film.Cap {
		t.Fatalf("base reports %d frames developed, want %d", b.FilmDeveloped, s.p.Film.Cap)
	}
	// A loaded roll adds frames.
	if _, err := progress.AddItem(s.p, "film_roll", 1); err != nil {
		t.Fatal(err)
	}
	left := progress.FilmLeft(s.p)
	h.send(proto.CUse, proto.ItemAction{Item: "film_roll"})
	if progress.FilmLeft(s.p) != left+progress.FilmPerRoll {
		t.Fatalf("film roll: %d -> %d", left, progress.FilmLeft(s.p))
	}
}

func TestRegionGating(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	pos, ok := s.findRegion(core.RegionMurmurMarsh)
	if !ok {
		t.Skip("no marsh within reach of home in this world")
	}
	feet := h.ground(pos.X, pos.Z)
	xp0 := s.p.XPTotal
	h.take()
	h.stand(feet, 0)
	d, ok := h.last(proto.SRegion)
	if !ok {
		t.Fatal("no region message on entering a locked region")
	}
	rm := decodeAs[proto.RegionMsg](t, d)
	if rm.Unlocked || rm.Reason == "" || rm.Region != int(core.RegionMurmurMarsh) {
		t.Fatalf("locked region message %+v", rm)
	}
	if s.p.XPTotal != xp0 || progress.RegionUnlocked(s.p, core.RegionMurmurMarsh) {
		t.Fatal("entering a locked region paid or unlocked it")
	}
	// Not repeated within a minute.
	h.send(proto.CPose, standPose(feet.Add(core.V(1, 0, 0)), 0))
	h.tick(5)
	if _, ok := h.last(proto.SRegion); ok {
		t.Fatal("locked region message repeated within a minute")
	}
	// Unlock and re-enter: the discovery card and XP, once.
	if _, err := s.Debug("unlock", "murmur_marsh"); err != nil {
		t.Fatal(err)
	}
	h.stand(h.ground(feet.X+2, feet.Z), 0)
	d, ok = h.last(proto.SRegion)
	if !ok {
		t.Fatal("no region discovery on first entering an unlocked region")
	}
	if rm := decodeAs[proto.RegionMsg](t, d); !rm.Unlocked || rm.Species == 0 {
		t.Fatalf("discovery message %+v", rm)
	}
	if s.p.XPTotal <= xp0 || !containsStr(s.p.Journal.Badges, content.RegionBadgeID(core.RegionMurmurMarsh)) {
		t.Fatal("no XP or badge for discovering a region")
	}
	h.stand(h.ground(feet.X+4, feet.Z), 0)
	if _, ok := h.last(proto.SRegion); ok {
		t.Fatal("region discovery repeated")
	}
}

func TestCachesAndCollectibles(t *testing.T) {
	h := newHarness(t, false)
	s := h.s

	// The page in the Old Watchtower: page_0 with its lore. It lies up on the
	// platform: from the ground beneath it is out of reach.
	page, _ := s.world.POI("page_0")
	if ground := s.world.HeightAt(page.Pos.X, page.Pos.Z); page.Pos.Y-ground < 6 {
		t.Fatalf("page_0 is not up on the tower platform: y %.1f, ground %.1f", page.Pos.Y, ground)
	}
	h.standNear("page_0", 1.5)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: "page_0"})
	if _, bad := hasError(h.take()); !bad || s.p.Flags["taken:page_0"] {
		t.Fatal("page_0 could be picked up from the ground under the tower")
	}
	h.stand(page.Pos.Add(core.V(0.8, 0, 0)), 0)
	h.send(proto.CInteract, proto.Interact{POI: "page_0"})
	if _, ok := s.p.Journal.Collectibles["page_0"]; !ok || !s.p.Flags["taken:page_0"] {
		t.Fatalf("page_0 not collected: %v", s.p.Journal.Collectibles)
	}
	before := profileJSON(s)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: "page_0"})
	if _, bad := hasError(h.take()); !bad || profileJSON(s) != before {
		t.Fatal("picking the page up twice was not refused cleanly")
	}

	// The pinned home cache: the Forgotten Journal, announced as a rare item; it
	// reveals the journal's hidden trails.
	h.standNear("cache_watchtower", 1.5)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: "cache_watchtower"})
	ms := h.take()
	if !progress.Owned(s.p, "forgotten_journal") || !s.p.Flags["taken:cache_watchtower"] {
		t.Fatalf("cache_watchtower: journal not given (inv %v)", s.p.Inventory)
	}
	if countType(ms, proto.SRareItem) != 1 {
		t.Fatal("no rareItem for the forgotten journal")
	}
	if !containsStr(s.p.Trails, "secret_pond") {
		t.Fatalf("journal trails not revealed: %v", s.p.Trails)
	}

	// Generated caches and feathers somewhere in the world.
	var cache, feather core.POI
	for r := 1; r < 12 && (cache.ID == "" || feather.ID == ""); r++ {
		for _, c := range []core.Vec3{{X: float32(r) * 600}, {X: -float32(r) * 600}, {Z: float32(r) * 600}, {Z: -float32(r) * 600}} {
			for _, p := range s.world.POIsNear(c.X, c.Z, 500, nil) {
				if p.Kind == "cache" && cache.ID == "" && strings.Contains(p.ID, "@") {
					cache = p
				}
				if p.Kind == "feather" && feather.ID == "" && strings.Contains(p.ID, "@") {
					feather = p
				}
			}
		}
	}
	if cache.ID == "" || feather.ID == "" {
		t.Fatalf("no generated cache (%q) or feather (%q) found", cache.ID, feather.ID)
	}
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		progress.UnlockRegionID(s.p, r)
	}
	credits0, inv0 := s.p.Credits, len(s.p.Inventory)+len(s.p.Storage)
	h.standNear(cache.ID, 1.5)
	h.take()
	h.send(proto.CInteract, proto.Interact{POI: cache.ID})
	ms = h.take()
	if e, bad := hasError(ms); bad {
		t.Fatalf("open %s: %s", cache.ID, e)
	}
	loot := content.CacheLoot(cache.Data["region"])
	switch {
	case len(loot) > 0:
		if !progress.Owned(s.p, loot[0]) || countType(ms, proto.SRareItem) != 1 {
			t.Fatalf("cache in %s did not give %s", cache.Data["region"], loot[0])
		}
	default:
		if s.p.Credits == credits0 && len(s.p.Inventory)+len(s.p.Storage) == inv0 {
			t.Fatalf("modest find gave nothing")
		}
	}
	if !s.p.Flags["taken:"+cache.ID] {
		t.Fatal("cache not flagged taken")
	}

	h.standNear(feather.ID, 1.5)
	h.send(proto.CInteract, proto.Interact{POI: feather.ID})
	var got string
	for id := range s.p.Journal.Collectibles {
		if strings.HasPrefix(id, "feather_") {
			got = id
		}
	}
	if got == "" {
		t.Fatal("no feather collected")
	}
	reg, _ := core.RegionFromKey(feather.Data["region"])
	sp := s.spByID(strings.TrimPrefix(got, "feather_"))
	if sp == nil || !containsInt(sp.Regions, reg) {
		t.Fatalf("feather %s does not belong to region %s", got, feather.Data["region"])
	}
	// Feathers of unidentified species are hidden from the client view.
	if _, ok := s.clientView().Journal.Collectibles[got]; ok {
		t.Fatal("client view shows the feather of an unidentified species")
	}
}

func containsInt(list []core.RegionID, v core.RegionID) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// TestInvalidInputLeavesProfileUnchanged sends every client message type with
// invalid or out-of-context input.
func TestInvalidInputLeavesProfileUnchanged(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	h.standNear("old_oak", 12) // away from the cabin, the shop and every NPC
	h.tick(3)
	h.send(proto.CQuest, proto.QuestAction{ID: "unseen_singer", Action: "track"}) // settle the quest list
	h.take()

	type tc struct {
		name string
		t    string
		d    string
	}
	away := []tc{
		{"pose garbage", proto.CPose, `{"x":"north"}`},
		{"pose not json", proto.CPose, `{{{`},
		{"chunk bad lod", proto.CChunkReq, `{"cx":0,"cz":0,"lod":7}`},
		{"photo not a jpeg", proto.CPhoto, `{"x":0,"y":2,"z":0,"fov":40,"aspect":1.6,"img":"data:image/png;base64,iVBORw0KGgo="}`},
		{"photo bad base64", proto.CPhoto, `{"x":0,"y":2,"z":0,"fov":40,"aspect":1.6,"img":"data:image/jpeg;base64,!!!"}`},
		{"recStart without a recorder", proto.CRecStart, `{}`},
		{"recStop not recording", proto.CRecStop, `{}`},
		{"identify stale mystery", proto.CIdentify, `{"mystery":"m999","species":"european_robin"}`},
		{"interact unknown poi", proto.CInteract, `{"poi":"no_such_place"}`},
		{"interact too far", proto.CInteract, `{"poi":"cache_camp"}`},
		{"interact empty", proto.CInteract, `{}`},
		{"dialog accept from afar", proto.CDialogChoice, `{"npc":"mara","choice":"accept:unseen_singer"}`},
		{"quest unknown", proto.CQuest, `{"id":"no_such_quest","action":"accept"}`},
		{"quest accept away from giver", proto.CQuest, `{"id":"unseen_singer","action":"accept"}`},
		{"quest bad action", proto.CQuest, `{"id":"unseen_singer","action":"explode"}`},
		{"quest turn in not active", proto.CQuest, `{"id":"perfect_moment","action":"turnin"}`},
		{"buy away from the shop", proto.CBuy, `{"item":"film_roll"}`},
		{"upgrade unknown", proto.CUpgrade, `{"item":"basic_binoculars","upgrade":"laser"}`},
		{"equip not owned", proto.CEquip, `{"item":"explorer_binoculars"}`},
		{"equip unknown", proto.CEquip, `{"item":"pogo_stick"}`},
		{"unequip bad slot", proto.CUnequip, `{"slot":"hat"}`},
		{"move away from cabin", proto.CMove, `{"item":"film_roll","to":"storage"}`},
		{"use not owned", proto.CUse, `{"item":"film_roll"}`},
		{"use unknown", proto.CUse, `{"item":"pogo_stick"}`},
		{"skill unknown", proto.CSkill, `{"id":"flying"}`},
		{"skill no points", proto.CSkill, `{"id":"keen_ears"}`},
		{"cabin away", proto.CCabin, `{"action":"rest","until":6}`},
		{"note unidentified species", proto.CNote, `{"species":"european_robin","text":"hello"}`},
		{"note empty", proto.CNote, `{"text":"   "}`},
		{"note stale mystery", proto.CNote, `{"mystery":"m999","text":"hello"}`},
		{"debug without -dev", proto.CDebug, `{"cmd":"credits","args":["9999"]}`},
		{"unknown message", "frobnicate", `{}`},
	}
	run := func(cases []tc) {
		for _, c := range cases {
			before := profileJSON(s)
			h.take()
			h.s.Handle(c.t, json.RawMessage(c.d))
			ms := h.take()
			if _, bad := hasError(ms); !bad {
				t.Errorf("%s: no error message (got %d messages)", c.name, len(ms))
			}
			if after := profileJSON(s); after != before {
				t.Errorf("%s: profile changed", c.name)
			}
		}
	}
	if s.p.SkillPoints != 0 {
		s.p.SkillPoints = 0
	}
	run(away)

	// At the shop.
	h.standNear("shop_finn", 3)
	h.take()
	run([]tc{
		{"buy unknown", proto.CBuy, `{"item":"pogo_stick"}`},
		{"buy not for sale", proto.CBuy, `{"item":"research_backpack"}`},
		{"buy starting kit", proto.CBuy, `{"item":"basic_binoculars"}`},
		{"buy without credits", proto.CBuy, `{"item":"explorer_binoculars"}`},
	})

	// At the cabin.
	h.standNear("cabin", 5)
	h.take()
	run([]tc{
		{"cabin unknown action", proto.CCabin, `{"action":"dance"}`},
		{"cabin upgrade unknown", proto.CCabin, `{"action":"upgrade","id":"moat"}`},
		{"cabin upgrade rank", proto.CCabin, `{"action":"upgrade","id":"map_room"}`},
		{"cabin upgrade credits", proto.CCabin, `{"action":"upgrade","id":"photo_wall"}`},
		{"cabin rest bad hour", proto.CCabin, `{"action":"rest","until":31}`},
		{"cabin pin unknown", proto.CCabin, `{"action":"pin","id":"p999"}`},
		{"cabin unpin unknown", proto.CCabin, `{"action":"unpin","id":"p999"}`},
		{"cabin study unidentified", proto.CCabin, `{"action":"study","id":"european_robin"}`},
		{"cabin analyze unknown", proto.CCabin, `{"action":"analyze","id":"r999"}`},
		{"cabin submit unknown", proto.CCabin, `{"action":"submit","id":"p999"}`},
		{"move unknown item", proto.CMove, `{"item":"pogo_stick","to":"storage"}`},
		{"move bad destination", proto.CMove, `{"item":"basic_binoculars","to":"moon"}`},
		{"board contract not unlocked", proto.CQuest, `{"id":"no_such","action":"accept"}`},
	})
}

// On the title screen the client sends no pose: the birds sing behind the menu but
// the player hears nothing yet (no mysteries, clues or quest progress) and the game
// clock waits for them.
func TestTitleScreenWaitsForThePlayer(t *testing.T) {
	h := newHarness(t, false)
	before := h.s.clock.Env()
	h.tick(600) // a minute on the title screen
	if n := len(h.s.p.Journal.Mysteries); n != 0 {
		t.Fatalf("%d mysteries created before the player started playing", n)
	}
	if c := countType(h.take(), proto.SClue); c != 0 {
		t.Fatalf("%d clues sent before the first pose", c)
	}
	if after := h.s.clock.Env(); after.Time != before.Time || after.Day != before.Day {
		t.Fatalf("clock ran on the title screen: %v -> %v", before.Time, after.Time)
	}
	// The first pose starts the clock.
	h.stand(h.s.feet, 0)
	h.tick(50)
	if after := h.s.clock.Env(); after.Time == before.Time {
		t.Fatalf("clock did not start after the first pose")
	}
}

func TestClockTextRoundsToTheMinute(t *testing.T) {
	for h, want := range map[float32]string{4.99999: "05:00", 5: "05:00", 6.5: "06:30", 23.999: "00:00", 13.25: "13:15"} {
		if got := clockText(h); got != want {
			t.Errorf("clockText(%v) = %s, want %s", h, got, want)
		}
	}
}

// A gift that does not fit in a full pack goes to cabin storage, and the toast says so.
func TestGiftToAFullPackSaysWhereItWent(t *testing.T) {
	h := newHarness(t, true)
	if _, err := h.s.Debug("pantry"); err != nil {
		t.Fatal(err)
	}
	h.take()
	h.s.giveItems([]string{"seed_mix"}, true)
	found := false
	for _, m := range h.take() {
		if m.T == proto.SToast && strings.Contains(string(m.D), "cabin storage") {
			found = true
		}
	}
	if !found {
		t.Fatal("no toast telling the player the gift went to storage")
	}
}

// A hidden trail that a quest awards is not revealed by standing at its trailhead.
func TestQuestRewardTrailIsNotGivenAwayAtTheCabin(t *testing.T) {
	h := newHarness(t, false)
	var head core.Vec3
	for _, tr := range h.s.world.TrailsNear(0, 0, 900, nil) {
		if tr.ID == "secret_lookout" && len(tr.Points) > 0 {
			head = tr.Points[0]
		}
	}
	if head == (core.Vec3{}) {
		t.Skip("no lookout trail in this world")
	}
	h.stand(h.ground(head.X, head.Z), 0)
	h.tick(20)
	if containsStr(h.s.p.Trails, "secret_lookout") {
		t.Fatal("the Old Watchtower's reward trail was revealed at the start")
	}
	if !h.s.trailIsAReward("secret_lookout") {
		t.Fatal("secret_lookout should be a quest reward trail")
	}
}
