package env

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func approx(a, b, eps float32) bool { return float32(math.Abs(float64(a-b))) <= eps }

func TestNewGameStart(t *testing.T) {
	c := New(42, 0)
	if c.DayLen() != DefaultDayLen {
		t.Fatalf("default day length = %v, want %v", c.DayLen(), DefaultDayLen)
	}
	e := c.Env()
	if e.Day != 1 || !approx(e.Time, 6.5, 1e-4) || e.Season != core.Spring || e.Weather != core.WeatherSunny {
		t.Fatalf("new game starts at %+v, want Day 1 06:30 Spring Sunny", e)
	}
	if e.Rain != 0 || e.Cloud > 0.4 || e.Wind > 0.4 {
		t.Fatalf("a sunny start should be calm and clear, got %+v", e)
	}
	if e.Light <= 0.2 || e.Light > 1 {
		t.Fatalf("light at 06:30 in spring = %v, want daylight", e.Light)
	}
	if e.Phase() != core.PhaseDawn {
		t.Fatalf("phase = %v, want Dawn", e.Phase())
	}
}

func TestAdvanceUsesDayLength(t *testing.T) {
	c := New(1, 1440)
	c.Advance(60) // one real minute = one game hour
	if e := c.Env(); !approx(e.Time, 7.5, 1e-3) {
		t.Fatalf("after 60 s at dayLen 1440 time = %v, want 7.5", e.Time)
	}
	fast := New(1, 240)
	fast.Advance(60)
	if e := fast.Env(); !approx(e.Time, 12.5, 1e-3) {
		t.Fatalf("after 60 s at dayLen 240 time = %v, want 12.5", e.Time)
	}
}

func TestDayRollover(t *testing.T) {
	c := New(7, 1440)
	prev := c.Env()
	rolled := false
	for i := 0; i < 12000; i++ { // 20 real minutes = 20 game hours
		c.Advance(0.1)
		e := c.Env()
		if e.Time < 0 || e.Time >= 24 {
			t.Fatalf("time out of range: %v", e.Time)
		}
		if e.Day != prev.Day {
			if e.Day != prev.Day+1 || prev.Time < 23.9 || e.Time > 0.1 {
				t.Fatalf("bad rollover %v@%v -> %v@%v", prev.Day, prev.Time, e.Day, e.Time)
			}
			rolled = true
		} else if e.Time < prev.Time {
			t.Fatalf("time went backwards within a day: %v -> %v", prev.Time, e.Time)
		}
		prev = e
	}
	if !rolled || prev.Day != 2 {
		t.Fatalf("expected to be on day 2 after 20 hours, got day %d", prev.Day)
	}
}

func TestSeasonChangesEveryFourDays(t *testing.T) {
	c := New(3, 1440)
	want := []core.Season{core.Spring, core.Summer, core.Autumn, core.Winter, core.Spring}
	for day := 1; day <= 17; day++ {
		c.Set(12, day)
		e := c.Env()
		if e.Day != day {
			t.Fatalf("Set day %d gave day %d", day, e.Day)
		}
		if w := want[(day-1)/SeasonDays]; e.Season != w {
			t.Fatalf("day %d season = %v, want %v", day, e.Season, w)
		}
	}
	// And by simply letting time pass: the change happens at midnight.
	c = New(3, 24) // one game hour per real second
	last := c.Env()
	changes := 0
	for i := 0; i < 16*24*20; i++ {
		c.Advance(0.05)
		e := c.Env()
		if e.Season != last.Season {
			changes++
			if e.Season != (last.Season+1)&3 || (e.Day-1)%SeasonDays != 0 || e.Time > 0.2 {
				t.Fatalf("season changed %v -> %v on day %d at %v", last.Season, e.Season, e.Day, e.Time)
			}
		}
		last = e
	}
	if changes != 4 {
		t.Fatalf("saw %d season changes in a 16-day year, want 4", changes)
	}
}

