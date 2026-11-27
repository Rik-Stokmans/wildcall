package eco

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// feedKind groups Behavior.Feeding into the foraging routines the simulation knows.
type feedKind uint8

const (
	feedGround feedKind = iota // ground | seeds | scavenge: hop or walk about pecking
	feedGlean                  // work through foliage, branch to branch
	feedAerial                 // hawk insects on the wing
	feedDive                   // swim and dive from the surface
	feedDabble                 // swim and dabble
	feedProbe                  // probe mud at the water's edge
	feedHunt                   // watch, soar or hover, then stoop on prey
	feedTrunk                  // creep up trunks
	feedPlunge                 // hover over water and plunge
)

type flightKind uint8

const (
	flyDirect flightKind = iota
	flyUndulating
	flySoaring
	flyHover
	flyFlapGlide
	flyDarting
	flyBuoyant
	flyWhirring
)

type groundKind uint8

const (
	groundHop groundKind = iota
	groundWalk
	groundWade
	groundSwim
	groundCling
	groundNone
)

// profile is a species boiled down to what the hot loop needs: enums instead of
// strings, lookup tables instead of slices.
type profile struct {
	sp *core.Species

	perchPref [core.PerchKindCount]float32 // 0 = never chosen as a general perch; 1 = favourite
	feedSpot  [core.PerchKindCount]bool    // perch kinds this species forages at
	// Height habit: perches up to hiMax metres above the ground suit the species
	// fully; above it they suit it less and less (hiFall metres per step of the
	// falloff). Low-living skulkers (wren, reed warbler) keep to the bottom 3 m.
	hiMax, hiFall float32
	lowLiving     bool // strict height habit: high perches are a last resort
	habW          [core.HabCount]float32
	regions       [core.RegionCount]bool
	seasons       [4]bool
	activity      [core.PhaseCount]float32
	asleep        [core.PhaseCount]bool // phases this species spends at roost

	feed   feedKind
	flight flightKind
	ground groundKind

	flock, pair                      bool
	flockMin, flockMax               int
	lureEater                        bool // comes to seed
	waterBird                        bool // may live and rest on open water
	soarer                           bool // spends foraging time circling
	hoverer                          bool // hunts by hovering
	specBathe, specSocial, specPreen bool
	mixed                            bool        // joins mixed feeding flocks in autumn and winter (mixed.go)
	raptor                           bool        // a bird of prey: small birds dive for cover when it passes low
	small                            bool        // a small bird that dives for cover from a passing raptor
	nest                             nestProfile // how and when it breeds (nest.go)

	// Rare and legendary species only show themselves under strict conditions.
	gated     bool
	legendary bool
	gatePhase [core.PhaseCount]bool
	gateHab   [core.HabCount]bool
	windProof bool // open-country and sea birds do not mind wind

	shy, terr, speed            float32
	skulk, habituate, density   float32
	length                      float32
	soarAlt, hoverAlt           float32
	boutRate                    float32 // song bouts per minute at peak activity
	boutDur                     float32 // seconds a typical bout of the primary call lasts
	callSong, callContact       int
	callAlarm, callDrum         int
	senseR2                     float32 // beyond this squared distance the observer cannot matter
	noiseR                      float32
	habitR2                     float32
	fleeDist                    float32
	groundSpeed, hopLen, swimSp float32
	wobAmp, wobFreq             float32
}

func has(list []string, key string) bool {
	for _, v := range list {
		if v == key {
			return true
		}
	}
	return false
}

// lowKind: perch kinds that are, by their nature, close to the ground or water.
func lowKind(k core.PerchKind) bool {
	switch k {
	case core.PerchShrub, core.PerchGround, core.PerchReed, core.PerchShore, core.PerchWater, core.PerchRock, core.PerchBank:
		return true
	}
	return false
}

const noHeightLimit = 1e4

// heightHabit derives the species' preferred height band from its perch list and
// how much it skulks. A species whose favourite perch is low (shrub, ground, reed,
// shore, water, rock) lives low: a skulker strictly so (the bottom 3 m), a bolder
// one loosely (it may sing from a tree top now and then). Species that prefer tree
// perches (canopy, branch, trunk, snag...) may go as high as the trees take them.
func (p *profile) heightHabit(b *core.Behavior) {
	p.hiMax, p.hiFall = noHeightLimit, 1
	first := core.PerchKindCount
	var low, all float32
	for _, key := range b.Perches {
		k, ok := core.PerchKindFromKey(key)
		if !ok {
			continue
		}
		if first == core.PerchKindCount {
			first = k
		}
		all += p.perchPref[k]
		if lowKind(k) {
			low += p.perchPref[k]
		}
	}
	if first == core.PerchKindCount || !lowKind(first) || all <= 0 {
		return
	}
	if b.Skulking >= 0.6 {
		p.hiMax, p.hiFall, p.lowLiving = 3, 0.7, true
		return
	}
	share := low / all
	p.hiMax, p.hiFall = 4+8*(1-share), 5
}

