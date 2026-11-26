package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Noise layers. Every layer is its own seeded simplex source so fields are
// uncorrelated; the order is part of the world format (changing it changes every
// world), so append only.
const (
	lWarp = iota
	lCont
	lTemp
	lRug
	lMoist
	lDrift
	lRiver
	lWidth
	lLake
	lHill
	lDetail
	lSwell
	lRidge
	lCliffLine
	lMarsh
	lPool
	lHummock
	lFrost
	lCliffy
	lDune
	lStack
	lClear
	lThicket
	lConifer
	lOutcrop
	lColor
	lGrain
	layerCount
)

// Tuning constants of the climate model. Thresholds are in noise units (fields are
// roughly -0.8..0.8); see TestRegionCoverage for the proportions they produce.
const (
	homeR = float64(core.HomeRadius)

	warpScale = 760.0  // wavelength of the domain warp that makes region borders organic
	warpAmp   = 150.0  // metres of displacement
	contScale = 4500.0 // continentalness: sea / coast / inland
	contOct   = 3
	contGain  = 0.4
	climScale = 2100.0 // temperature, ruggedness, moisture, season drift

	seaThr      = -0.38 // continentalness below this is sea
	frostThr    = -0.43 // temperature below this is Frostveil
	windThr     = 0.365 // ruggedness above this is Windpeak
	marshThr    = 0.30  // moisture above this (on gentle ground) is Murmur Marsh
	marshRugMax = 0.16
	amberThr    = 0.21  // season drift above this is Amberwood
	blendDelta  = 0.045 // half-width of a region transition in noise units (~60 m)

	coastWidth = 150.0 // metres of land behind the shoreline that count as Whispering Coast

	riverScale = 1000.0
	riverK     = 420.0 // scales the river noise so the field reads roughly in metres
	lakeScale  = 1250.0
	lakeThr    = 0.78
)

// anchor is a climate nudge near home: a soft disc in which the climate fields are
// pulled towards one region type, so that every world offers all six region types
// within walking distance of the home valley (contract §2.1). Anchors are part of
// the pure (seed, position) function like everything else.
type anchor struct {
	x, z, r float64
	kind    core.RegionID
}

// gen is the pure world function: everything here depends only on the seed and
// the queried position. It is immutable once the home layout has been attached.
type gen struct {
	seed    int64
	n       [layerCount]*noise.Source
	anchors [5]anchor
	creek   creek
	hl      *homeLayout // nil while the home layout is being searched
}

func newGen(seed int64) *gen {
	g := &gen{seed: seed}
	for i := range g.n {
		g.n[i] = noise.New(int64(noise.Hash2(uint64(seed), int64(i), 7919)))
	}
	r := noise.NewRNG(noise.Hash2(uint64(seed), 101, 202))
	kinds := [5]core.RegionID{core.RegionMurmurMarsh, core.RegionWindpeak, core.RegionWhisperingCoast, core.RegionAmberwood, core.RegionFrostveil}
	for i := len(kinds) - 1; i > 0; i-- {
		j := r.Intn(i + 1)
		kinds[i], kinds[j] = kinds[j], kinds[i]
	}
	a0 := r.Range(0, 2*math.Pi)
	for i, k := range kinds {
		ang := a0 + float64(i)*2*math.Pi/5 + r.Range(-0.22, 0.22)
		d := r.Range(1450, 2500)
		rad := r.Range(560, 720)
		if k == core.RegionWhisperingCoast {
			// The sea must stay clear of the land forced around the home valley.
			d = r.Range(2050, 2900)
			rad = r.Range(600, 760)
		}
		g.anchors[i] = anchor{x: math.Sin(ang) * d, z: -math.Cos(ang) * d, r: rad, kind: k}
	}
	g.creek = newCreek(&r)
	return g
}

