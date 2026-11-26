package world

import (
	"fmt"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Forage plants (contract §12): VegKinds 18-35, placed per chunk like the rest of
// the vegetation, in natural clusters on fitting ground - a handful in a
// suitable chunk, none in many. They come after all other vegetation in a
// chunk's list (sweet chestnuts excepted: they are trees, grown in the tree
// pass), and a plant's id "fg@<cx>,<cz>,<n>" (n = its index in the LOD-0
// vegetation list) is a pure function of the seed. The home valley additionally holds one guaranteed
// patch of each everyday plant near the place it naturally belongs.

// forageRule is a forage kind's placement: the region types and habitats it may
// grow in (the hard limits, also checked by the tests), its clearance from tree
// trunks, cluster size and spread, and scale range.
type forageRule struct {
	regions  uint8  // bit per core.RegionID
	habitats uint16 // bit per core.Habitat
	clear    float64
	cluster  [2]int
	spread   float64
	scale    [2]float64
	weight   float64 // how readily a suitable spot starts a cluster of this kind
}

func regs(rs ...core.RegionID) uint8 {
	var m uint8
	for _, r := range rs {
		m |= 1 << r
	}
	return m
}

func habs(hs ...core.Habitat) uint16 {
	var m uint16
	for _, h := range hs {
		m |= 1 << h
	}
	return m
}

var (
	rG, rA, rM, rW, rC, rF = core.RegionGreenhollow, core.RegionAmberwood, core.RegionMurmurMarsh, core.RegionWindpeak, core.RegionWhisperingCoast, core.RegionFrostveil
	hWood, hConi, hShrub   = core.HabWoodland, core.HabConifer, core.HabShrub
	hMead, hRiver, hMarsh  = core.HabMeadow, core.HabRiver, core.HabMarsh
	hBeach, hAlp, hSnow    = core.HabBeach, core.HabAlpine, core.HabSnow
)

var forageRules = [core.VegKindCount]forageRule{
	core.VegBramble:      {regions: regs(rG, rA, rC), habitats: habs(hWood, hMead, hShrub), clear: 1.8, cluster: [2]int{1, 3}, spread: 4, scale: [2]float64{0.8, 1.3}, weight: 1},
	core.VegStrawberry:   {regions: regs(rG, rA), habitats: habs(hMead, hWood, hRiver), clear: 1.0, cluster: [2]int{2, 4}, spread: 3, scale: [2]float64{0.8, 1.2}, weight: 0.9},
	core.VegBilberry:     {regions: regs(rG, rA, rW, rF), habitats: habs(hConi, hAlp), clear: 1.0, cluster: [2]int{2, 4}, spread: 3.5, scale: [2]float64{0.8, 1.25}, weight: 1},
	core.VegElder:        {regions: regs(rG, rA, rM), habitats: habs(hWood, hMead, hShrub, hRiver), clear: 2.4, cluster: [2]int{1, 2}, spread: 5, scale: [2]float64{0.8, 1.2}, weight: 0.7},
	core.VegDogRose:      {regions: regs(rG, rA, rC), habitats: habs(hMead, hShrub, hWood, hBeach), clear: 1.8, cluster: [2]int{1, 2}, spread: 4, scale: [2]float64{0.8, 1.2}, weight: 0.7},
	core.VegHazel:        {regions: regs(rG, rA), habitats: habs(hWood, hShrub), clear: 2.4, cluster: [2]int{1, 2}, spread: 5, scale: [2]float64{0.8, 1.2}, weight: 0.8},
	core.VegChestnut:     {regions: regs(rA), habitats: habs(hWood), clear: 4.2, cluster: [2]int{1, 1}, spread: 0, scale: [2]float64{0.85, 1.2}, weight: 0},
	core.VegNettle:       {regions: regs(rG, rA, rM), habitats: habs(hWood, hShrub, hRiver, hMead), clear: 1.0, cluster: [2]int{2, 4}, spread: 3, scale: [2]float64{0.8, 1.25}, weight: 0.9},
	core.VegWildGarlic:   {regions: regs(rG, rA), habitats: habs(hWood, hShrub, hRiver), clear: 1.0, cluster: [2]int{2, 4}, spread: 3.5, scale: [2]float64{0.8, 1.3}, weight: 0.9},
	core.VegWaterMint:    {regions: regs(rG, rA, rM), habitats: habs(hRiver, hMarsh, hWood, hShrub, hMead), clear: 1.0, cluster: [2]int{2, 3}, spread: 2.5, scale: [2]float64{0.8, 1.2}, weight: 1.2},
	core.VegChamomile:    {regions: regs(rG, rA, rC), habitats: habs(hMead), clear: 1.0, cluster: [2]int{2, 4}, spread: 3.5, scale: [2]float64{0.8, 1.2}, weight: 0.9},
	core.VegYoungPine:    {regions: regs(rG, rA, rW), habitats: habs(hConi, hAlp), clear: 2.0, cluster: [2]int{1, 3}, spread: 5, scale: [2]float64{0.8, 1.25}, weight: 0.8},
	core.VegChanterelle:  {regions: regs(rG, rA), habitats: habs(hWood, hConi), clear: 0.9, cluster: [2]int{2, 4}, spread: 2.5, scale: [2]float64{0.8, 1.2}, weight: 0.8},
	core.VegPorcini:      {regions: regs(rG, rA), habitats: habs(hWood, hConi), clear: 0.9, cluster: [2]int{1, 3}, spread: 2.5, scale: [2]float64{0.8, 1.25}, weight: 0.6},
	core.VegSeaBuckthorn: {regions: regs(rC), habitats: habs(hBeach, hShrub, hMead), clear: 1.8, cluster: [2]int{1, 3}, spread: 4, scale: [2]float64{0.8, 1.25}, weight: 1},
	core.VegSamphire:     {regions: regs(rC, rM), habitats: habs(hBeach, hRiver, hMarsh), clear: 1.0, cluster: [2]int{2, 4}, spread: 3, scale: [2]float64{0.8, 1.2}, weight: 1},
	core.VegCloudberry:   {regions: regs(rF), habitats: habs(hSnow, hConi), clear: 1.0, cluster: [2]int{2, 4}, spread: 3.5, scale: [2]float64{0.8, 1.2}, weight: 1},
	core.VegWildThyme:    {regions: regs(rW), habitats: habs(hAlp), clear: 1.0, cluster: [2]int{2, 4}, spread: 3, scale: [2]float64{0.8, 1.2}, weight: 1},
}

// isForage reports whether k is a forage plant kind.
func isForage(k core.VegKind) bool { return k >= core.FirstForageKind && k < core.VegKindCount }

// forageAllowed is the hard rule: region type and habitat (the tests check it).
func forageAllowed(k core.VegKind, reg core.RegionID, hab core.Habitat) bool {
	if !isForage(k) || reg >= core.RegionCount {
		return false
	}
	r := &forageRules[k]
	return r.regions&(1<<reg) != 0 && r.habitats&(1<<hab) != 0
}

// forageCtx is what a suitability test knows about the surroundings.
type forageCtx struct {
	nearStruct bool // within ~30 m of a building or structure (rich, disturbed ground)
}

// forageSuit is how well a vertex suits a forage kind (0 = never here): the
// region/habitat limits plus the plant's own preferences - damp ground, edges,
// sunny banks, the water's edge.
func forageSuit(k core.VegKind, v *gvert, h float64, fc forageCtx) float64 {
	reg, hab := core.RegionID(v.reg), core.Habitat(v.hab)
	if !forageAllowed(k, reg, hab) {
		return 0
	}
	// Never on trails, pads, water, ice or cliffs.
	if h < 0.06 || v.flags&(vfSea|vfIce) != 0 || v.keep > 0.2 || v.trail > 0 || v.htrail > 0.05 || v.slope > 0.9 {
		return 0
	}
	clear, thicket, conifer := float64(v.clear), float64(v.thicket), float64(v.conifer)
	near := func(d float64) bool { return float64(v.riverD) < d && h < 5 }
	damp := near(28) || v.pond > 0 || v.fern > 0.15
	edge := smoothstep(0.12, 0.42, clear) * (1 - smoothstep(0.62, 0.8, clear))
	switch k {
	case core.VegBramble:
		switch hab {
		case hShrub:
			return 0.8
		case hWood:
			return math.Max(edge, 0.7*smoothstep(0.15, 0.45, thicket))
		case hMead:
			if reg == rC {
				return 0.35 * smoothstep(0, 0.3, thicket)
			}
			return 0.6 * (1 - smoothstep(0.55, 0.8, clear)) * (1 - 0.6*float64(v.meadow))
		}
	case core.VegStrawberry:
		sunnyBank := 0.3 * smoothstep(0.08, 0.3, float64(v.slope))
		switch hab {
		case hMead:
			return 0.55 + sunnyBank
		case hWood:
			return smoothstep(0.2, 0.45, clear)*0.6 + sunnyBank
		case hRiver:
			if h > 0.9 {
				return 0.3 + sunnyBank
			}
		}
	case core.VegBilberry:
		switch {
		case hab == hConi && reg == rF:
			return 0.25
		case hab == hConi:
			return 0.8
		case hab == hAlp && h < 140 && v.rock < 0.5 && v.slope < 0.6:
			return 0.5
		}
	case core.VegElder:
		s := 0.0
		switch hab {
		case hWood:
			s = 0.45 * edge
		case hShrub:
			s = 0.45
		case hMead:
			s = 0.25 * (1 - smoothstep(0.6, 0.85, clear))
		case hRiver:
			if h > 0.8 {
				s = 0.35
			}
		}
		if reg == rM && hab != hShrub && hab != hMead {
			s = 0
		}
		if fc.nearStruct && (hab != hRiver || h > 0.8) {
			s = math.Max(s, 0.9)
		}
		return s
	case core.VegDogRose:
		if reg == rC {
			switch hab {
			case hBeach:
				if v.seaDist > 25 {
					return 0.4
				}
			case hShrub:
				return 0.6
			case hMead:
				return 0.35
			}
			return 0
		}
		switch hab {
		case hShrub:
			return 0.6
		case hMead:
			return 0.4 * (1 - smoothstep(0.6, 0.85, clear))
		case hWood:
			return 0.5 * edge
		}
	case core.VegHazel:
		if conifer > 0.25 {
			return 0
		}
		if hab == hShrub {
			return 0.5
		}
		return 0.55 * (1 - smoothstep(0.3, 0.55, clear))
	case core.VegChestnut:
		return 0.6 * (1 - smoothstep(0.25, 0.45, clear)) * (1 - smoothstep(0.3, 0.6, conifer))
	case core.VegNettle:
		if !(damp || fc.nearStruct) {
			return 0
		}
		if reg == rM && hab != hShrub && hab != hMead {
			return 0
		}
		if hab == hRiver && h < 0.6 {
			return 0
		}
		return 0.75
	case core.VegWildGarlic:
		if !damp || (hab == hRiver && h < 0.6) {
			return 0
		}
		return 0.8 * (1 - smoothstep(0.4, 0.6, clear))
	case core.VegWaterMint:
		if h > 0.75 || !(near(12) || v.pond > 0 || reg == rM) {
			return 0
		}
		return 0.9
	case core.VegChamomile:
		if reg == rC && v.seaDist < 40 {
			return 0
		}
		return 0.55 + 0.45*float64(v.meadow)
	case core.VegYoungPine:
		if hab == hAlp {
			if h < 110 && v.rock < 0.5 {
				return 0.3
			}
			return 0
		}
		return 0.55 + 0.3*smoothstep(0, 0.4, clear)
	case core.VegChanterelle:
		if hab == hWood {
			return 0.45 + 0.2*smoothstep(-0.2, 0.3, conifer)
		}
		return 0.5
	case core.VegPorcini:
		if hab == hWood {
			if reg == rA {
				return 0.65
			}
			return 0.4
		}
		return 0.3
	case core.VegSeaBuckthorn:
		switch hab {
		case hBeach:
			if v.seaDist > 20 && v.seaDist < 100 {
				return 0.7
			}
		case hShrub:
			return 0.6
		case hMead:
			if v.seaDist < 80 {
				return 0.4
			}
		}
	case core.VegSamphire:
		if reg == rC && ((hab == hBeach && h < 1.4 && v.seaDist < 70) || (hab == hRiver && h < 0.8)) {
			return 0.8
		}
		if h > 0.6 {
			return 0
		}
		if reg == rM && hab == hMarsh && v.seaDist < 300 && h < 0.5 {
			return 0.6
		}
	case core.VegCloudberry:
		// Bogs: flat, wet ground on the plateaus.
		if v.slope < 0.1 {
			return 0.6
		}
	case core.VegWildThyme:
		if v.slope > 0.18 && v.slope < 0.8 && v.rock < 0.6 && h < 170 {
			return 0.7
		}
	}
	return 0
}

// Forage placement per chunk: a 2x2 lattice of candidate cluster centres.
const (
	forageLattice  = 2
	forageChance   = 0.34 // chance a well-suited centre starts a cluster
	forageMinSpace = 0.9  // between two plants
	forageHomeKeep = 2.6  // trees keep this far from guaranteed home patches
)

// forageKinds lists the forage kinds in order.
var forageKinds = func() []core.VegKind {
	var out []core.VegKind
	for k := core.FirstForageKind; k < core.VegKindCount; k++ {
		out = append(out, k)
	}
	return out
}()

// chunkStructs returns the structures (home and generated) that may be near a
// chunk, for the "near buildings" preferences.
func (w *World) chunkStructs(cx, cz int) []structure {
	bx, bz := float64(cx*core.ChunkSize), float64(cz*core.ChunkSize)
	var out []structure
	near := func(s *structure) bool {
		return s.x > bx-40 && s.x < bx+core.ChunkSize+40 && s.z > bz-40 && s.z < bz+core.ChunkSize+40
	}
	for i := range w.hl.structs {
		if near(&w.hl.structs[i]) {
			out = append(out, w.hl.structs[i])
		}
	}
	for dz := -1; dz <= 1; dz++ {
		for dx := -1; dx <= 1; dx++ {
			c := w.cell(cellOf(bx+32)+dx, cellOf(bz+32)+dz)
			for i := range c.structs {
				if near(&c.structs[i]) {
					out = append(out, c.structs[i])
				}
			}
		}
	}
	return out
}

func nearStructure(structs []structure, x, z float64) bool {
	for i := range structs {
		d := hypot(structs[i].x-x, structs[i].z-z) - structs[i].r
		if d > 4 && d < 30 {
			return true
		}
	}
	return false
}

// placeForage appends the chunk's forage plants to vs: first the guaranteed
// home patches that fall in it, then natural clusters.
func (w *World) placeForage(cx, cz int, gr *grid, vs *vegSet, home []core.Veg) {
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0xf0a6e5, int64(cx), int64(cz)))
	bx, bz := float64(cx*core.ChunkSize), float64(cz*core.ChunkSize)
	first := len(vs.veg)
	for _, v := range home {
		if chunkOf(float64(v.Pos.X)) == cx && chunkOf(float64(v.Pos.Z)) == cz {
			vs.veg = append(vs.veg, v)
			vs.lod = append(vs.lod, vegLOD(v.Kind))
		}
	}
	structs := w.chunkStructs(cx, cz)
	// fits reports whether a plant of kind k may stand at (x, z): suitable ground,
	// inside the chunk far enough from the border that neighbouring trees cannot
	// crowd it, clear of trunks, bushes, rocks and other forage plants.
	fits := func(k core.VegKind, x, z float64) (float64, bool) {
		rule := &forageRules[k]
		m := math.Max(0.6, rule.clear-0.5)
		if x < bx+m || x > bx+core.ChunkSize-m || z < bz+m || z > bz+core.ChunkSize-m {
			return 0, false
		}
		fx, fz := gr.local(x, z)
		v := &gr.v[gr.nearest(fx, fz)]
		h := gr.heightAt(fx, fz)
		if forageSuit(k, v, h, forageCtx{nearStruct: nearStructure(structs, x, z)}) <= 0 {
			return 0, false
		}
		for i := range vs.veg {
			o := &vs.veg[i]
			var need float64
			switch {
			case o.Kind.IsTree():
				need = rule.clear * math.Max(1, float64(o.Scale))
			case isForage(o.Kind) && i >= first:
				need = math.Max(forageMinSpace, 0.5*(rule.clear+forageRules[o.Kind].clear))
			case o.Kind == core.VegShrub || o.Kind == core.VegRock || o.Kind == core.VegLog || o.Kind == core.VegStump:
				need = 1.1 * math.Max(1, float64(o.Scale))
			default:
				continue
			}
			if dx, dz := float64(o.Pos.X)-x, float64(o.Pos.Z)-z; dx*dx+dz*dz < need*need {
				return 0, false
			}
		}
		return h, true
	}
	cs := core.ChunkSize / float64(forageLattice)
	var weights [core.VegKindCount]float64
	for j := 0; j < forageLattice; j++ {
		for i := 0; i < forageLattice; i++ {
			x := bx + (float64(i)+r.Range(0.12, 0.88))*cs
			z := bz + (float64(j)+r.Range(0.12, 0.88))*cs
			roll, pick := r.Float64(), r.Float64()
			sub := noise.NewRNG(r.Uint64())
			fx, fz := gr.local(x, z)
			v := &gr.v[gr.nearest(fx, fz)]
			h := gr.heightAt(fx, fz)
			fc := forageCtx{nearStruct: nearStructure(structs, x, z)}
			total, best := 0.0, 0.0
			for _, k := range forageKinds {
				s := forageSuit(k, v, h, fc) * forageRules[k].weight
				weights[k] = s
				total += s
				best = math.Max(best, s)
			}
			if total <= 0 || roll >= forageChance*math.Min(1, best/0.6) {
				continue
			}
			// Choose the kind in proportion to how well each suits the spot.
			u := pick * total
			k := forageKinds[len(forageKinds)-1]
			for _, kk := range forageKinds {
				if u < weights[kk] {
					k = kk
					break
				}
				u -= weights[kk]
			}
			w.cluster(k, x, z, &sub, vs, fits)
		}
	}
}

