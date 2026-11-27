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
	cMarsh     = rgb{146, 136, 70}  // ochre-olive reed flats
	cMarshTeal = rgb{100, 124, 88}  // damp sedge, a cool teal-green
	cMarshMud  = rgb{84, 70, 48}    // wet mud
	cMarshDry  = rgb{122, 136, 70}  // hummock grass
	cAlpine    = rgb{128, 138, 90}  // high, wind-cropped grass
	cRock      = rgb{132, 124, 112} // grey-brown rock
	cRockDark  = rgb{106, 100, 92}
	cRockHigh  = rgb{128, 124, 136} // Windpeak: grey-violet stone
	cRockHighD = rgb{98, 94, 110}
	cPeakSnow  = rgb{234, 238, 244}
	cCoast     = rgb{132, 154, 102} // salt-wind grass, blue-green
	cSand      = rgb{228, 210, 160} // beach sand
	cDune      = rgb{214, 198, 144}
	cCliff     = rgb{176, 168, 150} // pale banded sea cliff
	cSnow      = rgb{238, 242, 248}
	cSnowBlue  = rgb{188, 206, 232} // snow in shadow / on slopes
	cSnowPine  = rgb{206, 218, 232}
	cIce       = rgb{196, 222, 240}
	cEarth     = rgb{156, 122, 84} // trodden trail
	cYard      = rgb{146, 120, 88} // trodden pads
	cDamp      = rgb{96, 84, 54}   // damp earth up the bank
	cEarthBank = rgb{110, 102, 62} // mossy loam on steep earth banks
	cWetEarth  = rgb{70, 54, 36}   // dark, rich wet loam right at the water line
	cWetSand   = rgb{176, 156, 116} // wet sand at the sea's edge
	cBed       = rgb{112, 94, 64}  // stream / pond bed: warm brown gravel
	cBedDeep   = rgb{66, 72, 54}   // deeper bed: dark, a little weedy
	cSeaBed    = rgb{178, 166, 126}
	cWarmWash  = rgb{1.1, 1.03, 0.8} // multipliers for the large-scale colour drift
	cCoolWash  = rgb{0.86, 1.0, 1.06}
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
		// Ochre reed flats and teal-green sedge in broad drifts, mud at the water.
		c := cMarsh.mix(cMarshTeal, smoothstep(-0.25, 0.35, g.n[lColor].Eval(x/57+23, z/57-11))*0.6)
		c = c.mix(cMarshMud, 1-smoothstep(0.05, 0.5, h))
		return c.mix(cMarshDry, smoothstep(1.0, 1.8, h))
	case core.RegionWindpeak:
		rock := cRockHigh.mix(cRockHighD, 0.5+0.5*g.n[lGrain].Eval(x/23, z/23))
		c := cAlpine.mix(cPineFloor, smoothstep(0.05, 0.3, s.conifer)*(1-smoothstep(60, 85, h)))
		c = c.mix(rock, math.Max(smoothstep(70, 150, h)*0.75, s.rock*0.85))
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
	if hi := s.w[core.RegionWindpeak]; hi > 0 {
		rockC = rockC.mix(cRockHigh.mix(cRockHighD, 0.5+0.5*g.n[lGrain].Eval(x/17, z/17)), hi)
	}
	if frost > 0.5 {
		rockC = rockC.mix(cSnowBlue, 0.35)
	}
	// In the lowland forests and the marsh a steep slope that is not an outcrop
	// is an earth bank (pond rims, creek banks, hollows): mossy loam, not rock.
	soft := (s.w[core.RegionGreenhollow] + s.w[core.RegionAmberwood] + s.w[core.RegionMurmurMarsh]) * (1 - smoothstep(0.2, 0.5, s.rock))
	steep := rockC.mix(cEarthBank, soft*0.85)
	c = c.mix(steep, smoothstep(0.6, 0.95, slope))
	c = c.mix(rockC, s.rock*0.7*(1-frost*0.5))
	// The water's edge: damp earth fading up the bank, dark wet loam (or wet
	// sand) at the water line, then the bed below the surface - warm gravel in
	// the shallows, darker and a little weedy deeper down.
	if s.ice > 0.5 {
		c = c.mix(cIce, smoothstep(0.5, 0.8, s.ice))
	} else {
		sandy := 0.0
		if s.seaDist < 40 || s.sea {
			sandy = 1 - smoothstep(25, 40, s.seaDist)
			if s.sea {
				sandy = 1
			}
		}
		sandy *= 1 - smoothstep(0.3, 0.6, slope) // steep banks stay earthen
		damp := (1 - smoothstep(0.2, 1.1, h)) * (1 - frost)
		wet := (1 - smoothstep(-0.05, 0.4, h)) * (1 - frost)
		c = c.mix(cDamp.mix(cWetSand, sandy), damp*0.55*(1-0.6*sandy))
		c = c.mix(cWetEarth.mix(cWetSand, sandy), wet*0.85)
		if h < 0 {
			bed := cBed.mix(cBedDeep, smoothstep(-0.3, -1.6, h)).mix(cSeaBed, sandy)
			c = c.mix(bed, smoothstep(0, -0.5, h)).scale(1 - 0.25*smoothstep(-1.5, -6, h))
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
	// Large-scale drift over a few hundred metres: golden, sunnier patches and
	// cooler, lusher ones, so meadows and forest floors are never one flat tone.
	if hab == core.HabMeadow || hab == core.HabWoodland || hab == core.HabConifer || hab == core.HabShrub || hab == core.HabAlpine || hab == core.HabMarsh {
		nl := g.n[lColor].Eval(x/230+41, z/230-17) + 0.35*g.n[lGrain].Eval(x/95-8, z/95+23)
		k := (1 - frost) * (1 - r.trail) * (1 - r.pad)
		c = c.mix(rgb{c.r * cWarmWash.r, c.g * cWarmWash.g, c.b * cWarmWash.b}, smoothstep(0.05, 0.6, nl)*0.7*k)
		c = c.mix(rgb{c.r * cCoolWash.r, c.g * cCoolWash.g, c.b * cCoolWash.b}, smoothstep(-0.05, -0.6, nl)*0.7*k)
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
