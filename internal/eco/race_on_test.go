//go:build race

package eco

// raceEnabled relaxes wall-clock assertions under the race detector, which slows
// everything down several times.
const raceEnabled = true
