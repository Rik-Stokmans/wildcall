package species

import "github.com/Rik-Stokmans/wildcall/internal/core"

// The Greenhollow Woods roster: twenty real birds of a temperate European forest.
//
// Authoring conventions used throughout this file:
//
//   - Appearance is the adult male in spring plumage (the bird that sings), because a
//     species has a single model. Where the female differs, the description says so.
//   - Traits are what a naturalist would write in a notebook. Size follows length:
//     tiny < 12 cm, small < 20 cm, medium < 45 cm, large < 80 cm (the same classes as
//     regional.go, so a tawny owl and an oystercatcher are both "medium").
//     Traits.Bill agrees with Look.BillShape (cone → short or stout, curved → long
//     curved).
//   - Call.Pitch follows the loudness-weighted mean frequency of the notes, so the
//     clue text always matches what the client synthesizes: low < 1 kHz, medium
//     1–3 kHz, high 3–6 kHz, very high above 6 kHz.
//   - Note waves: "sine" is a pure tone (owl hoots, the thinnest high notes),
//     "whistle" a clear bird whistle, "trill" a tone with fast amplitude modulation
//     at Rate (Depth 0..1), "buzz" a rough, dry tone, "noise" a band of noise swept
//     from F0 to F1 (screeches), "click" a short percussive strike. On every wave but
//     "trill", Rate/Depth are vibrato.
//   - Calls[0] is what the player usually hears and what the pitch/pattern evidence
//     describes. No two species here share size, shape, both colours and bill, and
//     the (pitch, pattern) pair of the primary call is unique in the wood except for
//     two pairs that fool real birdwatchers too: robin / blackcap (both a high,
//     melodic warble) and great tit / chiffchaff (both a high two-note repeat).
//   - Similar is kept symmetric, also towards the species of regional.go.
//
// Every helper in this file is prefixed "gh": regional.go shares the package.

// greenhollowSpecies returns the Greenhollow Woods roster in catalog order. Each call
// builds fresh data, so callers may modify what they get.
func greenhollowSpecies() []core.Species {
	return []core.Species{
		ghRobin(),
		ghBlueTit(),
		ghGreatTit(),
		ghBlackbird(),
		ghWren(),
		ghChaffinch(),
		ghGreatSpottedWoodpecker(),
		ghJay(),
		ghNuthatch(),
		ghTreecreeper(),
		ghTawnyOwl(),
		ghBuzzard(),
		ghSongThrush(),
		ghGoldcrest(),
		ghLongTailedTit(),
		ghBlackcap(),
		ghChiffchaff(),
		ghGreyWagtail(),
		ghKingfisher(),
		ghGoldenOriole(),
	}
}

// ---------------------------------------------------------------------------
// Helpers

// Seasons are spring, summer, autumn, winter.
var (
	ghResident      = [4]bool{true, true, true, true}
	ghSummerVisitor = [4]bool{true, true, false, false} // winters in Africa or the Mediterranean
)

// ghWoodsOnly is the range of a Greenhollow specialist.
func ghWoodsOnly() []core.RegionID { return []core.RegionID{core.RegionGreenhollow} }

// ghWoodsAndAmberwood is the range of the woodland generalists, which are just as
// much at home in the autumn forest.
func ghWoodsAndAmberwood() []core.RegionID {
	return []core.RegionID{core.RegionGreenhollow, core.RegionAmberwood}
}

// ghWoodsAndMarsh is the range of the two waterside birds, which follow creeks and
// channels out into Murmur Marsh.
func ghWoodsAndMarsh() []core.RegionID {
	return []core.RegionID{core.RegionGreenhollow, core.RegionMurmurMarsh}
}

func ghHab(key string, weight float32) core.HabitatWeight {
	return core.HabitatWeight{Habitat: key, Weight: weight}
}

func ghMark(kind, color string) core.Mark { return core.Mark{Kind: kind, Color: color} }

func ghPalette(back, belly, head, wing, tail, bill, legs, eye string) core.Palette {
	return core.Palette{Back: back, Belly: belly, Head: head, Wing: wing, Tail: tail, Bill: bill, Legs: legs, Eye: eye}
}

// ghTone is a note without vibrato that glides from f0 to f1 Hz, followed by gap
// seconds of silence.
func ghTone(wave string, dur, gap, f0, f1, amp float32) core.Note {
	return core.Note{Dur: dur, Gap: gap, F0: f0, F1: f1, Wave: wave, Amp: amp}
}

// ghVib is ghTone with a modulation: vibrato (depth as a fraction of the frequency),
// or for the "trill" wave the amplitude flutter that makes the trill.
func ghVib(wave string, dur, gap, f0, f1, rate, depth, amp float32) core.Note {
	return core.Note{Dur: dur, Gap: gap, F0: f0, F1: f1, Wave: wave, Rate: rate, Depth: depth, Amp: amp}
}

func ghNotes(notes ...core.Note) []core.Note { return notes }

// ghJoin strings phrase sections together.
func ghJoin(parts ...[]core.Note) []core.Note {
	var out []core.Note
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// ghTimes repeats a motif n times.
func ghTimes(n int, motif ...core.Note) []core.Note {
	out := make([]core.Note, 0, n*len(motif))
	for i := 0; i < n; i++ {
		out = append(out, motif...)
	}
	return out
}

// ghRest lengthens the silence after the last note of a section: the breath a bird
// takes between two motifs.
func ghRest(notes []core.Note, pause float32) []core.Note {
	if len(notes) > 0 {
		notes[len(notes)-1].Gap += pause
	}
	return notes
}

// ghSteps is a run of n equal notes whose starting pitch steps evenly from `from` to
// `to` Hz; each note itself glides by slur Hz (negative = downwards).
func ghSteps(n int, wave string, dur, gap, from, to, slur, amp float32) []core.Note {
	out := make([]core.Note, n)
	for i := range out {
		f := from
		if n > 1 {
			f = from + (to-from)*float32(i)/float32(n-1)
		}
		out[i] = ghTone(wave, dur, gap, f, f+slur, amp)
	}
	return out
}

// ghDrum is a woodpecker's drum roll: strikes on resonant dead wood that speed up
// and fade towards the end.
func ghDrum(strikes int, hz, firstGap, lastGap float32) []core.Note {
	out := make([]core.Note, strikes)
	for i := range out {
		t := float32(i) / float32(strikes-1)
		out[i] = ghTone("click", 0.014, firstGap+(lastGap-firstGap)*t, hz, hz*0.92, 1-0.55*t)
	}
	out[strikes-1].Gap = 0
	return out
}

// When nests are active (spring, summer, autumn, winter). Single-brooded birds nest
// in spring only; birds that raise a second brood, or whose chicks are still in the
// nest at midsummer, are active through spring and summer.
var (
	ghNestSpring       = [4]bool{true, false, false, false}
	ghNestSpringSummer = [4]bool{true, true, false, false}
)

// ghNest describes a species' real nest: the site type, the perch kinds it is built
// on (most typical first), its height above the ground or water in metres, when it
// is active, its outer diameter in metres and one field-guide sentence.
func ghNest(site string, perches []string, hmin, hmax float32, seasons [4]bool, size float32, desc string) core.NestInfo {
	return core.NestInfo{Site: site, Perches: perches, HeightMin: hmin, HeightMax: hmax, Seasons: seasons, Size: size, Desc: desc}
}

// ghCall assembles a vocalization. A bout is repMin..repMax phrases, gap seconds apart.
func ghCall(kind, pitch, pattern string, loud float32, repMin, repMax int, gap float32, notes []core.Note) core.Call {
	return core.Call{
		Kind:    kind,
		Notes:   notes,
		Repeat:  [2]int{repMin, repMax},
		Gap:     gap,
		Loud:    loud,
		Pitch:   pitch,
		Pattern: pattern,
	}
}

// ---------------------------------------------------------------------------
// The roster

func ghRobin() core.Species {
	return core.Species{
		ID:     "european_robin",
		Name:   "European Robin",
		Sci:    "Erithacus rubecula",
		Family: "Thrushes & Chats",
		Desc: "A plump, upright little bird of the woodland floor and its shrubby edges, with an orange-red face and breast and large dark eyes. " +
			"Bold and inquisitive, it often comes closer to a quiet walker than any other bird in the wood. " +
			"Both sexes sing a thin, wistful warble, even in the depths of winter.",
		IDTips: "The orange-red runs from the forehead down to the breast and is edged with soft blue-grey; nothing else in the wood has it. " +
			"A chaffinch's breast is pinker, and it shows white wing-bars and a blue-grey cap. " +
			"Watch for the robin's habit of bobbing, flicking its wings and dropping to the ground from a low perch.",
		Fact: "Long before there were gardens, robins followed wild boar through the forest to snap up the worms and beetles turned over by their rooting. " +
			"A person walking through the leaf litter is treated the same way, which is why a robin seems so tame.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.45), ghHab("shrub", 0.4), ghHab("meadow", 0.15),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.14, Wingspan: 0.21, Plump: 1.25, Neck: 0.05, Legs: 0.4,
			Tail: 0.55, TailShape: "square", Bill: 0.45, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#7d6a4a", "#e9e3d5", "#7d6a4a", "#6f5d42", "#6a583e", "#2b2622", "#6b4a3a", "#15110e"),
			Marks: []core.Mark{
				ghMark("breast", "#d9642c"), ghMark("throat", "#d9642c"), ghMark("cheek", "#d9642c"),
				ghMark("collar", "#9aa3ab"), // the blue-grey border between the orange and the brown
			},
		},
		Move: core.Movement{Flight: "darting", Ground: "hop", Speed: 8, FlapHz: 14},
		Behavior: core.Behavior{
			Perches:   []string{"shrub", "branch", "ground", "structure", "snag"},
			Feeding:   "ground",
			Activity:  [6]float32{1, 0.8, 0.5, 0.6, 0.9, 0.15}, // first to start, last to stop; sometimes sings in the dark
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 35, Shyness: 4, Vocal: 6, Density: 1.2,
			Camo: 0.3, Skulking: 0.3, Habituate: 0.9,
			Specials: []string{"bathing", "social", "nesting"},
		},
		Calls: []core.Call{
			// Wistful warble: thin, long-held high notes alternating with quick liquid ripples.
			ghCall("song", "high", "melodic", 0.45, 2, 4, 2.5, ghNotes(
				ghTone("whistle", 0.22, 0.05, 5200, 5600, 0.8),
				ghTone("whistle", 0.16, 0.04, 4300, 3600, 0.9),
				ghVib("trill", 0.28, 0.06, 4800, 4200, 28, 0.6, 0.8),
				ghTone("whistle", 0.10, 0.03, 6200, 5200, 0.7),
				ghTone("whistle", 0.09, 0.05, 3600, 4400, 0.8),
				ghVib("whistle", 0.32, 0.07, 5000, 4700, 7, 0.03, 1),
				ghVib("trill", 0.22, 0.05, 3800, 3300, 32, 0.6, 0.7),
				ghTone("whistle", 0.14, 0.04, 5600, 6400, 0.6),
				ghTone("sine", 0.28, 0, 4400, 3900, 0.7),
			)),
			// "Tic, tic, tic": like an old clock being wound.
			ghCall("call", "high", "repeated", 0.3, 1, 3, 0.6, ghTimes(3,
				ghTone("click", 0.015, 0.11, 5200, 5200, 0.8),
			)),
			// A thin, drawn-out "tseee" when a hawk or owl is about; very hard to locate.
			ghCall("alarm", "very high", "whistle", 0.2, 1, 2, 1.5, ghNotes(
				ghTone("sine", 0.45, 0, 7700, 7400, 0.5),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "songbird", Primary: "brown", Secondary: "orange",
			Marking: "orange-red face and breast", Bill: "thin", Flight: "darting",
		},
		Nest: ghNest("cup_shrub", []string{"shrub", "bank", "ground", "trunk"}, 0, 3, ghNestSpringSummer, 0.12,
			"A cup of moss and dead leaves lined with hair, tucked into a hollow in a bank, among ivy or the roots of a tree, rarely more than a couple of metres up."),
		Facts: []string{
			"Robins sing almost all year, and in autumn and winter the females sing too, each defending her own territory.",
			"A male robin will attack a tuft of red feathers on a stick, because a red breast means a rival.",
			"Robins often sing at night under street lamps, and are then mistaken for nightingales.",
			"Young robins have no red breast at all: they are speckled brown until their first moult.",
			"Robins have nested in old kettles, coat pockets and the engines of parked tractors.",
			"Robins can sense the Earth's magnetic field, and migrating robins use it as a compass.",
			"Victorian postmen wore red coats and were nicknamed robins, which is how the bird got onto Christmas cards.",
		},
		Difficulty: 1,
		Similar:    []string{"common_chaffinch"},
		Relations: []string{
			"Shadows larger animals, and patient naturalists, to snatch the insects they stir up from the leaf litter.",
			"Holds a territory alone all winter and drives off rival robins with song and a puffed-out red breast.",
			"Its thin alarm whistle warns every small bird in the thicket that a hunter is near.",
		},
	}
}

func ghBlueTit() core.Species {
	return core.Species{
		ID:     "blue_tit",
		Name:   "Blue Tit",
		Sci:    "Cyanistes caeruleus",
		Family: "Tits",
		Desc: "A tiny, restless acrobat of the canopy, blue and yellow with a white face. " +
			"It hangs upside down from the thinnest twigs to pick insects and their eggs from buds and leaves, and is rarely still for more than a second.",
		IDTips: "Look for the bright blue cap and the dark line through the eye on a white face. " +
			"The great tit is larger, with a glossy black head and a black stripe down its yellow belly. " +
			"The song is a couple of thin, high notes that tumble into a quick silvery trill.",
		Fact: "The blue cap glows in ultraviolet light, which birds can see and we cannot; females prefer the males with the brightest crowns. " +
			"A pair times its one large brood to the few weeks when the oak leaves are thick with caterpillars.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.7), ghHab("shrub", 0.2), ghHab("conifer", 0.1),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.115, Wingspan: 0.19, Plump: 1.15, Neck: 0.05, Legs: 0.3,
			Tail: 0.5, TailShape: "square", Bill: 0.3, BillShape: "cone", WingShape: "rounded",
			Colors: ghPalette("#7f9a5a", "#f0d94e", "#f4f4ee", "#4a7fc0", "#4f7fbd", "#2a2a30", "#4c5f78", "#101010"),
			Marks: []core.Mark{
				ghMark("cap", "#3f7fd0"), ghMark("eyestripe", "#1d2a4a"), ghMark("collar", "#1f2f55"),
				ghMark("bib", "#1c2440"), ghMark("cheek", "#f6f6f0"), ghMark("wingbar", "#f2f2ee"),
			},
		},
		Move: core.Movement{Flight: "whirring", Ground: "hop", Speed: 8, FlapHz: 20},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch", "shrub"},
			Feeding:   "glean",
			Activity:  [6]float32{0.9, 1, 0.6, 0.7, 0.6, 0},
			Sociality: "flock", FlockMin: 2, FlockMax: 6, // loose roving parties
			Territory: 45, Shyness: 7, Vocal: 5, Density: 1.2,
			Camo: 0.2, Skulking: 0.25, Habituate: 0.7,
			Specials: []string{"bathing", "nesting", "social"},
		},
		Calls: []core.Call{
			// "Tsee-tsee-tsee-tsu-hu-hu-hu-hu": thin high notes falling into a silvery trill.
			ghCall("song", "high", "trill", 0.3, 1, 3, 1.8, ghJoin(
				ghTimes(3, ghTone("whistle", 0.11, 0.05, 7200, 6900, 0.8)),
				ghNotes(ghVib("trill", 0.5, 0, 4900, 4500, 22, 0.8, 0.9)),
			)),
			// Contact call between birds in a party: "tsee-tsee-tsit".
			ghCall("call", "very high", "repeated", 0.2, 1, 3, 0.7, ghJoin(
				ghTimes(2, ghTone("sine", 0.09, 0.04, 7600, 7400, 0.6)),
				ghNotes(ghTone("sine", 0.05, 0, 6800, 6400, 0.7)),
			)),
			// A scolding churr at anything it distrusts.
			ghCall("alarm", "high", "harsh", 0.35, 1, 3, 0.5, ghNotes(
				ghVib("buzz", 0.4, 0, 4000, 3600, 30, 0.12, 0.8),
			)),
		},
		Traits: core.Traits{
			Size: "tiny", Shape: "tit", Primary: "blue", Secondary: "yellow",
			Marking: "blue cap, white face with a dark eye-stripe", Bill: "short", Flight: "whirring",
		},
		Nest: ghNest("cavity", []string{"cavity"}, 1, 8, ghNestSpring, 0.1,
			"A soft cup of moss, hair and feathers inside a small tree hole or nest box, the entrance barely wider than a coin."),
		Facts: []string{
			"Blue tits lay some of the biggest clutches of any songbird, often ten eggs or more.",
			"At the peak, a pair of blue tits can make several hundred feeding trips to the nest in one day.",
			"The blue cap reflects ultraviolet light, which birds can see and we cannot.",
			"In the 1920s British blue tits learned to peck through the foil tops of milk bottles to reach the cream.",
			"On Corsica, blue tits tuck sprigs of lavender and mint into the nest, which seems to help keep parasites down.",
			"Blue tits hang upside down from the thinnest twigs to pick insects from under leaves and buds.",
			"The whole brood leaves the nest within a day or so, about three weeks after hatching.",
		},
		Difficulty: 1,
		Similar:    []string{"great_tit", "long_tailed_tit"},
		Relations: []string{
			"Times its brood to the flush of caterpillars on the oak leaves in late spring.",
			"Roams in winter with great tits, long-tailed tits, goldcrests and treecreepers: more eyes to spot danger.",
			"Nests in small tree holes that larger birds cannot enter.",
		},
	}
}

