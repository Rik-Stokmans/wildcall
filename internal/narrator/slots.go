package narrator

import (
	"strings"
	"unicode"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// slots are the words a template may use. A template is only eligible when every
// {slot} it mentions has a non-empty value.
//
// Slots for any bird (built from perception only):
//
//	sound   "a thin, rippling trill"       where  "somewhere up in the canopy"
//	dist    "not far off"                  elev   "somewhere above me"
//	dir     "to the northeast"             act    "busy foraging"
//	size    "small"                        shape  "a round, busy little shape"
//	colours "brown and orange"             marking "neat black cap"
//	bill    "a fine, thin bill"            flight "a bounding flight"
//	habitat "the reedbed"                  subj   "the small brown bird" / "the wren"
//
// Slots only for identified birds: name "wren", aname "a wren".
// Other slots: place, region, title, mismatch.
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
	sl := n.perceptionSlots(p)
	size := sizeWord(p.evidence["size"])
	colour := colourWord(p.evidence["primary"])
	switch {
	case size != "" && colour != "":
		sl["subj"] = "the " + size + " " + colour + " bird"
	case size != "":
		sl["subj"] = "the " + size + " bird"
	case colour != "":
		sl["subj"] = "the " + colour + " bird"
	default:
		sl["subj"] = n.oneOf("our mystery bird", "the stranger", "this one")
	}
	return sl
}

// knownSlots fills slots for a bird the player has identified.
func (n *Narrator) knownSlots(sp *core.Species, p perceived) slots {
	sl := n.perceptionSlots(p)
	name := shortName(sp)
	sl["name"] = name
	sl["aname"] = article(name) + " " + name
	sl["subj"] = "the " + name
	return sl
}

// perceptionSlots turns perceived qualities into speakable phrases.
func (n *Narrator) perceptionSlots(p perceived) slots {
	sl := slots{}
	where := n.wherePhrase(p.perch, p.habitat)
	if where != "" {
		sl["where"] = where
	}
	sl["sound"] = n.soundPhrase(p.pitch, p.pattern)
	// Avoid "a high trill, high in the canopy".
	if strings.Contains(where, "high") && strings.HasPrefix(sl["sound"], "a high") {
		sl["sound"] = "a thin" + strings.TrimPrefix(sl["sound"], "a high")
	}
	if p.distMax > 0 {
		mid := (p.distMin + p.distMax) / 2
		switch {
		case mid < 15:
			sl["dist"] = n.oneOf("very close", "only a few yards away")
		case mid < 35:
			sl["dist"] = n.oneOf("not far off", "quite close")
		case mid < 80:
			sl["dist"] = n.oneOf("some way off", "a fair distance away")
		default:
			sl["dist"] = n.oneOf("a long way off", "far off")
		}
	}
	switch strings.ToLower(p.elevation) {
	case "above":
		sl["elev"] = n.oneOf("somewhere above me", "up above")
	case "below":
		sl["elev"] = n.oneOf("somewhere below", "down below")
	}
	if d := cleanWords(p.dir, 3); d != "" {
		sl["dir"] = "to the " + strings.ToLower(d)
	}
	ev := p.evidence
	if s := sizeWord(ev["size"]); s != "" {
		sl["size"] = s
	}
	if s := shapePhrase(ev["shape"]); s != "" {
		sl["shape"] = s
	}
	if c := colourPhrase(ev["primary"], ev["secondary"]); c != "" {
		sl["colours"] = c
	}
	if m := cleanPerceived(ev["marking"], 8); m != "" {
		sl["marking"] = strings.ToLower(m)
	}
	if b := billPhrase(ev["bill"]); b != "" {
		sl["bill"] = b
	}
	if f := flightPhrase(ev["flight"]); f != "" {
		sl["flight"] = f
	}
	if h := habitatPhrase(ev["habitat"]); h != "" {
		sl["habitat"] = h
	}
	act := p.behavior
	if act == "" {
		act = ev["behavior"]
	}
	if a := actPhrase(act); a != "" {
		sl["act"] = a
	}
	return sl
}

// contextSlots adds the player's surroundings.
func (n *Narrator) contextSlots(sl slots, c Context) {
	if c.Region < core.RegionCount {
		sl["region"] = c.Region.Name()
	}
}

