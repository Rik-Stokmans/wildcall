package world

import (
	"fmt"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// The structure grid (contract §2.2): 192 m cells, each holding zero or one
// generated feature chosen by region type, terrain and a seeded roll. A cell is a
// pure function of (seed, cell); its features never depend on other cells, so cells
// can be generated in any order.

const (
	cellSize      = 192.0
	cellMargin    = 30.0  // features keep this far inside their cell
	featureChance = 0.45  // share of land cells with a feature
	rangerChance  = 0.025 // ~1 ranger station per 2 km² of land
	nCands        = 12    // candidate sites sampled per cell
	ringR         = 36.0  // radius of the ring sampled around each candidate
	homeKeepPOI   = 75.0  // generated features keep this far from home places...
	homeKeepTrail = 35.0  // ...and from home trails
)

// regionKinds lists the generated main-feature kinds each region type may hold
// (companions - cache, page, relic, feather - come with them).
var regionKinds = [core.RegionCount][]string{
	core.RegionGreenhollow:     {"watchtower", "hide", "camp", "hidden_cabin", "viewpoint", "pond", "landmark", "ranger_station"},
	core.RegionMurmurMarsh:     {"watchtower", "hide", "abandoned_station", "landmark", "ranger_station"},
	core.RegionWindpeak:        {"watchtower", "hide", "camp", "abandoned_station", "viewpoint", "landmark", "ranger_station"},
	core.RegionWhisperingCoast: {"watchtower", "hide", "abandoned_station", "viewpoint", "landmark", "ranger_station"},
	core.RegionAmberwood:       {"watchtower", "hide", "camp", "hidden_cabin", "viewpoint", "pond", "landmark", "ranger_station"},
	core.RegionFrostveil:       {"watchtower", "camp", "abandoned_station", "viewpoint", "landmark", "ranger_station"},
}

// kindWeight is how often a kind is chosen in a region when a valid site exists.
var kindWeight = [core.RegionCount]map[string]float64{
	core.RegionGreenhollow:     {"watchtower": 1.2, "hide": 1.5, "camp": 1.6, "hidden_cabin": 1.4, "viewpoint": 1.0, "pond": 1.4, "landmark": 1.6},
	core.RegionMurmurMarsh:     {"watchtower": 1.2, "hide": 3.0, "abandoned_station": 1.6, "landmark": 2.0},
	core.RegionWindpeak:        {"watchtower": 1.4, "hide": 0.6, "camp": 1.4, "abandoned_station": 1.3, "viewpoint": 2.0, "landmark": 1.6},
	core.RegionWhisperingCoast: {"watchtower": 1.0, "hide": 1.4, "abandoned_station": 1.3, "viewpoint": 1.6, "landmark": 1.6},
	core.RegionAmberwood:       {"watchtower": 1.2, "hide": 1.4, "camp": 1.5, "hidden_cabin": 1.5, "viewpoint": 1.0, "pond": 1.3, "landmark": 1.6},
	core.RegionFrostveil:       {"watchtower": 1.0, "camp": 1.0, "abandoned_station": 1.6, "viewpoint": 1.5, "landmark": 1.6},
}

// landmarkKinds: the natural or old human features that fit each region type.
var landmarkKinds = [core.RegionCount]map[string]float64{
	core.RegionGreenhollow:     {"giant_tree": 2, "standing_stones": 1, "waterfall_rocks": 1},
	core.RegionMurmurMarsh:     {"boardwalk": 2.5, "standing_stones": 1},
	core.RegionWindpeak:        {"cairn": 2, "standing_stones": 1, "waterfall_rocks": 1},
	core.RegionWhisperingCoast: {"sea_arch": 2, "lighthouse": 0.35, "standing_stones": 1},
	core.RegionAmberwood:       {"giant_tree": 2, "standing_stones": 1, "waterfall_rocks": 1},
	core.RegionFrostveil:       {"frozen_falls": 1.5, "cairn": 1.5, "standing_stones": 1},
}

// kindAllowed reports whether a generated main feature of this kind may stand in
// a region type.
func kindAllowed(r core.RegionID, kind string) bool {
	if r >= core.RegionCount {
		return false
	}
	for _, k := range regionKinds[r] {
		if k == kind {
			return true
		}
	}
	return false
}

// cand is one candidate site examined by a cell.
type cand struct {
	x, z, h, slope float64
	prom           float64 // height above the mean of the surrounding ring
	region         core.RegionID
	hab            core.Habitat
	ok             bool    // dry, usable land
	water          bool    // open water within ~ringR
	waterYaw       float64 // heading towards that water
	downYaw        float64 // heading towards the lowest ring sample (the view)
	riverD         float64
	seaDist        float64
	cliffy         float64
	home           bool // inside the home valley
}

func (c *cand) forest() bool {
	return c.hab == core.HabWoodland || c.hab == core.HabConifer || c.hab == core.HabShrub
}

// cell is a structure-grid cell's features (stage 1: everything that does not
// depend on other cells).
type cell struct {
	cx, cz  int
	main    int // index of the main feature in pois, -1 if none
	pois    []core.POI
	onPad   []bool // the POI's y is a pad height (already final)
	ov      overlays
	structs []structure
	special []core.Veg // landmark vegetation: giant trees, rocks
	cands   []cand
}

// mainPOI returns the cell's main feature, if it has one.
func (c *cell) mainPOI() (core.POI, bool) {
	if c.main < 0 {
		return core.POI{}, false
	}
	return c.pois[c.main], true
}

func genID(kind string, cx, cz int) string { return fmt.Sprintf("%s@%d,%d", kind, cx, cz) }

func cellOf(v float64) int { return int(math.Floor(v / cellSize)) }

func (w *World) cell(cx, cz int) *cell {
	return w.cells.get(cellKey{cx, cz}, func() *cell { return w.buildCell(cx, cz) })
}

// sampleCand examines one candidate site.
func (w *World) sampleCand(x, z float64) cand {
	g := w.g
	var s sample
	g.sample(x, z, &s)
	c := cand{x: x, z: z, h: s.h, region: s.region, riverD: s.riverD, seaDist: s.seaDist, cliffy: s.cliffy}
	const e = 3.0
	hx := g.height(x+e, z) - g.height(x-e, z)
	hz := g.height(x, z+e) - g.height(x, z-e)
	c.slope = hypot(hx, hz) / (2 * e)
	c.hab = habitatOf(&s, s.h, c.slope)
	sum, low := 0.0, math.Inf(1)
	bestW := math.Inf(1)
	for i := 0; i < 8; i++ {
		a := float64(i) * math.Pi / 4
		dx, dz := headingDir(a)
		rh := g.height(x+dx*ringR, z+dz*ringR)
		sum += rh
		if rh < low {
			low, c.downYaw = rh, a
		}
		if rh < -0.15 && s.ice < 0.5 && rh < bestW {
			bestW, c.water, c.waterYaw = rh, true, a
		}
	}
	c.prom = s.h - sum/8
	c.ok = !s.sea && s.ice < 0.5 && s.h >= 1.2 && s.region < core.RegionCount
	if d := hypot(x, z); d < homeR+60 {
		c.home = true
		if !w.hl.clearOf(x, z, homeKeepPOI, homeKeepTrail) {
			c.ok = false
		}
	}
	return c
}

// clearOf reports whether (x, z) keeps the given distances from every home place
// and home trail.
func (hl *homeLayout) clearOf(x, z, poiGap, trailGap float64) bool {
	for i := range hl.pois {
		p := &hl.pois[i]
		if hypot(x-float64(p.Pos.X), z-float64(p.Pos.Z)) < poiGap {
			return false
		}
	}
	for i := range hl.ov.segs {
		s := &hl.ov.segs[i]
		if d, _ := distSeg(x, z, s.ax, s.az, s.bx, s.bz); d < trailGap {
			return false
		}
	}
	return true
}

// siteScore rates a candidate for a kind (higher is better); ok=false if unusable.
func siteScore(kind, landmark string, c *cand) (float64, bool) {
	if !c.ok || !kindAllowed(c.region, kind) {
		return 0, false
	}
	if c.home && !(kind == "landmark" && (landmark == "giant_tree" || landmark == "standing_stones")) {
		return 0, false
	}
	switch kind {
	case "watchtower":
		if c.slope > 0.45 || c.prom < 0.8 {
			return 0, false
		}
		return c.prom*2 + c.h*0.02 - c.slope*4, true
	case "hide":
		if !c.water || c.slope > 0.4 {
			return 0, false
		}
		return 3 - c.slope*4, true
	case "camp":
		if c.slope > 0.32 {
			return 0, false
		}
		if (c.region == core.RegionGreenhollow || c.region == core.RegionAmberwood) && !c.forest() {
			return 0, false
		}
		return 2 - c.slope*5, true
	case "hidden_cabin":
		if c.slope > 0.3 || !c.forest() {
			return 0, false
		}
		return 2 - c.slope*5, true
	case "abandoned_station":
		if c.slope > 0.3 {
			return 0, false
		}
		return 2 - c.slope*5 + c.prom*0.1, true
	case "viewpoint":
		cliffTop := c.region == core.RegionWhisperingCoast && c.cliffy > 0.5 && c.seaDist < 60 && c.h > 6
		if c.prom < 3 && !cliffTop {
			return 0, false
		}
		return c.prom + c.h*0.01, true
	case "pond":
		if !c.forest() || c.slope > 0.2 || c.water || c.riverD < 40 || c.h > 40 {
			return 0, false
		}
		return 2 - c.prom*0.5 - c.slope*6, true
	case "ranger_station":
		if c.slope > 0.15 {
			return 0, false
		}
		return 2 - c.slope*10, true
	case "landmark":
		switch landmark {
		case "giant_tree":
			if c.slope > 0.3 || !(c.forest() || c.hab == core.HabMeadow) {
				return 0, false
			}
			return 2 - c.slope*4, true
		case "standing_stones":
			if c.slope > 0.2 {
				return 0, false
			}
			bonus := 0.0
			if c.hab == core.HabMeadow || c.hab == core.HabAlpine || c.hab == core.HabSnow {
				bonus = 1
			}
			return 1 + bonus - c.slope*5, true
		case "waterfall_rocks":
			if c.riverD > 26 || c.slope < 0.12 || c.slope > 0.8 {
				return 0, false
			}
			return c.slope * 3, true
		case "sea_arch":
			if c.seaDist > 55 || c.cliffy < 0.35 {
				return 0, false
			}
			return c.cliffy - c.seaDist*0.01, true
		case "lighthouse":
			if c.seaDist > 90 || c.slope > 0.35 {
				return 0, false
			}
			return c.h * 0.1, true
		case "boardwalk":
			return 1 + boolf(c.water), true
		case "cairn":
			if c.slope > 0.5 {
				return 0, false
			}
			return c.prom + c.h*0.01, true
		case "frozen_falls":
			if c.slope < 0.3 {
				return 0, false
			}
			return c.slope, true
		}
	}
	return 0, false
}

func boolf(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// best returns the index of the best candidate for a kind, or -1.
func best(cands []cand, kind, landmark string) int {
	bi, bs := -1, math.Inf(-1)
	for i := range cands {
		if s, ok := siteScore(kind, landmark, &cands[i]); ok && s > bs {
			bi, bs = i, s
		}
	}
	return bi
}

type weighted struct {
	key string
	w   float64
}

// roll picks a weighted option; options must be in a deterministic order.
func roll(r *noise.RNG, opts []weighted) string {
	tot := 0.0
	for _, o := range opts {
		tot += o.w
	}
	if tot <= 0 {
		return ""
	}
	v := r.Float64() * tot
	for _, o := range opts {
		v -= o.w
		if v < 0 {
			return o.key
		}
	}
	return opts[len(opts)-1].key
}

// padSpec is the flattened pad (radius, blend) under a kind of feature.
func padSpec(kind, landmark string) (r, blend float64) {
	switch kind {
	case "watchtower":
		return 4, 5
	case "hide":
		return 3, 4
	case "camp":
		return 5, 5
	case "hidden_cabin":
		return 6, 6
	case "abandoned_station":
		return 7, 7
	case "ranger_station":
		return 9, 9
	case "landmark":
		switch landmark {
		case "standing_stones", "lighthouse":
			return 6, 6
		case "cairn":
			return 3, 3
		}
	}
	return 0, 0
}

func (w *World) buildCell(cx, cz int) *cell {
	c := &cell{cx: cx, cz: cz, main: -1}
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0xce11ce11, int64(cx), int64(cz)))
	x0, z0 := float64(cx)*cellSize, float64(cz)*cellSize
	span := cellSize - 2*cellMargin
	c.cands = make([]cand, nCands)
	land := 0
	for i := range c.cands {
		// Stratified: a 4 x 3 lattice of strata, one jittered point in each.
		sx, sz := float64(i%4), float64(i/4)
		x := x0 + cellMargin + (sx+r.Float64())*span/4
		z := z0 + cellMargin + (sz+r.Float64())*span/3
		c.cands[i] = w.sampleCand(x, z)
		if c.cands[i].ok {
			land++
		}
	}
	featRoll := r.Float64()
	rangerRoll := r.Float64()
	kindRNG := noise.NewRNG(r.Uint64())
	if land < 3 || featRoll >= featureChance {
		return c
	}

	// Majority region of the usable land decides the table.
	var votes [core.RegionCount]int
	for i := range c.cands {
		if c.cands[i].ok {
			votes[c.cands[i].region]++
		}
	}
	reg := core.RegionGreenhollow
	for i := range votes {
		if votes[i] > votes[reg] {
			reg = core.RegionID(i)
		}
	}

	kind, landmark, site := "", "", -1
	if rangerRoll < rangerChance/featureChance {
		if i := best(c.cands, "ranger_station", ""); i >= 0 {
			kind, site = "ranger_station", i
		}
	}
	if kind == "" {
		// Landmark subtype first, so the landmark only competes if it has a site.
		var lms []weighted
		for _, k := range sortedKeys(landmarkKinds[reg]) {
			if best(c.cands, "landmark", k) >= 0 {
				lms = append(lms, weighted{k, landmarkKinds[reg][k]})
			}
		}
		landmark = roll(&kindRNG, lms)
		var opts []weighted
		for _, k := range sortedKeys(kindWeight[reg]) {
			if k == "landmark" {
				if landmark != "" {
					opts = append(opts, weighted{k, kindWeight[reg][k]})
				}
				continue
			}
			if best(c.cands, k, "") >= 0 {
				opts = append(opts, weighted{k, kindWeight[reg][k]})
			}
		}
		kind = roll(&kindRNG, opts)
		if kind == "" {
			return c
		}
		if kind != "landmark" {
			landmark = ""
		}
		site = best(c.cands, kind, landmark)
	}
	w.placeFeature(c, &kindRNG, kind, landmark, &c.cands[site])
	return c
}

