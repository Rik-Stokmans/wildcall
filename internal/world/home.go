package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// The home valley (contract §2.1, §2.2). For every seed the same set of places is
// laid out around the creek by a deterministic site search: each place has a
// template position in valley coordinates (along the creek, distance from it), a
// handful of seeded candidate spots around the template are scored against the
// climate terrain, and the best one wins. The terrain is then shaped around the
// chosen sites (meadow, fern hollow, watchtower rise, lookout outcrop, creek ford)
// and the places get their pads, trails and the pond as overlays.

const (
	homeMaxDist    = core.HomeRadius - 40 // every home place stays this close to the origin
	hiddenTrailGap = 70.0                 // hidden places keep at least this far from the main trail
)

// homeLayout is the finished home valley. Immutable once built.
type homeLayout struct {
	pois   []core.POI
	trails []core.Trail
	ov     overlays

	meadow, fern, rise, lookout, pines, oakClear circle
	meadowH                                      float64
	fordAX, fordAZ, fordBX, fordBZ               float64 // creek crossing, bank to bank

	oakX, oakZ float64
	stones     [][2]float64 // stepping stones across the creek
	special    []core.Veg   // the Old Oak and the stepping stones (set by World.finishHome)
	spawn      core.Vec3
	spawnYaw   float32
	structs    []structure
}

// shape applies the home valley's terrain dressing to a climate sample.
func (hl *homeLayout) shape(x, z float64, s *sample) {
	// Meadow clearing: soften the hills into a broad open bowl.
	if d := hl.meadow.dist(x, z); d < hl.meadow.r+14 {
		w := 1 - smoothstep(hl.meadow.r*0.7, hl.meadow.r+14, d)
		s.h = lerp(s.h, hl.meadowH+0.35*(s.h-hl.meadowH), w)
		s.hMeadow = math.Max(s.hMeadow, smoothstep(hl.meadow.r+4, hl.meadow.r*0.8, d))
	}
	// Fern Valley: a damp hollow scooped out of the slope, floor kept dry.
	if d := hl.fern.dist(x, z); d < hl.fern.r+16 {
		bowl := 1 - smoothstep(0, hl.fern.r+16, d)
		s.h = math.Max(s.h-3.4*bowl, math.Min(s.h, 1.15))
		s.hFern = math.Max(s.hFern, smoothstep(hl.fern.r+8, hl.fern.r*0.5, d))
	}
	// The wooded rise under the Old Watchtower.
	if d := hl.rise.dist(x, z); d < hl.rise.r {
		k := smoothstep(hl.rise.r, 0, d)
		s.h += 6.5 * k
	}
	// Lookout Rock: a rocky knoll.
	if d := hl.lookout.dist(x, z); d < hl.lookout.r {
		k := smoothstep(hl.lookout.r, hl.lookout.r*0.2, d)
		s.h += 5 * k
		s.rock = math.Max(s.rock, smoothstep(0.25, 0.75, k))
	}
	// The stand of pines around the Old Survey Camp.
	if d := hl.pines.dist(x, z); d < hl.pines.r {
		s.hPine = math.Max(s.hPine, smoothstep(hl.pines.r, hl.pines.r*0.55, d))
	}
	// The Old Oak's little clearing.
	if d := hl.oakClear.dist(x, z); d < hl.oakClear.r+6 {
		s.clear = math.Max(s.clear, 0.65*smoothstep(hl.oakClear.r+6, hl.oakClear.r*0.6, d))
	}
	// Stepping-stone ford: a shallow gravel bar where the main trail crosses.
	if d, _ := distSeg(x, z, hl.fordAX, hl.fordAZ, hl.fordBX, hl.fordBZ); d < 4 && s.h < 0 {
		s.h = lerp(s.h, -0.12, 1-smoothstep(1.8, 4, d))
	}
}

// homeBuilder carries the state of the site search.
type homeBuilder struct {
	g     *gen
	c     *creek
	rng   noise.RNG
	dir   float64 // +1 or -1: which way along the creek the main trail runs
	b0    float64 // the origin's distance from the creek
	hl    *homeLayout
	taken []circle // places already sited (keep-out discs)
}