func (n *Narrator) oneOf(opts ...string) string { return opts[n.rng.IntN(len(opts))] }

// ---------------------------------------------------------------------------
// Vocabulary

var pitchAdj = map[string][]string{
	"low":       {"low", "deep"},
	"medium":    {"mid-pitched", "medium-pitched"},
	"high":      {"high", "thin"},
	"very high": {"very high", "needle-thin"},
}

type patternWords struct{ adj, noun []string }

var patternVocab = map[string]patternWords{
	"repeated": {[]string{"insistent", "repeated"}, []string{"phrase", "call"}},
	"trill":    {[]string{"rippling", "rattling"}, []string{"trill"}},
	"melodic":  {[]string{"melodic", "fluent"}, []string{"song", "phrase"}},
	"single":   {[]string{"lone", "single"}, []string{"note", "call"}},
	"harsh":    {[]string{"harsh", "rasping"}, []string{"call", "cry"}},
	"drumming": {[]string{"rapid"}, []string{"drumming"}},
	"booming":  {[]string{"hollow"}, []string{"boom"}},
	"whistle":  {[]string{"clear", "fluting"}, []string{"whistle"}},
	"chatter":  {[]string{"busy", "scratchy"}, []string{"chatter"}},
	"laughing": {[]string{"raucous"}, []string{"laughing call"}},
}