func TestSetSeasonKeepsCycling(t *testing.T) {
	c := New(3, 1440)
	c.SetSeason(core.Autumn)
	if s := c.Env().Season; s != core.Autumn {
		t.Fatalf("SetSeason(Autumn) gave %v", s)
	}
	c.Set(12, 5) // one season later
	if s := c.Env().Season; s != core.Winter {
		t.Fatalf("a season after a forced autumn should be winter, got %v", s)
	}
}

func TestSkipTo(t *testing.T) {
	c := New(5, 1440) // 06:30, day 1
	if got := c.SkipTo(12); !approx(got, 5.5, 1e-3) {
		t.Fatalf("SkipTo(12) from 06:30 skipped %v h, want 5.5", got)
	}
	if e := c.Env(); e.Day != 1 || !approx(e.Time, 12, 1e-3) {
		t.Fatalf("after SkipTo(12): day %d time %v", e.Day, e.Time)
	}
	if got := c.SkipTo(5); !approx(got, 17, 1e-3) {
		t.Fatalf("SkipTo(5) from 12:00 skipped %v h, want 17", got)
	}
	if e := c.Env(); e.Day != 2 || !approx(e.Time, 5, 1e-3) {
		t.Fatalf("after SkipTo(5): day %d time %v", e.Day, e.Time)
	}
	// Asking for "now" means the same time tomorrow.
	if got := c.SkipTo(5); !approx(got, 24, 1e-3) {
		t.Fatalf("SkipTo(now) skipped %v h, want 24", got)
	}
	if e := c.Env(); e.Day != 3 || !approx(e.Time, 5, 1e-3) {
		t.Fatalf("after SkipTo(now): day %d time %v", e.Day, e.Time)
	}
	// Values stay sane and the schedule still covers the forecast window.
	e := c.Env()
	for _, v := range []float32{e.Wind, e.Rain, e.Cloud, e.Mist, e.Light} {
		if v < 0 || v > 1 || v != v {
			t.Fatalf("env value out of range after skip: %+v", e)
		}
	}
	if len(c.Forecast()) != 4 {
		t.Fatalf("forecast must have 4 slots")
	}
}

func TestWeatherEasesWithoutJumps(t *testing.T) {
	for _, dayLen := range []float32{1440, 240} {
		c := New(11, dayLen)
		prev := c.Env()
		seen := map[core.Weather]bool{}
		const dt = 0.1
		steps := int(8 * dayLen / dt) // eight in-game days
		for i := 0; i < steps; i++ {
			if i == steps/2 {
				c.SetWeather(core.WeatherRain) // a forced change must ease too
			}
			c.Advance(dt)
			e := c.Env()
			seen[e.Weather] = true
			for name, d := range map[string]float32{
				"wind": e.Wind - prev.Wind, "rain": e.Rain - prev.Rain,
				"cloud": e.Cloud - prev.Cloud, "mist": e.Mist - prev.Mist,
			} {
				if d > 0.02 || d < -0.02 {
					t.Fatalf("dayLen %v: %s jumped by %v in one tick at day %d %v", dayLen, name, d, e.Day, e.Time)
				}
			}
			if d := e.Light - prev.Light; d > 0.03 || d < -0.03 {
				t.Fatalf("dayLen %v: light jumped by %v at %v", dayLen, d, e.Time)
			}
			if e.Weather == core.WeatherRain && e.Rain < 0 {
				t.Fatal("negative rain")
			}
			prev = e
		}
		if len(seen) != int(core.WeatherCount) {
			t.Fatalf("dayLen %v: only saw weathers %v in eight days", dayLen, seen)
		}
	}
}