// site describes one placed home location.
type site struct {
	x, z, a, b, h float64
}

// candidate scoring: lower is better; returns +Inf for invalid spots.
type scoreFn func(x, z, a, b, h, slope float64) float64

func (hb *homeBuilder) find(a0, b0, jitter float64, n int, score scoreFn) site {
	best, bestS := site{}, math.Inf(1)
	for i := 0; i < n; i++ {
		a, b := a0, b0
		if i > 0 {
			ang := hb.rng.Range(0, 2*math.Pi)
			r := jitter * math.Sqrt(hb.rng.Float64())
			a += r * math.Cos(ang)
			b += r * math.Sin(ang)
		}
		x, z := hb.c.at(a, b)
		if hypot(x, z) > homeMaxDist {
			continue
		}
		h, slope := hb.g.heightSlope(x, z)
		sc := score(x, z, a, b, h, slope)
		for _, t := range hb.taken {
			if t.dist(x, z) < t.r {
				sc = math.Inf(1)
			}
		}
		if sc < bestS {
			best, bestS = site{x, z, a, b, h}, sc
		}
	}
	if math.IsInf(bestS, 1) {
		// Fall back to the template itself (the home terrain is gentle by design).
		x, z := hb.c.at(a0, b0)
		h, _ := hb.g.heightSlope(x, z)
		best = site{x, z, a0, b0, h}
	}
	return best
}

func (hb *homeBuilder) take(s site, r float64) { hb.taken = append(hb.taken, circle{s.x, s.z, r}) }

// flatScore prefers level, dry ground close to the template.
func flatScore(a0, b0 float64, bMin, bMax float64) scoreFn {
	return func(x, z, a, b, h, slope float64) float64 {
		if b < bMin || b > bMax || h < 1.0 {
			return math.Inf(1)
		}
		return slope*60 + hypot(a-a0, b-b0)*0.08
	}
}

// heightSlope samples the climate terrain (plus home shaping once attached) and
// its slope (rise over run) by central differences.
func (g *gen) heightSlope(x, z float64) (h, slope float64) {
	const e = 2.0
	h = g.height(x, z)
	dx := g.height(x+e, z) - g.height(x-e, z)
	dz := g.height(x, z+e) - g.height(x, z-e)
	return h, hypot(dx, dz) / (2 * e)
}

