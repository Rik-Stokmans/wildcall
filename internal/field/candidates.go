package field

import (
	"math"
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Identification-confidence tuning (spec §13.1; contract §3.3.4).
//
// Every eligible species gets score = prior × Π factor(key)^sharpness over the
// evidence. A matching key multiplies the score up, a "close" value (adjacent
// size, a similar colour) down a little, a miss down hard — never to zero, because
// an observation can be a little wrong. The top entries are normalised to 100 %.
//
// With the full visual set (size, shape, primary, secondary, marking) the true
// species leads by orders of magnitude and sits well above the 70 % "certain"
// line; with only a size or only a pitch the table stays flat and ambiguous.
type fitWeight struct{ match, close, miss float64 }

var evidenceWeights = map[string]fitWeight{
	"size":      {2.0, 0.55, 0.10},
	"shape":     {3.0, 1, 0.08},
	"primary":   {2.2, 0.50, 0.12},
	"secondary": {1.8, 0.55, 0.20},
	"marking":   {6.0, 1, 0.04}, // the key field mark is close to proof
	"bill":      {1.6, 1, 0.20},
	"flight":    {1.5, 1, 0.30},
	"pitch":     {1.5, 0.70, 0.30},
	"pattern":   {2.0, 1, 0.30},
	"behavior":  {1.6, 1, 0.40}, // only for behaviours that say something about a way of life
}

const (
	// Habitat evidence is a mild prior, never proof: birds wander.
	habitatBase  = 1.0
	habitatGain  = 0.8 // match factor = base + gain × the species' weight for that habitat
	habitatMiss  = 0.65
	regionMiss   = 0.45 // prior for a species that does not live in the encounter's region type
	seasonMiss   = 0.30 // prior for a species that is away this season
	uncommonBias = 0.85 // rarity priors: scarcer birds are less likely a priori …
	rareBias     = 0.55 // … Stats.RareID lifts the rare ones back toward 1
	legendBias   = 0.35

	// Sharpness: evidence factors are raised to 1 + idAssistSharp·IDAssist, plus
	// rareIDSharp·RareID for rare or difficult species; audio evidence additionally
	// to 1 + audioSharp·AudioAssist.
	idAssistSharp = 0.2
	rareIDSharp   = 0.4
	audioSharp    = 0.25
	hardSpecies   = 4 // Species.Difficulty from which RareID applies

	candidatesShort = 3 // table length with IDAssist < 1
	candidatesLong  = 5 // … with IDAssist >= 1

	// CertainConfidence is the confidence (%) from which a correct identification is
	// "certain" rather than "probable" (contract §3.6).
	CertainConfidence = 70
	// MinEvidence is the number of evidence keys an identification needs at all.
	MinEvidence = 2
)

// IDContext is the circumstance of an encounter, as far as it bears on
// identification.
type IDContext struct {
	// Region is the region type where the bird was met; species that do not live
	// there are less likely. core.RegionNone = unknown (no prior).
	Region core.RegionID
	Season core.Season
	// Unlocked are the region ids the player may enter: only species living in one
	// of them are considered. Empty = every species.
	Unlocked []int
	// Include lists species ids to consider regardless of Unlocked. The session
	// passes the true species of a mystery here when it is a visitor from a region
	// the player has not unlocked, so a vagrant can be identified at all.
	Include []string
}

// EncounterContext builds the IDContext of meeting a bird of species sp at pos.
func EncounterContext(c *Context, sp *core.Species, pos core.Vec3) IDContext {
	ic := IDContext{Region: c.Terrain.RegionAt(pos.X, pos.Z), Season: c.Env.Season, Unlocked: c.Regions}
	if sp != nil && !livesInAny(sp, c.Regions) {
		ic.Include = []string{sp.ID}
	}
	return ic
}

// MysteryContext builds the IDContext for reviewing a mystery later (journal,
// research desk): the region where it was last noticed and the current season.
func MysteryContext(c *Context, m *proto.Mystery) IDContext {
	ic := IDContext{Region: core.RegionNone, Season: c.Env.Season, Unlocked: c.Regions}
	if m == nil {
		return ic
	}
	if m.Region >= 0 && m.Region < int(core.RegionCount) {
		ic.Region = core.RegionID(m.Region)
	}
	if m.Species != "" {
		for i := range c.Species {
			if c.Species[i].ID == m.Species && !livesInAny(&c.Species[i], c.Regions) {
				ic.Include = []string{m.Species}
			}
		}
	}
	return ic
}

// Candidates computes the identification confidence table for a set of evidence
// (key → raw vocabulary value, see core.EvidenceKeys). wrong lists species ids the
// player has already ruled out by a wrong guess; they never appear. The result is
// the top 5 species (top 3 with Stats.IDAssist < 1), most likely first, with integer
// percentages that sum to exactly 100; entries that round to 0 % are dropped.
// With no evidence at all the table is empty. Deterministic.
func Candidates(evidence map[string]string, wrong []string, ic IDContext, st core.Stats, catalog []core.Species) []proto.Candidate {
	if EvidenceCount(evidence) == 0 {
		return []proto.Candidate{}
	}
	type scored struct {
		sp    *core.Species
		score float64
	}
	var list []scored
	for i := range catalog {
		sp := &catalog[i]
		if contains(wrong, sp.ID) {
			continue
		}
		if len(ic.Unlocked) > 0 && !livesInAny(sp, ic.Unlocked) && !contains(ic.Include, sp.ID) {
			continue
		}
		list = append(list, scored{sp, speciesScore(sp, evidence, ic, st)})
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].sp.Index < list[j].sp.Index
	})
	n := candidatesShort
	if st.IDAssist >= 1 {
		n = candidatesLong
	}
	if len(list) > n {
		list = list[:n]
	}
	var total float64
	for _, s := range list {
		total += s.score
	}
	if total <= 0 {
		return []proto.Candidate{}
	}

	// Largest-remainder rounding so the table sums to exactly 100.
	pct := make([]int, len(list))
	frac := make([]float64, len(list))
	sum := 0
	for i, s := range list {
		exact := s.score / total * 100
		pct[i] = int(math.Floor(exact))
		frac[i] = exact - float64(pct[i])
		sum += pct[i]
	}
	for sum < 100 {
		best := 0
		for i := range frac {
			if frac[i] > frac[best] {
				best = i
			}
		}
		pct[best]++
		frac[best] = -1
		sum++
	}
	out := make([]proto.Candidate, 0, len(list))
	for i, s := range list {
		if pct[i] > 0 {
			out = append(out, proto.Candidate{Species: s.sp.ID, Confidence: pct[i]})
		}
	}
	// Rounding can reorder near-ties; keep the table sorted as shown.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Confidence > out[j].Confidence })
	return out
}

