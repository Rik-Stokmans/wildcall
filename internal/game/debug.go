package game

import (
	"math"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// msgDebug runs a developer command (only with -dev).
func (s *Session) msgDebug(d []byte) {
	if !s.cfg.Dev {
		s.fail("Debug commands are disabled.")
		return
	}
	var m proto.DebugMsg
	if err := decode(d, &m); err != nil {
		s.fail("Bad debug command.")
		return
	}
	msg, err := s.Debug(m.Cmd, m.Args...)
	if err != nil {
		s.failErr(err)
		return
	}
	s.toast("info", "debug "+m.Cmd, msg, 0, "info")
}

func argInt(args []string, i, def int) int {
	if i < len(args) {
		if n, err := strconv.Atoi(args[i]); err == nil {
			return n
		}
	}
	return def
}

func argF(args []string, i int) (float32, bool) {
	if i < len(args) {
		if f, err := strconv.ParseFloat(args[i], 32); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return float32(f), true
		}
	}
	return 0, false
}

// Debug runs one debug command and returns a short report.
func (s *Session) Debug(cmd string, args ...string) (string, error) {
	switch cmd {
	case "xp":
		n := argInt(args, 0, 500)
		progress.GrantXP(s.p, n)
		s.changed()
		return "+" + itoa(n) + " XP", nil
	case "credits":
		n := argInt(args, 0, 500)
		s.p.Credits += n
		if s.p.Credits < 0 {
			s.p.Credits = 0
		}
		s.changed()
		return "credits " + itoa(s.p.Credits), nil
	case "time":
		h, ok := argF(args, 0)
		if !ok || h < 0 || h >= 24 {
			return "", gentleErr("usage: time <hour> [day]")
		}
		s.clock.Set(h, argInt(args, 1, s.clock.Env().Day))
		s.send(proto.SEnv, s.envMsg())
		return "time set", nil
	case "weather":
		w := -1
		names := []string{"sunny", "cloudy", "rain", "wind"}
		if len(args) > 0 {
			for i, n := range names {
				if strings.EqualFold(args[0], n) {
					w = i
				}
			}
			if w < 0 {
				w = argInt(args, 0, -1)
			}
		}
		if w < 0 || w >= int(core.WeatherCount) {
			return "", gentleErr("usage: weather sunny|cloudy|rain|wind")
		}
		s.clock.SetWeather(core.Weather(w))
		s.send(proto.SEnv, s.envMsg())
		return core.Weather(w).String(), nil
	case "season":
		w := -1
		if len(args) > 0 {
			for i, n := range []string{"spring", "summer", "autumn", "winter"} {
				if strings.EqualFold(args[0], n) {
					w = i
				}
			}
			if w < 0 {
				w = argInt(args, 0, -1)
			}
		}
		if w < 0 || w > 3 {
			return "", gentleErr("usage: season spring|summer|autumn|winter")
		}
		s.clock.SetSeason(core.Season(w))
		s.send(proto.SEnv, s.envMsg())
		return core.Season(w).String(), nil
	case "tp":
		return s.debugTeleport(args)
	case "unlock":
		if len(args) == 0 || args[0] == "all" {
			for r := core.RegionID(0); r < core.RegionCount; r++ {
				progress.UnlockRegionID(s.p, r)
			}
		} else if r, ok := core.RegionFromKey(args[0]); ok {
			progress.UnlockRegionID(s.p, r)
		} else {
			return "", gentleErr("usage: unlock <region key>|all")
		}
		s.changed()
		return "regions unlocked", nil
	case "seed":
		return s.seedText + " (" + strconv.FormatInt(s.seed, 10) + ")", nil
	case "give":
		if len(args) == 0 {
			return "", gentleErr("usage: give <item> [qty]")
		}
		if _, ok := progress.Item(args[0]); !ok {
			return "", gentleErr("no such item")
		}
		if _, err := progress.AddItem(s.p, args[0], argInt(args, 1, 1)); err != nil {
			return "", err
		}
		s.changed()
		return "given " + args[0], nil
	case "identify":
		if len(args) == 0 {
			return "", gentleErr("usage: identify <species id>")
		}
		sp := s.spByID(args[0])
		if sp == nil {
			return "", gentleErr("no such species")
		}
		if s.identified(sp.ID) {
			return "already identified", nil
		}
		m := s.ensureMystery(sp, proto.LevelEncountered, s.feet)
		for _, k := range []string{"size", "shape", "primary", "secondary", "marking"} {
			m.Evidence[k] = sp.TraitValue(k)
		}
		res, err := s.identify(m.ID, sp.ID)
		if err != nil {
			return "", err
		}
		s.send(proto.SIdentify, res)
		return "identified " + sp.ID, nil
	case "skillpoints":
		s.p.SkillPoints += argInt(args, 0, 5)
		s.changed()
		return "skill points " + itoa(s.p.SkillPoints), nil
	case "rank":
		r := argInt(args, 0, s.p.Rank+1)
		if r < 1 || r > progress.MaxRank {
			return "", gentleErr("usage: rank 1..5")
		}
		s.p.Rank = r
		for _, id := range content.UnlockedRegions(r) {
			progress.UnlockRegionID(s.p, core.RegionID(id))
		}
		progress.Recompute(s.p)
		s.tracker.Sync(s.p)
		s.changed()
		return "rank " + itoa(r), nil
	case "spawn":
		if len(args) == 0 {
			return "", gentleErr("usage: spawn <species id>")
		}
		sp := s.spByID(args[0])
		if sp == nil {
			return "", gentleErr("no such species")
		}
		id, _ := s.SpawnAhead(sp.Index, 15)
		if id == 0 {
			return "", gentleErr("it would not settle there")
		}
		return "spawned bird " + strconv.FormatUint(uint64(id), 10), nil
	case "rep":
		if len(args) == 0 {
			return "", gentleErr("usage: rep <faction> [n]")
		}
		v := progress.AddRep(s.p, args[0], argInt(args, 1, 25))
		s.changed()
		return args[0] + " " + itoa(v), nil
	case "forage":
		return s.debugForage(args)
	case "nest":
		return s.debugNest(args)
	case "nests":
		return s.debugNests()
	case "buff":
		if len(args) == 0 || !edible(args[0]) {
			return "", gentleErr("usage: buff <food or edible ingredient id>")
		}
		if _, err := progress.AddItem(s.p, args[0], 1); err != nil {
			return "", err
		}
		if err := s.eat(args[0]); err != nil {
			return "", err
		}
		return "buff " + args[0], nil
	case "clearbuffs":
		s.p.Buffs = []proto.Buff{}
		progress.Recompute(s.p)
		s.changed()
		return "buffs cleared", nil
	case "learn":
		if len(args) == 0 || args[0] == "all" {
			n := 0
			for _, r := range content.Recipes() {
				if s.learnRecipe(r.ID) {
					n++
				}
			}
			return "learned " + itoa(n) + " recipes", nil
		}
		if _, ok := content.Recipe(args[0]); !ok {
			return "", gentleErr("usage: learn <recipe id>|all")
		}
		s.learnRecipe(args[0])
		return "learned " + args[0], nil
	case "regrow":
		s.p.Forage = map[string]int{}
		s.changed()
		return "every plant bears again", nil
	case "pantry":
		// A little of every ingredient, for testing the kitchen.
		for _, id := range progress.PantryIngredients() {
			_, _ = progress.AddItem(s.p, id, 3)
		}
		for _, id := range progress.ForagedIngredients() {
			_, _ = progress.AddItem(s.p, id, 3)
		}
		s.changed()
		return "pantry stocked (overflow went to storage)", nil
	}
	return "", gentleErr("unknown debug command")
}