// heightFit is how well a perch h metres above the ground suits the species'
// height habit: 1 inside the preferred band, falling off above it.
func (p *profile) heightFit(h float32) float32 {
	if h <= p.hiMax {
		return 1
	}
	x := (h - p.hiMax) / p.hiFall
	return 1 / (1 + x + x*x)
}

// perchFit is how much the species likes a perch of kind k, h metres up: its kind
// preference times its height habit. 0 = not a kind it chooses.
func (p *profile) perchFit(k core.PerchKind, h float32) float32 {
	return p.perchPref[k] * p.heightFit(h)
}

// suitFit: from this perchFit on, a perch counts as suitable for everyday use.
const suitFit = 0.2

func buildProfiles(species []core.Species) []profile {
	out := make([]profile, len(species))
	for i := range species {
		out[i] = buildProfile(&species[i])
	}
	return out
}

func buildProfile(sp *core.Species) profile {
	p := profile{sp: sp}
	b := &sp.Behavior

	switch b.Feeding {
	case "glean":
		p.feed = feedGlean
	case "aerial":
		p.feed = feedAerial
	case "dive":
		p.feed = feedDive
	case "dabble":
		p.feed = feedDabble
	case "probe":
		p.feed = feedProbe
	case "hunt":
		p.feed = feedHunt
	case "trunk":
		p.feed = feedTrunk
	case "plunge":
		p.feed = feedPlunge
	default: // ground, seeds, scavenge
		p.feed = feedGround
	}
	p.lureEater = b.Feeding == "ground" || b.Feeding == "seeds" || b.Feeding == "scavenge"

	switch sp.Move.Flight {
	case "undulating":
		p.flight, p.wobAmp, p.wobFreq = flyUndulating, 0.45, 8.5
	case "soaring":
		p.flight = flySoaring
	case "hover":
		p.flight = flyHover
	case "flapglide":
		p.flight, p.wobAmp, p.wobFreq = flyFlapGlide, 0.25, 4.2
	case "darting":
		p.flight, p.wobAmp, p.wobFreq = flyDarting, 1.1, 5.5
	case "buoyant":
		p.flight, p.wobAmp, p.wobFreq = flyBuoyant, 0.4, 2.6
	case "whirring":
		p.flight = flyWhirring
	default:
		p.flight = flyDirect
	}

	switch sp.Move.Ground {
	case "walk":
		p.ground = groundWalk
	case "wade":
		p.ground = groundWade
	case "swim":
		p.ground = groundSwim
	case "cling":
		p.ground = groundCling
	case "none":
		p.ground = groundNone
	default:
		p.ground = groundHop
	}

	// Perch preferences: the listed kinds, most preferred first.
	pref := float32(1)
	for _, key := range b.Perches {
		if k, ok := core.PerchKindFromKey(key); ok && p.perchPref[k] == 0 {
			p.perchPref[k] = pref
			pref *= 0.72
		}
	}
	// What the body plan implies even when the list does not say so.
	if p.ground == groundSwim && p.perchPref[core.PerchWater] < 0.7 {
		p.perchPref[core.PerchWater] = 0.7
	}
	if p.ground == groundWade && p.perchPref[core.PerchShore] < 0.7 {
		p.perchPref[core.PerchShore] = 0.7
	}
	if p.ground == groundCling && p.perchPref[core.PerchTrunk] < 0.7 {
		p.perchPref[core.PerchTrunk] = 0.7
	}
	if (b.Feeding == "dive" || b.Feeding == "dabble") && p.perchPref[core.PerchWater] < 0.6 {
		p.perchPref[core.PerchWater] = 0.6
	}
	p.waterBird = p.perchPref[core.PerchWater] > 0
	// A species with no usable perch list still has to stand somewhere.
	anyPerch := false
	for _, v := range p.perchPref {
		if v > 0 {
			anyPerch = true
		}
	}
	if !anyPerch {
		p.perchPref[core.PerchGround] = 1
	}
	p.heightHabit(b)

	switch p.feed {
	case feedGround:
		p.feedSpot[core.PerchGround], p.feedSpot[core.PerchShore] = true, true
	case feedGlean:
		p.feedSpot[core.PerchCanopy], p.feedSpot[core.PerchShrub], p.feedSpot[core.PerchBranch], p.feedSpot[core.PerchReed] = true, true, true, true
	case feedTrunk:
		p.feedSpot[core.PerchTrunk] = true
	case feedProbe:
		p.feedSpot[core.PerchShore], p.feedSpot[core.PerchGround] = true, p.perchPref[core.PerchGround] > 0
		if p.perchPref[core.PerchShore] == 0 {
			p.feedSpot[core.PerchGround] = true
		}
	case feedDive, feedDabble, feedPlunge:
		p.feedSpot[core.PerchWater] = true
	}

	for _, h := range sp.Habitats {
		if k, ok := core.HabitatFromKey(h.Habitat); ok {
			p.habW[k] = h.Weight
		}
	}
	for _, r := range sp.Regions {
		if r < core.RegionCount {
			p.regions[r] = true
		}
	}
	p.seasons = sp.Seasons
	p.activity = b.Activity

	// A species sleeps through the phases in which it is barely active. One that is
	// never that quiet rests in its weakest phase only if that is clearly a lull.
	maxA, minA, minP := float32(0), float32(2), 0
	for ph, a := range b.Activity {
		if a > maxA {
			maxA = a
		}
		if a < minA {
			minA, minP = a, ph
		}
	}
	sleeps := false
	for ph, a := range b.Activity {
		if a < 0.2 && a < maxA {
			p.asleep[ph] = true
			sleeps = true
		}
	}
	if !sleeps && minA < 0.5*maxA {
		p.asleep[minP] = true
	}

	p.flock = b.Sociality == "flock" && b.FlockMax > 1
	p.pair = b.Sociality == "pair"
	p.flockMin, p.flockMax = b.FlockMin, b.FlockMax
	if p.flockMin < 2 {
		p.flockMin = 2
	}
	if p.flockMax < p.flockMin {
		p.flockMax = p.flockMin
	}
	if p.flockMax > 14 {
		p.flockMax = 14 // keep any one flock a manageable knot of birds
	}

	p.mixed = has(mixedSpecies, sp.ID)
	p.raptor = sp.Traits.Shape == "raptor"
	p.specBathe = has(b.Specials, "bathing")
	p.specSocial = has(b.Specials, "social")
	p.specPreen = has(b.Specials, "preening")
	p.soarer = p.flight == flySoaring || has(b.Specials, "soaring")
	p.hoverer = p.flight == flyHover || has(b.Specials, "hovering")

	p.shy = max32(b.Shyness, 0.5)
	p.terr = clamp(b.Territory, 6, 260)
	p.speed = clamp(sp.Move.Speed, 2, 30)
	p.skulk = clamp(b.Skulking, 0, 1)
	p.habituate = clamp(b.Habituate, 0, 1)
	p.density = max32(b.Density, 0)
	p.length = clamp(sp.Look.Length, 0.07, 1.6)
	p.small = sp.Look.Length < smallBird && !p.raptor

	// Big wings ride higher thermals; small hoverers work close to the ground.
	p.soarAlt = 22 + 45*clamp(sp.Look.Wingspan/1.4, 0.2, 1.3)
	p.hoverAlt = clamp(4+18*sp.Look.Wingspan, 3, 16)

	p.callSong, p.callContact, p.callAlarm, p.callDrum = 0, -1, -1, -1
	for i, c := range sp.Calls {
		if i == 0 {
			continue
		}
		switch c.Kind {
		case "call", "boom":
			if p.callContact < 0 {
				p.callContact = i
			}
		case "alarm":
			if p.callAlarm < 0 {
				p.callAlarm = i
			}
		case "drum":
			if p.callDrum < 0 {
				p.callDrum = i
			}
		case "song":
			if p.callContact < 0 {
				p.callContact = i // a second song type doubles as variety
			}
		}
	}
	if len(sp.Calls) > 0 {
		c := sp.Calls[0]
		mean := float32(c.Repeat[0]+c.Repeat[1]) / 2
		if mean < 1 {
			mean = 1
		}
		p.boutRate = b.Vocal / mean
		p.boutDur = max32(mean*c.PhraseDur()+(mean-1)*c.Gap, 0.1)
	}

	// Furthest the observer can matter: the largest flush distance (sprint, direct
	// approach) plus the awareness margin of the fear curve.
	sense := p.shy*moveSprint*approachDirect*awareBand + 12
	p.senseR2 = sense * sense
	p.noiseR = 10 + p.shy*2.5
	hr := min32(3*p.shy+20, 60)
	p.habitR2 = hr * hr
	p.fleeDist = clamp(p.shy*3.5, 22, 140)
	p.nest = buildNestProfile(sp, p.shy)

	switch p.ground {
	case groundWalk, groundWade:
		p.groundSpeed, p.hopLen = 0.55+0.9*p.length, 0.8+2.2*p.length
	default:
		p.groundSpeed, p.hopLen = 1.6+2*p.length, 0.35+2.2*p.length
	}
	p.swimSp = 0.35 + 0.6*p.length

	// Rare species: only out in the phases when they are at their most active, only
	// in their core habitat, and (unless they are birds of open, windy places) only
	// in calm, dry weather. Legendary ones are stricter still.
	if sp.Rarity >= core.Rare {
		p.gated = true
		p.legendary = sp.Rarity == core.Legendary
		need := 0.6 * maxA
		if p.legendary {
			need = 0.95 * maxA
		}
		for ph, a := range b.Activity {
			p.gatePhase[ph] = a >= need && a > 0
		}
		var maxW float32
		for _, w := range p.habW {
			if w > maxW {
				maxW = w
			}
		}
		for h, w := range p.habW {
			p.gateHab[h] = w > 0 && w >= 0.6*maxW
		}
		p.windProof = p.flight == flySoaring ||
			p.habW[core.HabOcean] >= 0.25 || p.habW[core.HabCliff] >= 0.25 ||
			p.habW[core.HabBeach] >= 0.25 || p.habW[core.HabAlpine] >= 0.25
	}
	return p
}