// sample is everything the generator knows about one point of the world.
type sample struct {
	h      float64                   // ground height in metres (before generated pads, ponds and trail benches)
	w      [core.RegionCount]float64 // region blend weights, sum 1
	region core.RegionID             // hard classification; RegionNone = open sea

	seaDist float64 // signed metres to the sea shoreline, + inland, clamped to ±400
	sea     bool    // seaward of the shoreline
	cliffy  float64 // 0..1: sea-cliff coast rather than beach
	riverD  float64 // metres to the nearest river centre line (capped at 400)
	riverW  float64 // half-width of that river's channel
	flowing bool    // the river holds water here (lowland), as opposed to a dry gully
	lakeD   float64 // signed metres to a lake shore, + inside the lake (capped)
	ice     float64 // 0..1: frozen water surface (Frostveil)

	clear   float64 // woodland structure fields (-1..1): high = clearing
	thicket float64 // high = dense scrub
	conifer float64 // high = pine stand
	rock    float64 // 0..1 rocky outcrop

	// Home-valley dressing (0..1 weights) set by the home layout.
	hMeadow, hFern, hPine float64

	ambient float64 // 0..1 steady environmental noise (running water, surf)
}

// climate evaluates the smooth climate fields at a point, including the anchors and
// the land forced around the home valley. sd is the signed distance to the sea
// shoreline in metres (+ inland), estimated from the continentalness gradient.
func (g *gen) climate(x, z, dist float64) (sd, temp, rug, moist, drift float64) {
	wu, wv, jac := g.n[lWarp].WarpD(x/warpScale, z/warpScale, warpAmp/warpScale)
	wx, wz := wu*warpScale, wv*warpScale

	c, cu, cv := g.n[lCont].FBMD(wx/contScale, wz/contScale, contOct, 2.05, contGain)
	cgx := (cu*jac[0] + cv*jac[2]) / contScale
	cgz := (cu*jac[1] + cv*jac[3]) / contScale
	temp = g.n[lTemp].FBM(wx/climScale, wz/climScale, 2, 2.1, 0.45)
	rug = g.n[lRug].FBM(wx/climScale, wz/climScale, 2, 2.1, 0.45)
	moist = g.n[lMoist].FBM(wx/climScale, wz/climScale, 2, 2.1, 0.45)
	drift = g.n[lDrift].FBM(wx/climScale, wz/climScale, 2, 2.1, 0.45)

	for i := range g.anchors {
		a := &g.anchors[i]
		dx, dz := x-a.x, z-a.z
		d2 := dx*dx + dz*dz
		if d2 >= a.r*a.r {
			continue
		}
		d := math.Sqrt(d2)
		sv, sdv := smoothstepD(0.3*a.r, a.r, d)
		b := 1 - sv
		var bgx, bgz float64
		if d > 1e-6 {
			bgx, bgz = -sdv*dx/d, -sdv*dz/d
		}
		ct := 0.30
		if a.kind == core.RegionWhisperingCoast {
			ct = seaThr - 0.36
		}
		cgx = (1-b)*cgx + (ct-c)*bgx
		cgz = (1-b)*cgz + (ct-c)*bgz
		c = lerp(c, ct, b)
		switch a.kind {
		case core.RegionMurmurMarsh:
			moist = lerp(moist, 0.75, b)
			rug = lerp(rug, -0.3, b)
			temp = lerp(temp, 0.2, b)
		case core.RegionWindpeak:
			rug = lerp(rug, 0.78, b)
			temp = lerp(temp, 0.2, b)
		case core.RegionAmberwood:
			drift = lerp(drift, 0.75, b)
			rug = lerp(rug, -0.2, b)
			moist = lerp(moist, -0.2, b)
			temp = lerp(temp, 0.2, b)
		case core.RegionFrostveil:
			temp = lerp(temp, -0.8, b)
		}
	}

	// Land around the home valley: no sea within ~650 m of the origin.
	if dist < 1150 {
		mv, md := smoothstepD(650, 1150, dist)
		m := 1 - mv
		const landV = seaThr + 0.34
		if c < landV {
			if dist > 1e-6 {
				k := -md * (landV - c) / dist
				cgx = (1-m)*cgx + k*x
				cgz = (1-m)*cgz + k*z
			}
			c = lerp(c, landV, m)
		}
	}
	sd = clamp((c-seaThr)/math.Max(hypot(cgx, cgz), 2.2e-4), -400, 400)
	if dist < 700 {
		sd = math.Max(sd, 400*(1-smoothstep(520, 700, dist)))
	}
	return
}

// seaFloor is the sea-bed profile seaward of the shoreline (sd <= 0): a wadeable
// shelf off beaches, a quick drop below cliffs.
func seaFloor(sd, cl float64) float64 {
	d := -sd
	if d < 30 {
		return -d * lerp(1.0/13, 1.0/5, cl)
	}
	h := -30*lerp(1.0/13, 1.0/5, cl) - (d-30)*0.11
	if h < -38 {
		h = -38
	}
	return h
}

