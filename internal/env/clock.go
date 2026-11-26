// Package env keeps the world clock: time of day, the day counter, seasons, the
// weather schedule with its smoothly eased intensities, and the forecast.
//
// The clock is deterministic for a seed: weather is decided ahead of time in blocks
// of 2-5 in-game hours by a Markov chain whose rolls are a pure function of
// (seed, block number), so the forecast is simply a read of what is already
// scheduled and a saved State resumes on exactly the same future.
package env

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

const (
	// DefaultDayLen is the real-time length of an in-game day in seconds
	// (one game hour per real minute).
	DefaultDayLen = 1440

	// SeasonDays is the length of a season in days; a year is four seasons.
	SeasonDays = 4

	startHour = 6.5 // a new game begins on Day 1 at 06:30

	forecastSlots     = 4
	forecastSlotHours = 3
	scheduleAhead     = forecastSlots*forecastSlotHours + 1 // hours of weather always decided in advance

	// maxStepHours bounds one integration step so easing stays stable when a single
	// Advance covers a lot of game time (very short days, long frames).
	maxStepHours = 0.05

	// maxRealRate caps how fast an eased value may change per REAL second, so that
	// nothing pops on screen even when the day is configured to run very fast.
	maxRealRate = 0.15
)

// Block is one stretch of decided weather.
type Block struct {
	N       uint32       `json:"n"`       // sequence number: selects this block's random rolls
	Start   float64      `json:"start"`   // absolute hour at which it begins (hour 0 = Day 1, 00:00)
	Dur     float32      `json:"dur"`     // hours
	Weather core.Weather `json:"weather"` // what it is
	Level   float32      `json:"level"`   // 0..1 how strongly this block expresses its weather
}

// End is the absolute hour at which the block ends.
func (b Block) End() float64 { return b.Start + float64(b.Dur) }

// State is everything needed to resume the clock; it is plain data and safe to
// marshal as JSON.
type State struct {
	Seed        int64   `json:"seed"`
	DayLen      float32 `json:"dayLen"`
	Hours       float64 `json:"hours"`       // absolute hours since Day 1, 00:00
	SeasonShift int     `json:"seasonShift"` // seasons added by SetSeason (0..3)
	Wind        float32 `json:"wind"`
	Rain        float32 `json:"rain"`
	Cloud       float32 `json:"cloud"`
	Mist        float32 `json:"mist"`
	Wet         float32 `json:"wet"` // 0..1 lingering dampness after rain (drives post-rain mist)
	Blocks      []Block `json:"blocks"`
}

// Clock advances time and weather. It is not safe for concurrent use; the session
// owns it and calls it from the simulation goroutine.
type Clock struct {
	seed   int64
	dayLen float32
	hours  float64 // absolute hours since Day 1, 00:00
	shift  int     // season offset from SetSeason

	wind, rain, cloud, mist, wet float32

	blocks []Block // blocks[0] is the current weather; always covers scheduleAhead hours
}

// New returns a clock at Day 1, 06:30, Spring, Sunny. dayLen is the real-time length
// of one in-game day in seconds; values <= 0 select DefaultDayLen.
func New(seed int64, dayLen float32) *Clock {
	if dayLen <= 0 {
		dayLen = DefaultDayLen
	}
	c := &Clock{seed: seed, dayLen: dayLen, hours: startHour}
	// The opening block is always a fair morning, so every adventure starts the same way.
	c.blocks = []Block{{N: 0, Start: startHour, Dur: 3 + 2*c.roll(0, 1), Weather: core.WeatherSunny, Level: c.roll(0, 2)}}
	c.fill()
	c.settle()
	return c
}

// DayLen returns the real seconds per in-game day.
func (c *Clock) DayLen() float32 { return c.dayLen }

// SetDayLen changes the real seconds per in-game day (ignored if <= 0).
func (c *Clock) SetDayLen(dayLen float32) {
	if dayLen > 0 {
		c.dayLen = dayLen
	}
}

// Advance moves the clock forward by dt real seconds.
func (c *Clock) Advance(dt float32) {
	if dt <= 0 {
		return
	}
	hours := float64(dt) * 24 / float64(c.dayLen)
	steps := int(math.Ceil(hours / maxStepHours))
	if steps < 1 {
		steps = 1
	}
	h, r := hours/float64(steps), dt/float32(steps)
	for i := 0; i < steps; i++ {
		c.step(h, r)
	}
}