// cluster plants a natural group of kind k around (x, z).
func (w *World) cluster(k core.VegKind, x, z float64, r *noise.RNG, vs *vegSet, fits func(core.VegKind, float64, float64) (float64, bool)) int {
	rule := &forageRules[k]
	n := rule.cluster[0] + r.Intn(rule.cluster[1]-rule.cluster[0]+1)
	placed := 0
	for p := 0; p < n; p++ {
		for try := 0; try < 5; try++ {
			px, pz := x, z
			if p > 0 || try > 0 {
				a, d := r.Range(0, 2*math.Pi), rule.spread*math.Sqrt(r.Float64())
				px, pz = x+math.Sin(a)*d, z-math.Cos(a)*d
			}
			if h, ok := fits(k, px, pz); ok {
				vs.veg = append(vs.veg, core.Veg{Kind: k, Variant: uint8(r.Intn(252)), Pos: vec(px, h, pz),
					Scale: float32(r.Range(rule.scale[0], rule.scale[1])), Rot: quantRot(r.Range(0, 2*math.Pi))})
				vs.lod = append(vs.lod, vegLOD(k))
				placed++
				break
			}
		}
	}
	return placed
}

// --- The home valley's guaranteed patches -------------------------------------

// homePatch says where in the home valley each everyday plant is looked for:
// near which place and at what distance from it.
type homePatch struct {
	kind   core.VegKind
	anchor string // home POI id
	lo, hi float64
}