// sample evaluates the world at (x, z).
func (g *gen) sample(x, z float64, s *sample) {
	*s = sample{riverD: 400, lakeD: -400}
	dist := hypot(x, z)

	sd, temp, rug, moist, drift := g.climate(x, z, dist)
	s.seaDist = sd
	s.sea = sd < 0

	// Coast character: cliffs or beach.
	cl := 0.0
	if sd < 200 {
		cl = smoothstep(0.12, 0.38, g.n[lCliffy].Eval(x/560, z/560)+0.25*rug)
	}
	s.cliffy = cl

	if sd < -135 {
		// Open sea: nothing else matters out here.
		s.region = core.RegionNone
		s.h = seaFloor(sd, cl)
		s.ambient = lerp(0.55, 0.75, cl) * 0.55 * smoothstep(-330, -135, sd)
		return
	}

	// --- region weights -----------------------------------------------------
	mF := smoothstep(-blendDelta, blendDelta, frostThr-temp)
	mW := smoothstep(-blendDelta, blendDelta, rug-windThr)
	mM := smoothstep(-blendDelta, blendDelta, moist-marshThr) * smoothstep(-blendDelta, blendDelta, marshRugMax-rug)
	mA := smoothstep(-blendDelta, blendDelta, drift-amberThr)
	wF := mF
	wW := (1 - wF) * mW
	wM := (1 - wF - wW) * mM
	wA := (1 - wF - wW - wM) * mA
	hmR := 1 - smoothstep(homeR+20, homeR+200, dist)
	if hmR > 0 {
		k := 1 - hmR
		wF, wW, wM, wA = wF*k, wW*k, wM*k, wA*k
	}
	wG := 1 - wF - wW - wM - wA
	hmH := 1 - smoothstep(homeR, homeR+260, dist) // gentle home terrain

	// --- rivers: the zero contour of one field ------------------------------
	// Far from home the field is noise; in the home valley it is the signed
	// distance to the creek. Blending the two fields (rather than two channels)
	// keeps the contour continuous, so the home creek flows on as a natural river.
	var f, fgx, fgz float64
	mv, md := smoothstepD(homeR+60, homeR+320, dist)
	hmRiver := 1 - mv
	if hmRiver < 1 {
		n, nx, nz := g.n[lRiver].FBMD(x/riverScale, z/riverScale, 2, 2.3, 0.4)
		f, fgx, fgz = riverK*n, riverK*nx/riverScale, riverK*nz/riverScale
	}
	if hmRiver > 0 {
		c, cx, cz := g.creek.signed(x, z)
		k := 0.0
		if dist > 1e-6 {
			k = -md * (c - f) / dist
		}
		fgx = lerp(fgx, cx, hmRiver) + k*x
		fgz = lerp(fgz, cz, hmRiver) + k*z
		f = lerp(f, c, hmRiver)
	}
	af := math.Abs(f)
	rd := math.Min(af/math.Max(hypot(fgx, fgz), 0.4), 400)
	s.riverD = rd
	valley := smoothstep(0, 340, af) // broad lowland along rivers

	// --- inland height: blend of the region types' own terrain ---------------
	land := 0.0
	if wG > 0.002 {
		land += wG * g.greenH(x, z, valley, s)
	}
	if wA > 0.002 {
		land += wA * g.amberH(x, z, valley, s)
	}
	if wM > 0.002 {
		land += wM * g.marshH(x, z)
	}
	if wW > 0.002 {
		land += wW * g.windH(x, z, rug, s)
	}
	if wF > 0.002 {
		land += wF * g.frostH(x, z, rug)
	}
	if hmH > 0 {
		land = lerp(land, g.homeH(x, z, rd), hmH)
	}

	// --- lakes ---------------------------------------------------------------
	if lakeS := (1 - hmH) * (1 - wW); lakeS > 0.01 && sd > 0 {
		lv, lx, lz := g.n[lLake].EvalD(x/lakeScale, z/lakeScale)
		lv += 0.1 * g.n[lLake].Eval(x/310+40, z/310-70)
		ld := clamp((lv-lakeThr)/math.Max(hypot(lx, lz)/lakeScale, 4e-4), -400, 400)
		s.lakeD = ld
		band := 70 + 5*clamp(land, 0, 30)
		if ld > -band {
			target := 0.0
			if ld <= 0 {
				target = lerp(0.45, land, smoothstep(0, band, -ld))
			} else {
				target = math.Max(0.45-ld*0.085, -4.5)
			}
			land = lerp(land, target, lakeS)
		}
	}

	// --- the sea shore -------------------------------------------------------
	h := land
	if sd < 190 {
		if sd >= 0 {
			dunes := (0.5 + 0.5*g.n[lDune].Eval(x/27, z/27)) * 2.8 * smoothstep(22, 60, sd) * (1 - smoothstep(105, 175, sd))
			beach := sd*0.04 + dunes
			top := 11 + 9*(1+g.n[lCliffy].Eval(x/240+13, z/240-7))
			cliff := lerp(sd*0.1, top, smoothstep(3.5, 14, sd))
			h = lerp(lerp(beach, cliff, cl), land, smoothstep(45, 190, sd))
		} else {
			h = seaFloor(sd, cl)
			// Sea stacks: steep rock islets off cliff coasts.
			if cl > 0.3 && sd > -100 && sd < -22 {
				st := g.n[lStack].Eval(x/38, z/38)
				if st > 0.55 {
					k := smoothstep(0.55, 0.8, st) * smoothstep(0.3, 0.7, cl) * smoothstep(-22, -38, sd) * smoothstep(-100, -80, sd)
					h = lerp(h, 5+11*(0.5+0.5*g.n[lStack].Eval(x/90+5, z/90)), k)
					s.rock = math.Max(s.rock, k)
				}
			}
		}
	}

	// --- river channel -------------------------------------------------------
	if rd < 76 && !s.sea {
		wn := 0.5 + 0.5*g.n[lWidth].Eval(x/330, z/330)
		halfW := 2.3 + 4.4*wn*wn
		depth := 0.32 + 0.4*wn + 0.95*smoothstep(0.62, 0.9, wn)
		if hmRiver > 0 {
			// The home creek: 4.4-6 m wide and always wadeable.
			cw := 2.2 + 0.8*(0.5+0.5*math.Sin(g.creek.along(x, z)/47))
			halfW = lerp(halfW, cw, hmRiver)
			depth = lerp(depth, 0.45, hmRiver)
		}
		s.riverW = halfW
		// gd is how far the bed lies below the surrounding land: all the way to
		// just under the water plane in lowland, fading to nothing in high ground.
		var gd float64
		if h <= 12 {
			gd = h + depth
			s.flowing = true
		} else {
			gd = (12 + depth) * (1 - smoothstep(12, 26, h))
		}
		if gd > 0.05 {
			bed := h - gd
			bank := bed + depth + 0.75
			if bank > h {
				bank = h
			}
			vw := halfW + 6 + 4.5*gd
			switch {
			case rd >= vw:
			case rd >= halfW+2.5:
				h = lerp(bank, h, smoothstep(halfW+2.5, vw, rd))
			case rd >= halfW:
				h = lerp(bed+depth*0.55, bank, (rd-halfW)/2.5)
			default:
				q := rd / halfW
				h = bed + depth*0.55*q*q
			}
		}
	}

	// --- Frostveil: standing water is flat ice at y = 0.3 ----------------------
	if wF > 0.3 && !s.sea && h < 0.3 {
		iw := smoothstep(0.35, 0.65, wF)
		h = lerp(h, 0.3, iw)
		s.ice = iw
	}

	// --- final weights and classification -------------------------------------
	wC := 1.0
	if sd > 0 {
		wC = (1 - smoothstep(coastWidth-40, coastWidth+40, sd)) * (1 - hmR)
	}
	k := 1 - wC
	s.w = [core.RegionCount]float64{wG * k, wM * k, wW * k, wC, wA * k, wF * k}
	if sd < -110 {
		s.region = core.RegionNone
	} else {
		best := core.RegionGreenhollow
		for r := core.RegionID(1); r < core.RegionCount; r++ {
			if s.w[r] > s.w[best] {
				best = r
			}
		}
		s.region = best
	}

	// --- woodland structure fields (used for habitat, colour and vegetation) ---
	s.clear = g.n[lClear].Eval(x/185, z/185) + 0.45*g.n[lClear].Eval(x/71+9, z/71+3)
	s.thicket = g.n[lThicket].Eval(x/125, z/125)
	s.conifer = g.n[lConifer].Eval(x/270, z/270) + 0.3*g.n[lConifer].Eval(x/90+5, z/90-8)

	// --- ambient noise ---------------------------------------------------------
	amb := 0.0
	if s.flowing && rd < 48 {
		edge := rd - s.riverW
		a := 0.5
		if edge > 0 {
			a = lerp(0.5, 0.25, clamp01(edge/15)) * (1 - smoothstep(15, 46, edge))
		}
		a *= 1 - 0.6*s.w[core.RegionMurmurMarsh] // marsh channels barely move
		amb = a * (1 - s.ice)
	}
	if sd < 150 {
		surf := lerp(0.55, 0.75, cl)
		if sd >= 0 {
			surf *= 1 - smoothstep(8, 150, sd)
		} else {
			surf *= 1 - 0.45*smoothstep(0, -135, sd)
		}
		amb = math.Max(amb, surf)
	}
	s.ambient = amb

	s.h = h
	if g.hl != nil && dist < homeR+90 {
		g.hl.shape(x, z, s)
	}
}