// debugForage teleports next to the nearest forage plant of a plant id (or of any
// plant) and reports whether it can be picked now.
func (s *Session) debugForage(args []string) (string, error) {
	want := ""
	if len(args) > 0 && args[0] != "any" {
		pl, ok := content.Plant(args[0])
		if !ok {
			return "", gentleErr("usage: forage <plant id>|any")
		}
		want = pl.ID
	}
	for _, r := range []float32{60, 200, 500} {
		var best world.ForagePlant
		bestD := float32(math.MaxFloat32)
		for _, fp := range s.world.ForageNear(s.feet.X, s.feet.Z, r) {
			pl, ok := content.PlantByVeg(int(fp.Veg.Kind))
			if !ok || (want != "" && pl.ID != want) {
				continue
			}
			if d := fp.Veg.Pos.DistXZ(s.feet); d < bestD {
				best, bestD = fp, d
			}
		}
		if best.ID == "" {
			continue
		}
		pl, _ := content.PlantByVeg(int(best.Veg.Kind))
		// Stand 1.5 m from the plant, on dry ground, facing it.
		to := best.Veg.Pos
		for a := 0; a < 8; a++ {
			p := best.Veg.Pos.Add(core.HeadingDir(float32(a) * math.Pi / 4).Scale(1.5))
			p.Y = s.world.HeightAt(p.X, p.Z)
			if p.Y > 0 {
				to = p
				break
			}
		}
		s.Teleport(to, core.HeadingTo(to, best.Veg.Pos))
		env := s.clock.Env()
		state := "in season"
		if len(content.YieldsIn(pl.ID, int(env.Season))) == 0 {
			state = "nothing to pick in " + env.Season.String()
		} else if !progress.ForageReady(s.p, best.ID, env.Day, pl.Regrow) {
			state = "already picked"
		}
		return pl.ID + " " + best.ID + ": " + state, nil
	}
	return "", gentleErr("no such plant within 500 m")
}

