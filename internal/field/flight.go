package field

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Following a flushed bird with the eye. The session samples a flushed bird's
// flight with InSight to tell whether the player watched it go and saw where it
// landed ("flushed and watched to its landing").

// sightOccBlock: a line of sight this blocked (a hill, a solid wall of crowns) loses
// the bird.
const sightOccBlock = 0.85

// InSight reports whether the point pos is inside the player's current view
// (naked eye or optics, with a little margin for a bird near the edge) and not
// hidden behind terrain or dense foliage.
func InSight(c *Context, p proto.Pose, pos core.Vec3) bool {
	eye := Eye(p)
	if eye.Dist(pos) < 0.3 {
		return true
	}
	cam := newCamera(eye, p.Yaw, p.Pitch, halfFOV(p, c.Stats)*1.15, cueAspect)
	if !cam.inFrame(cam.project(pos)) {
		return false
	}
	return c.Terrain == nil || c.Terrain.Occlusion(eye, pos) < sightOccBlock
}