var homePatches = []homePatch{
	{core.VegChamomile, "meadow_clearing", 0, 45},
	{core.VegStrawberry, "meadow_clearing", 40, 75},
	{core.VegBramble, "meadow_clearing", 50, 95},
	{core.VegElder, "cabin", 12, 45},
	{core.VegHazel, "woodland_entrance", 12, 80},
	{core.VegNettle, "fern_valley", 8, 50},
	{core.VegWildGarlic, "fern_valley", 0, 50},
	{core.VegWaterMint, "creekside", 3, 70},
	{core.VegYoungPine, "camp_survey", 8, 55},
	{core.VegChanterelle, "old_oak", 16, 70},
}

// homeForageMax is how far from the cabin a guaranteed patch may lie.
const homeForageMax = 380.0

// homeForage returns the guaranteed home patches (computed once per world).
func (w *World) homeForage() []core.Veg {
	w.homeForageOnce.Do(func() { w.homeForageVeg = w.buildHomeForage() })
	return w.homeForageVeg
}

func (w *World) buildHomeForage() []core.Veg {
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0x40e5f0, 7, 11))
	cabin, _ := w.POI("cabin")
	var out []core.Veg
	spot := func(k core.VegKind, x, z float64) (float64, bool) {
		if hypot(x-float64(cabin.Pos.X), z-float64(cabin.Pos.Z)) > homeForageMax {
			return 0, false
		}
		cx, cz := chunkOf(x), chunkOf(z)
		rule := &forageRules[k]
		m := math.Max(0.6, rule.clear-0.5)
		lx, lz := x-float64(cx*core.ChunkSize), z-float64(cz*core.ChunkSize)
		if lx < m || lz < m || lx > core.ChunkSize-m || lz > core.ChunkSize-m {
			return 0, false
		}
		gr := w.grid(cx, cz)
		fx, fz := gr.local(x, z)
		v := &gr.v[gr.nearest(fx, fz)]
		h := gr.heightAt(fx, fz)
		if forageSuit(k, v, h, forageCtx{nearStruct: nearStructure(w.chunkStructs(cx, cz), x, z)}) <= 0 {
			return 0, false
		}
		for _, o := range out {
			if hypot(float64(o.Pos.X)-x, float64(o.Pos.Z)-z) < 1.2*rule.clear+0.5 {
				return 0, false
			}
		}
		// Keep clear of the structures themselves.
		for _, s := range w.hl.structs {
			if hypot(s.x-x, s.z-z) < s.r+4 {
				return 0, false
			}
		}
		return h, true
	}
	for _, hp := range homePatches {
		a, ok := w.POI(hp.anchor)
		if !ok {
			continue
		}
		ax, az := float64(a.Pos.X), float64(a.Pos.Z)
		lo, hi := hp.lo, hp.hi
		found := false
		var sx, sz, sy float64
		for try := 0; try < 900 && !found; try++ {
			if try == 300 {
				lo, hi = 0, 180 // widen the search around the anchor
			} else if try == 600 {
				ax, az, lo, hi = float64(cabin.Pos.X), float64(cabin.Pos.Z), 0, homeForageMax
			}
			ang, d := r.Range(0, 2*math.Pi), lo+(hi-lo)*math.Sqrt(r.Float64())
			sx, sz = ax+math.Sin(ang)*d, az-math.Cos(ang)*d
			sy, found = spot(hp.kind, sx, sz)
		}
		if !found {
			continue
		}
		rule := &forageRules[hp.kind]
		n := max(2, rule.cluster[1]-1)
		if rule.cluster[1] <= 2 {
			n = rule.cluster[1]
		}
		for p := 0; p < n; p++ {
			px, pz, py := sx, sz, sy
			if p > 0 {
				ok := false
				for try := 0; try < 8 && !ok; try++ {
					ang, d := r.Range(0, 2*math.Pi), r.Range(1.2, math.Max(2, rule.spread))
					px, pz = sx+math.Sin(ang)*d, sz-math.Cos(ang)*d
					py, ok = spot(hp.kind, px, pz)
				}
				if !ok {
					continue
				}
			}
			out = append(out, core.Veg{Kind: hp.kind, Variant: uint8(r.Intn(252)), Pos: vec(px, py, pz),
				Scale: float32(r.Range(rule.scale[0], rule.scale[1])), Rot: quantRot(r.Range(0, 2*math.Pi))})
		}
	}
	return out
}