// Confidence returns a species' percentage in a candidate table (0 if absent).
func Confidence(cands []proto.Candidate, speciesID string) int {
	for _, c := range cands {
		if c.Species == speciesID {
			return c.Confidence
		}
	}
	return 0
}

// ConfidenceFor is the confidence (%) the evidence gives to one species: the number
// the session compares with CertainConfidence when the player submits it.
func ConfidenceFor(speciesID string, evidence map[string]string, wrong []string, ic IDContext, st core.Stats, catalog []core.Species) int {
	return Confidence(Candidates(evidence, wrong, ic, st, catalog), speciesID)
}

func speciesScore(sp *core.Species, evidence map[string]string, ic IDContext, st core.Stats) float64 {
	score := 1.0

	// Priors.
	rareID := float64(clamp01(st.RareID))
	switch sp.Rarity {
	case core.Uncommon:
		score *= uncommonBias
	case core.Rare:
		score *= rareBias + (1-rareBias)*rareID
	case core.Legendary:
		score *= legendBias + (1-legendBias)*rareID
	}
	if ic.Region < core.RegionCount && !livesIn(sp, ic.Region) {
		score *= regionMiss
	}
	if !sp.Seasons[ic.Season&3] {
		score *= seasonMiss
	}

	// Evidence.
	sharp := 1 + idAssistSharp*float64(clamp(st.IDAssist, 0, 3))
	if sp.Rarity >= core.Rare || sp.Difficulty >= hardSpecies {
		sharp += rareIDSharp * rareID
	}
	audio := 1 + audioSharp*float64(clamp(st.AudioAssist, 0, 3))
	// Fixed key order: float products must not depend on map iteration order.
	for _, key := range core.EvidenceKeys {
		value := evidence[key]
		fit := Fits(sp, key, value)
		if fit == FitNeutral {
			continue
		}
		if key == "habitat" {
			if fit == FitMatch {
				score *= habitatBase + habitatGain*float64(habitatWeight(sp, value))
			} else {
				score *= habitatMiss
			}
			continue
		}
		w, ok := evidenceWeights[key]
		if !ok {
			continue
		}
		f := w.miss
		switch fit {
		case FitMatch:
			f = w.match
		case FitClose:
			f = w.close
		}
		exp := sharp
		if key == "pitch" || key == "pattern" {
			exp *= audio
		}
		score *= math.Pow(f, exp)
	}
	return score
}

