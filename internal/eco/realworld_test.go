package eco

import (
	"sort"
	"sync"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/species"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Tests on the real generated world and the real species catalog. One world per
// seed for the whole test binary: generation caches are the expensive part, and the
// world is safe for concurrent use.
var (
	worldsMu sync.Mutex
	worlds   = map[int64]*world.World{}
)

func realWorld(text string) (*world.World, int64) {
	seed := world.SeedFromText(text)
	worldsMu.Lock()
	defer worldsMu.Unlock()
	w := worlds[seed]
	if w == nil {
		w = world.New(seed)
		worlds[seed] = w
	}
	return w, seed
}

func cabinPos(t *testing.T, w *world.World) core.Vec3 {
	t.Helper()
	c, ok := w.POI("cabin")
	if !ok {
		t.Fatal("no cabin POI")
	}
	return c.Pos
}

// realSim builds an ecosystem on the real world with the real catalog.
func realSim(t *testing.T, text string) (*Sim, *world.World, []core.Species) {
	t.Helper()
	w, seed := realWorld(text)
	spp := species.All()
	return New(w, spp, seed), w, spp
}

// stillObserver stands quietly at pos (on the ground).
func stillObserver(w core.Terrain, pos core.Vec3) core.Observer {
	pos.Y = w.HeightAt(pos.X, pos.Z)
	o := observerAt(pos)
	o.Still = 100
	o.Move = "still"
	return o
}

// heightAbove is how high a bird is above the ground (or the water plane).
func heightAbove(w core.Terrain, p core.Vec3) float32 {
	return p.Y - max32(w.HeightAt(p.X, p.Z), 0)
}

// regionLand finds a dry-land spot in the middle of a patch of region type r within
// 9 km of the origin, nearest first (ok false if none).
func regionLand(w core.Terrain, r core.RegionID) (core.Vec3, bool) {
	var pts []core.Vec3
	for z := -35; z <= 35; z++ {
		for x := -35; x <= 35; x++ {
			p := core.V(float32(x)*256, 0, float32(z)*256)
			if l := p.Len(); l <= 9000 && l > 0 {
				pts = append(pts, p)
			}
		}
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].Len() < pts[j].Len() })
	for _, q := range pts {
		if w.RegionAt(q.X, q.Z) != r || w.HeightAt(q.X, q.Z) < 1 {
			continue
		}
		ok := true
		for _, d := range []core.Vec3{{X: 150}, {X: -150}, {Z: 150}, {Z: -150}} {
			if w.RegionAt(q.X+d.X, q.Z+d.Z) != r {
				ok = false
			}
		}
		if ok {
			return core.V(q.X, w.HeightAt(q.X, q.Z), q.Z), true
		}
	}
	return core.Vec3{}, false
}