// Env returns the current environment snapshot.
func (c *Clock) Env() core.Env {
	day, t := c.dayTime()
	season := c.seasonAt(c.hours)
	return core.Env{
		Time:    t,
		Day:     day,
		Season:  season,
		Weather: c.blocks[0].Weather,
		Wind:    c.wind,
		Rain:    c.rain,
		Mist:    c.mist,
		Cloud:   c.cloud,
		Light:   daylight(t, season, c.cloud, c.rain),
	}
}

// Forecast returns the already-decided weather for the next 12 hours as four
// 3-hour slots starting now. Hour is the hour of day at which the slot begins;
// Weather is the weather that holds for most of the slot.
func (c *Clock) Forecast() []proto.ForecastSlot {
	c.fill()
	out := make([]proto.ForecastSlot, forecastSlots)
	for i := range out {
		from := c.hours + float64(i*forecastSlotHours)
		out[i] = proto.ForecastSlot{
			Hour:    hourOfDay(from),
			Weather: int(c.dominant(from, from+forecastSlotHours)),
		}
	}
	return out
}

// SkipTo jumps forward to the next time the clock reads hour (0..24) and returns
// the number of in-game hours skipped. If that moment is less than three minutes
// away the following day's is used, so "rest until dawn" at dawn sleeps a full day.
// The weather schedule plays out over the skipped time and intensities end up
// settled (a skip is a cut, so nothing is eased on screen).
func (c *Clock) SkipTo(hour float32) (hoursSkipped float32) {
	if hour != hour { // NaN
		return 0
	}
	target := math.Mod(float64(hour), 24)
	if target < 0 {
		target += 24
	}
	_, now := c.dayTime()
	delta := target - float64(now)
	if delta < 0.05 {
		delta += 24
	}
	for left := delta; left > 1e-9; {
		h := math.Min(left, maxStepHours)
		c.step(h, 0)
		left -= h
	}
	return float32(delta)
}

// Set moves the clock to an hour of day on a given day (debug / scripted time).
// The decided weather moves with it: what was forecast for "in two hours" is still
// two hours away.
func (c *Clock) Set(time float32, day int) {
	if time != time {
		return
	}
	if day < 1 {
		day = 1
	}
	t := math.Mod(float64(time), 24)
	if t < 0 {
		t += 24
	}
	target := float64(day-1)*24 + t
	shift := target - c.hours
	for i := range c.blocks {
		c.blocks[i].Start += shift
	}
	c.hours = target
	c.fill()
}

// SetWeather replaces the current weather with w for a fresh block of about three
// hours and re-decides what follows. Intensities ease towards it as usual.
func (c *Clock) SetWeather(w core.Weather) {
	if w >= core.WeatherCount {
		return
	}
	cur := c.blocks[0]
	cur.Weather, cur.Start, cur.Dur = w, c.hours, 3
	if cur.Level < 0.5 {
		cur.Level = 0.5 // a requested weather should be clearly noticeable
	}
	c.blocks = append(c.blocks[:0], cur)
	c.fill()
}

// SetSeason makes the current season s. Seasons keep advancing every SeasonDays
// days from the usual day boundaries afterwards.
func (c *Clock) SetSeason(s core.Season) {
	natural := c.naturalSeason(c.hours)
	c.shift = (int(s&3) - natural + 4) % 4
}

// State captures the clock for saving.
func (c *Clock) State() State {
	return State{
		Seed: c.seed, DayLen: c.dayLen, Hours: c.hours, SeasonShift: c.shift,
		Wind: c.wind, Rain: c.rain, Cloud: c.cloud, Mist: c.mist, Wet: c.wet,
		Blocks: append([]Block(nil), c.blocks...),
	}
}