// height is the pure ground height at (x, z).
func (g *gen) height(x, z float64) float64 {
	var s sample
	g.sample(x, z, &s)
	return s.h
}

// outcrop adds occasional rocky knolls to forest terrain and reports rockiness.
func (g *gen) outcrop(x, z, valley float64, s *sample) float64 {
	o := g.n[lOutcrop].Eval(x/64, z/64)
	if o < 0.6 {
		return 0
	}
	k := smoothstep(0.6, 0.86, o) * valley
	s.rock = math.Max(s.rock, k)
	return 6.5 * k
}

// greenH: Greenhollow Woods. Rolling wooded hills with hollows and knolls, low and
// level along the rivers.
func (g *gen) greenH(x, z, valley float64, s *sample) float64 {
	hills := g.n[lHill].FBM(x/430, z/430, 4, 2.1, 0.5)
	detail := g.n[lDetail].FBM(x/58, z/58, 2, 2.2, 0.5)
	h := 2.6 + 9.5*valley + hills*(4.5+10*valley) + detail*0.9 + g.outcrop(x, z, valley, s)
	return smax(h, 1.15+0.25*detail, 1.2)
}

// amberH: Amberwood. Broader swells than Greenhollow with small sharp ridgelets.
func (g *gen) amberH(x, z, valley float64, s *sample) float64 {
	swell := g.n[lSwell].FBM(x/620, z/620, 3, 2.0, 0.5)
	ridges := g.n[lSwell].Ridged(x/170+31, z/170+77, 2, 2.1, 0.5)
	detail := g.n[lDetail].FBM(x/58, z/58, 2, 2.2, 0.5)
	h := 3.2 + 11*valley + swell*(5+11*valley) + ridges*3.6*valley + detail*0.8 + 0.7*g.outcrop(x, z, valley, s)
	return smax(h, 1.15+0.25*detail, 1.2)
}