func newHomeLayout(g *gen) *homeLayout {
	hb := &homeBuilder{g: g, c: &g.creek, rng: noise.NewRNG(noise.Hash2(uint64(g.seed), 4242, 17)), hl: &homeLayout{}}
	hb.dir = 1
	if hb.rng.Chance(0.5) {
		hb.dir = -1
	}
	_, hb.b0 = g.creek.local(0, 0)
	s := hb.dir
	hl := hb.hl

	// --- the places along the main trail ------------------------------------
	cabin := hb.find(0, hb.b0, 30, 24, func(x, z, a, b, h, slope float64) float64 {
		if hypot(x, z) > 50 || b < 60 || h < 1.2 {
			return math.Inf(1)
		}
		return slope*80 + hypot(x, z)*0.05
	})
	hb.take(cabin, 30)
	we := hb.find(cabin.a+s*100, cabin.b-20, 16, 16, func(x, z, a, b, h, slope float64) float64 {
		d := hypot(x-cabin.x, z-cabin.z)
		if b < 42 || h < 1.0 || d < 100 || d > 140 {
			return math.Inf(1)
		}
		return slope*60 + math.Abs(d-120)*0.1
	})
	hb.take(we, 22)
	oak := hb.find(we.a+s*85, 50, 16, 16, flatScore(we.a+s*85, 50, 34, 90))
	hb.take(oak, 24)
	crossA := oak.a + s*62
	creekside := hb.find(crossA, 11, 0, 1, func(x, z, a, b, h, slope float64) float64 { return 0 })
	research := hb.find(crossA-s*30, 19, 6, 10, flatScore(crossA-s*30, 19, 15, 30))
	hb.take(research, 10)
	hide := hb.find(crossA+s*50, -16, 8, 10, flatScore(crossA+s*50, -16, -24, -13))
	hb.take(hide, 12)
	ranger := hb.find(crossA+s*55, -88, 20, 20, flatScore(crossA+s*55, -88, -130, -60))
	hb.take(ranger, 30)
	fern := hb.find(crossA+s*78, 44, 14, 12, func(x, z, a, b, h, slope float64) float64 {
		if b < 32 || b > 70 {
			return math.Inf(1)
		}
		return h*0.4 + slope*20 + hypot(a-(crossA+s*78), b-44)*0.05 // low ground: a natural hollow
	})
	hb.take(fern, 45)
	meadow := hb.find(cabin.a+s*150, cabin.b+75, 22, 16, flatScore(cabin.a+s*150, cabin.b+75, 80, 400))
	hb.take(meadow, 70)
	tower := hb.find(cabin.a-s*120, cabin.b+25, 26, 18, func(x, z, a, b, h, slope float64) float64 {
		if b < 50 || h < 1.2 {
			return math.Inf(1)
		}
		return -h + slope*25 + hypot(a-(cabin.a-s*120), b-(cabin.b+25))*0.03 // high ground
	})
	hb.take(tower, 40)

	hl.meadow = circle{meadow.x, meadow.z, 60}
	hl.meadowH = meadow.h
	hl.fern = circle{fern.x, fern.z, 34}
	hl.rise = circle{tower.x, tower.z, 48}
	hl.oakClear = circle{oak.x, oak.z, 14}
	hl.oakX, hl.oakZ = oak.x, oak.z

	// Ford across the creek on the main trail.
	hl.fordAX, hl.fordAZ = hb.c.at(crossA, 7)
	hl.fordBX, hl.fordBZ = hb.c.at(crossA, -7)

	// Headings.
	cabinYaw := heading(we.x-cabin.x, we.z-cabin.z)
	fx, fz := headingDir(cabinYaw)
	px, pz := -fz, fx // to the right of the facing direction
	doorX, doorZ := cabin.x+fx*4, cabin.z+fz*4

	// --- the main trail (needed before the hidden places are sited) -----------
	// Control points in valley coordinates; the spline runs in (a, b) and is then
	// mapped to the world so it follows the creek's meanders.
	weA, weB := we.a, we.b
	oakPA, oakPB := oak.a, oak.b-9 // pass just creek-side of the Old Oak
	da, db := hb.c.local(doorX, doorZ)
	rfx, rfz := headingDir(heading(creekside.x-ranger.x, creekside.z-ranger.z))
	rfa, rfb := hb.c.local(ranger.x+rfx*7, ranger.z+rfz*7)
	mainCtl := [][2]float64{
		{da, db},
		{lerp(da, weA, 0.5), lerp(db, weB, 0.5) + 4},
		{weA, weB},
		{lerp(weA, oakPA, 0.5), lerp(weB, oakPB, 0.5) + 5},
		{oakPA, oakPB},
		{lerp(oakPA, crossA, 0.55), 26},
		{crossA, 11},
		{crossA, 6},
		{crossA, -6},
		{crossA + s*6, -20},
		{lerp(crossA+s*6, rfa, 0.5), lerp(-20, rfb, 0.5)},
		{rfa, rfb},
	}
	mainPts := hb.splineValley(mainCtl, 2.5)
	// The spur to the meadow clearing branches off between the entrance and the oak.
	bi := nearestIndex(mainPts, meadow.x, meadow.z)
	spurCtl := [][2]float64{}
	{
		sa, sb := hb.c.local(mainPts[bi][0], mainPts[bi][1])
		spurCtl = append(spurCtl, [2]float64{sa, sb}, [2]float64{lerp(sa, meadow.a, 0.5) + s*6, lerp(sb, meadow.b, 0.5)}, [2]float64{meadow.a, meadow.b})
	}
	spurPts := hb.splineValley(spurCtl, 2.0)
	mainSegs := segsOf(mainPts, false)
	mainSegs = append(mainSegs, segsOf(spurPts, false)...)
	trailDist := func(x, z float64) float64 {
		best := math.Inf(1)
		for i := range mainSegs {
			sg := &mainSegs[i]
			if d, _ := distSeg(x, z, sg.ax, sg.az, sg.bx, sg.bz); d < best {
				best = d
			}
		}
		return best
	}
	hiddenScore := func(a0, b0 float64, bMin, bMax float64, extra func(h float64) float64) scoreFn {
		return func(x, z, a, b, h, slope float64) float64 {
			if b < bMin || b > bMax || h < 1.2 || trailDist(x, z) < hiddenTrailGap {
				return math.Inf(1)
			}
			return slope*40 + hypot(a-a0, b-b0)*0.05 + extra(h)
		}
	}
	none := func(float64) float64 { return 0 }

	// --- hidden places --------------------------------------------------------
	pondS := hb.find(s*120, -110, 30, 24, hiddenScore(s*120, -110, -170, -45, func(h float64) float64 { return h * 0.3 }))
	hb.take(pondS, 50)
	lookS := hb.find(cabin.a-s*40, cabin.b+140, 36, 24, hiddenScore(cabin.a-s*40, cabin.b+140, 120, 400, func(h float64) float64 { return -h * 1.5 }))
	hb.take(lookS, 50)
	hcab := hb.find(-s*140, -150, 34, 24, hiddenScore(-s*140, -150, -260, -70, none))
	hb.take(hcab, 50)
	camp := hb.find(cabin.a+s*40, cabin.b+170, 34, 24, hiddenScore(cabin.a+s*40, cabin.b+170, 130, 420, none))
	hb.take(camp, 40)

	hl.lookout = circle{lookS.x, lookS.z, 20}
	hl.pines = circle{camp.x, camp.z, 55}

	// Attach the shaping now so structure pads sit on the shaped ground.
	g.hl = hl
	ground := func(x, z float64) float64 { return g.height(x, z) }
	padY := func(x, z float64) float64 { return math.Max(ground(x, z), 1.0) }

	addPad := func(x, z, r, blend float64) float64 {
		y := padY(x, z)
		hl.ov.pads = append(hl.ov.pads, pad{x, z, r, blend, y})
		return y
	}
	cabinY := addPad(cabin.x, cabin.z, 9, 10)
	weY := addPad(we.x, we.z, 4, 6)
	shopX, shopZ := we.x+px*8, we.z+pz*8
	// Keep the stall on the side away from the creek.
	if _, sb := hb.c.local(shopX, shopZ); sb < we.b {
		shopX, shopZ = we.x-px*8, we.z-pz*8
	}
	shopY := addPad(shopX, shopZ, 4, 5)
	csY := addPad(creekside.x, creekside.z, 3, 4)
	resY := addPad(research.x, research.z, 6, 6)
	hideY := addPad(hide.x, hide.z, 3.5, 4)
	rangerY := addPad(ranger.x, ranger.z, 9, 9)
	towerY := addPad(tower.x, tower.z, 5, 5)
	hcabY := addPad(hcab.x, hcab.z, 6, 6)
	campY := addPad(camp.x, camp.z, 5, 5)
	hl.ov.ponds = append(hl.ov.ponds, pond{x: pondS.x, z: pondS.z, rWater: 10, rRim: 25, depth: 1.15})

	// Trails get their heights from the shaped ground.
	mainTrail := core.Trail{ID: "main", Name: "Greenhollow Trail", Points: hb.points(mainPts)}
	spurTrail := core.Trail{ID: "meadow_spur", Name: "Meadow Spur", Points: hb.points(spurPts)}

	// Hidden trails branch off the main trail (or chain from another hidden place).
	sideOK := func(sign float64) func(p [2]float64) bool {
		return func(p [2]float64) bool {
			_, b := hb.c.local(p[0], p[1])
			return b*sign > 25
		}
	}
	branchFrom := func(pts [][2]float64, tx, tz float64, ok func([2]float64) bool) [2]float64 {
		best, bd := pts[0], math.Inf(1)
		for _, p := range pts {
			if !ok(p) {
				continue
			}
			if d := hypot(p[0]-tx, p[1]-tz); d < bd {
				best, bd = p, d
			}
		}
		return best
	}
	hiddenTrail := func(id, name string, from [2]float64, tx, tz, stopShort float64) core.Trail {
		fa, fb := hb.c.local(from[0], from[1])
		ta, tb := hb.c.local(tx, tz)
		l := hypot(ta-fa, tb-fb)
		k := 1 - stopShort/math.Max(l, 1)
		ta, tb = lerp(fa, ta, k), lerp(fb, tb, k)
		w := hb.rng.Range(-1, 1) * 0.18 * l
		ctl := [][2]float64{{fa, fb}, {lerp(fa, ta, 0.33) + w*0.5, lerp(fb, tb, 0.33) - w*0.3}, {lerp(fa, ta, 0.66) - w*0.4, lerp(fb, tb, 0.66) + w*0.4}, {ta, tb}}
		return core.Trail{ID: id, Name: name, Hidden: true, Points: hb.points(hb.splineValley(ctl, 1.5))}
	}
	pondEntry := branchFrom(mainPts, pondS.x, pondS.z, sideOK(-1))
	tPond := hiddenTrail("secret_pond", "Reed-hidden Path", pondEntry, pondS.x, pondS.z, 13)
	pondRim := tPond.Points[len(tPond.Points)-1]
	tCabin := hiddenTrail("secret_cabin", "Trapper's Path", [2]float64{float64(pondRim.X), float64(pondRim.Z)}, hcab.x, hcab.z, 6)
	tLook := hiddenTrail("secret_lookout", "Lookout Scramble", branchFrom(mainPts, lookS.x, lookS.z, sideOK(1)), lookS.x, lookS.z, 4)
	tCamp := hiddenTrail("secret_camp", "Old Survey Path", [2]float64{meadow.x, meadow.z}, camp.x, camp.z, 5)

	hl.trails = []core.Trail{mainTrail, spurTrail, tPond, tCabin, tLook, tCamp}
	for _, t := range hl.trails {
		hl.ov.segs = append(hl.ov.segs, segsOfTrail(t.Points, t.Hidden)...)
	}

	// Stepping stones across the ford.
	for i := 0; i < 4; i++ {
		b := -4.5 + 3*float64(i)
		x, z := hb.c.at(crossA+hb.rng.Range(-0.4, 0.4), b)
		hl.stones = append(hl.stones, [2]float64{x, z})
	}

	// --- POIs ------------------------------------------------------------------
	yawTo := func(fx, fz, tx, tz float64) float32 { return float32(heading(tx-fx, tz-fz)) }
	gr := core.RegionGreenhollow
	add := func(id, kind, name string, x, y, z float64, yaw float32, hidden bool, data map[string]string) {
		hl.pois = append(hl.pois, core.POI{ID: id, Kind: kind, Name: name, Pos: vec(x, y, z), Yaw: yaw,
			Region: gr, Radius: poiRadius(kind), Hidden: hidden, Data: data})
		if h, r := structureHeight(kind); h > 0 {
			hl.structs = append(hl.structs, structure{x: x, z: z, y: y, height: h, r: r})
		}
	}
	add("cabin", "cabin", "Naturalist Cabin", cabin.x, cabinY, cabin.z, float32(cabinYaw), false, nil)
	mx, mz := cabin.x+fx*4.6+px*3.4, cabin.z+fz*4.6+pz*3.4
	add("npc_mara", "npc", "Mara", mx, cabinY, mz, yawTo(mx, mz, doorX+fx*6, doorZ+fz*6), false, map[string]string{"npc": "mara"})
	weYaw := yawTo(we.x, we.z, oak.x, oak.z)
	add("woodland_entrance", "landmark", "Woodland Entrance", we.x, weY, we.z, weYaw, false, nil)
	add("shop_finn", "shop", "Finn's Field Supply", shopX, shopY, shopZ, yawTo(shopX, shopZ, we.x, we.z), false, nil)
	nfx, nfz := lerp(shopX, we.x, 0.3), lerp(shopZ, we.z, 0.3)
	add("npc_finn", "npc", "Finn", nfx, shopY, nfz, yawTo(nfx, nfz, we.x, we.z), false, map[string]string{"npc": "finn"})
	add("old_oak", "landmark", "The Old Oak", oak.x, 0, oak.z, 0, false, nil)
	add("creekside", "landmark", "Creekside", creekside.x, csY, creekside.z, yawTo(creekside.x, creekside.z, hl.fordBX, hl.fordBZ), false, nil)
	cx, cz := hb.c.at(research.a, 0)
	add("research_creekside", "research_site", "Creekside Field Lab", research.x, resY, research.z, yawTo(research.x, research.z, cx, cz), false, nil)
	ax, az := lerp(research.x, creekside.x, 3.5/math.Max(hypot(research.x-creekside.x, research.z-creekside.z), 1)), lerp(research.z, creekside.z, 3.5/math.Max(hypot(research.x-creekside.x, research.z-creekside.z), 1))
	add("npc_alder", "npc", "Professor Alder", ax, resY, az, yawTo(ax, az, creekside.x, creekside.z), false, map[string]string{"npc": "alder"})
	add("fern_valley", "landmark", "Fern Valley", fern.x, 0, fern.z, 0, false, nil)
	add("meadow_clearing", "landmark", "Meadow Clearing", meadow.x, 0, meadow.z, 0, false, nil)
	add("ranger_station", "ranger_station", "Greenhollow Ranger Station", ranger.x, rangerY, ranger.z, yawTo(ranger.x, ranger.z, creekside.x, creekside.z), false, nil)
	jx, jz := ranger.x+rfx*5, ranger.z+rfz*5
	add("npc_june", "npc", "June", jx, rangerY, jz, yawTo(jx, jz, creekside.x, creekside.z), false, map[string]string{"npc": "june"})
	add("old_watchtower", "watchtower", "Old Watchtower", tower.x, towerY, tower.z, yawTo(tower.x, tower.z, cabin.x, cabin.z), false, nil)
	add("hidden_pond", "pond", "Hidden Pond", pondS.x, -1.15, pondS.z, 0, true, nil)
	hcx, hcz := hb.c.at(hide.a, 0)
	add("hide_creek", "hide", "Creek Hide", hide.x, hideY, hide.z, yawTo(hide.x, hide.z, hcx, hcz), false, nil)
	add("viewpoint_lookout", "viewpoint", "Lookout Rock", lookS.x, 0, lookS.z, yawTo(lookS.x, lookS.z, cabin.x, cabin.z)+math.Pi, true, nil)
	add("hidden_cabin", "hidden_cabin", "Trapper's Cabin", hcab.x, hcabY, hcab.z, yawTo(hcab.x, hcab.z, pondS.x, pondS.z), true, nil)
	add("camp_survey", "camp", "Old Survey Camp", camp.x, campY, camp.z, yawTo(camp.x, camp.z, meadow.x, meadow.z), true, nil)
	tfx, tfz := headingDir(float64(yawTo(tower.x, tower.z, cabin.x, cabin.z)))
	add("cache_watchtower", "cache", "Weathered Satchel", tower.x+tfz*2.6, towerY, tower.z-tfx*2.6, 0, false, map[string]string{"item": "forgotten_journal"})
	hfx, hfz := headingDir(float64(yawTo(hcab.x, hcab.z, pondS.x, pondS.z)))
	add("cache_hidden_cabin", "cache", "Dusty Leather Case", hcab.x-hfz*3.2, hcabY, hcab.z+hfx*3.2, 0, false, map[string]string{"item": "historical_binoculars"})
	add("cache_camp", "cache", "Oilcloth Bundle", camp.x+2.4, campY, camp.z+1.2, 0, false, map[string]string{"item": "vintage_recorder"})
	add("page_0", "page", "Torn Journal Page", tower.x+tfx*0.6, towerY, tower.z+tfz*0.6, 0, false, map[string]string{"collectible": "page_0"})

	hl.spawn = vec(doorX+fx*6, cabinY, doorZ+fz*6)
	hl.spawnYaw = float32(cabinYaw)
	return hl
}