// Fit says how well one piece of evidence agrees with a species.
type Fit uint8

const (
	FitNeutral Fit = iota // says nothing either way (unknown key, empty value, everyday behaviour)
	FitMatch              // agrees
	FitClose              // nearly agrees: an adjacent size or pitch, a similar colour
	FitMiss               // disagrees
)

// Fits compares an evidence value with a species. Audio evidence (pitch, pattern)
// matches if ANY of the species' calls has that value, since the bird may have
// given its alarm or contact call rather than its song.
func Fits(sp *core.Species, key, value string) Fit {
	if sp == nil || value == "" {
		return FitNeutral
	}
	exact := func(truth string) Fit {
		switch {
		case truth == "":
			return FitNeutral
		case truth == value:
			return FitMatch
		}
		return FitMiss
	}
	switch key {
	case "size":
		return ordinalFit(sizeOrder[:], sp.Traits.Size, value)
	case "shape":
		return exact(sp.Traits.Shape)
	case "primary":
		return colourFit(value, sp.Traits.Primary, sp.Traits.Secondary)
	case "secondary":
		return colourFit(value, sp.Traits.Secondary, sp.Traits.Primary)
	case "marking":
		return exact(sp.Traits.Marking)
	case "bill":
		return exact(sp.Traits.Bill)
	case "flight":
		if sp.Traits.Flight == "" {
			return exact(sp.Move.Flight)
		}
		return exact(sp.Traits.Flight)
	case "pitch":
		best := FitNeutral
		for i := range sp.Calls {
			best = betterFit(best, ordinalFit(pitchOrder[:], sp.Calls[i].Pitch, value))
		}
		return best
	case "pattern":
		best := FitNeutral
		for i := range sp.Calls {
			if sp.Calls[i].Pattern != "" {
				best = betterFit(best, exact(sp.Calls[i].Pattern))
			}
		}
		return best
	case "habitat":
		if len(sp.Habitats) == 0 {
			return FitNeutral
		}
		if habitatWeight(sp, value) > 0 {
			return FitMatch
		}
		return FitMiss
	case "behavior":
		return behaviorFit(sp, value)
	}
	return FitNeutral
}

// betterFit keeps the more favourable of two fits (match > close > miss > neutral).
func betterFit(a, b Fit) Fit {
	rank := func(f Fit) int {
		switch f {
		case FitMatch:
			return 3
		case FitClose:
			return 2
		case FitMiss:
			return 1
		}
		return 0
	}
	if rank(b) > rank(a) {
		return b
	}
	return a
}

var (
	sizeOrder  = [...]string{"tiny", "small", "medium", "large", "huge"}
	pitchOrder = [...]string{"low", "medium", "high", "very high"}
)

// ordinalFit compares values on an ordered scale: neighbours are "close".
func ordinalFit(scale []string, truth, value string) Fit {
	ti, vi := indexOf(scale, truth), indexOf(scale, value)
	switch {
	case truth == "" || vi < 0:
		return FitNeutral
	case truth == value:
		return FitMatch
	case ti >= 0 && (ti-vi == 1 || vi-ti == 1):
		return FitClose
	}
	return FitMiss
}

// similarColours are colour words an honest observer may confuse in the field.
var similarColours = [...][2]string{
	{"brown", "buff"}, {"buff", "orange"}, {"orange", "red"}, {"red", "pink"},
	{"grey", "blue"}, {"grey", "black"}, {"grey", "white"}, {"green", "yellow"},
	{"buff", "yellow"}, {"brown", "orange"}, {"buff", "white"},
}

// colourFit compares a colour word with the species' colour in that role; the
// species' other colour or a similar colour is "close".
func colourFit(value, truth, other string) Fit {
	switch {
	case truth == "":
		return FitNeutral
	case value == truth:
		return FitMatch
	case value == other:
		return FitClose
	}
	for _, p := range similarColours {
		if (p[0] == value && p[1] == truth) || (p[1] == value && p[0] == truth) {
			return FitClose
		}
	}
	return FitMiss
}