// nearHomeForage reports whether (x, z) is within d of a guaranteed home patch.
func nearHomeForage(home []core.Veg, x, z, d float64) bool {
	for i := range home {
		if dx, dz := float64(home[i].Pos.X)-x, float64(home[i].Pos.Z)-z; dx*dx+dz*dz < d*d {
			return true
		}
	}
	return false
}

// --- Lookup ----------------------------------------------------------------------

// ForageID is the id of the forage plant at index n of chunk (cx, cz)'s LOD-0
// vegetation list (contract §12, proto.ForageMsg).
func ForageID(cx, cz, n int) string { return fmt.Sprintf("fg@%d,%d,%d", cx, cz, n) }

// ForageAt resolves a forage plant id "fg@<cx>,<cz>,<n>" to its vegetation
// record. ok is false for a malformed id, an index out of range or a record that
// is not a forage plant.
func (w *World) ForageAt(id string) (core.Veg, bool) {
	var cx, cz, n int
	if c, err := fmt.Sscanf(id, "fg@%d,%d,%d", &cx, &cz, &n); c != 3 || err != nil || ForageID(cx, cz, n) != id {
		return core.Veg{}, false
	}
	vs := w.vegetation(cx, cz)
	if n < 0 || n >= len(vs.veg) || !isForage(vs.veg[n].Kind) {
		return core.Veg{}, false
	}
	return vs.veg[n], true
}