// marshH: Murmur Marsh. Ground at or just below the water plane: reed flats,
// pools, winding channels and a few dry hummocks.
func (g *gen) marshH(x, z float64) float64 {
	h := 0.5 + 0.38*g.n[lMarsh].FBM(x/95, z/95, 2, 2.1, 0.5)
	if p := g.n[lPool].Eval(x/58, z/58); p < -0.22 {
		h = lerp(h, -0.3-0.65*smoothstep(-0.3, -0.65, p), smoothstep(-0.22, -0.34, p))
	}
	if c := math.Abs(g.n[lMarsh].Eval(x/150+70, z/150-20)); c < 0.07 {
		h = math.Min(h, lerp(-0.5, h, smoothstep(0.03, 0.07, c)))
	}
	if m := g.n[lHummock].Eval(x/80, z/80); m > 0.45 {
		h += 1.1 * smoothstep(0.45, 0.8, m)
	}
	return h
}

// windH: Windpeak Highlands. Ridged mountains whose amplitude grows from the
// patch edge (walkable approaches) to the core (peaks of 150-300 m), with cliff
// bands cutting dramatic faces across the upper slopes.
func (g *gen) windH(x, z, rug float64, s *sample) float64 {
	p := smoothstep(windThr-0.04, windThr+0.26, rug)
	r := g.n[lRidge].Ridged(x/480, z/480, 5, 2.1, 0.42)
	peaks := (26 + 215*p) * math.Pow(r, 1.45)
	cliffs := 0.0
	if p > 0.05 {
		line := g.n[lCliffLine].Eval(x/340, z/340)
		cliffs = 17 * p * smoothstep(-0.025, 0.025, line) * smoothstep(0.22, 0.5, r)
	}
	s.rock = math.Max(s.rock, smoothstep(0.35, 0.7, r)*p)
	return 13 + 44*p + peaks + cliffs
}

