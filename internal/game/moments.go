package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
)

// Moments the narrator mumbles about (contract §13 activity lines) that the session
// detects from the player's pose and surroundings. Each is latched: it fires on the
// way in and re-arms only once the player has clearly left that state.

const (
	climbHeight   = 2.5  // m of feet above the ground under them: on a platform
	climbNear     = 10   // m (XZ) from a watchtower / hide POI
	wadeDepth     = 0.25 // m of water over the ground at the feet
	shelterRain   = 0.25 // rain intensity that makes shelter worth seeking
	shelterCover  = 0.55 // canopy cover overhead that keeps the worst off
	shelterRoof   = 6    // m from a cabin / hide / station: under its roof
	emptyViewSecs = 6    // s of binoculars held up on nothing
)

// moments checks the latched moments once a second.
func (s *Session) moments() {
	if !s.havePose {
		return
	}
	feet := s.feet
	ground := s.world.HeightAt(feet.X, feet.Z)

	// Climbing: the feet are well above the ground beside a tower.
	above := feet.Y - ground
	if !s.climbed && above > climbHeight {
		if kind := s.structureNear(climbNear, "watchtower", "hide", "ranger_station", "abandoned_station"); kind != "" {
			s.climbed = true
			s.narrate(narrator.Event{Kind: narrator.Climbed, Item: kind})
		}
	} else if s.climbed && above < 1 {
		s.climbed = false
	}

	// Wading: the water plane (y = 0) is over the ground at the feet.
	depth := -ground
	if !s.waded && depth > wadeDepth && depth < 1.6 {
		s.waded = true
		s.narrate(narrator.Event{Kind: narrator.Waded})
	} else if s.waded && depth < 0.05 {
		s.waded = false
	}

	// Sheltering: rain, and a dense canopy or a roof overhead.
	env := s.clock.Env()
	under := s.world.Cover(feet.X, feet.Z) >= shelterCover ||
		s.structureNear(shelterRoof, "cabin", "hide", "ranger_station", "research_site", "hidden_cabin", "abandoned_station") != ""
	raining := env.Rain >= shelterRain
	if !s.sheltered && raining && under {
		s.sheltered = true
		s.narrate(narrator.Event{Kind: narrator.Sheltered})
	} else if s.sheltered && (!under || env.Rain < shelterRain*0.5) {
		s.sheltered = false
	}
}

// structureNear returns the kind of the nearest POI of the given kinds within r
// metres (XZ), or "".
func (s *Session) structureNear(r float32, kinds ...string) string {
	s.poiBuf = s.world.POIsNear(s.feet.X, s.feet.Z, r, s.poiBuf[:0])
	best, kind := r+1, ""
	for _, poi := range s.poiBuf {
		if !containsStr(kinds, poi.Kind) {
			continue
		}
		if d := poi.Pos.DistXZ(s.feet); d <= r && d < best {
			best, kind = d, poi.Kind
		}
	}
	return kind
}

// emptyView tracks the binoculars held up with no bird under observation (called
// at the observation rate with its step).
func (s *Session) emptyView(dt float32) {
	up := s.pose.Tool == "binoculars" && s.pose.Raised
	if !up || s.sightBird != 0 {
		s.emptyFor = 0
		if !up {
			s.emptySaid = false
		}
		return
	}
	s.emptyFor += dt
	if s.emptyFor >= emptyViewSecs && !s.emptySaid {
		s.emptySaid = true
		s.narrate(narrator.Event{Kind: narrator.EmptyView})
	}
}