// ForagePlant is a forage plant with its id.
type ForagePlant struct {
	ID  string
	Veg core.Veg
}

// ForageNear returns every forage plant within r (XZ) of (x, z), chunk by chunk
// in vegetation-list order.
func (w *World) ForageNear(x, z, r float32) []ForagePlant {
	fx, fz, rr := float64(x), float64(z), float64(r)
	var out []ForagePlant
	for cz := chunkOf(fz - rr); cz <= chunkOf(fz+rr); cz++ {
		for cx := chunkOf(fx - rr); cx <= chunkOf(fx+rr); cx++ {
			vs := w.vegetation(cx, cz)
			for i := range vs.veg {
				v := &vs.veg[i]
				if !isForage(v.Kind) {
					continue
				}
				if dx, dz := float64(v.Pos.X)-fx, float64(v.Pos.Z)-fz; dx*dx+dz*dz <= rr*rr {
					out = append(out, ForagePlant{ID: ForageID(cx, cz, i), Veg: *v})
				}
			}
		}
	}
	return out
}

// quantRot snaps a rotation to the 16-bit wire value (contract §2.3) so the
// server's perches and the client's drawing use exactly the same angle.
func quantRot(a float64) float32 {
	a = math.Mod(a, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	q := math.Mod(math.Round(a/(2*math.Pi)*65535), 65535)
	return float32(q / 65535 * 2 * math.Pi)
}