// behaviorFit judges behaviour evidence. Only behaviours that reflect a way of life
// discriminate (a soaring bird is not a wren); everyday ones are neutral.
func behaviorFit(sp *core.Species, key string) Fit {
	a, ok := actFromKey(key)
	if !ok {
		return FitNeutral
	}
	does := contains(sp.Behavior.Specials, key)
	yes := func(cond bool) Fit {
		if cond || does {
			return FitMatch
		}
		return FitMiss
	}
	switch a {
	case core.ActSoaring:
		return yes(sp.Move.Flight == "soaring" || sp.Traits.Flight == "soaring")
	case core.ActHovering:
		return yes(sp.Move.Flight == "hover" || sp.Traits.Flight == "hover")
	case core.ActClimbing:
		return yes(sp.Move.Ground == "cling" || sp.Behavior.Feeding == "trunk" || contains(sp.Behavior.Perches, "trunk"))
	case core.ActSwimming:
		return yes(sp.Move.Ground == "swim" || contains(sp.Behavior.Perches, "water"))
	case core.ActWading:
		return yes(sp.Move.Ground == "wade" || contains(sp.Behavior.Perches, "shore"))
	case core.ActDiving:
		return yes(sp.Behavior.Feeding == "dive" || sp.Behavior.Feeding == "plunge")
	}
	if does {
		return FitMatch // one of the species' own special behaviours (bathing, social…)
	}
	return FitNeutral
}

// Misfit finds the most telling piece of evidence that contradicts a species: the
// gentle explanation for a wrong guess. ok is false if nothing clearly disagrees.
func Misfit(sp *core.Species, evidence map[string]string) (key, value string, ok bool) {
	// Most telling first; habitat is only ever a hint, so it is never blamed.
	for _, k := range [...]string{"marking", "shape", "size", "primary", "secondary", "bill", "flight", "pattern", "pitch", "behavior"} {
		if v := evidence[k]; v != "" && Fits(sp, k, v) == FitMiss {
			return k, v, true
		}
	}
	return "", "", false
}

// MisfitNote phrases Misfit as one gentle sentence for proto.IdentifyResult.Feedback
// ("" if nothing clearly disagrees). It only mentions the species the player
// guessed, never the true one.
func MisfitNote(sp *core.Species, evidence map[string]string) string {
	key, value, ok := Misfit(sp, evidence)
	if !ok {
		return ""
	}
	name := withArticle(sp.Name)
	switch key {
	case "marking":
		return "You noted its " + value + ", which " + name + " does not have."
	case "shape":
		return "Its outline was that of " + withArticle(value) + "; " + name + " is built differently."
	case "size":
		return "The bird you watched was " + value + "; " + name + " is " + sp.Traits.Size + "."
	case "primary", "secondary":
		return "You noted " + value + " in its plumage, which " + name + " does not show."
	case "bill":
		return "Its bill looked " + value + "; " + name + " has a different bill."
	case "flight":
		return "Its flight was " + value + ", unlike the flight of " + name + "."
	case "pattern":
		return "The call you heard was " + value + ", unlike the voice of " + name + "."
	case "pitch":
		return "The call you heard was " + value + "-pitched, which does not suit " + name + "."
	case "behavior":
		return "You watched it " + value + ", which is not something " + name + " does."
	}
	return ""
}

func withArticle(noun string) string {
	if noun == "" {
		return noun
	}
	if soundsLikeYou(noun) {
		return "a " + noun
	}
	switch noun[0] {
	case 'a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U':
		return "an " + noun
	}
	return "a " + noun
}

func habitatWeight(sp *core.Species, habitatKey string) float32 {
	for _, h := range sp.Habitats {
		if h.Habitat == habitatKey {
			return maxf(h.Weight, 0.01)
		}
	}
	return 0
}

func livesIn(sp *core.Species, r core.RegionID) bool {
	for _, x := range sp.Regions {
		if x == r {
			return true
		}
	}
	return false
}

// livesInAny reports whether the species lives in one of the region ids. An empty
// list means "no restriction".
func livesInAny(sp *core.Species, regions []int) bool {
	if len(regions) == 0 {
		return true
	}
	for _, x := range sp.Regions {
		for _, r := range regions {
			if int(x) == r {
				return true
			}
		}
	}
	return false
}

func contains(list []string, s string) bool {
	return indexOf(list, s) >= 0
}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

// soundsLikeYou reports a word that starts with a vowel letter but a "you" sound
// ("European", "Eurasian", "unique"), which takes "a", not "an".
func soundsLikeYou(word string) bool {
	w := strings.ToLower(word)
	return strings.HasPrefix(w, "eu") || strings.HasPrefix(w, "uni") || strings.HasPrefix(w, "use") || strings.HasPrefix(w, "usu")
}

// SoundsLikeYou is soundsLikeYou for other packages that build "a"/"an" phrases.
func SoundsLikeYou(word string) bool { return soundsLikeYou(word) }