// Restore resumes from a saved State. A zero DayLen keeps the clock's current day
// length (so a command-line override survives loading); an empty or implausible
// schedule is rebuilt.
func (c *Clock) Restore(st State) {
	c.seed = st.Seed
	if st.DayLen > 0 {
		c.dayLen = st.DayLen
	}
	c.hours = st.Hours
	if c.hours < 0 || c.hours != c.hours {
		c.hours = startHour
	}
	c.shift = ((st.SeasonShift % 4) + 4) % 4
	c.wind, c.rain, c.cloud, c.mist, c.wet = clamp01(st.Wind), clamp01(st.Rain), clamp01(st.Cloud), clamp01(st.Mist), clamp01(st.Wet)

	c.blocks = c.blocks[:0]
	for _, b := range st.Blocks {
		if b.Dur <= 0 || b.Weather >= core.WeatherCount || b.End() <= c.hours {
			continue
		}
		if len(c.blocks) > 0 && math.Abs(c.blocks[len(c.blocks)-1].End()-b.Start) > 1e-6 {
			break // a gap: keep what is contiguous and re-decide the rest
		}
		c.blocks = append(c.blocks, b)
	}
	if len(c.blocks) == 0 || c.blocks[0].Start > c.hours {
		n := uint32(math.Max(0, c.hours)) // any block number will do; it only seeds the rolls
		c.blocks = append(c.blocks[:0], Block{N: n, Start: c.hours, Dur: 2 + 3*c.roll(n, 1), Weather: core.WeatherSunny, Level: c.roll(n, 2)})
	}
	c.fill()
}

// ---------------------------------------------------------------------------

// step integrates hours of game time. realDt is the real time it represents; 0
// means "a skip", which lifts the on-screen rate cap.
func (c *Clock) step(hours float64, realDt float32) {
	c.hours += hours
	for len(c.blocks) > 1 && c.blocks[0].End() <= c.hours {
		c.blocks = append(c.blocks[:0], c.blocks[1:]...)
	}
	c.fill()

	h := float32(hours)
	tg := c.targets()
	c.wind = ease(c.wind, tg.wind, h, 0.30, realDt)
	c.rain = ease(c.rain, tg.rain, h, 0.25, realDt)
	c.cloud = ease(c.cloud, tg.cloud, h, 0.45, realDt)

	// Dampness builds while it rains and lingers for a few hours afterwards.
	if c.rain > 0.15 {
		c.wet = ease(c.wet, 1, h, 0.6, realDt)
	} else {
		c.wet = ease(c.wet, 0, h, 2.5, realDt)
	}
	c.mist = ease(c.mist, c.mistTarget(), h, 0.35, realDt)
}

// settle snaps the eased values onto their targets (used once, at creation).
func (c *Clock) settle() {
	tg := c.targets()
	c.wind, c.rain, c.cloud = tg.wind, tg.rain, tg.cloud
	c.wet = 0
	c.mist = c.mistTarget()
}

// dayTime splits absolute hours into the day counter (from 1) and hour of day.
func (c *Clock) dayTime() (day int, hour float32) {
	d := math.Floor(c.hours / 24)
	return int(d) + 1, hourOfDay(c.hours)
}

// hourOfDay maps absolute hours onto 0 <= h < 24 as a float32 (never exactly 24).
func hourOfDay(abs float64) float32 {
	h := float32(abs - 24*math.Floor(abs/24))
	if h >= 24 {
		h = math.Nextafter32(24, 0)
	}
	if h < 0 {
		h = 0
	}
	return h
}

func (c *Clock) naturalSeason(abs float64) int {
	day := int(math.Floor(abs / 24))
	return (day / SeasonDays) % 4
}

func (c *Clock) seasonAt(abs float64) core.Season {
	return core.Season((c.naturalSeason(abs) + c.shift) % 4)
}

func ease(v, target, hours, tau, realDt float32) float32 {
	d := (target - v) * (1 - float32(math.Exp(float64(-hours/tau))))
	if realDt > 0 {
		if lim := maxRealRate * realDt; d > lim {
			d = lim
		} else if d < -lim {
			d = -lim
		}
	}
	return clamp01(v + d)
}

func clamp01(v float32) float32 {
	if v != v || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func smoothstep(lo, hi, x float32) float32 {
	t := (x - lo) / (hi - lo)
	if t <= 0 {
		return 0
	}
	if t >= 1 {
		return 1
	}
	return t * t * (3 - 2*t)
}
