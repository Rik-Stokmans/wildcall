package field

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Nest perception (contract §11): how clearly a nest can be seen, when the player has
// clearly found one, and nests in photographs. Nests use the same clarity model as
// birds; what hides them is the site (a dome deep in a bramble, a scrape that is
// only a hollow among stones) rather than a bird's skulking. Like a bird, a nest is
// never attributed to its owner here: core.Nest.Species is server truth that the
// session must not forward.
const (
	// NestFoundClarity is the clarity at which a nest in the view counts as clearly
	// observed ("nest found").
	NestFoundClarity = 0.5
	// nestAttention: the view has to rest on the nest this long first, so sweeping
	// the glasses over a hedge finds nothing (design rule: discovery is earned).
	nestAttention = 1.0
	nestCamoCut   = 0.35 // like camoCut for a perched bird: nests never move
	nestBackSide  = 0.3  // a hole seen from behind its trunk shows this much (its rim, the stains)

	// Photos: a nest counts as "in the photo" from this visibility and frame share.
	nestPhotoMinVisible = 0.3
	nestPhotoMinSize    = 0.015
	nestPhotoBonus      = 5 // points for a nest in the shot (any subject)
	nestOnlyFactor      = 0.92
)

// nestSites: how much of a nest its site hides (0..1, as Cover for a bird) and how
// well its material blends in (0..1, as Camo). Holes and burrows are judged by their
// entrance, which is in plain view when it faces the observer. The resulting foliage
// factor (before any occlusion) runs from ~0.89 for a hole or a ledge, like a robin
// on an open branch, through ~0.73 for a cup in a fork to ~0.55 for a domed or
// ground nest in thick cover: those are found only from close by or with good glass.
var nestSites = map[string]struct{ hide, camo float32 }{
	"cavity":    {0.05, 0.2},
	"burrow":    {0.05, 0.2},
	"ledge":     {0.05, 0.25},
	"platform":  {0.1, 0.15},
	"floating":  {0.2, 0.3},
	"scrape":    {0, 0.8},
	"cup_fork":  {0.2, 0.3},
	"cup_shrub": {0.3, 0.35},
	"pendant":   {0.3, 0.35},
	"reed":      {0.3, 0.35},
	"dome":      {0.35, 0.45},
	"ground":    {0.35, 0.55},
}

// NestStageKey is the vocabulary word for a nest stage, as used in photo tags
// ("nest:chicks"): old | building | eggs | chicks.
func NestStageKey(stage uint8) string {
	switch stage {
	case core.NestBuilding:
		return "building"
	case core.NestEggs:
		return "eggs"
	case core.NestChicks:
		return "chicks"
	}
	return "old"
}

// nestFoliage is the 0..1 fraction of the nest left visible from eye: terrain and
// foliage on the line of sight, the cover of its site, its camouflage, and for a
// hole or burrow which way the entrance faces.
func nestFoliage(c *Context, eye core.Vec3, n core.Nest) float32 {
	occ := clamp01(c.Terrain.Occlusion(eye, n.Pos))
	site, ok := nestSites[n.Site]
	if !ok {
		site = nestSites["cup_shrub"]
	}
	v := (1 - occ) * (1 - coverCut*site.hide) * (1 - nestCamoCut*site.camo)
	if n.Site == "cavity" || n.Site == "burrow" {
		to := eye.Sub(n.Pos)
		to.Y = 0
		if l := to.Len(); l > 0.01 {
			facing := core.HeadingDir(n.Yaw).Dot(to.Scale(1 / l))
			v *= nestBackSide + (1-nestBackSide)*clamp01(0.3+0.7*facing)
		}
	}
	return v
}

// NestView computes how clearly a nest can be seen from pose p, with the same
// factors as Clarity (size, foliage, light, weather, the observer's own movement,
// optics). View.Angle says how far it is off the view axis.
func NestView(c *Context, n core.Nest, p proto.Pose) View {
	return viewOf(c, p, n.Pos, maxf(n.Size, 0.05), nestFoliage(c, Eye(p), n), 0)
}

// NestSight is a nest the player can see, with how well.
type NestSight struct {
	// Nest is the server truth. Nest.Species is the owner: never send it; name the
	// owner only if the player has identified that species.
	Nest core.Nest
	View View
}

