package env

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// transition[prev] holds the base odds of the next block's weather
// (sunny, cloudy, rain, wind). Rain is the least likely state from fair weather and
// tends to break into cloud, so wet spells stay short (spec 20.2: variety without
// frustration).
var transition = [core.WeatherCount][core.WeatherCount]float32{
	core.WeatherSunny:  {0.50, 0.30, 0.06, 0.14},
	core.WeatherCloudy: {0.32, 0.30, 0.24, 0.14},
	core.WeatherRain:   {0.24, 0.48, 0.18, 0.10},
	core.WeatherWind:   {0.40, 0.32, 0.12, 0.16},
}

// seasonBias scales the odds of each weather per season: showery springs, settled
// summers, wet and blustery autumns, windy winters.
var seasonBias = [4][core.WeatherCount]float32{
	core.Spring: {1.0, 1.0, 1.15, 1.0},
	core.Summer: {1.3, 0.9, 0.65, 0.8},
	core.Autumn: {0.8, 1.1, 1.45, 1.35},
	core.Winter: {0.85, 1.2, 1.0, 1.3},
}

// sunHours is sunrise and sunset per season. They sit inside the fixed dawn and
// evening phases of core.PhaseAt so the dawn chorus always happens around first light.
var sunHours = [4][2]float32{
	core.Spring: {5.75, 19.25},
	core.Summer: {4.75, 21.25},
	core.Autumn: {6.25, 18.75},
	core.Winter: {7.0, 17.25},
}

// roll is a deterministic uniform number in [0,1) for a block and a purpose.
func (c *Clock) roll(block uint32, salt uint64) float32 {
	x := uint64(c.seed)*0x9E3779B97F4A7C15 ^ (uint64(block)+1)*0xBF58476D1CE4E5B9 ^ salt*0x94D049BB133111EB
	x ^= x >> 30
	x *= 0xBF58476D1CE4E5B9
	x ^= x >> 27
	x *= 0x94D049BB133111EB
	x ^= x >> 31
	return float32(x>>40) / float32(1<<24)
}

// fill decides weather blocks until the schedule reaches scheduleAhead hours past now.
func (c *Clock) fill() {
	for c.blocks[len(c.blocks)-1].End() < c.hours+scheduleAhead {
		prev := c.blocks[len(c.blocks)-1]
		n := prev.N + 1
		start := prev.End()
		c.blocks = append(c.blocks, Block{
			N:       n,
			Start:   start,
			Dur:     2 + 3*c.roll(n, 1),
			Weather: c.next(prev.Weather, c.seasonAt(start), c.roll(n, 0)),
			Level:   c.roll(n, 2),
		})
	}
}

// next draws the weather that follows prev in the given season.
func (c *Clock) next(prev core.Weather, season core.Season, u float32) core.Weather {
	var odds [core.WeatherCount]float32
	var sum float32
	for w := range odds {
		odds[w] = transition[prev][w] * seasonBias[season&3][w]
		sum += odds[w]
	}
	u *= sum
	for w, o := range odds {
		if u < o {
			return core.Weather(w)
		}
		u -= o
	}
	return core.WeatherCloudy
}

// dominant returns the weather scheduled for most of [from, to); ties go to the
// earlier block.
func (c *Clock) dominant(from, to float64) core.Weather {
	var share [core.WeatherCount]float64
	for _, b := range c.blocks {
		lo, hi := math.Max(from, b.Start), math.Min(to, b.End())
		if hi > lo {
			share[b.Weather] += hi - lo
		}
	}
	best := c.blocks[0].Weather
	bestShare := -1.0
	for _, b := range c.blocks { // schedule order makes ties deterministic
		if s := share[b.Weather]; s > bestShare+1e-9 {
			best, bestShare = b.Weather, s
		}
	}
	return best
}

type targets struct{ wind, rain, cloud float32 }

// targets are the intensities the current block is heading for.
func (c *Clock) targets() targets {
	b := c.blocks[0]
	l := b.Level
	var t targets
	switch b.Weather {
	case core.WeatherSunny:
		t = targets{wind: 0.08 + 0.17*l, cloud: 0.05 + 0.22*l}
	case core.WeatherCloudy:
		t = targets{wind: 0.14 + 0.22*l, cloud: 0.68 + 0.24*l}
	case core.WeatherRain:
		t = targets{wind: 0.20 + 0.30*l, rain: 0.45 + 0.50*l, cloud: 0.88 + 0.12*l}
	case core.WeatherWind:
		t = targets{wind: 0.68 + 0.28*l, cloud: 0.28 + 0.34*l}
	}
	// Slow gusting so the wind is never a flat line; small enough to stay smooth
	// after easing.
	h := c.hours
	t.wind = clamp01(t.wind + 0.05*float32(math.Sin(h*2.1+float64(b.N))) + 0.03*float32(math.Sin(h*5.3)))
	return t
}

// mistTarget: mist pools on calm mornings around sunrise (on roughly half the
// days, more in autumn) and rises off the wet ground once rain has stopped.
func (c *Clock) mistTarget() float32 {
	day, t := c.dayTime()
	season := c.seasonAt(c.hours)
	rise := sunHours[season][0]

	calm := (1 - c.wind) * (1 - c.wind)
	// How misty this particular morning is: 0 on clear days, up to 1.
	morning := smoothstep(0.35, 0.8, c.roll(uint32(day), 7))
	morning *= [4]float32{core.Spring: 1, core.Summer: 0.6, core.Autumn: 1.25, core.Winter: 0.9}[season]
	bump := smoothstep(rise-2.5, rise-0.3, t) * (1 - smoothstep(rise+0.8, rise+3, t))
	dawn := morning * bump * calm * (1 - c.rain)

	after := c.wet * 0.7 * (1 - smoothstep(0.05, 0.3, c.rain)) * (1 - c.wind)

	return clamp01(float32(math.Max(float64(dawn), float64(after))))
}

// daylight is 0 at night and 1 under a midday sun, dimmed by cloud and rain.
func daylight(t float32, season core.Season, cloud, rain float32) float32 {
	rise, set := sunHours[season&3][0], sunHours[season&3][1]
	x := (t - rise) / (set - rise) // 0 at sunrise, 1 at sunset
	if x < -0.5 {
		x = -0.5
	} else if x > 1.5 {
		x = 1.5
	}
	elev := float32(math.Sin(math.Pi * float64(x))) // sun height proxy; negative below the horizon
	// Twilight: light starts before sunrise and lingers after sunset.
	l := smoothstep(-0.28, 0.62, elev)
	return clamp01(l * (1 - 0.30*cloud - 0.15*rain))
}