// splineValley interpolates control points (valley coordinates) with a centripetal-
// ish Catmull-Rom spline, maps to the world and resamples every ~6 m.
func (hb *homeBuilder) splineValley(ctl [][2]float64, wiggle float64) [][2]float64 {
	var dense [][2]float64
	ph := hb.rng.Range(0, 2*math.Pi)
	for i := 0; i+1 < len(ctl); i++ {
		p0 := ctl[max(i-1, 0)]
		p1, p2 := ctl[i], ctl[i+1]
		p3 := ctl[min(i+2, len(ctl)-1)]
		steps := int(math.Max(4, hypot(p2[0]-p1[0], p2[1]-p1[1])/1.5))
		for k := 0; k < steps; k++ {
			t := float64(k) / float64(steps)
			a := catmull(p0[0], p1[0], p2[0], p3[0], t)
			b := catmull(p0[1], p1[1], p2[1], p3[1], t)
			dense = append(dense, [2]float64{a, b})
		}
	}
	dense = append(dense, ctl[len(ctl)-1])
	// Organic lateral wiggle that vanishes at both ends.
	n := len(dense)
	world := make([][2]float64, n)
	for i, p := range dense {
		u := float64(i) / float64(max(n-1, 1))
		w := wiggle * math.Sin(math.Pi*u) * math.Sin(p[0]/19+ph)
		x, z := hb.c.at(p[0], p[1]+w)
		world[i] = [2]float64{x, z}
	}
	return resample(world, 6)
}