func TestWeatherIntensitiesFollowTheState(t *testing.T) {
	c := New(2, 1440)
	settle := func() core.Env {
		for i := 0; i < 900; i++ { // 90 s = 1.5 game hours
			c.Advance(0.1)
		}
		return c.Env()
	}
	c.SetWeather(core.WeatherRain)
	if e := settle(); e.Weather != core.WeatherRain || e.Rain < 0.4 || e.Cloud < 0.8 {
		t.Fatalf("rain did not settle in: %+v", e)
	}
	c.SetWeather(core.WeatherWind)
	if e := settle(); e.Wind < 0.6 || e.Rain > 0.05 {
		t.Fatalf("wind did not settle in: %+v", e)
	}
	c.SetWeather(core.WeatherSunny)
	if e := settle(); e.Cloud > 0.35 || e.Rain > 0.01 || e.Wind > 0.4 {
		t.Fatalf("sun did not settle in: %+v", e)
	}
}

func TestRainIsTheRarestOfTheCalmWeathers(t *testing.T) {
	var hours [core.WeatherCount]float64
	for seed := int64(0); seed < 6; seed++ {
		c := New(seed, 1440)
		for i := 0; i < 16*24*4; i++ { // a year in quarter hours
			c.SkipTo(c.Env().Time + 0.25)
			hours[c.Env().Weather] += 0.25
		}
	}
	if hours[core.WeatherRain] >= hours[core.WeatherSunny] || hours[core.WeatherRain] >= hours[core.WeatherCloudy] {
		t.Fatalf("rain should be less common than sun and cloud: %v", hours)
	}
	for w, h := range hours {
		if h == 0 {
			t.Fatalf("weather %v never occurred", core.Weather(w))
		}
	}
}

func TestBlocksLastTwoToFiveHours(t *testing.T) {
	c := New(9, 1440)
	for i := 0; i < 400; i++ {
		c.SkipTo(c.Env().Time + 1)
		for j, b := range c.State().Blocks {
			if j == 0 {
				continue // the first one may be the opening or a forced block
			}
			if b.Dur < 2 || b.Dur > 5 {
				t.Fatalf("block %d lasts %v h, want 2..5", b.N, b.Dur)
			}
		}
	}
}

func TestMistFormsAtDawnAndAfterRain(t *testing.T) {
	// Dawn: over a year of mornings some must be misty, and middays must be clear
	// unless it has just rained.
	dawnMax, noonMax := float32(0), float32(0)
	c := New(4, 1440)
	for day := 0; day < 16; day++ {
		c.SkipTo(6)
		if e := c.Env(); e.Mist > dawnMax {
			dawnMax = e.Mist
		}
		c.SkipTo(13)
		if e, st := c.Env(), c.State(); st.Wet < 0.05 && e.Mist > noonMax {
			noonMax = e.Mist
		}
	}
	if dawnMax < 0.3 {
		t.Fatalf("no misty dawn in 16 days (max %v)", dawnMax)
	}
	if noonMax > 0.05 {
		t.Fatalf("mist at dry midday: %v", noonMax)
	}

	// After rain: mist rises once the rain stops, at an hour that has no dawn mist.
	c = New(4, 1440)
	c.Set(13, 2)
	c.SetWeather(core.WeatherRain)
	for i := 0; i < 1200; i++ {
		c.Advance(0.1)
	}
	c.SetWeather(core.WeatherSunny)
	peak := float32(0)
	for i := 0; i < 1200; i++ {
		c.Advance(0.1)
		if m := c.Env().Mist; m > peak {
			peak = m
		}
	}
	if peak < 0.2 {
		t.Fatalf("no mist after rain (peak %v)", peak)
	}
}

func TestLightFollowsTheSunAndSeason(t *testing.T) {
	c := New(1, 1440)
	at := func(season core.Season, hour float32) float32 {
		c.Set(hour, 1)
		c.SetSeason(season)
		return c.Env().Light
	}
	for s := core.Spring; s <= core.Winter; s++ {
		if l := at(s, 0.5); l != 0 {
			t.Fatalf("%v: light at 00:30 = %v, want 0", s, l)
		}
		if l := at(s, 12.5); l < 0.6 {
			t.Fatalf("%v: light at 12:30 = %v, want bright", s, l)
		}
		if l := at(s, 23); l != 0 {
			t.Fatalf("%v: light at 23:00 = %v, want 0", s, l)
		}
	}
	if at(core.Summer, 20) <= at(core.Winter, 20) {
		t.Fatal("summer evenings must be lighter than winter evenings")
	}
	if at(core.Summer, 5.5) <= at(core.Winter, 5.5) {
		t.Fatal("summer dawns must come earlier than winter dawns")
	}
}