// frostH: Frostveil. Cold plateaus: stepped snowfields with wind-drifted surfaces.
func (g *gen) frostH(x, z, rug float64) float64 {
	v := 13 + 13*g.n[lFrost].FBM(x/560, z/560, 3, 2.1, 0.5)
	const step = 7.0
	k := math.Floor(v / step)
	v = step * (k + smoothstep(0.28, 0.72, v/step-k))
	drift := g.n[lFrost].FBM(x/44+11, z/44+5, 2, 2.2, 0.5)
	return 19 + v + 0.7*drift + 9*smoothstep(0.05, 0.4, rug)
}

// homeH: the gentle terrain of the home valley, shaped around the creek: a level
// valley floor rising into low wooded hills. d is the distance to the creek.
func (g *gen) homeH(x, z, d float64) float64 {
	rise := 1.25 + 15*(1-math.Exp(-d/170))
	hills := g.n[lHill].FBM(x/190, z/190, 3, 2.1, 0.5) * (1.2 + 7.6*smoothstep(15, 230, d))
	small := g.n[lDetail].FBM(x/38, z/38, 2, 2.2, 0.5) * 0.55 * smoothstep(4, 40, d)
	return smax(rise+hills+small, 1.2+0.3*small, 1.0)
}

// habitatOf classifies the ground at a sample given its final height and slope
// (rise over run).
func habitatOf(s *sample, h, slope float64) core.Habitat {
	if s.region == core.RegionNone {
		return core.HabOcean
	}
	if s.sea {
		if h < 0.25 {
			return core.HabOcean
		}
		return core.HabCliff // sea stacks
	}
	switch s.region {
	case core.RegionWhisperingCoast:
		switch {
		case slope > 0.85:
			return core.HabCliff
		case h < 0.3 && s.seaDist > 12:
			return core.HabRiver // river mouths and lagoons behind the beach
		case s.cliffy < 0.5 && s.seaDist < 95 && slope < 0.4:
			return core.HabBeach
		case s.seaDist < 14:
			return core.HabBeach
		case s.thicket > 0.3:
			return core.HabShrub
		}
		return core.HabMeadow
	case core.RegionMurmurMarsh:
		switch {
		case h < -1.1:
			return core.HabRiver
		case h > 1.7 && s.thicket > 0.1:
			return core.HabShrub
		case h > 2.6:
			return core.HabMeadow
		}
		return core.HabMarsh
	case core.RegionFrostveil:
		switch {
		case slope > 0.95:
			return core.HabCliff
		case s.ice > 0.5 || h < 0.35:
			return core.HabSnow
		case s.conifer > 0.22 && s.clear < 0.5:
			return core.HabConifer
		}
		return core.HabSnow
	case core.RegionWindpeak:
		switch {
		case h < 0.4:
			return core.HabRiver
		case slope > 0.8:
			return core.HabCliff
		case h < 75 && s.conifer > 0.05 && slope < 0.55 && s.clear < 0.5:
			return core.HabConifer
		}
		return core.HabAlpine
	}
	// Greenhollow and Amberwood.
	switch {
	case h < 0.45 || (s.flowing && s.riverD < s.riverW+3.5):
		return core.HabRiver
	case slope > 1.0:
		return core.HabCliff
	case s.hMeadow > 0.5:
		return core.HabMeadow
	case s.hFern > 0.5:
		return core.HabShrub
	case s.hPine > 0.5:
		return core.HabConifer
	case s.clear > 0.5:
		return core.HabMeadow
	case s.thicket > 0.48:
		return core.HabShrub
	}
	kThr := 0.34
	if s.region == core.RegionAmberwood {
		kThr = 0.6
	}
	if s.conifer > kThr {
		return core.HabConifer
	}
	return core.HabWoodland
}
