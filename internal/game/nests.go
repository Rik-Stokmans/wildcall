package game

import (
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Nests (contract §11): the nests near the player are streamed (never their owner
// species), a nest the player clearly watches or photographs is "found" (a journal
// NestEntry, XP once per nest species as a unique behaviour, a narrator line).

const (
	nestStreamR   = 200 // m: nests streamed around the player
	nestEvery     = 1.0 // s
	nestHeartbeat = 10  // s: the full list is re-sent at least this often even if unchanged
)

// nestKey is the journal id of a nest: "n<nest id>".
func nestKey(id uint32) string { return "n" + strconv.FormatUint(uint64(id), 10) }

func siteIndex(site string) int {
	for i, s := range proto.NestSites {
		if s == site {
			return i
		}
	}
	return -1
}

// nestsFrame encodes a NestsMsg: [id, siteIndex, stage, x, y, z, size, yaw] per nest,
// with exact integer ids (a float32 array cannot hold every 32-bit id). The owner
// species is never part of it.
func nestsFrame(nests []core.Nest) []byte {
	b := make([]byte, 0, 24+len(nests)*56)
	b = append(b, `{"t":"nests","d":{"n":[`...)
	first := true
	for _, n := range nests {
		si := siteIndex(n.Site)
		if si < 0 {
			continue
		}
		if !first {
			b = append(b, ',')
		}
		first = false
		b = append(b, '[')
		b = strconv.AppendUint(b, uint64(n.ID), 10)
		b = append(b, ',')
		b = strconv.AppendInt(b, int64(si), 10)
		b = append(b, ',')
		b = strconv.AppendUint(b, uint64(n.Stage), 10)
		for _, v := range [...]float32{n.Pos.X, n.Pos.Y, n.Pos.Z, n.Size} {
			b = append(b, ',')
			b = appendNum(b, v, 2)
		}
		b = append(b, ',')
		b = appendNum(b, n.Yaw, 3)
		b = append(b, ']')
	}
	b = append(b, "]}}"...)
	return b
}

// streamNests sends the nests within nestStreamR of the player when the list
// changed (checked once a second), and at least every nestHeartbeat seconds.
func (s *Session) streamNests() {
	if !s.havePose {
		return
	}
	s.nestBuf = s.sim.Nests(s.feet, nestStreamR, s.nestBuf[:0])
	frame := nestsFrame(s.nestBuf)
	if string(frame) == string(s.lastNests) && s.now-s.lastNestsAt < nestHeartbeat {
		return
	}
	s.lastNests = frame
	s.lastNestsAt = s.now
	s.sendRaw(proto.SNests, frame)
}

// watchNests runs the nest watch at the observation rate (4 Hz).
func (s *Session) watchNests(ctx *field.Context, dt float32) {
	s.sightNests = s.sim.Nests(s.eye(), field.MaxSightRange, s.sightNests[:0])
	if sight, ok := s.nestWatch.Tick(ctx, dt, s.pose, s.sightNests); ok {
		s.foundNest(sight.Nest, "", 0)
	}
}

// nestEntry returns the journal entry of a nest (nil if not found yet).
func (s *Session) nestEntry(key string) *proto.NestEntry {
	for _, e := range s.p.Journal.Nests {
		if e != nil && e.ID == key {
			return e
		}
	}
	return nil
}

// siteWords is a player-facing description of a nest site that never names a bird.
var siteWords = map[string]string{
	"cavity":    "A nest hole in a tree",
	"cup_shrub": "A cup nest deep in a bush",
	"cup_fork":  "A cup nest in the fork of a tree",
	"platform":  "A big platform of sticks",
	"dome":      "A domed nest, tucked away",
	"pendant":   "A tiny nest slung beneath a branch",
	"ground":    "A nest on the ground",
	"scrape":    "A scrape on the bare ground",
	"reed":      "A nest woven among the reeds",
	"floating":  "A floating nest among the water plants",
	"burrow":    "A nest burrow",
	"ledge":     "A nest on a ledge",
}

// foundNest records a nest the player has found by watching it (photo "") or in a
// photograph. The journal keeps the true owner (Species, persisted like
// Mystery.Species); the client view names it only once the player has identified
// that species. The first nest of each species pays unique-behaviour XP.
func (s *Session) foundNest(n core.Nest, photo string, stars int) {
	key := nestKey(n.ID)
	sp := s.spAt(n.Species)
	e := s.nestEntry(key)
	if e != nil {
		if e.Stage != int(n.Stage) {
			e.Stage = int(n.Stage)
			s.changed()
		}
		if photo != "" {
			if old := s.photoByID(e.Photo); old == nil || stars > old.Stars {
				e.Photo = photo
				s.changed()
			}
		}
		return
	}
	env := s.clock.Env()
	e = &proto.NestEntry{
		ID: key, Site: n.Site, Stage: int(n.Stage), Day: env.Day,
		Region: int(s.world.RegionAt(n.Pos.X, n.Pos.Z)), Pos: n.Pos, Photo: photo,
	}
	if sp != nil {
		e.Species = sp.ID
	}
	s.p.Journal.Nests = append(s.p.Journal.Nests, e)
	s.changed()

	xp := 0
	if sp != nil {
		xp = s.award(progress.SrcBehavior, progress.BehaviorKey(sp.ID, "nest"), progress.BehaviorXP(s.p))
		s.deedRep(content.FactionRangers, "nest", sp.ID, repNest, "a nest on the survey")
	}
	text := siteWords[n.Site]
	if text == "" {
		text = "A nest"
	}
	if known := s.knownSp(sp); known != nil {
		text += ": " + withArticleLower(known.Name) + "'s"
	}
	text += " (" + field.NestStageKey(n.Stage) + ")"
	if l := s.lensNest(sp, n); l != "" {
		text += ". " + l
	}
	s.toast("behavior", "Nest found", text, xp, "nest")
	if sp != nil && n.Stage != core.NestOld {
		// An active nest is nesting behaviour seen (quests that ask for it).
		s.questEvent(content.Observed(sp.ID, core.ActNesting.Key(), s.at(n.Pos)))
	}
	s.narrate(narrator.Event{Kind: narrator.NestFound, Item: n.Site, Stage: field.NestStageKey(n.Stage), Subject: key, Known: s.knownSp(sp)})
}

// photoNests records the nests a photograph shows and pays the first nest photo
// of each species (the photo XP again, improvable like a bird photo).
func (s *Session) photoNests(sc field.PhotoScore, nests []core.Nest, photoID string, stars int) int {
	xp := 0
	for i, pn := range sc.Nests {
		n := core.Nest{ID: pn.ID, Species: pn.Species, Site: pn.Site, Stage: pn.Stage}
		for _, full := range nests {
			if full.ID == pn.ID {
				n = full
				break
			}
		}
		s.foundNest(n, photoID, stars)
		if i == 0 && stars > 0 {
			if sp := s.spAt(pn.Species); sp != nil {
				xp += s.award(progress.SrcPhoto, "nest/"+sp.ID, progress.PhotoXP(stars))
			}
		}
	}
	return xp
}

// nestOfPhoto returns the nest entry a photo is the best photo of ("" if none).
func (s *Session) nestOfPhoto(photoID string) string {
	for _, e := range s.p.Journal.Nests {
		if e != nil && e.Photo == photoID {
			return e.ID
		}
	}
	return ""
}
