package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Vertex colours (sRGB 0..255). Stylised and warm: each region type has its own
// palette built from the smooth woodland fields (so meadows, pine stands and
// thickets read as soft colour fields rather than hard patches), the region
// palettes are blended by the region weights, then shoreline, rock, trails and
// pads are layered on top, and finally a gentle two-scale noise breaks up flat
// areas like a painted texture would.
var (
	cWoodG     = rgb{92, 138, 60}   // Greenhollow woodland floor: moss and leaf litter
	cMeadowG   = rgb{138, 176, 76}  // sunny meadow grass
	cPineFloor = rgb{90, 108, 62}   // needle-strewn floor
	cThicketG  = rgb{74, 116, 52}   // deep shrub green
	cFernG     = rgb{66, 112, 64}   // damp fern hollow
	cAmber     = rgb{186, 118, 56}  // Amberwood leaf litter
	cAmberRust = rgb{164, 86, 46}   // rust drifts
	cAmberGold = rgb{206, 164, 80}  // golden clearings
	cAmberPine = rgb{136, 100, 62}  // brown needle floor
	cMarsh     = rgb{118, 126, 66}  // olive reed flats
	cMarshMud  = rgb{100, 86, 58}   // wet mud
	cMarshDry  = rgb{120, 146, 72}  // hummock grass
	cAlpine    = rgb{134, 144, 98}  // high grass
	cRock      = rgb{132, 124, 112} // grey-brown rock
	cRockDark  = rgb{106, 100, 92}
	cPeakSnow  = rgb{234, 238, 244}
	cCoast     = rgb{146, 166, 94}  // salt-wind grass
	cSand      = rgb{228, 210, 160} // beach sand
	cDune      = rgb{214, 198, 144}
	cCliff     = rgb{150, 140, 124}
	cSnow      = rgb{238, 242, 248}
	cSnowBlue  = rgb{188, 206, 232} // snow in shadow / on slopes
	cSnowPine  = rgb{206, 218, 232}
	cIce       = rgb{196, 222, 240}
	cEarth     = rgb{156, 122, 84} // trodden trail
	cYard      = rgb{146, 120, 88} // trodden pads
	cDamp      = rgb{92, 80, 60}   // damp earth at the water's edge
	cBed       = rgb{104, 100, 78} // stream / pond bed
	cSeaBed    = rgb{178, 166, 126}
)

// regionColor is a region type's ground colour before the shared layers.
func (g *gen) regionColor(reg core.RegionID, x, z, h, slope float64, s *sample) rgb {
	switch reg {
	case core.RegionGreenhollow:
		c := cWoodG
		c = c.mix(cPineFloor, smoothstep(0.12, 0.45, s.conifer)*(1-s.hMeadow))
		c = c.mix(cThicketG, smoothstep(0.3, 0.6, s.thicket)*0.8)
		c = c.mix(cMeadowG, math.Max(smoothstep(0.32, 0.62, s.clear), s.hMeadow))
		c = c.mix(cPineFloor, s.hPine*0.8)
		return c.mix(cFernG, s.hFern)
	case core.RegionAmberwood:
		c := cAmber
		c = c.mix(cAmberRust, smoothstep(-0.1, 0.45, g.n[lColor].Eval(x/61+17, z/61-4))*0.7)
		c = c.mix(cAmberPine, smoothstep(0.4, 0.75, s.conifer))
		return c.mix(cAmberGold, smoothstep(0.32, 0.62, s.clear))
	case core.RegionMurmurMarsh:
		c := cMarsh.mix(cMarshMud, 1-smoothstep(0.05, 0.5, h))
		return c.mix(cMarshDry, smoothstep(1.0, 1.8, h))
	case core.RegionWindpeak:
		c := cAlpine.mix(cPineFloor, smoothstep(0.05, 0.3, s.conifer)*(1-smoothstep(60, 85, h)))
		c = c.mix(cRock, math.Max(smoothstep(70, 150, h)*0.75, s.rock*0.85))
		return c.mix(cPeakSnow, smoothstep(178, 215, h+12*g.n[lGrain].Eval(x/40, z/40))*(1-smoothstep(0.9, 1.3, slope)))
	case core.RegionWhisperingCoast:
		c := cCoast.mix(cDune, smoothstep(140, 60, s.seaDist)*(1-s.cliffy)*0.6)
		return c.mix(cThicketG, smoothstep(0.35, 0.65, s.thicket)*0.5)
	case core.RegionFrostveil:
		c := cSnow.mix(cSnowBlue, smoothstep(0.12, 0.5, slope))
		return c.mix(cSnowPine, smoothstep(0.2, 0.5, s.conifer)*0.6)
	}
	return cSeaBed
}