func catmull(p0, p1, p2, p3, t float64) float64 {
	t2, t3 := t*t, t*t*t
	return 0.5 * (2*p1 + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3)
}

// resample walks a polyline and emits evenly spaced points about step metres
// apart (the spacing is adjusted so the last interval is not a stub), keeping both
// end points.
func resample(pts [][2]float64, step float64) [][2]float64 {
	if len(pts) < 2 {
		return pts
	}
	total := 0.0
	for i := 0; i+1 < len(pts); i++ {
		total += hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1])
	}
	n := max(1, int(math.Round(total/step)))
	st := total / float64(n)
	out := make([][2]float64, 0, n+1)
	out = append(out, pts[0])
	next := st
	walked := 0.0
	for i := 0; i+1 < len(pts) && len(out) < n; i++ {
		a, b := pts[i], pts[i+1]
		l := hypot(b[0]-a[0], b[1]-a[1])
		for next <= walked+l && len(out) < n {
			t := (next - walked) / l
			out = append(out, [2]float64{lerp(a[0], b[0], t), lerp(a[1], b[1], t)})
			next += st
		}
		walked += l
	}
	return append(out, pts[len(pts)-1])
}

// points converts world (x, z) points to trail points on the shaped ground.
func (hb *homeBuilder) points(pts [][2]float64) []core.Vec3 {
	out := make([]core.Vec3, len(pts))
	for i, p := range pts {
		out[i] = vec(p[0], hb.g.height(p[0], p[1]), p[1])
	}
	return out
}

func nearestIndex(pts [][2]float64, x, z float64) int {
	bi, bd := 0, math.Inf(1)
	for i, p := range pts {
		if d := hypot(p[0]-x, p[1]-z); d < bd {
			bi, bd = i, d
		}
	}
	return bi
}

func segsOf(pts [][2]float64, hidden bool) []trailSeg {
	var out []trailSeg
	for i := 0; i+1 < len(pts); i++ {
		out = append(out, trailSeg{ax: pts[i][0], az: pts[i][1], bx: pts[i+1][0], bz: pts[i+1][1], hidden: hidden})
	}
	return out
}

func segsOfTrail(pts []core.Vec3, hidden bool) []trailSeg {
	var out []trailSeg
	for i := 0; i+1 < len(pts); i++ {
		a, b := pts[i], pts[i+1]
		out = append(out, trailSeg{float64(a.X), float64(a.Z), float64(a.Y), float64(b.X), float64(b.Z), float64(b.Y), hidden})
	}
	return out
}