// placeFeature lays out the main feature, its companions and its ground edits.
func (w *World) placeFeature(c *cell, r *noise.RNG, kind, landmark string, s *cand) {
	id := genID(kind, c.cx, c.cz)
	region := s.region
	hidden := false
	switch kind {
	case "hidden_cabin", "viewpoint", "pond":
		hidden = true
	case "camp", "abandoned_station":
		hidden = r.Chance(0.5)
	}
	yaw := s.downYaw
	switch kind {
	case "hide":
		yaw = s.waterYaw
	case "camp", "hidden_cabin", "abandoned_station", "ranger_station":
		yaw = r.Range(0, 2*math.Pi)
	}
	y := s.h
	onPad := false
	if pr, pb := padSpec(kind, landmark); pr > 0 {
		c.ov.pads = append(c.ov.pads, pad{s.x, s.z, pr, pb, y})
		onPad = true
	}
	var data map[string]string
	switch kind {
	case "landmark":
		data = map[string]string{"landmark": landmark}
		switch landmark {
		case "giant_tree":
			c.ov.glades = append(c.ov.glades, circle{s.x, s.z, 13})
			k := core.VegOak
			if region == core.RegionAmberwood {
				k = core.VegAmberOak
			}
			c.special = append(c.special, core.Veg{Kind: k, Variant: uint8(r.Intn(256)), Pos: vec(s.x, y, s.z), Scale: float32(r.Range(2.4, 2.8)), Rot: float32(r.Range(0, 2*math.Pi))})
		case "cairn":
			c.special = append(c.special, core.Veg{Kind: core.VegRock, Variant: uint8(r.Intn(256)), Pos: vec(s.x+4, y, s.z+3), Scale: 1.3, Rot: float32(r.Range(0, 2*math.Pi))})
		case "waterfall_rocks", "frozen_falls":
			for i := 0; i < 5; i++ {
				a := r.Range(0, 2*math.Pi)
				d := r.Range(2.5, 7)
				dx, dz := headingDir(a)
				c.special = append(c.special, core.Veg{Kind: core.VegRock, Variant: uint8(r.Intn(256)), Pos: vec(s.x+dx*d, w.g.height(s.x+dx*d, s.z+dz*d), s.z+dz*d), Scale: float32(r.Range(1.0, 2.0)), Rot: float32(a)})
			}
		}
	case "viewpoint":
		// A rocky outcrop to stand on.
		for i := 0; i < 3; i++ {
			a := yaw + math.Pi + r.Range(-1.2, 1.2)
			d := r.Range(3, 6)
			dx, dz := headingDir(a)
			c.special = append(c.special, core.Veg{Kind: core.VegRock, Variant: uint8(r.Intn(256)), Pos: vec(s.x+dx*d, w.g.height(s.x+dx*d, s.z+dz*d), s.z+dz*d), Scale: float32(r.Range(1.1, 1.8)), Rot: float32(a)})
		}
	case "pond":
		rw := r.Range(7, 11)
		depth := r.Range(1.0, 1.3)
		c.ov.ponds = append(c.ov.ponds, pond{x: s.x, z: s.z, rWater: rw, rRim: rw + 15, depth: depth})
		y = -depth
		onPad = true // the centre height is final: the pond overlay sets it
	}
	main := core.POI{ID: id, Kind: kind, Name: poiName(w.seed, id, kind, landmark, region), Pos: vec(s.x, y, s.z),
		Yaw: float32(yaw), Region: region, Radius: poiRadius(kind), Hidden: hidden, Data: data}
	c.main = len(c.pois)
	c.add(main, onPad)
	if h, rad := structureHeight(kind); h > 0 {
		c.structs = append(c.structs, structure{x: s.x, z: s.z, y: y, height: h, r: rad})
	}

	// Companions sit beside the feature, on its pad when it has one.
	fx, fz := headingDir(yaw)
	side := func(fwd, right float64) (float64, float64) { return s.x + fx*fwd - fz*right, s.z + fz*fwd + fx*right }
	// A companion's region is the one at its own spot (it may straddle a border).
	companion := func(kind string, x, y, z float64, yaw float32, onPad bool) {
		var cs sample
		w.g.sample(x, z, &cs)
		reg := cs.region
		if reg >= core.RegionCount {
			reg = region
		}
		id := genID(kind, c.cx, c.cz)
		c.add(core.POI{ID: id, Kind: kind, Name: poiName(w.seed, id, kind, "", reg), Pos: vec(x, y, z), Yaw: yaw,
			Region: reg, Radius: poiRadius(kind), Data: map[string]string{"region": reg.Key()}}, onPad)
	}
	if kind == "hidden_cabin" || kind == "abandoned_station" {
		x, z := side(1.5, 3.4)
		companion("cache", x, y, z, float32(yaw), true)
	}
	if (kind == "camp" || kind == "hidden_cabin" || kind == "abandoned_station") && r.Chance(0.35) {
		x, z := side(-1.2, -2.2)
		companion("page", x, y, z, 0, true)
	}
	if kind == "landmark" && r.Chance(0.12) {
		x, z := side(-4, 2)
		companion("relic", x, w.g.height(x, z), z, 0, onPad)
	}
}

func (c *cell) add(p core.POI, onPad bool) {
	c.pois = append(c.pois, p)
	c.onPad = append(c.onPad, onPad)
}

// sortedKeys returns map keys in a fixed order (Go map iteration is random, and
// every roll must be deterministic).
func sortedKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}