func TestForecastMatchesWhatHappens(t *testing.T) {
	for seed := int64(0); seed < 5; seed++ {
		c := New(seed, 1440)
		for round := 0; round < 12; round++ {
			f := c.Forecast()
			if len(f) != 4 {
				t.Fatalf("forecast has %d slots, want 4", len(f))
			}
			start := c.Env()
			for i, slot := range f {
				wantHour := float32(math.Mod(float64(start.Time)+float64(i*3), 24))
				if !approx(slot.Hour, wantHour, 0.01) {
					t.Fatalf("slot %d hour = %v, want %v", i, slot.Hour, wantHour)
				}
				var tally [core.WeatherCount]int
				for k := 0; k < 3*600; k++ { // three game hours in 0.1 s ticks
					tally[c.Env().Weather]++
					c.Advance(0.1)
				}
				best := 0
				for w := range tally {
					if tally[w] > tally[best] {
						best = w
					}
				}
				if slot.Weather != best {
					t.Fatalf("seed %d round %d slot %d: forecast %v but it was mostly %v (%v)",
						seed, round, i, core.Weather(slot.Weather), core.Weather(best), tally)
				}
			}
		}
	}
}

func TestStateRestoreRoundTrip(t *testing.T) {
	a := New(99, 1440)
	for i := 0; i < 30000; i++ { // well into day 3
		a.Advance(0.1)
	}
	a.SetSeason(core.Autumn)

	raw, err := json.Marshal(a.State())
	if err != nil {
		t.Fatal(err)
	}
	var st State
	if err := json.Unmarshal(raw, &st); err != nil {
		t.Fatal(err)
	}
	b := New(1, 300) // different seed and day length: Restore must override both
	b.Restore(st)

	if ea, eb := a.Env(), b.Env(); ea != eb {
		t.Fatalf("restored env differs:\n a %+v\n b %+v", ea, eb)
	}
	if b.DayLen() != a.DayLen() {
		t.Fatalf("day length not restored: %v", b.DayLen())
	}
	for i := 0; i < 40000; i++ { // the future must be identical too
		a.Advance(0.1)
		b.Advance(0.1)
		if ea, eb := a.Env(), b.Env(); ea != eb {
			t.Fatalf("diverged after %d ticks:\n a %+v\n b %+v", i, ea, eb)
		}
	}
	fa, fb := a.Forecast(), b.Forecast()
	for i := range fa {
		if fa[i] != fb[i] {
			t.Fatalf("forecast differs at slot %d: %v vs %v", i, fa[i], fb[i])
		}
	}
}

func TestRestoreToleratesEmptyState(t *testing.T) {
	c := New(5, 1440)
	c.Restore(State{Seed: 5})
	e := c.Env()
	if e.Day != 1 || e.Time < 0 || e.Time >= 24 {
		t.Fatalf("bad env after restoring an empty state: %+v", e)
	}
	if c.DayLen() != 1440 {
		t.Fatalf("zero DayLen must keep the current one, got %v", c.DayLen())
	}
	c.Advance(100)
	if len(c.Forecast()) != 4 {
		t.Fatal("no forecast after restoring an empty state")
	}
}

func TestDeterministicForSeed(t *testing.T) {
	a, b, other := New(1234, 1440), New(1234, 1440), New(1235, 1440)
	differs := false
	for i := 0; i < 50000; i++ {
		a.Advance(0.1)
		b.Advance(0.1)
		other.Advance(0.1)
		if a.Env() != b.Env() {
			t.Fatalf("same seed diverged at tick %d", i)
		}
		if a.Env().Weather != other.Env().Weather {
			differs = true
		}
	}
	if !differs {
		t.Fatal("different seeds produced the same weather for 3.5 days")
	}
}