func ghGreatTit() core.Species {
	return core.Species{
		ID:     "great_tit",
		Name:   "Great Tit",
		Sci:    "Parus major",
		Family: "Tits",
		Desc: "The largest of the tits: green-backed and yellow-bellied, with a glossy black head, bright white cheeks and a black stripe down the middle of the breast. " +
			"Confident and curious, it forages lower than the blue tit and often drops to the ground for seeds and beech mast.",
		IDTips: "White cheeks on a black head and the black belly stripe are diagnostic; the stripe is broad in males and narrow in females. " +
			"The blue tit is smaller, with a blue cap and no belly stripe. " +
			"Its best-known song is a ringing two-note see-saw: tea-cher, tea-cher, tea-cher.",
		Fact: "Birdwatchers have a saying: if you hear a call in the woods and cannot place it, it is probably a great tit. " +
			"One male may use dozens of different songs and calls, and neighbours answer each other by matching song for song.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.65), ghHab("conifer", 0.2), ghHab("shrub", 0.15),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.14, Wingspan: 0.24, Plump: 1.15, Neck: 0.05, Legs: 0.3,
			Tail: 0.6, TailShape: "square", Bill: 0.35, BillShape: "cone", WingShape: "rounded",
			Colors: ghPalette("#7c8f45", "#f2d53c", "#121212", "#5d7590", "#55657a", "#1d1d1f", "#55657a", "#0c0c0c"),
			Marks: []core.Mark{
				ghMark("cheek", "#f8f8f4"), ghMark("throat", "#111111"), ghMark("bib", "#111111"), // the bib runs on down the belly as a stripe
				ghMark("nape", "#dfe36a"), ghMark("wingbar", "#f2f2ee"),
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "hop", Speed: 9, FlapHz: 17},
		Behavior: core.Behavior{
			Perches: []string{"branch", "canopy", "shrub", "ground"},
			// Heavier-billed than the other tits: beech mast, hazelnuts and fallen seed
			// make up much of its food, so it comes readily to scattered seed.
			Feeding:   "seeds",
			Activity:  [6]float32{0.9, 1, 0.6, 0.7, 0.6, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 55, Shyness: 7, Vocal: 6, Density: 1,
			Camo: 0.2, Skulking: 0.2, Habituate: 0.75,
			Specials: []string{"nesting", "bathing"},
		},
		Calls: []core.Call{
			// "Tea-cher, tea-cher, tea-cher": a bright see-saw like a squeaky bicycle pump.
			ghCall("song", "high", "repeated", 0.5, 2, 4, 2, ghTimes(4,
				ghTone("whistle", 0.13, 0.03, 4900, 4750, 0.9),
				ghTone("whistle", 0.15, 0.10, 3600, 3500, 1),
			)),
			// A sharp "pink, pink", much like a chaffinch's.
			ghCall("call", "high", "single", 0.4, 1, 3, 0.8, ghTimes(2,
				ghTone("whistle", 0.06, 0.13, 4500, 3500, 0.9),
			)),
			// Scolding chatter: "cha-cha-cha-cha".
			ghCall("alarm", "high", "chatter", 0.45, 1, 3, 0.5, ghTimes(6,
				ghTone("buzz", 0.07, 0.035, 3700, 3300, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "tit", Primary: "yellow", Secondary: "black",
			Marking: "black stripe down a yellow belly, white cheeks", Bill: "short", Flight: "undulating",
		},
		Nest: ghNest("cavity", []string{"cavity"}, 1, 6, ghNestSpring, 0.12,
			"A thick pad of moss lined with hair and wool, in a tree hole, an old woodpecker hole or a nest box."),
		Facts: []string{
			"Great tits time their nesting to the peak of oak caterpillars, and warmer springs have moved both earlier.",
			"The great tits of Wytham Woods near Oxford have been studied every single year since 1947.",
			"In some Hungarian caves, great tits hunt hibernating bats when other food is hard to find.",
			"Great tits learn by watching one another, and a new trick can spread through a whole wood.",
			"The black stripe down the belly is broad in males and narrow, often broken, in females.",
			"Its ringing 'teacher, teacher' is one of the first songs of the year, often heard on mild January days.",
		},
		Difficulty: 1,
		Similar:    []string{"blue_tit"},
		Relations: []string{
			"Dominates the smaller tits at food and at nest holes.",
			"Depends on beech mast and hazelnuts in winter, holding them under a foot and hammering them open.",
			"Often raises its brood in an old great spotted woodpecker hole.",
		},
	}
}

func ghBlackbird() core.Species {
	return core.Species{
		ID:     "common_blackbird",
		Name:   "Common Blackbird",
		Sci:    "Turdus merula",
		Family: "Thrushes & Chats",
		Desc: "The male is all black with an orange-yellow bill and eye-ring; the female is dark brown. " +
			"It hops and runs across the woodland floor, tossing leaves aside for worms, and sings slow, mellow, fluting phrases from a high perch at dawn and dusk.",
		IDTips: "A medium-sized, long-tailed black bird with a bright bill, usually on or near the ground; on landing it raises its tail and droops its wings. " +
			"The song thrush is brown with a spotted breast and repeats each phrase, where the blackbird's song flows unhurried and ends in a squeaky twiddle.",
		Fact: "A blackbird hunting on the ground cocks its head to one side, watching and listening for a worm in its burrow. " +
			"Each male composes his own song and goes on adding phrases, so an old bird has a richer repertoire than a youngster.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.45), ghHab("shrub", 0.3), ghHab("meadow", 0.25),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.25, Wingspan: 0.36, Plump: 1.05, Neck: 0.1, Legs: 0.45,
			Tail: 0.8, TailShape: "square", Bill: 0.6, BillShape: "thin", WingShape: "rounded",
			// The plumage has no marks at all: the glowing bill is the field mark.
			Colors: ghPalette("#1a1714", "#1e1a17", "#161311", "#1c1815", "#15120f", "#f0a020", "#3a2c22", "#1a1208"),
			Marks:  []core.Mark{},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 10, FlapHz: 6.5},
		Behavior: core.Behavior{
			Perches:   []string{"ground", "shrub", "branch", "canopy", "structure"},
			Feeding:   "ground",
			Activity:  [6]float32{1, 0.8, 0.45, 0.6, 0.95, 0.05},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 50, Shyness: 10, Vocal: 5, Density: 1,
			Camo: 0.25, Skulking: 0.35, Habituate: 0.6,
			Specials: []string{"bathing", "nesting", "preening"},
		},
		Calls: []core.Call{
			// Slow, mellow, fluting phrases that trail off into a quiet squeaky twiddle.
			ghCall("song", "medium", "melodic", 0.6, 2, 4, 3, ghNotes(
				ghVib("whistle", 0.34, 0.08, 1900, 2200, 5, 0.02, 0.9),
				ghTone("whistle", 0.28, 0.06, 2500, 2100, 0.9),
				ghVib("whistle", 0.40, 0.10, 1700, 1850, 5, 0.02, 1),
				ghTone("whistle", 0.24, 0.05, 2300, 2700, 0.9),
				ghTone("whistle", 0.36, 0.08, 2100, 1600, 1),
				ghVib("trill", 0.18, 0.03, 5200, 6000, 30, 0.5, 0.35),
				ghTone("sine", 0.10, 0, 6400, 5000, 0.3),
			)),
			// A soft, low "chook, chook" of mild unease.
			ghCall("call", "medium", "repeated", 0.3, 1, 3, 0.8, ghTimes(3,
				ghTone("sine", 0.07, 0.16, 1500, 1100, 0.7),
			)),
			// The hysterical rattle of a flushed blackbird, rising as it flies off.
			ghCall("alarm", "high", "chatter", 0.7, 1, 2, 1.2,
				ghSteps(10, "whistle", 0.05, 0.035, 2900, 3900, 300, 0.9),
			),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "thrush", Primary: "black", Secondary: "yellow",
			Marking: "orange-yellow bill and eye-ring", Bill: "thin", Flight: "direct",
		},
		Nest: ghNest("cup_shrub", []string{"shrub", "fork", "trunk"}, 0.5, 5, ghNestSpringSummer, 0.2,
			"A sturdy cup of grass and twigs plastered inside with mud and lined with fine grass, in a thick bush, a hedge or against ivy on a trunk."),
		Facts: []string{
			"Blackbirds were shy forest birds until about two hundred years ago, when they moved into towns and gardens.",
			"Only the male blackbird is black; the female is dark brown with a faintly streaked throat.",
			"The female builds the nest alone: a cup of grass plastered inside with mud.",
			"Blackbirds sunbathe by spreading their wings and tail on warm ground, looking almost collapsed.",
			"Many blackbirds from Scandinavia cross the North Sea to spend the winter in Britain.",
			"The loud 'chink-chink' of blackbirds at dusk is them settling to roost, and often scolding a cat or an owl.",
			"A blackbird can raise three broods in one summer if the worms hold out.",
		},
		Difficulty: 1,
		Similar:    []string{"song_thrush", "ring_ouzel", "golden_oriole"},
		Relations: []string{
			"Turns over the leaf litter for worms and beetles; robins follow to glean what it uncovers.",
			"Feasts on rowan, hawthorn and ivy berries in autumn and spreads their seeds.",
			"Its frantic alarm at dusk often gives away a tawny owl leaving its roost.",
		},
	}
}

func ghWren() core.Species {
	return core.Species{
		ID:     "eurasian_wren",
		Name:   "Eurasian Wren",
		Sci:    "Troglodytes troglodytes",
		Family: "Wrens",
		Desc: "A tiny, round, russet-brown bird that creeps like a mouse through ferns, brambles and tangled roots with its short tail cocked straight up. " +
			"It is far more often heard than seen: the song is astonishingly loud for so small a bird, a fast, ringing phrase full of trills.",
		IDTips: "Smaller than a robin, warm brown and finely barred, with a pale eyebrow and that cocked tail. " +
			"It keeps low and inside cover, so wait near the sound and watch for movement close to the ground. " +
			"The song always includes a hard, rattling trill; the alarm is a dry, scolding churr.",
		Fact: "Weight for weight, a wren's song is about ten times more powerful than a cockerel's crow. " +
			"In freezing weather these fierce loners give up their territories at dusk and squeeze together for warmth; more than sixty have been counted roosting in one nest box.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("shrub", 0.7), ghHab("woodland", 0.2), ghHab("river", 0.1),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.095, Wingspan: 0.15, Plump: 1.3, Neck: 0, Legs: 0.35,
			Tail: 0.35, TailShape: "cocked", Bill: 0.6, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#8a5f3a", "#c9ab84", "#84593a", "#7d5433", "#7a5030", "#5a4636", "#a07a5c", "#120e0a"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#e3cfa8"), // pale eyebrow
				ghMark("bars", "#4d3423"),      // fine dark barring on wings, tail and flanks
			},
		},
		Move: core.Movement{Flight: "whirring", Ground: "hop", Speed: 7, FlapHz: 21},
		Behavior: core.Behavior{
			Perches:   []string{"shrub", "ground", "branch"},
			Feeding:   "glean",
			Activity:  [6]float32{1, 0.85, 0.5, 0.6, 0.75, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 30, Shyness: 6, Vocal: 6, Density: 1.1,
			Camo: 0.7, Skulking: 0.9, Habituate: 0.4,
			Specials: []string{"nesting", "social"},
		},
		Calls: []core.Call{
			// An explosive, very high phrase: quick whistles, a ringing trill, a dry
			// rattle and a second trill, delivered at full volume from inside a thicket.
			ghCall("song", "very high", "trill", 0.55, 1, 3, 3, ghJoin(
				ghTimes(3, ghTone("whistle", 0.07, 0.03, 6200, 7400, 0.9)),
				ghNotes(
					ghTone("whistle", 0.10, 0.03, 7600, 6400, 1),
					ghVib("trill", 0.5, 0.04, 6800, 6600, 36, 0.8, 1),
				),
				ghTimes(4, ghTone("whistle", 0.06, 0.03, 7400, 6000, 0.9)),
				ghNotes(ghVib("buzz", 0.42, 0.04, 6300, 6100, 55, 0.06, 0.85)), // the rattle
				ghTimes(3, ghTone("whistle", 0.07, 0.03, 6600, 7800, 0.9)),
				ghNotes(
					ghVib("trill", 0.55, 0.03, 7200, 6900, 30, 0.8, 1),
					ghTone("whistle", 0.12, 0, 7000, 5800, 0.9),
				),
			)),
			// A hard "tek, tek" from deep in the ferns.
			ghCall("call", "high", "single", 0.3, 1, 4, 0.5, ghTimes(2,
				ghTone("click", 0.02, 0.12, 4300, 4300, 0.8),
			)),
			// A dry, scolding churr, like a tiny ratchet.
			ghCall("alarm", "high", "harsh", 0.4, 1, 3, 0.6, ghNotes(
				ghVib("buzz", 0.35, 0, 4700, 4400, 45, 0.1, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "tiny", Shape: "songbird", Primary: "brown", Secondary: "buff",
			Marking: "short cocked tail, fine dark barring", Bill: "thin", Flight: "whirring",
		},
		Nest: ghNest("dome", []string{"shrub", "bank", "ground"}, 0, 3, ghNestSpringSummer, 0.12,
			"A domed ball of moss, leaves and grass with a small side entrance, hidden among roots, ivy or a tangle of bramble close to the ground."),
		Facts: []string{
			"A wren weighs about as much as a pound coin, yet has one of the loudest songs for its size.",
			"Its scientific name, Troglodytes, means cave-dweller, after its habit of creeping into holes and crevices.",
			"A male wren builds up to half a dozen domed nests and then shows the female round them.",
			"More than sixty wrens have been found huddled together in one nest box on a freezing night.",
			"Folk tales make the wren king of the birds: it hid on an eagle's back and flew higher still.",
			"Wrens are among Britain's commonest birds, yet a long, hard winter can kill a large share of them.",
			"Wrens creep like mice among roots and stones, hunting spiders in the darkest, dampest tangles.",
		},
		Difficulty: 2,
		Similar:    []string{"eurasian_treecreeper", "goldcrest", "eurasian_reed_warbler"},
		Relations: []string{
			"Hunts spiders and insects in the dampest, darkest tangles, where few other birds forage.",
			"The male builds several ball-shaped nests among ferns and roots; the female chooses one and lines it.",
			"Hard winters hit it badly, and wrens then roost huddled together for warmth.",
		},
	}
}

func ghChaffinch() core.Species {
	return core.Species{
		ID:     "common_chaffinch",
		Name:   "Common Chaffinch",
		Sci:    "Fringilla coelebs",
		Family: "Finches",
		Desc: "A colourful finch: the male has a blue-grey cap, a pinkish-rust face and breast and a chestnut back, while the female is soft olive-brown. " +
			"Both flash white shoulder patches, wing-bars and outer tail feathers when they fly. " +
			"It feeds on the ground with small, quick steps and sings from a branch in the trees.",
		IDTips: "The double white wing-bars show on every chaffinch, at rest and in flight. " +
			"A robin has an orange-red face and no white in the wing; the brambling has an orange shoulder and a white rump. " +
			"The song is a cheerful rattle that runs down the scale and ends with a flourish; the call is a sharp pink, pink.",
		Fact: "Chaffinches sing in dialects: the closing flourish differs from one valley to the next, because young males learn the song from their neighbours. " +
			"Linnaeus named the species coelebs, the bachelor, after the flocks of males that stayed in Sweden while the females flew south for the winter.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.5), ghHab("meadow", 0.25), ghHab("conifer", 0.25),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.145, Wingspan: 0.265, Plump: 1.05, Neck: 0.05, Legs: 0.3,
			Tail: 0.65, TailShape: "forked", Bill: 0.45, BillShape: "cone", WingShape: "pointed",
			Colors: ghPalette("#7a4f34", "#d98f78", "#7d98b4", "#1f1d1c", "#2a2826", "#8a97a6", "#7a5a4a", "#120e0a"),
			Marks: []core.Mark{
				ghMark("cap", "#7d98b4"), ghMark("nape", "#7d98b4"), ghMark("cheek", "#d98f78"),
				ghMark("breast", "#d98f78"), ghMark("wingpatch", "#f6f4ec"), ghMark("wingbar", "#f6f4ec"),
				ghMark("rump", "#7f9a4c"), // moss-green rump, seen as it flies away
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "walk", Speed: 11, FlapHz: 15},
		Behavior: core.Behavior{
			Perches:   []string{"branch", "canopy", "ground", "shrub"},
			Feeding:   "seeds",
			Activity:  [6]float32{0.85, 1, 0.6, 0.7, 0.6, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 50, Shyness: 9, Vocal: 6, Density: 1,
			Camo: 0.3, Skulking: 0.2, Habituate: 0.65,
			Specials: []string{"bathing", "nesting"},
		},
		Calls: []core.Call{
			// A rattle that runs down the scale, gathers speed and ends with a flourish:
			// "chip-chip-chip-chett-chett-chett-diddy-dioo".
			ghCall("song", "high", "chatter", 0.5, 2, 4, 4, ghJoin(
				ghTimes(4, ghTone("whistle", 0.08, 0.05, 5200, 4600, 0.8)),
				ghTimes(4, ghTone("whistle", 0.07, 0.04, 4400, 3900, 0.9)),
				ghTimes(5, ghTone("whistle", 0.055, 0.03, 3700, 3200, 1)),
				ghNotes(
					ghTone("whistle", 0.10, 0.02, 3000, 4200, 1),
					ghTone("whistle", 0.08, 0.02, 4400, 3000, 1),
					ghTone("whistle", 0.18, 0, 3400, 2600, 0.9),
				),
			)),
			// The call that gives the finch its name in many languages: "pink, pink".
			ghCall("call", "high", "single", 0.45, 1, 4, 0.9, ghTimes(2,
				ghTone("whistle", 0.07, 0.15, 4700, 3500, 0.9),
			)),
			// The "rain call": a patient, upslurred "hweet" repeated from a perch.
			ghCall("call", "high", "whistle", 0.4, 2, 6, 1.4, ghNotes(
				ghTone("whistle", 0.24, 0, 3000, 4300, 0.8),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "finch", Primary: "pink", Secondary: "grey",
			Marking: "double white wing-bars, blue-grey cap", Bill: "stout", Flight: "undulating",
		},
		Nest: ghNest("cup_fork", []string{"fork", "shrub", "branch"}, 1, 10, ghNestSpring, 0.1,
			"A neat, deep cup of moss and grass bound with spider silk and decorated outside with lichen, set in a fork of a tree or a bush."),
		Facts: []string{
			"Chaffinches sing in regional dialects, learned from their neighbours in their first spring.",
			"A young chaffinch that never hears an adult sing grows up to sing only a simple, unfinished song.",
			"The female decorates her nest with lichen and cobwebs, so it melts into the bark.",
			"Chaffinches feed their chicks almost entirely on caterpillars, not the seeds the adults live on.",
			"The chaffinch is one of Europe's most numerous birds, with well over a hundred million pairs.",
			"Linnaeus named it coelebs, the bachelor, because mainly males stayed in Sweden through the winter.",
		},
		Difficulty: 1,
		Similar:    []string{"brambling", "hawfinch", "european_robin"},
		Relations: []string{
			"Feeds its chicks on caterpillars from the oak canopy, then lives on fallen seeds for the rest of the year.",
			"In winter it joins bramblings under the beeches to feed on fallen mast.",
			"Covers its nest with lichen and spider silk until it looks like part of the branch.",
		},
	}
}

func ghGreatSpottedWoodpecker() core.Species {
	return core.Species{
		ID:     "great_spotted_woodpecker",
		Name:   "Great Spotted Woodpecker",
		Sci:    "Dendrocopos major",
		Family: "Woodpeckers",
		Desc: "A boldly pied woodpecker the size of a blackbird, black and white with a crimson patch under the tail; the male also has a red spot on the nape. " +
			"It hitches up trunks and along dead branches, propped on its stiff tail, and crosses the gaps between trees in deep bounds.",
		IDTips: "Two large white oval patches on the shoulders and the red under the tail identify it from any angle. " +
			"Listen for the drum, a very fast roll that fades at the end and lasts barely half a second, and for the sharp, far-carrying kik. " +
			"The nuthatch also climbs trunks but is much smaller, blue-grey, and comes down head first.",
		Fact: "Drumming is the woodpecker's song, not its feeding: both sexes choose a dead, resonant branch and strike it ten to sixteen times in little more than half a second. " +
			"Spongy bone and a tongue-bone that wraps right around the skull protect the brain from the blows.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.75), ghHab("conifer", 0.25),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.23, Wingspan: 0.36, Plump: 1, Neck: 0.1, Legs: 0.25,
			Tail: 0.5, TailShape: "pointed", Bill: 0.9, BillShape: "chisel", WingShape: "rounded",
			Colors: ghPalette("#141414", "#efe7d6", "#f1ece0", "#161616", "#141414", "#4a4d55", "#5a5f66", "#3a1410"),
			// The crimson under-tail cannot be painted with the available mark kinds (it
			// is not the rump, which is black), so the model carries the male's red nape.
			Marks: []core.Mark{
				ghMark("cap", "#111111"), ghMark("nape", "#d42a20"), ghMark("cheek", "#f3efe4"),
				ghMark("collar", "#111111"), ghMark("wingpatch", "#f7f5ee"), ghMark("bars", "#f2f0ea"),
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "cling", Speed: 11, FlapHz: 9},
		Behavior: core.Behavior{
			Perches:   []string{"trunk", "snag", "branch", "canopy"},
			Feeding:   "trunk",
			Activity:  [6]float32{0.7, 1, 0.6, 0.7, 0.5, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 140, Shyness: 22, Vocal: 2.5, Density: 0.3,
			Camo: 0.3, Skulking: 0.2, Habituate: 0.3,
			Specials: []string{"nesting", "social"},
		},
		Calls: []core.Call{
			// The drum: fourteen strikes in two thirds of a second, speeding up and
			// fading. Low and woody, it carries a long way through bare trees.
			ghCall("drum", "low", "drumming", 0.75, 1, 2, 5, ghDrum(14, 850, 0.048, 0.026)),
			// A sharp, explosive "kik!".
			ghCall("call", "high", "single", 0.5, 1, 4, 1.1, ghNotes(
				ghTone("whistle", 0.05, 0.12, 4400, 3200, 1),
			)),
			// A run of kiks when alarmed.
			ghCall("alarm", "high", "chatter", 0.55, 1, 2, 1, ghTimes(8,
				ghTone("whistle", 0.04, 0.05, 4400, 3300, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "woodpecker", Primary: "black", Secondary: "white",
			Marking: "white shoulder patches, crimson under the tail", Bill: "chisel", Flight: "undulating",
		},
		Nest: ghNest("cavity", []string{"cavity"}, 3, 9, ghNestSpring, 0.14,
			"A fresh hole chiselled into a trunk or a thick dead limb, the floor bare except for a few wood chips."),
		Facts: []string{
			"Drumming is the woodpecker's song: a fast roll on a resonant dead branch that says 'this is my wood'.",
			"A woodpecker's tongue is so long that it wraps round the back of its skull when pulled in.",
			"It wedges pine cones into a bark crevice, its anvil, to hammer out the seeds.",
			"Stiff tail feathers act as a prop, bracing the bird against the trunk as it hammers.",
			"Young great spotted woodpeckers have an all-red crown, which fools many people into thinking they are another species.",
			"A pair takes two or three weeks to chisel out a new nest hole.",
			"In spring it sometimes breaks into nest boxes to take the chicks of tits.",
		},
		Difficulty: 2,
		Similar:    []string{"eurasian_nuthatch"},
		Relations: []string{
			"Cuts a new nest hole most years; the old ones become homes for tits and nuthatches.",
			"Wedges pine cones and nuts into a crack in the bark, its workshop, to hammer out the seeds.",
			"In spring it sometimes breaks into the nest holes of tits to take the chicks.",
		},
	}
}

func ghJay() core.Species {
	return core.Species{
		ID:     "eurasian_jay",
		Name:   "Eurasian Jay",
		Sci:    "Garrulus glandarius",
		Family: "Crows & Jays",
		Desc: "The colourful crow of the woodland: pinkish-brown with a black tail, a white rump and a brilliant blue patch, barred with black, on each wing. " +
			"Shy and wary, it keeps to the canopy and is usually first noticed by its harsh, tearing screech or as a white rump vanishing between the trees.",
		IDTips: "In flight the white rump above a black tail is unmistakable, together with broad rounded wings and an unsteady, floppy action. " +
			"Perched, look for the blue wing patch, the black moustache and the streaked crown, which it raises into a crest when excited. " +
			"It slips away long before you are close; stay still and let it come back.",
		Fact: "In autumn a single jay buries several thousand acorns, one by one, and finds most of them again months later, even under snow. " +
			"The ones it forgets are perfectly planted, and many of the oaks in a wood were sown by jays. " +
			"It is also a mimic, and can give a convincing buzzard's mew.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.8), ghHab("conifer", 0.2),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.34, Wingspan: 0.55, Plump: 1.05, Neck: 0.15, Legs: 0.45,
			Tail: 0.75, TailShape: "square", Bill: 0.6, BillShape: "cone", Crest: true, WingShape: "broad",
			Colors: ghPalette("#b58f7c", "#c9a391", "#c4a08c", "#1d1b1a", "#151414", "#26221f", "#9a7a62", "#a8c4d8"),
			Marks: []core.Mark{
				ghMark("wingpatch", "#2f8fe0"), ghMark("wingbar", "#f4f2ec"),
				ghMark("rump", "#f7f5f0"), ghMark("throat", "#f2ece4"),
			},
		},
		Move: core.Movement{Flight: "buoyant", Ground: "hop", Speed: 10, FlapHz: 4.5},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch", "ground"},
			Feeding:   "seeds", // acorns above all
			Activity:  [6]float32{0.7, 1, 0.6, 0.8, 0.5, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 180, Shyness: 35, Vocal: 1.2, Density: 0.25,
			Camo: 0.3, Skulking: 0.55, Habituate: 0.1,
			Specials: []string{"social", "preening"}, // spring gatherings; "anting" with spread wings
		},
		Calls: []core.Call{
			// A harsh, tearing screech, usually given twice: the sentinel of the wood.
			ghCall("call", "medium", "harsh", 0.7, 1, 3, 1.2, ghNotes(
				ghTone("noise", 0.42, 0.3, 2900, 2100, 1),
				ghTone("noise", 0.38, 0, 2800, 1900, 0.9),
			)),
			// A quiet, uncanny imitation of a buzzard's mew, given from inside the canopy.
			ghCall("call", "medium", "single", 0.35, 1, 2, 3, ghNotes(
				ghTone("whistle", 0.55, 0, 2700, 1900, 0.5),
			)),
			// Rapid screeches when it has found an owl, a fox or a person.
			ghCall("alarm", "medium", "harsh", 0.75, 1, 3, 0.8, ghTimes(3,
				ghTone("noise", 0.22, 0.1, 3000, 2200, 1),
			)),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "corvid", Primary: "pink", Secondary: "black",
			Marking: "blue-barred wing patch, white rump", Bill: "stout", Flight: "buoyant",
		},
		Nest: ghNest("cup_fork", []string{"fork", "canopy", "shrub"}, 2, 8, ghNestSpring, 0.3,
			"A loose platform of twigs around a neat cup of rootlets, hidden in a fork among dense foliage or ivy."),
		Facts: []string{
			"A single jay may bury several thousand acorns in autumn and find most of them again.",
			"A jay can carry several acorns at once, stowed in its throat and its bill.",
			"Jays carry acorns far from the parent trees, and the forgotten ones grow into new oaks.",
			"Jays sometimes squat on ants' nests with wings spread, letting the ants crawl through their feathers.",
			"Jays are fine mimics and can copy the calls of hawks and owls.",
			"A male jay brings his mate tit-bits, and seems to choose the food she currently craves.",
		},
		Difficulty: 3,
		Similar:    []string{},
		Relations: []string{
			"Buries thousands of acorns every autumn; the ones it forgets grow into new oaks.",
			"Its screech puts every bird in the wood on alert, and often means an owl or a walker has been spotted.",
			"Takes the eggs and nestlings of smaller songbirds in spring.",
		},
	}
}

func ghNuthatch() core.Species {
	return core.Species{
		ID:     "eurasian_nuthatch",
		Name:   "Eurasian Nuthatch",
		Sci:    "Sitta europaea",
		Family: "Nuthatches",
		Desc: "A compact, short-tailed bird, blue-grey above and orange-buff below, with a long black stripe through the eye and a strong dagger of a bill. " +
			"It runs over trunks and boughs in jerky bursts in every direction, including straight down, head first.",
		IDTips: "A small bird coming down a trunk head first is a nuthatch; woodpeckers and treecreepers only go upwards. " +
			"The treecreeper is brown and white with a thin curved bill, and creeps like a mouse. " +
			"The nuthatch is loud: ringing whistles, twee-twee-twee, and a sharp twit.",
		Fact: "The name comes from 'nut-hack': it wedges a hazelnut or an acorn into a crack in the bark and hammers it open. " +
			"It nests in an old woodpecker hole and plasters the entrance with mud until the opening is exactly nuthatch-sized, which keeps larger birds out.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.9), ghHab("conifer", 0.1),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.14, Wingspan: 0.245, Plump: 1.2, Neck: 0, Legs: 0.3,
			Tail: 0.3, TailShape: "square", Bill: 0.9, BillShape: "dagger", WingShape: "rounded",
			Colors: ghPalette("#6f8fb0", "#dba36a", "#6f8fb0", "#5f7c9a", "#5a7590", "#3a4048", "#7a6248", "#0f0d0b"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#111111"), ghMark("cheek", "#f3efe6"), ghMark("throat", "#f3efe6"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "cling", Speed: 10, FlapHz: 12},
		Behavior: core.Behavior{
			Perches:   []string{"trunk", "branch", "canopy"},
			Feeding:   "trunk",
			Activity:  [6]float32{0.8, 1, 0.6, 0.7, 0.5, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 70, Shyness: 12, Vocal: 4, Density: 0.4,
			Camo: 0.35, Skulking: 0.15, Habituate: 0.5,
			Specials: []string{"nesting", "feeding"}, // plastering the nest hole; hammering a wedged nut
		},
		Calls: []core.Call{
			// Loud, ringing, upslurred whistles: "twee-twee-twee-twee".
			ghCall("song", "high", "whistle", 0.6, 2, 4, 1.5, ghTimes(4,
				ghTone("whistle", 0.15, 0.09, 2700, 3900, 1),
			)),
			// A sharp, liquid "twit, twit" as it works a trunk.
			ghCall("call", "high", "single", 0.5, 1, 4, 0.5, ghTimes(2,
				ghTone("whistle", 0.05, 0.08, 3300, 4100, 0.9),
			)),
			// The second song: a fast, even trill.
			ghCall("song", "high", "trill", 0.55, 1, 3, 2, ghNotes(
				ghVib("trill", 0.9, 0, 3300, 3300, 13, 0.9, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "songbird", Primary: "grey", Secondary: "buff",
			Marking: "long black eye-stripe", Bill: "dagger", Flight: "direct",
		},
		Nest: ghNest("cavity", []string{"cavity"}, 2, 9, ghNestSpring, 0.12,
			"An old woodpecker hole whose entrance the female plasters with mud until it fits her exactly, lined with loose flakes of bark."),
		Facts: []string{
			"The nuthatch is the only bird in Britain that regularly climbs down trees head first.",
			"It plasters mud round its nest hole until the entrance fits a nuthatch and nothing bigger.",
			"Its name means 'nut hacker': it wedges a nut into the bark and hammers it open.",
			"Nuthatches line the nest with flakes of pine bark rather than moss or feathers.",
			"In autumn it hides seeds in bark crevices and covers them with moss or lichen.",
			"Strong feet and a long hind claw let a nuthatch hang upside down from bark.",
		},
		Difficulty: 2,
		Similar:    []string{"eurasian_treecreeper", "great_spotted_woodpecker"},
		Relations: []string{
			"Nests in old woodpecker holes, plastering the entrance with mud until only a nuthatch fits.",
			"Hides seeds in bark crevices in autumn and defends the larder all winter.",
			"Joins the roving tit flocks for as long as they are crossing its territory.",
		},
	}
}

func ghTreecreeper() core.Species {
	return core.Species{
		ID:     "eurasian_treecreeper",
		Name:   "Eurasian Treecreeper",
		Sci:    "Certhia familiaris",
		Family: "Treecreepers",
		Desc: "A small, slender bird that looks like a piece of bark come to life: mottled brown above, silky white below, with a fine curved bill. " +
			"It creeps up a trunk in a spiral, propped on its stiff tail, then drops to the foot of the next tree and starts again.",
		IDTips: "It only ever climbs upwards, pressed so close to the trunk that it resembles a mouse; watch for the white underparts as it flits down to the next tree. " +
			"The nuthatch is bulkier, blue-grey, and climbs down as well as up. " +
			"Song and call are very high and thin, and easy to miss among the tits.",
		Fact: "On cold nights a treecreeper sleeps in a small hollow that it presses into soft bark, fitting so closely that its back becomes part of the trunk. " +
			"Where giant redwoods have been planted, their spongy bark is soon dotted with treecreeper-sized roosting hollows.",
		Rarity:  core.Uncommon,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.7), ghHab("conifer", 0.3),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.125, Wingspan: 0.19, Plump: 0.95, Neck: 0.05, Legs: 0.25,
			Tail: 0.8, TailShape: "pointed", Bill: 1.1, BillShape: "curved", WingShape: "rounded",
			Colors: ghPalette("#7a5f42", "#f4f1ea", "#6f563c", "#6a5238", "#8a6a48", "#5c4a3a", "#a58a72", "#120e0a"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#f1e9d8"), ghMark("streaks", "#dccdb0"),
				ghMark("wingbar", "#e6c88a"), ghMark("rump", "#9a6a3c"),
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "cling", Speed: 7, FlapHz: 15},
		Behavior: core.Behavior{
			Perches:   []string{"trunk", "branch"},
			Feeding:   "trunk",
			Activity:  [6]float32{0.7, 1, 0.7, 0.8, 0.5, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 80, Shyness: 8, Vocal: 2.5, Density: 0.25,
			Camo: 0.9, Skulking: 0.2, Habituate: 0.5,
			Specials: []string{"nesting", "preening"},
		},
		Calls: []core.Call{
			// A thin, silvery cadence that hurries down the scale and flicks up at the end.
			ghCall("song", "very high", "melodic", 0.18, 1, 2, 5, ghJoin(
				ghTimes(2, ghTone("sine", 0.16, 0.06, 7900, 7600, 0.7)),
				ghSteps(4, "sine", 0.09, 0.04, 7500, 6900, -200, 0.8),
				ghSteps(6, "sine", 0.05, 0.025, 6800, 6200, -150, 0.8),
				ghNotes(ghTone("whistle", 0.14, 0, 6000, 7400, 0.9)),
			)),
			// A thin, shivering "tsreee".
			ghCall("call", "very high", "single", 0.15, 1, 3, 1.5, ghNotes(
				ghVib("sine", 0.32, 0, 7700, 7500, 45, 0.02, 0.6),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "treecreeper", Primary: "brown", Secondary: "white",
			Marking: "bark-mottled back, silky white underparts", Bill: "long curved", Flight: "undulating",
		},
		Nest: ghNest("cavity", []string{"trunk", "cavity"}, 0.5, 5, ghNestSpring, 0.1,
			"A loose cup of twigs, moss and feathers wedged behind a flap of loose bark or in a crack in a trunk."),
		Facts: []string{
			"A treecreeper spirals up a trunk, then flutters down to the foot of the next tree and starts again.",
			"Its stiff, pointed tail feathers work like a third leg, propping it against the bark.",
			"On cold nights treecreepers roost in hollows they scrape into the soft bark of giant redwoods.",
			"It usually nests behind a loose flap of bark or in a crack in a trunk.",
			"The thin, curved bill probes crevices for spiders and insect eggs too small for woodpeckers.",
			"In bitter weather several treecreepers may huddle together in one roosting hollow.",
		},
		Difficulty: 4,
		Similar:    []string{"eurasian_nuthatch", "eurasian_wren"},
		Relations: []string{
			"Probes bark crevices too fine for woodpeckers and nuthatches, taking spiders and insect eggs.",
			"Tags along with the winter tit flocks for the safety of extra eyes.",
			"Nests behind a flap of loose bark on an old or dying tree.",
		},
	}
}

func ghTawnyOwl() core.Species {
	return core.Species{
		ID:     "tawny_owl",
		Name:   "Tawny Owl",
		Sci:    "Strix aluco",
		Family: "Owls",
		Desc: "A stocky, round-headed owl, mottled rufous-brown and buff, with large black eyes in a plain face. " +
			"It spends the day asleep against a trunk or in thick ivy, where it is very hard to find, and hunts mice and voles after dark. " +
			"Its wavering hoot is the voice of the wood at night.",
		IDTips: "A round head without ear tufts and dark eyes separate it from other owls. " +
			"By day, check close to the trunks of large trees, and follow the noise when small birds are scolding something they have found. " +
			"After dusk listen for the hoot, one long note, a pause, then a quavering hoo-hoo-hooo, and for the sharp ke-wick.",
		Fact: "The famous 'tu-whit, tu-whoo' is not one owl but two: a female calling ke-wick and a male answering with his hoot. " +
			"A pair stays in the same territory for life and learns it so thoroughly that it can hunt between the trees on the darkest night, guided mostly by sound.",
		Rarity:  core.Uncommon,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.85), ghHab("conifer", 0.15),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.38, Wingspan: 0.99, Plump: 1.3, Neck: 0, Legs: 0.2,
			Tail: 0.4, TailShape: "square", Bill: 0.35, BillShape: "hooked", WingShape: "broad",
			Colors: ghPalette("#8a5a36", "#d9c4a0", "#8f6240", "#7d5332", "#7a5232", "#c9bf7a", "#d6c5a6", "#0b0907"),
			Marks: []core.Mark{
				ghMark("cheek", "#cdb08a"),   // the pale facial disc
				ghMark("streaks", "#4a3220"), // bold dark streaks below
				ghMark("wingbar", "#efe6d2"), // the row of white spots along the shoulder
			},
		},
		Move: core.Movement{Flight: "flapglide", Ground: "none", Speed: 8, FlapHz: 3.2},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch", "snag", "structure"},
			Feeding:   "hunt",
			Activity:  [6]float32{0.5, 0.02, 0, 0.02, 0.7, 1}, // strictly nocturnal: roosts all day
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 220, Shyness: 18, Vocal: 1.5, Density: 0.1,
			Camo: 0.9, Skulking: 0.85, Habituate: 0.35,
			Specials: []string{"preening", "social"}, // a pair calling to each other at dusk
		},
		Calls: []core.Call{
			// The male's hoot: one long note, a pause of two seconds, a short "hu", then a
			// long quavering "hu-hu-hu-hooo".
			ghCall("song", "low", "whistle", 0.85, 1, 2, 9, ghNotes(
				ghTone("sine", 0.85, 2.3, 800, 720, 0.9),
				ghTone("sine", 0.13, 0.28, 760, 740, 0.7),
				ghVib("sine", 1.35, 0, 800, 660, 11, 0.04, 1),
			)),
			// "Ke-wick!": sharp and carrying, mostly from the female.
			ghCall("call", "medium", "single", 0.7, 1, 3, 2.5, ghNotes(
				ghTone("whistle", 0.13, 0.03, 1900, 2700, 0.9),
				ghTone("whistle", 0.16, 0, 2900, 2000, 1),
			)),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "owl", Primary: "brown", Secondary: "buff",
			Marking: "round head, dark eyes in a plain face", Bill: "hooked", Flight: "flapglide",
		},
		Nest: ghNest("cavity", []string{"cavity", "fork"}, 3, 9, ghNestSpring, 0.35,
			"No nest material at all: the eggs lie on the floor of a large tree hole, an old crow's nest or a deep fork."),
		Facts: []string{
			"'Tu-whit, tu-whoo' is really two owls: the female calls 'ke-wick' and the male answers with his hoot.",
			"A tawny owl's eyes are fixed in its skull, so it turns its whole head, up to about 270 degrees.",
			"Soft, fringed edges on its flight feathers make a tawny owl's flight almost silent.",
			"Once settled, a tawny owl never leaves its territory; young owls that find none often starve.",
			"The female tawny owl is larger and heavier than the male, as in most birds of prey.",
			"Tawny owls cough up pellets of fur and bone that show exactly what they have eaten.",
			"Tawny owls nest in tree holes, old crows' nests and even chimneys.",
		},
		Difficulty: 4,
		Similar:    []string{"common_buzzard", "snowy_owl"},
		Relations: []string{
			"Hunts wood mice and bank voles from a perch, by ear as much as by sight.",
			"Small birds that find a roosting owl mob it noisily: follow a scolding blackbird or jay and you may find one.",
			"A pair holds the same territory for life and knows every perch in it.",
		},
	}
}

func ghBuzzard() core.Species {
	return core.Species{
		ID:     "common_buzzard",
		Name:   "Common Buzzard",
		Sci:    "Buteo buteo",
		Family: "Hawks & Eagles",
		Desc: "A large, broad-winged bird of prey, mostly dark brown with a paler band across the breast. " +
			"It circles high over the wood and its clearings on raised wings with the tail fanned, or sits hunched on a dead tree at the meadow's edge, watching the grass.",
		IDTips: "Look up: broad wings held in a shallow V, a short fanned tail and pale patches under the wingtips. " +
			"The call is a wild, cat-like mew that falls in pitch, pee-yow, and carries a long way. " +
			"The golden eagle of the highlands is far bigger, with longer wings; the marsh harrier is slimmer and flies low over the reeds.",
		Fact: "For all its eagle-like looks, a buzzard will happily spend a damp morning walking about a meadow eating earthworms. " +
			"It likes to save its energy and soars on rising warm air, which is why it is seen most often around the middle of the day.",
		Rarity:  core.Uncommon,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.5), ghHab("meadow", 0.5),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.54, Wingspan: 1.2, Plump: 1.1, Neck: 0.1, Legs: 0.35,
			Tail: 0.55, TailShape: "fan", Bill: 0.5, BillShape: "hooked", WingShape: "broad",
			Colors: ghPalette("#5d4129", "#8a6846", "#5a3f29", "#523822", "#9a8468", "#2a2622", "#e3c032", "#4a3018"),
			Marks: []core.Mark{
				ghMark("breast", "#e6d8ba"),    // the pale crescent
				ghMark("bars", "#3e2a1a"),      // fine barring below and on the tail
				ghMark("wingpatch", "#ece2c8"), // pale panel under the wingtip
				ghMark("tailtip", "#3a281a"),
			},
		},
		Move: core.Movement{Flight: "soaring", Ground: "walk", Speed: 11, FlapHz: 2.8},
		Behavior: core.Behavior{
			Perches:   []string{"snag", "branch", "structure", "canopy", "ground"},
			Feeding:   "hunt",
			Activity:  [6]float32{0.2, 0.8, 1, 0.9, 0.4, 0}, // waits for the thermals
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 380, Shyness: 70, Vocal: 1.2, Density: 0.08,
			Camo: 0.35, Skulking: 0.05, Habituate: 0.1,
			Specials: []string{"social", "hovering"}, // pairs circling together; hanging on the wind
		},
		Calls: []core.Call{
			// A wild, plaintive mew that falls away: "pee-yow".
			ghCall("call", "medium", "single", 0.8, 1, 3, 3.5, ghNotes(
				ghTone("whistle", 0.09, 0, 2500, 3200, 0.8),
				ghTone("whistle", 0.9, 0, 3200, 1900, 1),
			)),
			// Shorter, insistent mews when something comes too near the nest.
			ghCall("alarm", "medium", "repeated", 0.8, 1, 2, 2, ghTimes(3,
				ghTone("whistle", 0.42, 0.28, 3000, 2000, 1),
			)),
		},
		Traits: core.Traits{
			Size: "large", Shape: "raptor", Primary: "brown", Secondary: "white",
			Marking: "pale crescent across the breast", Bill: "hooked", Flight: "soaring",
		},
		Nest: ghNest("platform", []string{"fork", "canopy"}, 6, 20, ghNestSpringSummer, 0.9,
			"A bulky platform of sticks in a high fork against the trunk, decorated with fresh green sprigs throughout the season."),
		Facts: []string{
			"The buzzard is now the commonest bird of prey in Britain, after a remarkable recovery.",
			"Buzzards keep adding fresh green sprigs to the nest while the chicks grow, perhaps to keep it clean.",
			"After rain buzzards often walk across fields picking up earthworms, like big brown chickens.",
			"Buzzard plumage ranges from almost white to dark chocolate, so no two look quite alike.",
			"Other woodland birds mimic its mewing call so well that not every 'buzzard' in the wood is one.",
			"Buzzards often use the same territory for many years and rebuild old nests.",
		},
		Difficulty: 2,
		Similar:    []string{"golden_eagle", "western_marsh_harrier", "common_raven", "tawny_owl"},
		Relations: []string{
			"Rides the thermals over the wood by day, watching the clearings for voles and young rabbits.",
			"Often mobbed by jays and ravens, which escort it out of their territories.",
			"Walks damp meadows after rain to eat earthworms.",
		},
	}
}

func ghSongThrush() core.Species {
	return core.Species{
		ID:     "song_thrush",
		Name:   "Song Thrush",
		Sci:    "Turdus philomelos",
		Family: "Thrushes & Chats",
		Desc: "A neat brown thrush, smaller than a blackbird, with a cream breast covered in dark spots shaped like arrowheads. " +
			"It feeds on the ground in short runs and pauses, and sings from a treetop at dawn and dusk: loud, clear phrases, each repeated two or three times before it moves on to the next.",
		IDTips: "Warm brown above with a spotted breast; a female blackbird is darker and has no clear spots. " +
			"The redwing of Amberwood has a cream eyebrow and rusty flanks. " +
			"The song gives it away at once: no other bird in the wood repeats itself so deliberately.",
		Fact: "The song thrush is the only bird here that cracks snails: it carries them to a favourite stone, its anvil, and beats them against it until the shell breaks. " +
			"Find a flat stone surrounded by broken shells and you have found a thrush's workshop.",
		Rarity:  core.Common,
		Regions: ghWoodsAndAmberwood(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.5), ghHab("shrub", 0.3), ghHab("meadow", 0.2),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.23, Wingspan: 0.34, Plump: 1.1, Neck: 0.1, Legs: 0.45,
			Tail: 0.65, TailShape: "square", Bill: 0.55, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#8a6c48", "#f3ead2", "#86683f", "#7f6240", "#7a5e3c", "#4a3a2a", "#d3a888", "#130f0b"),
			Marks: []core.Mark{
				ghMark("breast", "#e9cf9a"), // warm buff wash, painted before the spots
				ghMark("spots", "#3a2a1c"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 11, FlapHz: 7.5},
		Behavior: core.Behavior{
			Perches:   []string{"ground", "branch", "shrub", "canopy"},
			Feeding:   "ground",
			Activity:  [6]float32{1, 0.7, 0.4, 0.5, 0.95, 0.02},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 70, Shyness: 14, Vocal: 6, Density: 0.5,
			Camo: 0.55, Skulking: 0.4, Habituate: 0.4,
			Specials: []string{"feeding", "bathing", "nesting"}, // feeding: smashing a snail on its anvil
		},
		Calls: []core.Call{
			// Three different motifs, each sung two or three times over: the thrush's
			// signature. "Tee-wit tee-wit tee-wit ... pee-oo pee-oo ... did-he-do did-he-do".
			ghCall("song", "medium", "repeated", 0.65, 2, 3, 1.2, ghJoin(
				ghRest(ghTimes(3,
					ghTone("whistle", 0.14, 0.03, 2200, 3000, 1),
					ghTone("whistle", 0.12, 0.16, 2800, 2000, 0.9),
				), 0.3),
				ghRest(ghTimes(2,
					ghTone("whistle", 0.22, 0.14, 3300, 1900, 1),
				), 0.3),
				ghTimes(3,
					ghTone("whistle", 0.07, 0.03, 3700, 3900, 0.8),
					ghTone("whistle", 0.07, 0.03, 2800, 3000, 0.9),
					ghTone("whistle", 0.11, 0.14, 2100, 2400, 1),
				),
			)),
			// A thin "tsip", often the only sign of one flying over.
			ghCall("call", "very high", "single", 0.2, 1, 2, 1, ghNotes(
				ghTone("sine", 0.05, 0.15, 7400, 7000, 0.6),
			)),
			// A rattling "tchuk-tchuk-tchuk" of alarm.
			ghCall("alarm", "medium", "chatter", 0.5, 1, 3, 0.7, ghTimes(6,
				ghTone("buzz", 0.05, 0.04, 2700, 2200, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "thrush", Primary: "brown", Secondary: "buff",
			Marking: "dark arrowhead spots on a cream breast", Bill: "thin", Flight: "direct",
		},
		Nest: ghNest("cup_shrub", []string{"shrub", "fork"}, 0.5, 4, ghNestSpringSummer, 0.16,
			"A cup of grass and moss lined with a smooth, hard layer of mud and wood pulp, in a dense bush, hedge or low fork."),
		Facts: []string{
			"The song thrush uses a favourite stone as an anvil to smash open snail shells.",
			"It repeats each phrase two or three times, the quickest way to know its song.",
			"The nest is lined with a smooth, hard shell of mud and wood pulp, with no soft lining at all.",
			"Its eggs are a startling sky blue with a few black spots.",
			"Robert Browning wrote of the wise thrush that sings each song twice over.",
			"A song thrush may have more than a hundred different phrases in its repertoire.",
		},
		Difficulty: 2,
		Similar:    []string{"redwing", "common_blackbird"},
		Relations: []string{
			"Smashes banded snails on a favourite stone; look for heaps of broken shells.",
			"Eats earthworms in damp weather and turns to snails when the ground is dry or frozen.",
			"Shares the autumn berry crop with blackbirds and visiting redwings.",
		},
	}
}

func ghGoldcrest() core.Species {
	return core.Species{
		ID:     "goldcrest",
		Name:   "Goldcrest",
		Sci:    "Regulus regulus",
		Family: "Kinglets",
		Desc: "The smallest bird in Europe: a tiny olive-green ball with a yellow stripe along its crown, edged with black. " +
			"It lives among the needles of pines and spruces, flitting and hovering constantly, and takes little notice of people.",
		IDTips: "Tiny size, a plain face with a dark beady eye and the yellow crown-stripe; the chiffchaff is longer, has a pale eyebrow and no crown-stripe or wing-bar. " +
			"The song is extremely high and thin, a little cycling phrase, tee-de-lee, tee-de-lee, that ends in a flourish. " +
			"Search the outer sprays of conifers.",
		Fact: "A goldcrest weighs about five grams, the same as a sheet of writing paper, yet the female lays up to a dozen eggs that together outweigh her. " +
			"Its song is pitched so high that many people lose the ability to hear it as they grow older.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("conifer", 0.8), ghHab("woodland", 0.2),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.09, Wingspan: 0.145, Plump: 1.25, Neck: 0, Legs: 0.3,
			Tail: 0.45, TailShape: "forked", Bill: 0.4, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#7d8c4a", "#d8d2b4", "#9a9c7a", "#3a3a2c", "#5a5c3a", "#1c1a18", "#6a543c", "#0a0a0a"),
			Marks: []core.Mark{
				ghMark("cap", "#f2c81e"), ghMark("wingbar", "#f0ecd8"), ghMark("wingpatch", "#1c1c18"),
			},
		},
		Move: core.Movement{Flight: "whirring", Ground: "hop", Speed: 6, FlapHz: 24},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch"},
			Feeding:   "glean",
			Activity:  [6]float32{0.8, 1, 0.7, 0.8, 0.6, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 40, Shyness: 4, Vocal: 5, Density: 0.6,
			Camo: 0.5, Skulking: 0.6, Habituate: 0.7,
			Specials: []string{"hovering", "bathing"}, // hovers to pick insects from under the needles
		},
		Calls: []core.Call{
			// Needle-thin and very high: "tee-de-lee tee-de-lee tee-de-lee" and a flourish.
			ghCall("song", "very high", "repeated", 0.15, 1, 3, 3, ghJoin(
				ghTimes(5,
					ghTone("sine", 0.07, 0.02, 7900, 7700, 0.6),
					ghTone("sine", 0.05, 0.02, 7000, 7200, 0.5),
					ghTone("sine", 0.06, 0.05, 7600, 7400, 0.6),
				),
				ghNotes(
					ghVib("trill", 0.2, 0.02, 7300, 8100, 30, 0.7, 0.6),
					ghTone("sine", 0.09, 0, 7000, 6300, 0.5),
				),
			)),
			// "See-see-see": the contact call, at the edge of hearing.
			ghCall("call", "very high", "repeated", 0.12, 1, 3, 1.2, ghTimes(3,
				ghTone("sine", 0.08, 0.07, 8000, 7900, 0.5),
			)),
		},
		Traits: core.Traits{
			Size: "tiny", Shape: "warbler", Primary: "green", Secondary: "yellow",
			Marking: "yellow crown-stripe edged with black", Bill: "thin", Flight: "whirring",
		},
		Nest: ghNest("pendant", []string{"branch", "canopy"}, 2, 12, ghNestSpringSummer, 0.09,
			"A deep, thick-walled cup of moss, lichen and spider silk slung like a hammock beneath the tip of a conifer branch."),
		Facts: []string{
			"The goldcrest is Europe's smallest bird, weighing about five grams, the same as a twenty-pence coin.",
			"Old folk tales said goldcrests crossed the North Sea riding on the backs of woodcocks.",
			"Despite weighing so little, many goldcrests fly across the North Sea every autumn.",
			"In winter a goldcrest must feed almost every daylight minute to survive the night.",
			"When excited, the male raises his crest to show a hidden flame of orange.",
			"Its song is pitched so high that many older people can no longer hear it.",
		},
		Difficulty: 3,
		Similar:    []string{"common_chiffchaff", "eurasian_wren"},
		Relations: []string{
			"A conifer specialist: its needle-fine bill picks springtails and aphids from between the needles.",
			"Joins the tit flocks in winter, when it must feed through almost every daylight minute to survive the night.",
			"Hangs its nest of moss and spider silk beneath the tip of a spruce or pine bough.",
		},
	}
}

func ghLongTailedTit() core.Species {
	return core.Species{
		ID:     "long_tailed_tit",
		Name:   "Long-tailed Tit",
		Sci:    "Aegithalos caudatus",
		Family: "Long-tailed Tits",
		Desc: "A tiny pink, black and white ball of fluff with a tail longer than its body. " +
			"Long-tailed tits are almost never alone: family parties move through bushes and treetops one after another, keeping in touch with constant thin calls.",
		IDTips: "The shape is unique: a round body, a stub of a bill and a long, narrow tail. " +
			"Usually you hear the flock first, high see-see-see notes and a short rippling trrr, and then the birds cross a gap in single file. " +
			"They are confiding and will feed within a few metres of a quiet watcher.",
		Fact: "The nest is a stretchy dome of moss bound with spider silk, covered with thousands of flakes of lichen and lined with around 1,500 feathers; it expands as the chicks grow. " +
			"On cold nights the whole family roosts in a row on a branch, pressed together.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("shrub", 0.5), ghHab("woodland", 0.5),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.14, Wingspan: 0.17, Plump: 1.3, Neck: 0, Legs: 0.3,
			Tail: 1.4, TailShape: "pointed", Bill: 0.2, BillShape: "cone", WingShape: "rounded",
			Colors: ghPalette("#1c1a1a", "#f0e4de", "#f5f1ea", "#1f1d1c", "#171615", "#121212", "#2a2420", "#1a0e0a"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#171514"), // the broad black band over the eye
				ghMark("wingpatch", "#c98a8a"), // pink shoulders
				ghMark("rump", "#c98a8a"),
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "hop", Speed: 6, FlapHz: 20},
		Behavior: core.Behavior{
			Perches:   []string{"shrub", "branch", "canopy"},
			Feeding:   "glean",
			Activity:  [6]float32{0.7, 1, 0.7, 0.8, 0.6, 0},
			Sociality: "flock", FlockMin: 6, FlockMax: 14,
			Territory: 150, Shyness: 5, Vocal: 8, Density: 0.35,
			Camo: 0.25, Skulking: 0.3, Habituate: 0.7,
			Specials: []string{"social", "nesting"},
		},
		Calls: []core.Call{
			// The flock's running commentary: "see-see-see" and a rippling "tsirrrup".
			ghCall("call", "very high", "chatter", 0.2, 2, 5, 0.7, ghJoin(
				ghTimes(3, ghTone("sine", 0.09, 0.05, 7700, 7500, 0.6)),
				ghNotes(ghVib("trill", 0.2, 0, 6000, 6900, 38, 0.8, 0.7)),
			)),
			// A short, dry "trrp" between birds at close range.
			ghCall("call", "high", "trill", 0.15, 1, 4, 0.5, ghTimes(2,
				ghVib("buzz", 0.1, 0.08, 4300, 4000, 50, 0.08, 0.7),
			)),
			// A falling string of thin notes that sends the whole party into cover.
			ghCall("alarm", "very high", "trill", 0.2, 1, 2, 1,
				ghSteps(6, "sine", 0.05, 0.03, 8200, 7400, -100, 0.6),
			),
		},
		Traits: core.Traits{
			Size: "tiny", Shape: "tit", Primary: "white", Secondary: "black",
			Marking: "tail longer than its body, pink shoulders", Bill: "short", Flight: "undulating",
		},
		Nest: ghNest("dome", []string{"shrub", "fork"}, 0.5, 4, ghNestSpring, 0.12,
			"A stretchy oval dome of moss and spider silk with a side entrance, covered in flakes of lichen and lined with well over a thousand feathers."),
		Facts: []string{
			"A long-tailed tit's nest can hold more than two thousand feathers, gathered one at a time.",
			"The nest is a stretchy dome of moss and cobwebs that grows as the chicks grow.",
			"The tail is longer than the body, so a sitting bird folds it up over its back.",
			"Adults whose own nest has failed often help to feed the chicks of their relatives.",
			"On cold nights the whole flock roosts in a tight row on a branch, sharing warmth.",
			"Long-tailed tits are not true tits at all, but belong to a family of their own.",
		},
		Difficulty: 2,
		Similar:    []string{"blue_tit"},
		Relations: []string{
			"Family parties roam the thickets together and roost pressed side by side on a branch.",
			"Adults whose own nest fails help to feed the chicks of their relatives.",
			"Needs spider silk for stretch and lichen for camouflage, so it nests where the scrub is old and mossy.",
		},
	}
}

func ghBlackcap() core.Species {
	return core.Species{
		ID:     "eurasian_blackcap",
		Name:   "Eurasian Blackcap",
		Sci:    "Sylvia atricapilla",
		Family: "Warblers",
		Desc: "A sturdy grey warbler with a neat cap: black in the male, chestnut-brown in the female. " +
			"A summer visitor, it keeps inside brambles, scrub and the understorey and pours out one of the richest songs in the wood.",
		IDTips: "A plain grey bird whose cap stops at the eye; the great tit also has a black head, but with white cheeks and a yellow belly. " +
			"The chiffchaff is smaller, greenish and has no cap. " +
			"The song begins as a scratchy chatter and then swells into loud, clear, fluting notes, fuller and faster than a robin's thin warble; the alarm is a hard tack, like two pebbles knocked together.",
		Fact: "Its song earned the blackcap the nickname 'northern nightingale'. " +
			"In late summer it changes its diet almost completely, from insects to elderberries and blackberries, fattening up for the journey south.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("shrub", 0.55), ghHab("woodland", 0.45),
		},
		Seasons: ghSummerVisitor,
		Look: core.Appearance{
			Length: 0.135, Wingspan: 0.22, Plump: 1, Neck: 0.05, Legs: 0.35,
			Tail: 0.7, TailShape: "square", Bill: 0.5, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#7d7a70", "#cfcfc8", "#a8a8a2", "#6e6a60", "#66625a", "#2c2a2c", "#4a4a52", "#100c0a"),
			Marks:  []core.Mark{ghMark("cap", "#111111")},
		},
		Move: core.Movement{Flight: "darting", Ground: "hop", Speed: 9, FlapHz: 14},
		Behavior: core.Behavior{
			Perches:   []string{"shrub", "canopy", "branch"},
			Feeding:   "glean",
			Activity:  [6]float32{1, 0.9, 0.5, 0.6, 0.7, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 40, Shyness: 12, Vocal: 5, Density: 0.7,
			Camo: 0.45, Skulking: 0.7, Habituate: 0.35,
			Specials: []string{"bathing", "nesting"},
		},
		Calls: []core.Call{
			// Starts as a hesitant, scratchy chatter, then swells into loud, pure flutes.
			ghCall("song", "high", "melodic", 0.5, 2, 4, 2.5, ghNotes(
				ghTone("buzz", 0.06, 0.03, 3600, 4200, 0.4),
				ghTone("whistle", 0.05, 0.03, 5200, 4400, 0.45),
				ghTone("buzz", 0.06, 0.03, 3200, 3600, 0.4),
				ghTone("whistle", 0.05, 0.02, 4800, 5400, 0.5),
				ghTone("whistle", 0.06, 0.03, 3800, 3200, 0.5),
				ghTone("buzz", 0.05, 0.03, 4400, 5000, 0.5),
				ghTone("whistle", 0.07, 0.04, 3400, 4400, 0.6),
				ghTone("whistle", 0.20, 0.04, 3500, 4200, 0.9),
				ghTone("whistle", 0.16, 0.03, 4600, 3500, 1),
				ghTone("whistle", 0.22, 0.04, 3100, 3900, 1),
				ghTone("whistle", 0.14, 0.03, 4800, 4300, 0.9),
				ghTone("whistle", 0.18, 0.03, 3600, 4400, 1),
				ghTone("whistle", 0.28, 0, 4000, 3100, 1),
			)),
			// "Tack, tack": two pebbles knocked together, from inside a bramble.
			ghCall("alarm", "high", "single", 0.3, 1, 4, 0.6, ghTimes(2,
				ghTone("click", 0.02, 0.2, 3600, 3600, 0.8),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "warbler", Primary: "grey", Secondary: "black",
			Marking: "neat black cap", Bill: "thin", Flight: "darting",
		},
		Nest: ghNest("cup_shrub", []string{"shrub"}, 0.3, 2, ghNestSpringSummer, 0.09,
			"A flimsy, neat cup of grass and roots slung low in bramble, nettles or a bush."),
		Facts: []string{
			"Some blackcaps from Germany now winter in Britain instead of Spain, a new migration route that evolved in decades.",
			"The male wears a black cap; the female's cap is chestnut brown.",
			"Its rich, fluting song earned the blackcap the nickname 'northern nightingale'.",
			"Blackcaps wipe sticky mistletoe seeds off their bills onto branches, planting new mistletoe.",
			"The male builds several flimsy trial nests, and the female may finish one or build her own.",
			"Its alarm call is a hard 'tac', like two pebbles knocked together.",
		},
		Difficulty: 3,
		Similar:    []string{"common_chiffchaff", "eurasian_reed_warbler"},
		Relations: []string{
			"Arrives in spring to nest low in bramble and scrub, and leaves again before the autumn.",
			"Feeds on insects in spring, then on elder, bramble and ivy berries before it migrates.",
			"Spreads mistletoe by wiping the sticky seeds off its bill onto branches.",
		},
	}
}

func ghChiffchaff() core.Species {
	return core.Species{
		ID:     "common_chiffchaff",
		Name:   "Common Chiffchaff",
		Sci:    "Phylloscopus collybita",
		Family: "Warblers",
		Desc: "A small, plain olive-brown warbler that arrives in early spring and sings its own name from the treetops: chiff-chaff, chiff-chaff. " +
			"It is forever on the move, picking insects from the leaves and dipping its tail as it goes.",
		IDTips: "Dull olive above and buff-white below, with a faint pale eyebrow and dark legs; the constant downward flick of the tail is a good clue. " +
			"The goldcrest is smaller, with a striped crown; the blackcap is larger, grey and capped. " +
			"It is best told by ear: two notes, repeated in a slightly irregular rhythm, where the great tit's louder see-saw is strictly regular.",
		Fact: "Many languages name this bird after its song: Zilpzalp in German, tjiftjaf in Dutch, siff-saff in Welsh. " +
			"It is one of the first summer visitors to return, and the first chiffchaff singing in a bare wood is a sign that spring has begun.",
		Rarity:  core.Common,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.6), ghHab("shrub", 0.4),
		},
		Seasons: ghSummerVisitor,
		Look: core.Appearance{
			Length: 0.11, Wingspan: 0.18, Plump: 1.05, Neck: 0.05, Legs: 0.35,
			Tail: 0.6, TailShape: "square", Bill: 0.45, BillShape: "thin", WingShape: "rounded",
			Colors: ghPalette("#7f7f52", "#e0d9b8", "#7d7c52", "#6c6a48", "#686644", "#2e261e", "#1f1a16", "#0e0c0a"),
			Marks:  []core.Mark{ghMark("eyestripe", "#d8d09a")}, // the short pale eyebrow
		},
		Move: core.Movement{Flight: "darting", Ground: "hop", Speed: 8, FlapHz: 17},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch", "shrub"},
			Feeding:   "glean",
			Activity:  [6]float32{0.9, 1, 0.6, 0.7, 0.6, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 45, Shyness: 8, Vocal: 7, Density: 0.8,
			Camo: 0.6, Skulking: 0.5, Habituate: 0.5,
			Specials: []string{"hovering", "bathing"}, // flutters under a leaf to pick off an insect
		},
		Calls: []core.Call{
			// It says its name, never quite in a regular order.
			ghCall("song", "high", "repeated", 0.45, 2, 4, 1.2, func() []core.Note {
				chiff := ghTone("whistle", 0.1, 0.14, 5700, 4700, 1)
				chaff := ghTone("whistle", 0.1, 0.14, 4500, 3800, 0.95)
				return ghNotes(chiff, chaff, chiff, chaff, chaff, chiff, chaff, chiff)
			}()),
			// A soft, upslurred "hweet".
			ghCall("call", "high", "whistle", 0.3, 1, 3, 1.5, ghNotes(
				ghTone("whistle", 0.17, 0, 3500, 4900, 0.8),
			)),
		},
		Traits: core.Traits{
			Size: "tiny", Shape: "warbler", Primary: "green", Secondary: "buff",
			Marking: "faint pale eyebrow, dark legs", Bill: "thin", Flight: "darting",
		},
		Nest: ghNest("dome", []string{"ground", "shrub"}, 0, 1, ghNestSpringSummer, 0.1,
			"A small domed nest of leaves and grass with a side entrance, on or just above the ground in brambles or tall vegetation."),
		Facts: []string{
			"The chiffchaff is named after its song, in English and in many other languages.",
			"It is often the first summer visitor back, singing in bare woods in March.",
			"Its nest is a little dome with a side entrance, hidden close to the ground.",
			"Weighing about eight grams, a chiffchaff flies to the Mediterranean or West Africa and back each year.",
			"Chiffchaffs and willow warblers look almost identical; even experts often tell them apart by song.",
			"Chiffchaffs dip their tails constantly as they feed, a useful clue to their identity.",
			"More and more chiffchaffs now spend the winter in Britain, often near water.",
		},
		Difficulty: 3,
		Similar:    []string{"eurasian_blackcap", "goldcrest", "eurasian_reed_warbler"},
		Relations: []string{
			"One of the first summer visitors back, in time for the flies that gather at willow catkins.",
			"Feeds and sings in the canopy but hides its domed nest near the ground, in bramble and long grass.",
			"Leaves in autumn for the Mediterranean and West Africa.",
		},
	}
}

func ghGreyWagtail() core.Species {
	return core.Species{
		ID:     "grey_wagtail",
		Name:   "Grey Wagtail",
		Sci:    "Motacilla cinerea",
		Family: "Wagtails & Pipits",
		Desc: "A slender bird of fast streams, slate-grey above with lemon-yellow underparts and a very long black-and-white tail that never stops wagging. " +
			"It runs over wet stones and along the water's edge, and flutters up to snatch insects from the air.",
		IDTips: "Despite the name, the yellow is what you notice, brightest under the tail. " +
			"Look for the long tail pumping up and down on a rock in mid-stream; in spring the male has a black throat. " +
			"It flies in deep bounds with a sharp, metallic tzi-tzit that cuts through the sound of the water.",
		Fact: "The grey wagtail has the longest tail of any European wagtail. " +
			"Its call is pitched well above the rush of the stream, so a pair can keep in contact beside a waterfall. " +
			"Why wagtails wag is still debated: it may tell a watching predator that it has been seen.",
		Rarity:  core.Common,
		Regions: ghWoodsAndMarsh(),
		Habitats: []core.HabitatWeight{
			ghHab("river", 0.9), ghHab("marsh", 0.1),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.185, Wingspan: 0.26, Plump: 0.85, Neck: 0.1, Legs: 0.5,
			Tail: 1.2, TailShape: "square", Bill: 0.5, BillShape: "thin", WingShape: "pointed",
			Colors: ghPalette("#7a8794", "#f1dc45", "#76838f", "#1f2022", "#1c1c1e", "#1a1a1c", "#b48a78", "#0c0c0c"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#f2f2ee"), // white eyebrow
				ghMark("rump", "#d9d84a"),      // yellow-green rump
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "walk", Speed: 11, FlapHz: 11},
		Behavior: core.Behavior{
			Perches:   []string{"shore", "rock", "ground", "structure"},
			Feeding:   "ground", // picks insects from wet stones and the water's edge
			Activity:  [6]float32{0.7, 1, 0.7, 0.8, 0.6, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 160, Shyness: 20, Vocal: 3, Density: 0.3,
			Camo: 0.35, Skulking: 0.05, Habituate: 0.35,
			Specials: []string{"bathing", "nesting"},
		},
		Calls: []core.Call{
			// A sharp, metallic "tzi-tzit", usually as it takes off.
			ghCall("call", "very high", "single", 0.35, 1, 3, 0.8, ghNotes(
				ghTone("whistle", 0.045, 0.05, 7500, 6700, 1),
				ghTone("whistle", 0.045, 0.1, 7400, 6600, 0.9),
			)),
			// The seldom-heard song: a few sharp notes and a short trill.
			ghCall("song", "very high", "trill", 0.3, 1, 3, 2, ghJoin(
				ghTimes(4, ghTone("whistle", 0.06, 0.07, 7100, 6500, 0.8)),
				ghNotes(ghVib("trill", 0.32, 0, 6700, 6300, 28, 0.8, 0.8)),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "wagtail", Primary: "grey", Secondary: "yellow",
			Marking: "lemon-yellow under a very long tail", Bill: "thin", Flight: "undulating",
		},
		Nest: ghNest("ledge", []string{"bank", "rock", "structure", "shore"}, 0, 3, ghNestSpringSummer, 0.12,
			"A cup of moss and roots lined with hair, on a ledge or in a crevice of a stream bank, a wall or a bridge, close above running water."),
		Facts: []string{
			"Despite its name, the grey wagtail's most striking colour is the lemon yellow under its tail.",
			"It has the longest tail of any wagtail in Europe.",
			"Its sharp, metallic call cuts through the rush of a fast stream.",
			"Grey wagtails often nest under bridges or in old walls right beside the water.",
			"In the breeding season the male grows a black throat.",
			"It feeds on mayflies, stoneflies and midges that hatch from fast, clean streams.",
		},
		Difficulty: 2,
		Similar:    []string{"northern_wheatear"},
		Relations: []string{
			"Depends on clean, fast water rich in mayflies, stoneflies and midges.",
			"Shares the creek with the kingfisher: the wagtail takes the insects above the water, the kingfisher the fish below.",
			"Nests in a crevice close to the water, among tree roots or under a bridge.",
		},
	}
}

func ghKingfisher() core.Species {
	return core.Species{
		ID:     "common_kingfisher",
		Name:   "Common Kingfisher",
		Sci:    "Alcedo atthis",
		Family: "Kingfishers",
		Desc: "A small, dumpy bird with a long dagger of a bill, brilliant blue-green above and orange below. " +
			"It sits motionless on a branch over quiet water, then plunges head first for a small fish. " +
			"Most sightings are of a blue spark flying low and straight along the creek.",
		IDTips: "Nothing else here is blue and orange. " +
			"Listen for the call, a sharp, very high whistle, usually given in flight just before the bird comes past. " +
			"To see one perched, sit quietly near branches that overhang a pool; in shade it is surprisingly hard to pick out. " +
			"It is easily disturbed, so let it come to you.",
		Fact: "The orange of a kingfisher is pigment, but the blue is not: it comes from the microscopic structure of the feathers scattering light, which is why the bird can look turquoise, cobalt or almost green as it turns. " +
			"When it dives, a transparent third eyelid closes over each eye.",
		Rarity:  core.Uncommon,
		Regions: ghWoodsAndMarsh(),
		Habitats: []core.HabitatWeight{
			ghHab("river", 0.8), ghHab("marsh", 0.2),
		},
		Seasons: ghResident,
		Look: core.Appearance{
			Length: 0.165, Wingspan: 0.25, Plump: 1.2, Neck: 0, Legs: 0.1,
			Tail: 0.25, TailShape: "square", Bill: 1.6, BillShape: "dagger", WingShape: "rounded",
			Colors: ghPalette("#1c8fb8", "#e2702a", "#17708f", "#1a6f86", "#1765a8", "#161616", "#e8452a", "#0d0b0a"),
			Marks: []core.Mark{
				ghMark("rump", "#4fd0f5"),   // the electric stripe from back to tail
				ghMark("cheek", "#e2702a"),  // orange ear patch
				ghMark("throat", "#f5f1e8"), // white chin
				ghMark("nape", "#f5f1e8"),   // white patch on the side of the neck
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "none", Speed: 12, FlapHz: 13},
		Behavior: core.Behavior{
			Perches:   []string{"snag", "branch", "reed", "rock", "structure"},
			Feeding:   "plunge",
			Activity:  [6]float32{0.8, 1, 0.6, 0.7, 0.7, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 250, Shyness: 40, Vocal: 1.5, Density: 0.1,
			Camo: 0.4, Skulking: 0.2, Habituate: 0.2,
			Specials: []string{"hovering", "diving", "bathing"},
		},
		Calls: []core.Call{
			// A sharp, piercing whistle, "tseee-ti", given in flight low over the water.
			ghCall("call", "very high", "whistle", 0.45, 1, 3, 1, ghNotes(
				ghTone("whistle", 0.22, 0.07, 7300, 6900, 1),
				ghTone("whistle", 0.1, 0, 6700, 7000, 0.8),
			)),
			// A harsh "shrit-it-it" when a rival enters its stretch of water.
			ghCall("alarm", "very high", "harsh", 0.45, 1, 2, 0.8, ghTimes(3,
				ghVib("buzz", 0.08, 0.05, 6900, 6500, 60, 0.05, 0.9),
			)),
		},
		Traits: core.Traits{
			Size: "small", Shape: "kingfisher", Primary: "blue", Secondary: "orange",
			Marking: "electric-blue stripe down the back", Bill: "dagger", Flight: "direct",
		},
		Nest: ghNest("burrow", []string{"bank"}, 0.5, 3, ghNestSpringSummer, 0.12,
			"A tunnel up to a metre long dug into a steep earth bank above water, ending in a chamber littered with fish bones."),
		Facts: []string{
			"A kingfisher's blue is not pigment: microscopic structures in the feathers scatter blue light.",
			"Kingfishers dig nest tunnels up to a metre long into steep earth banks.",
			"The nest chamber has no lining and soon fills with fish bones and droppings.",
			"The nose of Japan's bullet train was reshaped after the kingfisher's bill, to make it quieter.",
			"A kingfisher beats its catch against a branch, then swallows it head first.",
			"In Greek legend the halcyon days were calm days when the kingfisher nested on the sea.",
			"Hard winters that freeze the water can kill a large share of kingfishers.",
		},
		Difficulty: 4,
		Similar:    []string{},
		Relations: []string{
			"Needs clear, slow water with small fish and a perch overhanging it to dive from.",
			"Tunnels as much as a metre into a steep earth bank to nest.",
			"A hard winter that freezes the pools can halve its numbers.",
		},
	}
}

func ghGoldenOriole() core.Species {
	return core.Species{
		ID:     "golden_oriole",
		Name:   "Golden Oriole",
		Sci:    "Oriolus oriolus",
		Family: "Orioles",
		Desc: "A thrush-sized bird of the high canopy. The male is brilliant golden yellow with black wings and tail; the female is greenish. " +
			"A scarce summer visitor, it stays hidden in the crowns of the tallest trees, and its presence is given away only by a rich, fluting whistle.",
		IDTips: "Listen on late spring and summer mornings for a short, mellow, yodelling whistle, weela-weeoo, that carries a long way; a blackbird's song is longer and rambling. " +
			"Seeing the singer takes patience, as the yellow vanishes among sunlit leaves. " +
			"Watch for a fast, thrush-like flight between treetops that ends in an upward sweep into cover.",
		Fact: "The oriole's whistle has given the bird its name in several languages, among them wielewaal in Dutch and Pirol in German. " +
			"It weaves a hammock of grass and bark strips, slung in a thin fork near the top of a tall tree, and spends the winter south of the Sahara.",
		Rarity:  core.Rare,
		Regions: ghWoodsOnly(),
		Habitats: []core.HabitatWeight{
			ghHab("woodland", 0.85), ghHab("river", 0.15), // tall, old broadleaf wood, especially near water
		},
		Seasons: ghSummerVisitor,
		Look: core.Appearance{
			Length: 0.24, Wingspan: 0.46, Plump: 1, Neck: 0.1, Legs: 0.35,
			Tail: 0.65, TailShape: "square", Bill: 0.7, BillShape: "cone", WingShape: "pointed",
			Colors: ghPalette("#f2c81a", "#f5cf20", "#f2c81a", "#141414", "#161616", "#c0504a", "#5a6068", "#8a1c1c"),
			Marks: []core.Mark{
				ghMark("eyestripe", "#141414"), // black line from bill to eye
				ghMark("wingpatch", "#f2c81a"), // small yellow patch on the black wing
				ghMark("tailtip", "#f2c81a"),   // yellow tail corners
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "hop", Speed: 12, FlapHz: 6.5},
		Behavior: core.Behavior{
			Perches: []string{"canopy", "branch"},
			Feeding: "glean",
			// A bird of the first hours of the day: it whistles from dawn into the
			// morning and falls almost silent once the wood warms up.
			Activity:  [6]float32{1, 0.8, 0.2, 0.3, 0.5, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 200, Shyness: 35, Vocal: 2.5, Density: 0.03,
			Camo: 0.5, Skulking: 0.85, Habituate: 0.1,
			Specials: []string{"nesting", "bathing"}, // bathes by dropping onto the water in flight
		},
		Calls: []core.Call{
			// A short, rich, yodelling flute: "weela-weeoo".
			ghCall("song", "medium", "whistle", 0.75, 1, 3, 3.5, ghNotes(
				ghTone("whistle", 0.14, 0.02, 1500, 2100, 0.9),
				ghTone("whistle", 0.10, 0.04, 2100, 1700, 0.9),
				ghTone("whistle", 0.20, 0.02, 1800, 2500, 1),
				ghTone("whistle", 0.32, 0, 2500, 1400, 1),
			)),
			// A nasal, cat-like squall, startling from so handsome a bird.
			ghCall("call", "medium", "harsh", 0.5, 1, 2, 2, ghNotes(
				ghVib("buzz", 0.4, 0, 2200, 3000, 40, 0.1, 0.8),
			)),
		},
		Traits: core.Traits{
			Size: "medium", Shape: "thrush", Primary: "yellow", Secondary: "black",
			Marking: "golden body with black wings", Bill: "stout", Flight: "undulating",
		},
		Nest: ghNest("cup_fork", []string{"fork", "branch", "canopy"}, 4, 15, ghNestSpringSummer, 0.12,
			"A hammock of grass and bark strips woven between the arms of a thin horizontal fork, high in a tall tree."),
		Facts: []string{
			"The oriole's nest is a hammock woven from grass and bark, slung between the arms of a thin fork.",
			"Despite his brilliant yellow, a male oriole is remarkably hard to spot among sunlit leaves.",
			"Golden orioles spend the winter in Africa, south of the Sahara.",
			"Orioles eat large caterpillars, including hairy ones that most birds avoid.",
			"Females and young orioles are greenish, a camouflage that suits the leafy canopy.",
			"It is one of the last summer visitors to arrive, often not until May.",
		},
		Difficulty: 5,
		Similar:    []string{"common_blackbird"},
		Relations: []string{
			"Feeds high in the crowns on large caterpillars, including hairy ones that most birds leave alone.",
			"Slings its hammock nest in a thin fork near the top of a tall tree, out of reach of climbing predators.",
			"Among the last summer visitors to arrive and the first to leave for Africa.",
		},
	}
}
