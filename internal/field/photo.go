package field

import (
	"sort"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Photo-scoring tuning (spec §13.2; contract §3.3.5).
//
// Five sub-scores 0..100 for the best subject, a weighted mean, a behaviour bonus,
// then two caps: the weakest of focus / visibility (a blurred or hidden bird is not
// rescued by nice light) and the camera itself (40 + 60·CamQuality: the starter
// camera, CamQuality 0.5, tops out at 70 = three stars).
const (
	photoDefaultFOV    = 40  // vertical degrees assumed when the photo carries none
	photoDefaultAspect = 1.6 // width / height assumed when the photo carries none
	photoMaxSubjects   = 6

	// A bird counts as "in the photo" from this visibility and frame share.
	photoMinVisible = 0.12
	photoMinSize    = 0.008 // fraction of frame height

	weightFocus       = 0.25
	weightComposition = 0.20
	weightDistance    = 0.20
	weightLighting    = 0.15
	weightVisibility  = 0.20

	shakeBlur = 0.7 // focus lost at full camera shake

	// Composition: placement (centre or a rule-of-thirds point) and subject size.
	placeShare    = 0.55
	sizeShare     = 0.45
	thirdsBonus   = 0.05 // a subject on a thirds point beats one dead centre by this share of the placement score
	thirdsReach   = 0.6  // NDC distance from a thirds point at which its score reaches 0
	edgeStart     = 0.8  // NDC from which a subject is being cut off by the frame edge
	edgeCut       = 0.6
	idealSizeMin  = 0.12 // ideal subject size: 12–45 % of frame height
	idealSizeMax  = 0.45
	smallSizeBase = 0.2 // size score of a vanishingly small subject
	compStatBonus = 15  // points added at Stats.Composition 1

	// Distance: full marks from distFullSize of frame height, (size/full)^distCurve below.
	distFullSize   = 0.10
	distCurve      = 0.55
	distCropStart  = 0.6 // beyond this the bird is cropped by the frame …
	distCropFactor = 0.3 // … losing up to this much

	// Lighting.
	lightBase     = 0.08
	lightGamma    = 0.7
	cloudDull     = 10 // points lost under full overcast (flat light)
	rainDull      = 30
	mistDull      = 25
	goldenFloor   = 80   // golden-hour light is at least this good …
	goldenBonus   = 15   // … plus this
	goldenMinLux  = 0.15 // Env.Light window in which dawn / evening light is "golden"
	goldenMaxLux  = 0.85
	goldenMaxRain = 0.1
	goldenMaxCld  = 0.6

	behaviorBonus = 3  // points for catching an uncommon behaviour
	momentPoints  = 10 // extra points at Stats.MomentBonus 1

	weakLinkBase  = 25 // score ≤ weakLinkBase + weakLinkSlope × min(focus, visibility)
	weakLinkSlope = 1.5

	camCapBase  = 40 // score ≤ camCapBase + camCapRange × CamQuality
	camCapRange = 60

	exceptionalScore = 90
)

// PhotoBird is the server-side truth about one bird in a photo.
type PhotoBird struct {
	ID         uint32
	Species    int // species index. Never send.
	Act        core.BirdAct
	Flags      uint8
	Visibility float32 // 0..1 after occlusion and cover
	Dist       float32 // metres
	Size       float32 // fraction of frame height
	X, Y       float32 // position in the frame, -1..1 (x right, y up)
}

// PhotoScore is the result of ScorePhoto.
type PhotoScore struct {
	// Meta carries Day, Time, Region, Weather, Subjects, the sub-scores, Score,
	// Stars and Tags. The session assigns ID and URL.
	Meta proto.PhotoMeta
	// Notes are feedback lines for proto.PhotoResult.Notes, most important first.
	Notes []string
	// Birds is parallel to Meta.Subjects (best subject first): the truth the
	// session needs for journal, quest and XP bookkeeping.
	Birds []PhotoBird
	// Nests are the nests clearly in the frame, best first (server truth: never
	// send Species). A photo of a nest alone has no Subjects but does score stars.
	Nests []PhotoNest
	// NestSubject: the main subject of the photo is a nest (Nests[0]), not a bird.
	NestSubject bool
	// Rare: the main subject is a rare species, an out-of-range visitor or has
	// unusual plumage. The "rare" tag itself is only added to Meta.Tags when the
	// player has identified the species (rarity is never announced early); the
	// session may add it on a later identification.
	Rare bool
	// Capped: the camera's quality limited the score.
	Capped bool
}

// ScorePhoto scores a shutter press without nests (see ScorePhotoWith).
func ScorePhoto(c *Context, ph proto.Photo, birds []core.BirdState) PhotoScore {
	return ScorePhotoWith(c, ph, birds, nil)
}

// ScorePhotoWith scores a shutter press against the true world state: which birds
// and nests are in the frustum and visible, and for the best subject how sharp, well
// composed, close, well lit and unobstructed the shot is. birds should be
// Ecosystem.Near(eye, MaxSightRange), nests Ecosystem.Nests(eye, MaxSightRange). A
// nest in the frame and reasonably clear adds the tags "nest" and
// "nest:<old|building|eggs|chicks>" and a small bonus; a nest on its own is a valid
// subject. A photo with neither scores 0 stars - and is still a photo.
func ScorePhotoWith(c *Context, ph proto.Photo, birds []core.BirdState, nests []core.Nest) PhotoScore {
	st, env := c.Stats, c.Env
	eye := core.V(ph.X, ph.Y, ph.Z)
	fov, aspect := ph.FOV, ph.Aspect
	if fov <= 0.5 || fov > 150 {
		fov = photoDefaultFOV
	}
	if aspect <= 0.2 || aspect > 5 {
		aspect = photoDefaultAspect
	}
	cam := newCamera(eye, ph.Yaw, ph.Pitch, rad(fov)/2, aspect)

	out := PhotoScore{Meta: proto.PhotoMeta{
		Day: env.Day, Time: env.Time, Weather: int(env.Weather),
		Region:   int(c.Terrain.RegionAt(eye.X, eye.Z)),
		Subjects: []proto.PhotoSubject{}, Tags: []string{},
	}}

	type subject struct {
		PhotoBird
		sp   *core.Species
		rank float32
	}
	var subs []subject
	for _, b := range birds {
		sp := c.SpeciesAt(b.Species)
		if sp == nil {
			continue
		}
		x, y, depth := cam.project(b.Pos)
		if !cam.inFrame(x, y, depth) {
			continue
		}
		dist := eye.Dist(b.Pos)
		if dist > MaxSightRange {
			continue
		}
		extent := sp.Look.Length
		if b.Act.Airborne() && sp.Look.Wingspan*wingspanShare > extent {
			extent = sp.Look.Wingspan * wingspanShare
		}
		size := extent / (2 * depth * cam.tanV)
		vis := sightline(c, eye, b, sp)
		if vis < photoMinVisible || size < photoMinSize {
			continue
		}
		off := maxf(absf(x), absf(y))
		subs = append(subs, subject{
			PhotoBird: PhotoBird{ID: b.ID, Species: b.Species, Act: b.Act, Flags: b.Flags, Visibility: vis, Dist: dist, Size: size, X: x, Y: y},
			sp:        sp,
			rank:      distanceScore(size) * vis * (1 - 0.5*off),
		})
	}
	out.Nests = photoNests(c, cam, eye, nests)
	if len(subs) == 0 && len(out.Nests) == 0 {
		out.Notes = []string{"No bird in the frame - but a pleasant view all the same."}
		return out
	}
	sort.SliceStable(subs, func(i, j int) bool {
		if subs[i].rank != subs[j].rank {
			return subs[i].rank > subs[j].rank
		}
		return subs[i].ID < subs[j].ID
	})
	if len(subs) > photoMaxSubjects {
		subs = subs[:photoMaxSubjects]
	}
	know := c.know()
	for _, s := range subs {
		ps := proto.PhotoSubject{Behavior: s.Act.Key(), Dist: s.Dist, Size: s.Size}
		if know.Identified(s.sp.ID) {
			ps.Species = s.sp.ID
		} else if m := know.Mystery(s.sp.ID); m != nil {
			ps.Mystery = m.ID
		}
		out.Meta.Subjects = append(out.Meta.Subjects, ps)
		out.Birds = append(out.Birds, s.PhotoBird)
	}
	// The main subject: the best bird, unless a nest makes the better picture.
	var mX, mY, mSize, mVis, mMotion float32
	var mainBird subject
	if len(subs) > 0 {
		mainBird = subs[0]
		mX, mY, mSize, mVis = mainBird.X, mainBird.Y, mainBird.Size, mainBird.Visibility
		mMotion = actMotion[mainBird.Act%core.ActCount]
	}
	if len(out.Nests) > 0 {
		n := out.Nests[0]
		if nr := distanceScore(n.Size) * n.Visibility * (1 - 0.5*maxf(absf(n.X), absf(n.Y))) * nestOnlyFactor; len(subs) == 0 || nr > mainBird.rank {
			out.NestSubject = true
			mX, mY, mSize, mVis, mMotion = n.X, n.Y, n.Size, n.Visibility, 0
		}
	}

	// --- Focus: optical sharpness, camera shake, a subject moving through the frame.
	shake := clamp01(ph.Shake)
	focus := 100 * clamp01(ph.Sharp) * (1 - shakeBlur*shake) * (1 - mMotion*0.5)

	// --- Composition: placement and size in frame.
	centre := clamp01(1 - sqrt32(mX*mX+mY*mY))
	tx, ty := absf(mX)-1.0/3, absf(mY)-1.0/3
	thirds := clamp01(1 - sqrt32(tx*tx+ty*ty)/thirdsReach)
	place := maxf(centre*(1-thirdsBonus), thirds)
	if off := maxf(absf(mX), absf(mY)); off > edgeStart {
		place *= 1 - edgeCut*clamp01((off-edgeStart)/(1-edgeStart))
	}
	comp := 100*(placeShare*place+sizeShare*idealSize(mSize)) + compStatBonus*clamp01(st.Composition)

	// --- Distance: how much of the frame the subject fills.
	distance := 100 * distanceScore(mSize)

	// --- Lighting.
	light := 100*(lightBase+(1-lightBase)*pow32(clamp01(env.Light), lightGamma)) -
		cloudDull*clamp01(env.Cloud) - rainDull*clamp01(env.Rain) - mistDull*clamp01(env.Mist)
	golden := goldenHour(env)
	if golden {
		light = maxf(light, goldenFloor) + goldenBonus
	}

	// --- Visibility.
	vis := 100 * mVis

	m := &out.Meta
	m.Focus, m.Composition, m.Distance = pct(focus), pct(comp), pct(distance)
	m.Lighting, m.Visibility = pct(light), pct(vis)

	score := weightFocus*float32(m.Focus) + weightComposition*float32(m.Composition) +
		weightDistance*float32(m.Distance) + weightLighting*float32(m.Lighting) +
		weightVisibility*float32(m.Visibility)
	moment := !out.NestSubject && mainBird.Act.UncommonBehaviour()
	if moment {
		score += behaviorBonus + momentPoints*clamp01(st.MomentBonus)
	}
	if len(out.Nests) > 0 {
		score += nestPhotoBonus
	}
	weak := float32(m.Focus)
	if m.Visibility < m.Focus {
		weak = float32(m.Visibility)
	}
	score = minf(score, weakLinkBase+weakLinkSlope*weak)
	if limit := camCapBase + camCapRange*clamp01(st.CamQuality); score > limit {
		score, out.Capped = limit, true
	}
	m.Score = pct(score)
	m.Stars = starsFor(m.Score)

	// --- Tags.
	if !out.NestSubject {
		m.Tags = append(m.Tags, "behavior:"+mainBird.Act.Key())
		if mainBird.Act.Airborne() {
			m.Tags = append(m.Tags, "flight")
		}
	}
	if len(out.Nests) > 0 {
		m.Tags = append(m.Tags, "nest", "nest:"+NestStageKey(out.Nests[0].Stage))
	}
	if golden {
		m.Tags = append(m.Tags, "golden hour")
	}
	if !out.NestSubject {
		out.Rare = isUnusual(mainBird.sp, mainBird.Flags)
		if out.Rare && know.Identified(mainBird.sp.ID) {
			m.Tags = append(m.Tags, "rare")
		}
	}
	if m.Score >= exceptionalScore {
		m.Tags = append(m.Tags, "exceptional")
	}

	out.Notes = photoNotes(out, ph, env, mainBird.Act, golden, moment)
	return out
}

// goldenHour reports the warm low light of dawn and evening on a clear-ish day.
func goldenHour(env core.Env) bool {
	ph := env.Phase()
	return (ph == core.PhaseDawn || ph == core.PhaseEvening) &&
		env.Light >= goldenMinLux && env.Light <= goldenMaxLux &&
		env.Rain < goldenMaxRain && env.Cloud < goldenMaxCld
}

func distanceScore(size float32) float32 {
	s := minf(pow32(size/distFullSize, distCurve), 1)
	if size > distCropStart {
		s *= 1 - distCropFactor*clamp01((size-distCropStart)/(1-distCropStart))
	}
	return s
}

func idealSize(size float32) float32 {
	switch {
	case size < idealSizeMin:
		return smallSizeBase + (1-smallSizeBase)*size/idealSizeMin
	case size > idealSizeMax:
		return 1 - 0.7*clamp01((size-idealSizeMax)/0.5)
	}
	return 1
}

func pct(v float32) int { return roundInt(clamp(v, 0, 100)) }

// photoNotes writes the feedback lines: the main flaw first, then what went well.
// At most four, so the result card stays light.
func photoNotes(s PhotoScore, ph proto.Photo, env core.Env, act core.BirdAct, golden, moment bool) []string {
	m := s.Meta
	var notes []string
	add := func(line string) {
		if len(notes) < 4 {
			notes = append(notes, line)
		}
	}
	switch {
	case m.Focus < 40 && ph.Shake > 0.5:
		add("Camera shake blurred the shot - brace, crouch or breathe out first")
	case m.Focus < 40:
		add("Out of focus - give the lens a moment")
	case m.Focus < 70 && ph.Shake > 0.4:
		add("A little camera shake - steady your hands")
	case m.Focus < 70:
		add("Slightly soft - let the focus settle")
	}
	if m.Visibility < 50 {
		add("Hidden behind foliage")
	} else if m.Visibility < 75 {
		add("Partly screened by leaves")
	}
	if m.Distance < 45 {
		add("Too far for detail")
	} else if m.Distance < 70 {
		add("A little distant - closer or more zoom would show more")
	}
	switch {
	case env.Light < 0.2 && !golden:
		add("Too dark for a clean exposure")
	case env.Rain > 0.4:
		add("Rain softened the image")
	case env.Mist > 0.5:
		add("Mist washed out the colours")
	case golden && env.Phase() == core.PhaseEvening:
		add("Lovely evening light")
	case golden:
		add("Lovely dawn light")
	}
	if m.Composition < 45 {
		add("The subject sits awkwardly in the frame")
	} else if m.Composition >= 85 && m.Focus >= 70 {
		add("Nicely framed")
	}
	if len(s.Nests) > 0 {
		add(nestNote(s.Nests[0].Stage))
	}
	if moment {
		add("A real moment: " + act.Key())
	}
	if s.Capped {
		add("This camera has given all it can - better glass would do the scene justice")
	}
	if len(notes) == 0 {
		add("A clean, honest record shot")
	}
	return notes
}
