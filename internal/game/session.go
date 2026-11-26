// Package game is the WILDCALL session: it owns the world, the ecosystem, the clock
// and the player's profile, and implements every rule of docs/contract.md §3.6 and
// every message of §4 on top of the engine packages (world, eco, env, field,
// progress, content, narrator).
//
// Threading: a Session is NOT safe for concurrent use. Every method is called from
// one goroutine (see Runner). The only state other goroutines may read is exposed
// through Runner.Terrain and Session.Explored (both synchronised).
package game

import (
	crand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"runtime/debug"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/eco"
	"github.com/Rik-Stokmans/wildcall/internal/env"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/save"
	"github.com/Rik-Stokmans/wildcall/internal/species"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Tuning of the session rules.
const (
	tickDT        = 1.0 / core.TickHz
	observeEvery  = 0.25 // s: observation ticks at 4 Hz
	envEvery      = 1.0  // s
	poiEvery      = 1.0  // s
	autosaveEvery = 30.0 // s
	minorPushGap  = 2.0  // s between profile pushes caused only by fog / totals
	poiRadius     = 700  // m: POIs and trails streamed around the player
	poiForget     = 950  // m: beyond this a sent POI is forgotten (the client drops it at ~900)
	snapshotR     = field.MaxSightRange
	cabinEnter    = 16 // m from the cabin: arrival (develops the film)
	cabinLeave    = 30 // m: hysteresis
	cabinUse      = 25 // m: cabin actions allowed within this distance
	shopUse       = 25 // m from Finn's stall / Finn
	npcUse        = 15 // m from an NPC for dialogue and quest hand-ins
	interactSlack = 3  // m added to a POI's radius for interaction
	fogRadius     = 48 // m
	lockedRepeat  = 60 // s between "region locked" messages per region type
	investigateR  = 25 // m: closing in on a heard bird counts as investigating it
	callSendRange = 1.3
	recMaxSeconds = 90
)

// Config configures a Session.
type Config struct {
	Store *save.Store
	// Dev enables debug commands.
	Dev bool
	// DayLen is real seconds per in-game day (0 = default).
	DayLen float32
	// Seed is the world seed text used when there is no save yet ("" = random).
	Seed string
	// Logf receives diagnostics (nil = silent).
	Logf func(format string, args ...any)
	// Worlds builds the world for a seed (nil = world.New). Tests share instances.
	Worlds func(seed int64) *world.World
}

// Sink receives encoded outbound messages. Send must not block.
type Sink interface {
	// Send delivers one JSON envelope of message type t.
	Send(t string, data []byte)
}

// Session is one adventure: the world, its ecosystem, the clock and the player.
type Session struct {
	cfg     Config
	species []core.Species
	tracker *content.Tracker

	// The adventure (replaced on a new game).
	seed     int64
	seedText string
	world    *world.World
	sim      *eco.Sim
	clock    *env.Clock
	narr     *narrator.Narrator
	p        *proto.Profile
	seq      save.Seq
	hasSave  bool
	worldPtr atomic.Pointer[world.World]

	// Explored map tiles (for the map-tile endpoint, read by other goroutines).
	expMu    sync.RWMutex
	expTiles map[string]bool

	// Connection.
	out     Sink
	greeted bool

	// Per-connection streaming state.
	sentPOI   map[string]core.Vec3
	sentTrail map[string]core.Vec3
	// The 700 m POI/trail query runs off the simulation goroutine (a cold query
	// generates structure cells and routes trails: tens of milliseconds).
	saving  atomic.Bool // an autosave write is in flight
	poiCh   chan poiResult
	poiBusy bool
	warmed  map[[2]int32]bool // eco cells whose perches have been pre-generated
	warmedW *world.World

	// Player state.
	pose       proto.Pose
	havePose   bool
	feet       core.Vec3
	vel        core.Vec3
	lastPoseAt float64
	still      float32
	noise      float32 // pending one-shot disturbance (shutter)
	atCabin    bool
	developed  int // film developed on the last arrival, reported by the next base message
	region     core.RegionID
	lockedAt   map[core.RegionID]float64
	lastFocus  bool

	// Perception.
	rng          *rand.Rand
	board        field.ClueBoard
	watch        field.Watch
	calls        field.CallLog
	rec          *field.Recording
	recObsAcc    float32
	sightBird    uint32
	heardBirds   map[uint32]bool
	investigated map[uint32]bool
	mysteryBird  map[string]birdRef

	lures  []lure
	lureID uint32

	// Narration held back while a client message is handled (sent after its reply),
	// and the time until which a dialogue is assumed open (the narrator stays quiet).
	holdNarr    bool
	heldNarr    []proto.Narration
	dialogUntil float64

	// Clocks.
	now                             float64
	tick                            uint32
	obsAcc, envAcc, poiAcc, saveAcc float64
	narrAcc, discAcc                float64
	worstTick                       float64
	dirty, minor                    bool
	lastPush                        float64
	lastLevel                       int
	birdBuf                         []core.BirdState
	evBuf                           []core.EcoEvent
	poiBuf                          []core.POI
	trailBuf                        []core.Trail
	bytesOut                        int64
}

type birdRef struct {
	id    uint32
	flags uint8
}

type lure struct {
	id        uint32
	pos       core.Vec3
	kind      string
	ttl       float32
	permanent bool
}

// New creates a session: it loads the save (or starts a new adventure) and builds
// the world and the ecosystem. It runs the ecosystem's first (populating) step, so
// it takes a few hundred milliseconds.
func New(cfg Config) (*Session, error) {
	if cfg.Store == nil {
		return nil, fmt.Errorf("game: no save store")
	}
	if cfg.DayLen <= 0 {
		cfg.DayLen = env.DefaultDayLen
	}
	s := &Session{
		cfg:     cfg,
		species: species.All(),
		tracker: content.NewTracker(),
		poiCh:   make(chan poiResult, 1),
	}
	f, st, aside, err := cfg.Store.Load()
	switch st {
	case save.Loaded:
		s.logf("save: loaded %s (seed %d)", cfg.Store.Path(), f.Seed)
		s.adopt(f)
		s.hasSave = true
	default:
		if err != nil {
			s.logf("save: %v; starting a new adventure", err)
		}
		if aside != "" {
			s.logf("save: the unusable save was kept as %s", aside)
		}
		s.newAdventure("Naturalist", cfg.Seed)
		if err := s.Save(); err != nil {
			s.logf("save: %v", err)
		}
	}
	return s, nil
}

func (s *Session) logf(format string, args ...any) {
	if s.cfg.Logf != nil {
		s.cfg.Logf(format, args...)
	}
}

// Terrain returns the current world (safe from any goroutine).
func (s *Session) Terrain() *world.World { return s.worldPtr.Load() }

// Explored reports whether the map tile (tx, tz) holds at least one explored cell
// in the current profile (safe from any goroutine).
func (s *Session) Explored(tx, tz int) bool {
	s.expMu.RLock()
	defer s.expMu.RUnlock()
	return s.expTiles[tileKey(tx, tz)]
}

func (s *Session) setExplored(key string) {
	s.expMu.Lock()
	s.expTiles[key] = true
	s.expMu.Unlock()
}

func (s *Session) resetExplored() {
	m := map[string]bool{}
	for k, v := range s.p.Explored {
		for _, b := range v {
			if b != 0 {
				m[k] = true
				break
			}
		}
	}
	s.expMu.Lock()
	s.expTiles = m
	s.expMu.Unlock()
}

// randomSeed draws a world seed for "a random world".
func randomSeed() int64 {
	var b [8]byte
	if _, err := crand.Read(b[:]); err != nil {
		return int64(rand.Uint64() >> 1)
	}
	return int64(binary.LittleEndian.Uint64(b[:]) >> 1)
}

// seedFor turns the player's seed text into a seed and its display text.
func seedFor(text string) (int64, string) {
	if text == "" {
		sd := randomSeed()
		return sd, strconv.FormatInt(sd, 10)
	}
	return world.SeedFromText(text), text
}

// newAdventure throws the current adventure away and builds a fresh one.
func (s *Session) newAdventure(name, seedText string) {
	sd, txt := seedFor(trim(seedText, 64))
	p := progress.NewProfile(trim(name, 40))
	// The home valley is known: no Region Discovery card at the very start.
	p.Flags[regionFlag(core.RegionGreenhollow)] = true
	clock := env.New(sd, s.cfg.DayLen)
	s.install(sd, txt, p, clock, nil, save.Seq{})
	spawn, yaw := s.world.Spawn()
	s.p.Pos, s.p.Yaw = spawn, yaw
	s.feet = spawn
	s.explore(spawn) // the player stands here: the map around the cabin is known
	s.hasSave = false
}

// adopt installs a loaded save.
func (s *Session) adopt(f *save.File) {
	progress.Normalize(f.Profile)
	s.sanitize(f.Profile)
	clock := env.New(f.Seed, s.cfg.DayLen)
	clock.Restore(f.Clock)
	clock.SetDayLen(s.cfg.DayLen)
	s.install(f.Seed, f.SeedText, f.Profile, clock, f.Narrator, f.Seq)
}

func (s *Session) install(sd int64, seedText string, p *proto.Profile, clock *env.Clock, ns *narrator.State, seq save.Seq) {
	s.seed, s.seedText = sd, seedText
	if s.seedText == "" {
		s.seedText = strconv.FormatInt(sd, 10)
	}
	if s.cfg.Worlds != nil {
		s.world = s.cfg.Worlds(sd)
	} else {
		s.world = world.New(sd)
	}
	s.worldPtr.Store(s.world)
	s.sim = eco.New(s.world, s.species, sd)
	s.clock = clock
	s.narr = narrator.New(sd)
	if ns != nil {
		s.safeNarrator(func() { s.narr.Restore(*ns) })
	}
	s.p = p
	s.seq = seq
	s.rng = rand.New(rand.NewPCG(uint64(sd), 0x5eed))
	for _, r := range content.UnlockedRegions(p.Rank) {
		progress.UnlockRegionID(p, core.RegionID(r))
	}
	s.tracker.Sync(p)
	progress.Recompute(p)
	s.lastLevel = p.Level
	s.resetExplored()
	s.lures = nil
	s.resetPerception()
	s.feet = p.Pos
	s.havePose = false
	// Populate the ecosystem now (the first Step activates every cell around home).
	s.sim.Step(0.001, s.clock.Env(), core.Observer{})
	if progress.HasCabin(p, progress.CabinGarden) {
		s.addGardenFeeder()
	}
}

func (s *Session) resetPerception() {
	s.board.Reset()
	s.watch.Reset()
	s.calls = field.CallLog{}
	s.rec = nil
	s.sightBird = 0
	s.heardBirds = map[uint32]bool{}
	s.investigated = map[uint32]bool{}
	s.mysteryBird = map[string]birdRef{}
	s.lockedAt = map[core.RegionID]float64{}
	s.sentPOI = map[string]core.Vec3{}
	s.sentTrail = map[string]core.Vec3{}
}

// File builds the save file of the current adventure.
func (s *Session) File() *save.File {
	ns := s.narr.State()
	return &save.File{
		Seed: s.seed, SeedText: s.seedText,
		Profile:  s.p,
		Clock:    s.clock.State(),
		Narrator: &ns,
		Seq:      s.seq,
	}
}

// Save writes the adventure to disk.
func (s *Session) Save() error {
	return s.cfg.Store.Save(s.File())
}

// autosave encodes the adventure on the simulation goroutine and writes it on a
// helper goroutine, so disk latency (fsync) never stalls a tick.
func (s *Session) autosave() {
	if s.saving.Load() {
		return
	}
	data, err := save.Encode(s.File())
	if err != nil {
		s.logf("autosave: %v", err)
		return
	}
	s.saving.Store(true)
	st := s.cfg.Store
	go func() {
		defer s.saving.Store(false)
		if err := st.Write(data); err != nil {
			s.logf("autosave: %v", err)
		}
	}()
}

// Profile returns the server-side profile (tests and tools; do not mutate from
// another goroutine).
func (s *Session) Profile() *proto.Profile { return s.p }

// Sim returns the ecosystem (tests and tools).
func (s *Session) Sim() *eco.Sim { return s.sim }

// Clock returns the clock (tests and tools).
func (s *Session) Clock() *env.Clock { return s.clock }

// Seed returns the world seed.
func (s *Session) Seed() int64 { return s.seed }

// WorstTick returns the slowest tick so far in seconds and resets it.
func (s *Session) WorstTick() float64 { w := s.worstTick; s.worstTick = 0; return w }

// BytesOut is the number of bytes handed to the sink so far.
func (s *Session) BytesOut() int64 { return s.bytesOut }

// Attach connects a client. The client must say hello before anything happens.
func (s *Session) Attach(out Sink) {
	s.out = out
	s.greeted = false
	s.resetPerception()
	s.havePose = false
}

// Detach disconnects the client and saves.
func (s *Session) Detach() {
	if s.rec != nil {
		s.rec = nil
	}
	s.out = nil
	s.greeted = false
	if err := s.Save(); err != nil {
		s.logf("save: %v", err)
	}
}

// Handle processes one client message (an envelope's type and payload).
func (s *Session) Handle(t string, d json.RawMessage) {
	defer s.recoverMsg(t)
	if t == proto.CHello {
		var h proto.Hello
		if err := decode(d, &h); err != nil {
			s.fail("That greeting could not be read.")
			return
		}
		s.hello(h)
		s.flush()
		return
	}
	if !s.greeted {
		s.fail("Say hello first.")
		return
	}
	h, ok := handlers[t]
	if !ok {
		s.fail("Unknown message " + strconv.Quote(trim(t, 32)) + ".")
		return
	}
	s.holdNarr = true
	h(s, d)
	s.afterChange()
	s.releaseNarration()
	s.flush()
}

func (s *Session) recoverMsg(t string) {
	if r := recover(); r != nil {
		s.holdNarr, s.heldNarr = false, s.heldNarr[:0]
		s.logf("game: panic handling %q: %v\n%s", t, r, debug.Stack())
		s.fail("Something went wrong there.")
	}
}

var handlers map[string]func(*Session, []byte)

func init() {
	handlers = map[string]func(*Session, []byte){
		proto.CPose:         (*Session).msgPose,
		proto.CChunkReq:     (*Session).msgChunk,
		proto.CPhoto:        (*Session).msgPhoto,
		proto.CRecStart:     (*Session).msgRecStart,
		proto.CRecStop:      (*Session).msgRecStop,
		proto.CIdentify:     (*Session).msgIdentify,
		proto.CInteract:     (*Session).msgInteract,
		proto.CDialogChoice: (*Session).msgDialogChoice,
		proto.CQuest:        (*Session).msgQuest,
		proto.CBuy:          (*Session).msgBuy,
		proto.CUpgrade:      (*Session).msgUpgrade,
		proto.CEquip:        (*Session).msgEquip,
		proto.CUnequip:      (*Session).msgUnequip,
		proto.CMove:         (*Session).msgMove,
		proto.CUse:          (*Session).msgUse,
		proto.CSkill:        (*Session).msgSkill,
		proto.CCabin:        (*Session).msgCabin,
		proto.CNote:         (*Session).msgNote,
		proto.CDebug:        (*Session).msgDebug,
	}
}

func decode(d []byte, v any) error {
	if len(d) == 0 {
		d = []byte("{}")
	}
	return json.Unmarshal(d, v)
}

// hello starts (or restarts) the conversation with the client.
func (s *Session) hello(h proto.Hello) {
	resumed := s.hasSave
	if h.NewGame {
		s.newAdventure(h.Name, h.Seed)
		if err := s.cfg.Store.ClearPhotos(); err != nil {
			s.logf("save: clear photos: %v", err)
		}
		if err := s.Save(); err != nil {
			s.logf("save: %v", err)
		}
		resumed = false
	} else if h.Name != "" && s.p.Name == "Naturalist" {
		s.p.Name = trim(h.Name, 40)
	}
	s.greeted = true
	s.resetPerception()
	s.havePose = false
	s.feet = s.p.Pos
	s.region = s.world.RegionAt(s.feet.X, s.feet.Z)
	cabin, _ := s.world.POI("cabin")
	s.atCabin = cabin.Pos.DistXZ(s.feet) <= cabinEnter
	s.send(proto.SWelcome, s.welcome())
	// From now on the adventure exists: a later connection offers "Continue".
	s.hasSave = true
	for _, l := range s.lures {
		s.send(proto.SLure, proto.LureMsg{ID: l.id, Pos: l.pos, Kind: l.kind, Active: true})
	}
	s.dirty = false
	s.lastPush = s.now
	if resumed {
		s.narrate(narrator.Event{Kind: narrator.Resumed})
	} else {
		s.narrate(narrator.Event{Kind: narrator.NewAdventure})
	}
}

// welcome assembles the welcome message: every catalog, the home valley and what is
// in range, the profile and the environment.
func (s *Session) welcome() proto.Welcome {
	home := s.world.HomePOIs()
	cabin, _ := s.world.POI("cabin")
	pois := append([]core.POI(nil), home...)
	for _, poi := range home {
		s.sentPOI[poi.ID] = poi.Pos
	}
	s.poiBuf = s.world.POIsNear(s.feet.X, s.feet.Z, poiRadius, s.poiBuf[:0])
	for _, poi := range s.poiBuf {
		if _, ok := s.sentPOI[poi.ID]; !ok {
			s.sentPOI[poi.ID] = poi.Pos
			pois = append(pois, poi)
		}
	}
	var trails []core.Trail
	for _, c := range []core.Vec3{cabin.Pos, s.feet} {
		s.trailBuf = s.world.TrailsNear(c.X, c.Z, poiRadius, s.trailBuf[:0])
		for _, t := range s.trailBuf {
			if _, ok := s.sentTrail[t.ID]; !ok && len(t.Points) > 0 {
				s.sentTrail[t.ID] = t.Points[len(t.Points)/2]
				trails = append(trails, t)
			}
		}
	}
	if trails == nil {
		trails = []core.Trail{}
	}
	ids := make([]string, len(s.species))
	for i := range s.species {
		ids[i] = s.species[i].ID
	}
	spawnYaw := s.p.Yaw
	return proto.Welcome{
		Version: proto.Version,
		Seed:    s.seed,
		Dev:     s.cfg.Dev,
		HasSave: s.hasSave,
		World: proto.WorldInfo{
			Seed: s.seed, SeedText: s.seedText,
			ChunkSize: core.ChunkSize, SeaLevel: core.SeaLevel,
			MapTileSize: core.MapTileSize, MapTilePx: core.MapTilePx,
			MapURL:  "/map/{tx}/{tz}.png",
			FogCell: core.FogCell, Home: cabin.Pos, HomeRadius: core.HomeRadius,
		},
		Regions:      content.Regions(),
		Species:      s.species,
		Ranks:        progress.Ranks(),
		Disciplines:  progress.Disciplines(),
		SkillTiers:   progress.SkillTiers(),
		Skills:       progress.Skills(),
		Items:        progress.Items(),
		CabinUps:     progress.CabinUpgrades(),
		NPCs:         content.NPCs(),
		Quests:       s.questView(),
		Collectibles: content.Collectibles(s.species),
		Lore:         content.Lore(),
		POIs:         pois,
		Trails:       trails,
		Shop:         progress.ShopItems(),
		Profile:      s.clientView(),
		Env:          s.envMsg(),
		Spawn:        proto.Teleport{Pos: s.feet, Yaw: spawnYaw},
	}
}

func (s *Session) envMsg() proto.EnvMsg {
	e := s.clock.Env()
	return proto.EnvMsg{Env: e, Phase: e.Phase().String(), Forecast: s.clock.Forecast(), DayLen: s.clock.DayLen()}
}

func trim(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		r = r[:n]
	}
	out := string(r)
	for len(out) > 0 && (out[0] == ' ' || out[0] == '\t') {
		out = out[1:]
	}
	for len(out) > 0 && (out[len(out)-1] == ' ' || out[len(out)-1] == '\t') {
		out = out[:len(out)-1]
	}
	return out
}