// vertexColor is the final colour of a vertex.
func (g *gen) vertexColor(x, z, h, slope float64, hab core.Habitat, s *sample, r *ovResult) [3]uint8 {
	var c rgb
	tot := 0.0
	for i := core.RegionID(0); i < core.RegionCount; i++ {
		if wt := s.w[i]; wt > 0.004 {
			c = c.add(g.regionColor(i, x, z, h, slope, s), wt)
			tot += wt
		}
	}
	if tot > 0 {
		c = c.scale(1 / tot)
	} else {
		c = cSeaBed
	}
	frost := s.w[core.RegionFrostveil]

	// Beaches: sand along gentle shores.
	if s.seaDist < 110 {
		k := smoothstep(100, 55, s.seaDist) * (1 - smoothstep(0.25, 0.6, s.cliffy)) * (1 - smoothstep(0.35, 0.6, slope))
		if s.seaDist < 14 {
			k = math.Max(k, 1-smoothstep(0.45, 0.8, slope))
		}
		c = c.mix(cSand, k*(1-frost))
	}
	// Bare rock on steep ground and outcrops.
	rockC := cRock.mix(cRockDark, 0.5+0.5*g.n[lGrain].Eval(x/17, z/17))
	if s.cliffy > 0.3 && s.seaDist < 60 {
		rockC = cCliff
	}
	if frost > 0.5 {
		rockC = rockC.mix(cSnowBlue, 0.35)
	}
	c = c.mix(rockC, math.Max(smoothstep(0.6, 0.95, slope), s.rock*0.7*(1-frost*0.5)))
	// The water's edge: darker damp earth, then the bed below the surface.
	if s.ice > 0.5 {
		c = c.mix(cIce, smoothstep(0.5, 0.8, s.ice))
	} else {
		damp := (1 - smoothstep(0.15, 0.85, h)) * (1 - frost)
		bed := cBed
		if s.seaDist < 40 || s.sea {
			bed = cSeaBed
			damp *= 0.4 // sand is damp too, but stays light
		}
		c = c.mix(cDamp, damp*0.75)
		if h < 0 {
			c = c.mix(bed, smoothstep(0, -0.8, h)).scale(1 - 0.25*smoothstep(-0.5, -6, h))
		}
	}
	// Trails and pads.
	if r.trail > 0 {
		earth := cEarth
		if frost > 0.5 {
			earth = cEarth.mix(cSnowBlue, 0.45) // trodden snow
		}
		c = c.mix(earth, 0.85*r.trail)
	}
	if r.hidden > 0 {
		c = c.mix(cEarth, 0.22*r.hidden)
	}
	if r.pad > 0 {
		c = c.mix(cYard, 0.7*r.pad*(1-frost*0.5))
	}
	// Painterly variation: a broad brightness wash and a fine hue shimmer.
	n1 := g.n[lColor].Eval(x/27, z/27)
	n2 := g.n[lGrain].Eval(x/7.5, z/7.5)
	c = c.scale(1 + 0.065*n1 + 0.03*n2)
	if hab == core.HabMeadow || hab == core.HabWoodland {
		c = c.mix(rgb{c.r * 1.08, c.g * 1.04, c.b * 0.86}, 0.5+0.5*n2)
	}
	return [3]uint8{to8(c.r), to8(c.g), to8(c.b)}
}