func normPattern(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// soundPhrase builds "a thin, rippling trill" from whatever the player could tell.
func (n *Narrator) soundPhrase(pitch, pattern string) string {
	pa := pitchAdj[strings.ToLower(strings.TrimSpace(pitch))]
	pw, havePattern := patternVocab[normPattern(pattern)]
	var words []string
	switch {
	case pa != nil && havePattern:
		if n.rng.IntN(2) == 0 {
			words = []string{n.oneOf(pa...) + ",", n.oneOf(pw.adj...), n.oneOf(pw.noun...)}
		} else {
			words = []string{n.oneOf(pa...), n.oneOf(pw.noun...)}
		}
	case havePattern:
		words = []string{n.oneOf(pw.adj...), n.oneOf(pw.noun...)}
	case pa != nil:
		words = []string{n.oneOf(pa...), n.oneOf("call", "voice", "note")}
	default:
		return n.oneOf("a call", "a voice", "a little phrase", "a song of some sort")
	}
	s := strings.Join(words, " ")
	return article(s) + " " + s
}

var habitatWhere = map[string][]string{
	"Open sea":        {"out over the water", "out on the sea"},
	"Shoreline":       {"along the shore", "down on the shoreline"},
	"Open meadow":     {"out in the meadow grass", "somewhere in the open grass"},
	"Woodland canopy": {"somewhere up in the canopy", "high in the leaves"},
	"Pine forest":     {"among the pines", "somewhere in the pines"},
	"Reedbed":         {"low in the reeds", "deep in the reedbed"},
	"Riverside":       {"down by the water", "along the bank"},
	"Mountain slope":  {"up on the slope", "somewhere on the hillside"},
	"Cliff face":      {"on the cliff face", "up on the rocks"},
	"Snowfield":       {"out on the snow", "somewhere across the snow"},
	"Dense shrubs":    {"deep in the thicket", "low in the undergrowth"},
}

func (n *Narrator) wherePhrase(perch, habitat string) string {
	if p := cleanPerceived(perch, 6); p != "" {
		return strings.ToLower(p)
	}
	if opts, ok := habitatWhere[habitat]; ok {
		return n.oneOf(opts...)
	}
	// Tolerate habitat keys too.
	if h, ok := core.HabitatFromKey(strings.ToLower(habitat)); ok {
		if opts, ok := habitatWhere[h.Label()]; ok {
			return n.oneOf(opts...)
		}
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

func sizeWord(v string) string { return sizeWords[strings.ToLower(strings.TrimSpace(v))] }

var colourSet = map[string]bool{
	"brown": true, "black": true, "grey": true, "white": true, "blue": true, "green": true,
	"yellow": true, "red": true, "orange": true, "buff": true, "pink": true, "gray": true,
}

func colourWord(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "gray" {
		v = "grey"
	}
	if colourSet[v] {
		return v
	}
	return ""
}

func colourPhrase(primary, secondary string) string {
	p, s := colourWord(primary), colourWord(secondary)
	switch {
	case p != "" && s != "" && p != s:
		return p + " and " + s
	case p != "":
		return "mostly " + p
	case s != "":
		return "a touch of " + s
	}
	return ""
}

// shapePhrase describes a silhouette class without naming any bird group.
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

func shapePhrase(v string) string { return shapePhrases[strings.ToLower(strings.TrimSpace(v))] }

var billPhrases = map[string]string{
	"short": "a short bill", "thin": "a fine, thin bill", "stout": "a stout bill",
	"dagger": "a dagger of a bill", "hooked": "a hooked bill", "flat": "a broad, flat bill",
	"long curved": "a long, curved bill", "chisel": "a chisel of a bill",
}

func billPhrase(v string) string { return billPhrases[strings.ToLower(strings.TrimSpace(v))] }

var flightPhrases = map[string]string{
	"direct": "a straight, purposeful flight", "undulating": "a bounding, dipping flight",
	"soaring": "a long, easy glide", "hover": "a hovering flight", "flapglide": "a flap and a glide",
	"darting": "a quick, darting flight", "buoyant": "a loose, buoyant flight",
	"whirring": "a whirr of tiny wings",
}

func flightPhrase(v string) string { return flightPhrases[strings.ToLower(strings.TrimSpace(v))] }

var actPhrases = map[string]string{
	"perched": "sitting quietly", "foraging": "busy foraging", "feeding": "feeding",
	"flying": "on the wing", "soaring": "soaring", "hovering": "hovering", "swimming": "swimming",
	"wading": "wading", "climbing": "creeping up the bark", "alert": "watching us closely",
	"fleeing": "off in a hurry", "hiding": "tucked well away", "roosting": "fast asleep",
	"preening": "preening", "bathing": "bathing", "diving": "diving", "social": "in company",
	"nesting": "busy about a nest",
}

func actPhrase(v string) string { return actPhrases[strings.ToLower(strings.TrimSpace(v))] }

var mismatchWords = map[string]string{
	"size": "size", "shape": "shape", "primary": "colouring", "secondary": "colouring",
	"marking": "markings", "bill": "bill", "flight": "flight", "pitch": "voice",
	"pattern": "song", "habitat": "surroundings", "behavior": "behaviour",
}

func mismatchWord(k string) string { return mismatchWords[strings.ToLower(strings.TrimSpace(k))] }

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
// Sanitising free text

// birdWords are group and species nouns that must never reach an unknown-bird line
// through free-text perception values (markings, perch phrases).
var birdWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`robin robins tit tits blackbird blackbirds wren wrens chaffinch
		finch finches woodpecker woodpeckers jay jays nuthatch nuthatches treecreeper treecreepers
		owl owls buzzard buzzards thrush thrushes goldcrest goldcrests kinglet kinglets blackcap
		blackcaps chiffchaff chiffchaffs wagtail wagtails pipit pipits kingfisher kingfishers oriole
		orioles mallard mallards duck ducks drake moorhen moorhens rail rails crake crakes heron herons
		bittern bitterns warbler warblers harrier harriers hawk hawks eagle eagles wheatear wheatears
		chat chats raven ravens crow crows corvid corvids ouzel ouzels gull gulls tern terns
		oystercatcher oystercatchers wader waders cormorant cormorants puffin puffins auk auks
		redwing redwings brambling bramblings hawfinch hawfinches bunting buntings ptarmigan
		ptarmigans grouse raptor raptors swan swans goose geese seabird seabirds pigeon pigeons
		lark larks swallow swallows`) {
		birdWords[w] = true
	}
}

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

// cleanPerceived is cleanWords that also rejects any bird-group word.
func cleanPerceived(s string, maxWords int) string {
	s = cleanWords(s, maxWords)
	if s == "" {
		return ""
	}
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) }) {
		if birdWords[w] {
			return ""
		}
	}
	return s
}

// cleanName keeps a proper name (place, rank title) if it is plain words.
func cleanName(s string) string { return cleanWords(s, 5) }

// ---------------------------------------------------------------------------
// Templates

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
