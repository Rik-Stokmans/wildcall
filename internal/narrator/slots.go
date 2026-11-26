package narrator

import (
	"sort"
	"strings"
	"unicode"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// slots are the words a template may use. A template is only eligible when every
// {slot} it mentions has a non-empty value.
//
// Every slot value comes from a small CLOSED vocabulary (the tables below), chosen
// deterministically from what the player perceived, so the set of sentences the
// narrator can ever say is finite and enumerable (AllLines) and can be voiced ahead of
// time (docs/contract.md §13). Anything outside a vocabulary — free text, an unknown
// key — simply leaves the slot empty, and the templates that need it are skipped.
//
// Slots for any bird (built from perception only):
//
//	sound   "a rippling trill"             pitch  "a high, thin voice"
//	where   "high in the canopy"           dist   "not far off"
//	elev    "somewhere above me"           dir    "to the northeast"
//	size    "small"                        shape  "a round, busy little shape"
//	colours "mostly brown"                 bill   "a fine, thin bill"
//	flight  "a bounding, dipping flight"   habitat "the reedbed"
//	act     "busy foraging"                subj   "the small bird" (unidentified only)
//
// Slots only for identified birds: name "wren", aname "a wren".
// Other slots: title (rank), mismatch (identification).
type slots map[string]string

// perceived is everything the player can have noticed about a bird. It deliberately
// holds no species: the unknown-bird path is built from this alone.
type perceived struct {
	pitch, pattern, habitat, perch, dir, elevation string
	distMin, distMax, strength                     float32
	evidence                                       map[string]string
	behavior, blocked                              string
}

func perceive(c *proto.Clue, evidence map[string]string, behavior, blocked string) perceived {
	p := perceived{evidence: evidence, behavior: behavior, blocked: blocked}
	if c != nil {
		p.pitch, p.pattern, p.habitat, p.perch = c.Pitch, c.Pattern, c.Habitat, c.Perch
		p.dir, p.elevation = c.Dir, c.Elevation
		p.distMin, p.distMax, p.strength = c.DistMin, c.DistMax, c.Strength
	}
	// Evidence can supply pitch/pattern (from recordings or focus listening).
	if p.pitch == "" {
		p.pitch = evidence["pitch"]
	}
	if p.pattern == "" {
		p.pattern = evidence["pattern"]
	}
	return p
}

// unknownSlots fills slots for an unidentified bird from perception alone.
func (n *Narrator) unknownSlots(p perceived) slots {
	sl := perceptionSlots(p)
	size := sizeWord(p.evidence["size"])
	colour := colourWord(p.evidence["primary"])
	switch {
	case size != "":
		sl["subj"] = "the " + size + " bird"
	case colour != "":
		sl["subj"] = "the " + colour + " bird"
	default:
		sl["subj"] = "our mystery bird"
	}
	return sl
}

// knownSlots fills slots for a bird the player has identified.
func (n *Narrator) knownSlots(sp *core.Species, p perceived) slots {
	sl := perceptionSlots(p)
	nameSlots(sl, sp)
	return sl
}

// nameSlots adds {name} and {aname} for an identified species.
func nameSlots(sl slots, sp *core.Species) {
	name := shortName(sp)
	sl["name"] = name
	sl["aname"] = article(name) + " " + name
}

// perceptionSlots turns perceived qualities into speakable phrases. Deterministic: the
// same perception always gives the same words.
func perceptionSlots(p perceived) slots {
	sl := slots{}
	set := func(k, v string) {
		if v != "" {
			sl[k] = v
		}
	}
	set("where", wherePhrase(p.perch, p.habitat))
	set("sound", soundPhrase(p.pitch, p.pattern))
	set("pitch", pitchVoice[norm(p.pitch)])
	if p.distMax > 0 {
		set("dist", distPhrase((p.distMin+p.distMax)/2))
	}
	set("elev", elevPhrases[norm(p.elevation)])
	set("dir", dirPhrase(p.dir))
	ev := p.evidence
	set("size", sizeWord(ev["size"]))
	set("shape", shapePhrase(ev["shape"]))
	set("colours", colourPhrase(ev["primary"]))
	set("bill", billPhrase(ev["bill"]))
	set("flight", flightPhrase(ev["flight"]))
	set("habitat", habitatPhrase(ev["habitat"]))
	act := p.behavior
	if act == "" {
		act = ev["behavior"]
	}
	set("act", actPhrase(act))
	return sl
}

// contextSlots adds the player's surroundings. (No template uses the region name
// today; the hook is kept for flavour lines keyed by pool instead.)
func (n *Narrator) contextSlots(sl slots, c Context) {}

// norm lower-cases and trims a perception value.
func norm(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// ---------------------------------------------------------------------------
// Vocabulary (closed: every value here is enumerated by slotDomain)

// patternSound: the spoken phrase for a call pattern.
var patternSound = map[string]string{
	"repeated": "an insistent, repeated phrase",
	"trill":    "a rippling trill",
	"melodic":  "a fluent, melodic song",
	"single":   "a single clear note",
	"harsh":    "a harsh, rasping call",
	"drumming": "a rapid drumming",
	"booming":  "a deep, hollow boom",
	"whistle":  "a clear, fluting whistle",
	"chatter":  "a busy, scratchy chatter",
	"laughing": "a raucous, laughing call",
}

// pitchSound: the spoken phrase when only the pitch was caught.
var pitchSound = map[string]string{
	"low":       "a low, deep call",
	"medium":    "a mid-pitched call",
	"high":      "a high, thin call",
	"very high": "a needle-thin, very high call",
}

// pitchVoice: how the voice's pitch is described on its own.
var pitchVoice = map[string]string{
	"low":       "a low voice",
	"medium":    "a voice of middling pitch",
	"high":      "a high voice",
	"very high": "a very high, thin voice",
}

func normPattern(s string) string { return norm(s) }

// soundPhrase names what the player heard: the pattern when it is known (the more
// telling quality), else the pitch, else nothing.
func soundPhrase(pitch, pattern string) string {
	if s := patternSound[normPattern(pattern)]; s != "" {
		return s
	}
	return pitchSound[norm(pitch)]
}

// perchWhere: the Habitat Reading perch hints (field.perchHint), kept to this list.
var perchWhere = map[string]string{
	"on the wing":             "on the wing",
	"out on the water":        "out on the water",
	"at the water's edge":     "at the water's edge",
	"on a trunk":              "on a tree trunk",
	"high in the canopy":      "high in the canopy",
	"on a high, open perch":   "on a high, open perch",
	"among mid-level foliage": "among the middle branches",
	"on an open branch":       "on an open branch",
	"low in dense cover":      "low in dense cover",
	"on a low perch":          "on a low perch",
	"on or near the ground":   "down near the ground",
}

var habitatWhere = map[string]string{
	"Open sea":        "out over the sea",
	"Shoreline":       "along the shore",
	"Open meadow":     "out in the meadow grass",
	"Woodland canopy": "up in the leaves",
	"Pine forest":     "among the pines",
	"Reedbed":         "deep in the reeds",
	"Riverside":       "down by the water",
	"Mountain slope":  "up on the slope",
	"Cliff face":      "up on the rocks",
	"Snowfield":       "out across the snow",
	"Dense shrubs":    "deep in the thicket",
}

func wherePhrase(perch, habitat string) string {
	if w := perchWhere[norm(perch)]; w != "" {
		return w
	}
	if w, ok := habitatWhere[strings.TrimSpace(habitat)]; ok {
		return w
	}
	for h := core.Habitat(0); h < core.HabCount; h++ {
		if strings.EqualFold(h.Label(), strings.TrimSpace(habitat)) || h.Key() == norm(habitat) {
			return habitatWhere[h.Label()]
		}
	}
	return ""
}

func distPhrase(mid float32) string {
	switch {
	case mid < 15:
		return "very close"
	case mid < 35:
		return "not far off"
	case mid < 80:
		return "some way off"
	}
	return "a long way off"
}

var elevPhrases = map[string]string{"above": "somewhere above me", "below": "somewhere down below"}

var dirWords = map[string]string{
	"north": "north", "northeast": "northeast", "east": "east", "southeast": "southeast",
	"south": "south", "southwest": "southwest", "west": "west", "northwest": "northwest",
}

func dirPhrase(d string) string {
	k := strings.NewReplacer("-", "", " ", "").Replace(norm(d))
	if w := dirWords[k]; w != "" {
		return "to the " + w
	}
	return ""
}

var habitatNoun = map[string]string{
	"ocean": "the open sea", "beach": "the shoreline", "meadow": "the open meadow",
	"woodland": "the woodland", "conifer": "the pines", "marsh": "the reedbed",
	"river": "the riverside", "alpine": "the mountainside", "cliff": "the cliffs",
	"snow": "the snowfields", "shrub": "the thickets",
}

func habitatPhrase(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if s, ok := habitatNoun[strings.ToLower(v)]; ok {
		return s
	}
	for i := core.Habitat(0); i < core.HabCount; i++ {
		if strings.EqualFold(i.Label(), v) {
			return habitatNoun[i.Key()]
		}
	}
	return ""
}

var sizeWords = map[string]string{
	"tiny": "tiny", "small": "small", "medium": "medium-sized", "large": "large", "huge": "very large",
}

func sizeWord(v string) string { return sizeWords[norm(v)] }

var colourSet = map[string]bool{
	"brown": true, "black": true, "grey": true, "white": true, "blue": true, "green": true,
	"yellow": true, "red": true, "orange": true, "buff": true, "pink": true,
}

func colourWord(v string) string {
	v = norm(v)
	if v == "gray" {
		v = "grey"
	}
	if colourSet[v] {
		return v
	}
	return ""
}

// colourPhrase describes the main colour ("mostly brown").
func colourPhrase(primary string) string {
	if p := colourWord(primary); p != "" {
		return "mostly " + p
	}
	return ""
}

// shapePhrases describe a silhouette class without naming any bird group.
var shapePhrases = map[string]string{
	"songbird":    "a neat little perching shape",
	"finch":       "a compact, chunky little shape",
	"tit":         "a round, busy little shape",
	"thrush":      "an upright, round-breasted shape",
	"warbler":     "a slim, restless shape",
	"woodpecker":  "a stiff-tailed shape that clings to the bark",
	"owl":         "a big-headed, upright shape",
	"raptor":      "a broad-winged, powerful shape",
	"duck":        "a broad shape, sitting low on the water",
	"heron":       "a tall, long-necked shape",
	"wader":       "a long-legged shape",
	"gull":        "a sturdy, long-winged shape",
	"corvid":      "a bold, heavy-set shape",
	"swallow":     "a slender, swept-winged shape",
	"kingfisher":  "a compact shape with a big head",
	"rail":        "a dumpy, high-stepping shape",
	"seabird":     "a sturdy, seafaring shape",
	"pigeon":      "a plump, small-headed shape",
	"lark":        "a streaky, ground-hugging shape",
	"wagtail":     "a slim shape with a very long tail",
	"treecreeper": "a small shape that creeps up the bark",
	"grouse":      "a plump, ground-dwelling shape",
}

func shapePhrase(v string) string { return shapePhrases[norm(v)] }

var billPhrases = map[string]string{
	"short": "a short bill", "thin": "a fine, thin bill", "stout": "a stout bill",
	"dagger": "a dagger of a bill", "hooked": "a hooked bill", "flat": "a broad, flat bill",
	"long curved": "a long, curved bill", "chisel": "a chisel of a bill",
}

func billPhrase(v string) string { return billPhrases[norm(v)] }

var flightPhrases = map[string]string{
	"direct": "a straight, purposeful flight", "undulating": "a bounding, dipping flight",
	"soaring": "a long, easy glide", "hover": "a hovering flight", "flapglide": "a flap and a glide",
	"darting": "a quick, darting flight", "buoyant": "a loose, buoyant flight",
	"whirring": "a whirr of tiny wings",
}

func flightPhrase(v string) string { return flightPhrases[norm(v)] }

var actPhrases = map[string]string{
	"perched": "sitting quietly", "foraging": "busy foraging", "feeding": "feeding",
	"flying": "on the wing", "soaring": "soaring", "hovering": "hovering", "swimming": "swimming",
	"wading": "wading", "climbing": "creeping up the bark", "alert": "watching us closely",
	"fleeing": "off in a hurry", "hiding": "tucked well away", "roosting": "fast asleep",
	"preening": "preening", "bathing": "bathing", "diving": "diving", "social": "in company",
	"nesting": "busy about a nest",
}

func actPhrase(v string) string { return actPhrases[norm(v)] }

var mismatchWords = map[string]string{
	"size": "size", "shape": "shape", "primary": "colouring", "secondary": "colouring",
	"marking": "markings", "bill": "bill", "flight": "flight", "pitch": "voice",
	"pattern": "song", "habitat": "surroundings", "behavior": "behaviour",
}

func mismatchWord(k string) string { return mismatchWords[norm(k)] }

// rankTitles are the naturalist ranks (internal/progress) that may be spoken.
var rankTitles = map[string]string{
	"observer": "Observer", "naturalist": "Naturalist", "field specialist": "Field Specialist",
	"master naturalist": "Master Naturalist",
}

func rankTitle(s string) string { return rankTitles[norm(s)] }

func phaseKey(p core.DayPhase) string  { return strings.ToLower(p.String()) }
func seasonKey(s core.Season) string   { return strings.ToLower(s.String()) }
func weatherKey(w core.Weather) string { return strings.ToLower(w.String()) }

func article(s string) string {
	if s == "" {
		return "a"
	}
	switch unicode.ToLower(rune(s[0])) {
	case 'a', 'e', 'i', 'o', 'u':
		return "an"
	}
	return "a"
}

// ---------------------------------------------------------------------------
// Slot domains (for AllLines)

// subjValues are every {subj} an unidentified bird can get.
func subjValues() []string {
	out := []string{"our mystery bird"}
	for _, v := range sizeWords {
		out = append(out, "the "+v+" bird")
	}
	for c := range colourSet {
		out = append(out, "the "+c+" bird")
	}
	return out
}

// slotDomain lists every value a non-name slot can take. Names come from the species.
func slotDomain(slot string) []string {
	var vals []string
	addMap := func(m map[string]string) {
		for _, v := range m {
			vals = append(vals, v)
		}
	}
	switch slot {
	case "sound":
		addMap(patternSound)
		addMap(pitchSound)
	case "pitch":
		addMap(pitchVoice)
	case "where":
		addMap(perchWhere)
		addMap(habitatWhere)
	case "dist":
		vals = []string{distPhrase(0), distPhrase(20), distPhrase(50), distPhrase(100)}
	case "elev":
		addMap(elevPhrases)
	case "dir":
		for _, w := range dirWords {
			vals = append(vals, "to the "+w)
		}
	case "size":
		addMap(sizeWords)
	case "shape":
		addMap(shapePhrases)
	case "colours":
		for c := range colourSet {
			vals = append(vals, "mostly "+c)
		}
	case "bill":
		addMap(billPhrases)
	case "flight":
		addMap(flightPhrases)
	case "habitat":
		addMap(habitatNoun)
	case "act":
		addMap(actPhrases)
	case "subj":
		vals = subjValues()
	case "mismatch":
		addMap(mismatchWords)
	case "title":
		addMap(rankTitles)
	}
	return uniqSorted(vals)
}

func uniqSorted(xs []string) []string {
	seen := map[string]bool{}
	out := xs[:0:0]
	for _, x := range xs {
		if x != "" && !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Sanitising free text

// cleanWords keeps text that is plain words (letters, spaces, hyphens, apostrophes,
// commas) and at most maxWords long; anything else yields "".
func cleanWords(s string, maxWords int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || r == ' ' || r == '-' || r == '\'' || r == ',') {
			return ""
		}
	}
	f := strings.Fields(s)
	if len(f) > maxWords {
		return ""
	}
	return strings.Join(f, " ")
}

// ---------------------------------------------------------------------------
// Templates

// templateSlots lists the slot names a template mentions, in order of appearance.
func templateSlots(tpl string) []string {
	var out []string
	for {
		i := strings.IndexByte(tpl, '{')
		if i < 0 {
			return out
		}
		j := strings.IndexByte(tpl[i:], '}')
		if j < 0 {
			return out
		}
		out = append(out, tpl[i+1:i+j])
		tpl = tpl[i+j+1:]
	}
}

// fill substitutes {slots}; ok is false if a slot is missing or the line is too long.
func fill(tpl string, sl slots) (string, bool) {
	var b strings.Builder
	for {
		i := strings.IndexByte(tpl, '{')
		if i < 0 {
			b.WriteString(tpl)
			break
		}
		j := strings.IndexByte(tpl[i:], '}')
		if j < 0 {
			return "", false
		}
		v := sl[tpl[i+1:i+j]]
		if v == "" {
			return "", false
		}
		b.WriteString(tpl[:i])
		b.WriteString(v)
		tpl = tpl[i+j+1:]
	}
	out := tidy(b.String())
	if len(strings.Fields(out)) > maxWords {
		return "", false
	}
	return out, true
}

// tidy collapses spaces and capitalises the start of each sentence.
func tidy(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = strings.ReplaceAll(s, " ,", ",")
	s = strings.ReplaceAll(s, " .", ".")
	rs := []rune(s)
	capNext := true
	for i, r := range rs {
		if capNext && unicode.IsLetter(r) {
			rs[i] = unicode.ToUpper(r)
			capNext = false
		} else if r == '.' || r == '?' || r == '!' {
			capNext = true
		} else if r != ' ' {
			capNext = false
		}
	}
	return string(rs)
}