// debugNest teleports near the nearest nest (optionally of a site type or stage)
// and reports its id, site and stage. It never names the owner.
func (s *Session) debugNest(args []string) (string, error) {
	var best core.Nest
	bestD := float32(math.MaxFloat32)
	for _, n := range s.sim.Nests(s.feet, 600, nil) {
		if len(args) > 0 && args[0] != n.Site && args[0] != field.NestStageKey(n.Stage) {
			continue
		}
		if d := n.Pos.DistXZ(s.feet); d < bestD {
			best, bestD = n, d
		}
	}
	if best.ID == 0 {
		return "", gentleErr("no nest within 600 m (nests are in the breeding season, old ones until spring)")
	}
	// Stand on dry ground about 7 m away (outside most alarm radii is further; this
	// is for looking), facing the nest.
	to := best.Pos
	for _, r := range []float32{7, 10, 4, 14} {
		found := false
		for a := 0; a < 12; a++ {
			p := best.Pos.Add(core.HeadingDir(float32(a) * math.Pi / 6).Scale(r))
			p.Y = s.world.HeightAt(p.X, p.Z)
			if p.Y > 0.1 {
				to, found = p, true
				break
			}
		}
		if found {
			break
		}
	}
	to.Y = max(to.Y, 0)
	s.Teleport(to, core.HeadingTo(to, best.Pos))
	h := best.Pos.Y - s.world.HeightAt(best.Pos.X, best.Pos.Z)
	return nestKey(best.ID) + " " + best.Site + " " + field.NestStageKey(best.Stage) +
		" at " + strconv.FormatFloat(float64(h), 'f', 1, 32) + " m", nil
}

// debugNests counts the nests around the player by stage and site.
func (s *Session) debugNests() (string, error) {
	ns := s.sim.Nests(s.feet, nestStreamR, nil)
	stages := map[string]int{}
	for _, n := range ns {
		stages[field.NestStageKey(n.Stage)]++
	}
	return itoa(len(ns)) + " nests within " + itoa(nestStreamR) + " m: " + mustJSON(stages), nil
}

// SpawnAhead puts a bird of a species about dist metres in front of the player.
func (s *Session) SpawnAhead(spIndex int, dist float32) (uint32, core.Vec3) {
	pos := s.feet.Add(core.HeadingDir(s.pose.Yaw).Scale(dist))
	pos.Y = s.world.HeightAt(pos.X, pos.Z)
	return s.sim.SpawnNear(spIndex, pos), pos
}

func (s *Session) debugTeleport(args []string) (string, error) {
	var to core.Vec3
	yaw := s.pose.Yaw
	switch {
	case len(args) >= 2:
		x, ok1 := argF(args, 0)
		z, ok2 := argF(args, 1)
		if !ok1 || !ok2 {
			return "", gentleErr("usage: tp <x> <z> | <poi id> | <region key>")
		}
		to = core.V(x, 0, z)
	case len(args) == 1:
		if poi, ok := s.world.POI(args[0]); ok {
			to = poi.Pos.Add(core.HeadingDir(poi.Yaw).Scale(poi.Radius * 0.5))
		} else if r, ok := core.RegionFromKey(args[0]); ok {
			p, found := s.findRegion(r)
			if !found {
				return "", gentleErr("no land of that region type nearby")
			}
			to = p
		} else {
			return "", gentleErr("no such place")
		}
	default:
		return "", gentleErr("usage: tp <x> <z> | <poi id> | <region key>")
	}
	to.Y = s.world.HeightAt(to.X, to.Z)
	if to.Y < 0 {
		to.Y = 0
	}
	s.Teleport(to, yaw)
	return "teleported", nil
}

// Teleport moves the player (feet position) and tells the client.
func (s *Session) Teleport(feet core.Vec3, yaw float32) {
	s.send(proto.STeleport, proto.Teleport{Pos: feet, Yaw: yaw})
	p := s.pose
	p.X, p.Y, p.Z, p.Yaw, p.Speed = feet.X, feet.Y+core.EyeHeight, feet.Z, yaw, 0
	s.havePose = false // no distance for the jump
	s.applyPose(p)
	s.watch.Reset()
	s.nestWatch.Reset()
	s.board.Reset()
}

// findRegion looks for the nearest dry land of a region type, spiralling out.
func (s *Session) findRegion(r core.RegionID) (core.Vec3, bool) {
	c := s.feet
	for ring := 1; ring <= 100; ring++ {
		rad := float32(ring) * 64
		n := 8 * ring
		for i := 0; i < n; i++ {
			a := float64(i) / float64(n) * 2 * math.Pi
			x := c.X + rad*float32(math.Sin(a))
			z := c.Z - rad*float32(math.Cos(a))
			if s.world.RegionAt(x, z) == r && s.world.HeightAt(x, z) > 0.5 {
				return core.V(x, 0, z), true
			}
		}
	}
	return core.Vec3{}, false
}