// ObservedNest returns the nest the player is clearly observing right now: the one
// nearest the view axis inside the observation cone (the same cone Watch uses for
// birds) that is seen at clarity >= NestFoundClarity. nests should be
// Ecosystem.Nests(eye, MaxSightRange).
func ObservedNest(c *Context, p proto.Pose, nests []core.Nest) (NestSight, bool) {
	eye := Eye(p)
	axis := core.LookDir(p.Yaw, p.Pitch)
	cone := minf(rad(evidenceConeBase)+evidenceConeShare*halfFOV(p, c.Stats), rad(evidenceConeMax))
	var best NestSight
	found := false
	for _, n := range nests {
		d := n.Pos.Sub(eye)
		if dist := d.Len(); dist > MaxSightRange || dist < 0.2 {
			continue
		}
		a := angleBetween(axis, d)
		if a > cone || found && a >= best.View.Angle {
			continue
		}
		v := NestView(c, n, p)
		if v.Clarity < NestFoundClarity {
			continue
		}
		best, found = NestSight{Nest: n, View: v}, true
	}
	return best, found
}

// NestWatch decides when the player has found a nest by watching it: the view must
// rest on the same clearly seen nest for a moment. One per player session; the zero
// value is ready. Not safe for concurrent use.
type NestWatch struct {
	cand     uint32
	dwell    float32
	reported uint32
}

// Reset forgets the nest being looked at.
func (w *NestWatch) Reset() { *w = NestWatch{} }

// Tick advances by dt seconds for the current pose and the nests around the player.
// It returns the nest on the tick it has been clearly observed long enough - once
// per continuous look; the session records the find (NestEntry, XP) only the first
// time per nest.
func (w *NestWatch) Tick(c *Context, dt float32, p proto.Pose, nests []core.Nest) (NestSight, bool) {
	s, ok := ObservedNest(c, p, nests)
	if !ok {
		w.cand, w.dwell, w.reported = 0, 0, 0
		return NestSight{}, false
	}
	if s.Nest.ID != w.cand {
		w.cand, w.dwell = s.Nest.ID, 0
	}
	w.dwell += maxf(dt, 0)
	if w.dwell < nestAttention || w.reported == s.Nest.ID {
		return NestSight{}, false
	}
	w.reported = s.Nest.ID
	return s, true
}

// PhotoNest is the server-side truth about a nest in a photo.
type PhotoNest struct {
	ID         uint32
	Species    int // the owner's species index. Never send.
	Site       string
	Stage      uint8
	Visibility float32 // 0..1 after occlusion, site cover and camouflage
	Dist       float32 // metres
	Size       float32 // fraction of frame height
	X, Y       float32 // position in the frame, -1..1
}

// photoNests finds the nests in the frame that are clear enough to count, best
// first.
func photoNests(c *Context, cam camera, eye core.Vec3, nests []core.Nest) []PhotoNest {
	var out []PhotoNest
	for _, n := range nests {
		x, y, depth := cam.project(n.Pos)
		if !cam.inFrame(x, y, depth) {
			continue
		}
		dist := eye.Dist(n.Pos)
		if dist > MaxSightRange {
			continue
		}
		size := maxf(n.Size, 0.05) / (2 * depth * cam.tanV)
		vis := nestFoliage(c, eye, n)
		if vis < nestPhotoMinVisible || size < nestPhotoMinSize {
			continue
		}
		out = append(out, PhotoNest{ID: n.ID, Species: n.Species, Site: n.Site, Stage: n.Stage, Visibility: vis, Dist: dist, Size: size, X: x, Y: y})
	}
	rank := func(p PhotoNest) float32 {
		return distanceScore(p.Size) * p.Visibility * (1 - 0.5*maxf(absf(p.X), absf(p.Y)))
	}
	for i := 1; i < len(out); i++ { // insertion sort: a handful of nests at most
		for j := i; j > 0; j-- {
			a, b := rank(out[j]), rank(out[j-1])
			if a < b || a == b && out[j].ID > out[j-1].ID {
				break
			}
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// nestNote is the feedback line for a nest in a photo. It never names the owner.
func nestNote(stage uint8) string {
	switch stage {
	case core.NestBuilding:
		return "A nest in the making"
	case core.NestEggs:
		return "An active nest - a fine record, taken from a respectful distance"
	case core.NestChicks:
		return "A nest full of hungry chicks"
	}
	return "Last season's nest, still in place"
}
