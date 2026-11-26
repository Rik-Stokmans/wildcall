package species

import "github.com/Rik-Stokmans/wildcall/internal/core"

// The regional roster: the 20 species of the five outer region types. Every helper in
// this file is prefixed "rg" because greenhollow.go shares the package.
//
// Conventions used throughout (they keep the species comparable with one another):
//
//   - Appearance is the plumage a player is most likely to meet and remember: the
//     drake mallard, the cream-headed female marsh harrier, the winter-white
//     ptarmigan (Frostveil is always under snow), the winter brambling.
//   - Traits.Size follows body length: tiny < 0.11 m, small < 0.20, medium < 0.45,
//     large < 0.80, huge above that.
//   - Behavior.Shyness is the flush distance in metres for a walking, visible player:
//     under 12 tame, 15-30 ordinary, 40-60 wary, above 80 only for birds that must be
//     watched from afar (eagle, snowy owl).
//   - Behavior.Density: 1 is a typical common songbird; rare species sit at or below
//     0.1 so that finding one is an event, never a certainty.
//   - Call.Pitch names the band the player hears, not the fundamental alone: roughly
//     low < 1 kHz, medium 1-3 kHz, high 3-6 kHz, very high above. Rough "buzz" voices
//     read a little higher than their fundamental.
//   - Within one region type no two species share the (Pitch, Pattern) pair of their
//     primary call, so the audio clues alone already narrow a mystery down.
//   - Sociality sets the group size: solitary 1-1, pair 1-2, flock as authored.

// regionalSpecies returns the rosters of every region type other than Greenhollow
// Woods, in the pinned order: Murmur Marsh, Windpeak Highlands, Whispering Coast,
// Amberwood, Frostveil. Each call builds fresh data, so callers may modify the result.
func regionalSpecies() []core.Species {
	return []core.Species{
		// Murmur Marsh
		rgMallard(),
		rgCommonMoorhen(),
		rgGreyHeron(),
		rgReedWarbler(),
		rgBittern(),
		rgMarshHarrier(),
		// Windpeak Highlands
		rgWheatear(),
		rgRaven(),
		rgRingOuzel(),
		rgGoldenEagle(),
		// Whispering Coast
		rgHerringGull(),
		rgOystercatcher(),
		rgCormorant(),
		rgPuffin(),
		// Amberwood
		rgRedwing(),
		rgBrambling(),
		rgHawfinch(),
		// Frostveil
		rgSnowBunting(),
		rgPtarmigan(),
		rgSnowyOwl(),
	}
}

// ---------------------------------------------------------------------------
// Authoring helpers

// Presence by season: spring, summer, autumn, winter.
var (
	rgResident      = [4]bool{true, true, true, true}
	rgSummerVisitor = [4]bool{true, true, false, false}
	rgWinterVisitor = [4]bool{false, false, true, true}
	rgWinterOnly    = [4]bool{false, false, false, true}
)

func rgHab(key string, weight float32) core.HabitatWeight {
	return core.HabitatWeight{Habitat: key, Weight: weight}
}

func rgMark(kind, color string) core.Mark { return core.Mark{Kind: kind, Color: color} }

// rgNote is one plain synthesized note: wave, duration and trailing silence in
// seconds, a frequency glide f0 -> f1 in Hz, and relative loudness.
func rgNote(wave string, dur, gap, f0, f1, amp float32) core.Note {
	return core.Note{Wave: wave, Dur: dur, Gap: gap, F0: f0, F1: f1, Amp: amp}
}

// rgWob is rgNote with modulation: for the "trill" wave rate/depth pulse the
// loudness (a rattle or churr); for every other wave they wobble the frequency, which
// at 25-50 Hz turns a buzz into a croak or growl.
func rgWob(wave string, dur, gap, f0, f1, amp, rate, depth float32) core.Note {
	return core.Note{Wave: wave, Dur: dur, Gap: gap, F0: f0, F1: f1, Amp: amp, Rate: rate, Depth: depth}
}

// rgTimes repeats a group of notes n times.
func rgTimes(n int, notes ...core.Note) []core.Note {
	out := make([]core.Note, 0, n*len(notes))
	for i := 0; i < n; i++ {
		out = append(out, notes...)
	}
	return out
}

// rgRun is a series of n notes whose every number slides evenly from the first note
// to the last: an accelerating piping, a quack series that fades and drops, a
// laughing call that tumbles downhill.
func rgRun(n int, from, to core.Note) []core.Note {
	out := make([]core.Note, n)
	for i := range out {
		var t float32
		if n > 1 {
			t = float32(i) / float32(n-1)
		}
		mix := func(a, b float32) float32 { return a + (b-a)*t }
		out[i] = core.Note{
			Wave:  from.Wave,
			Dur:   mix(from.Dur, to.Dur),
			Gap:   mix(from.Gap, to.Gap),
			F0:    mix(from.F0, to.F0),
			F1:    mix(from.F1, to.F1),
			Amp:   mix(from.Amp, to.Amp),
			Rate:  mix(from.Rate, to.Rate),
			Depth: mix(from.Depth, to.Depth),
		}
	}
	return out
}

// rgPhrase joins groups of notes into one phrase.
func rgPhrase(parts ...[]core.Note) []core.Note {
	var out []core.Note
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// ---------------------------------------------------------------------------
// Murmur Marsh

func rgMallard() core.Species {
	return core.Species{
		ID:     "mallard",
		Name:   "Mallard",
		Sci:    "Anas platyrhynchos",
		Family: "Ducks, Geese & Swans",
		Desc: "The familiar dabbling duck of every pond and backwater. The drake has a bottle-green head, a narrow white " +
			"neck ring and a chestnut breast; the female is mottled brown with the same blue wing patch.",
		IDTips: "A large duck that floats high and tips tail-up to feed. Look for the drake's glossy green head and yellow " +
			"bill, and in both sexes the blue wing patch edged with white. The quack is a loud, coarse series that drops in " +
			"pitch and fades away.",
		Fact: "Only the female gives the famous ringing quack; the drake manages just a soft, rasping note. Nearly every " +
			"breed of farmyard duck is descended from the mallard.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionMurmurMarsh, core.RegionGreenhollow},
		Habitats: []core.HabitatWeight{rgHab("marsh", 0.5), rgHab("river", 0.5)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.56, Wingspan: 0.90, Plump: 1.25, Neck: 0.45, Legs: 0.15,
			Tail: 0.35, TailShape: "square", Bill: 1.0, BillShape: "flat", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#8a8378", Belly: "#c9c7c0", Head: "#1f5e3f", Wing: "#7d7770",
				Tail: "#2a2a2c", Bill: "#d9b53a", Legs: "#e2772a", Eye: "#2a1c12",
			},
			Marks: []core.Mark{
				rgMark("collar", "#f4f2ea"),
				rgMark("breast", "#6e3b2a"),
				rgMark("wingpatch", "#2f4fa8"),
				rgMark("rump", "#1c1c1e"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "swim", Speed: 18, FlapHz: 6},
		Behavior: core.Behavior{
			Perches:   []string{"water", "shore", "ground"},
			Feeding:   "dabble",
			Activity:  [6]float32{0.8, 0.9, 0.6, 0.8, 0.9, 0.3},
			Sociality: "flock", FlockMin: 2, FlockMax: 8,
			Territory: 90, Shyness: 9, Vocal: 2.5, Density: 1.2,
			Camo: 0.15, Skulking: 0.1, Habituate: 0.95,
			Specials: []string{"bathing", "social"},
		},
		Calls: []core.Call{
			{
				// The female's decrescendo: QUACK-quack-quack-quack, each note shorter,
				// lower and quieter than the last.
				Kind: "call",
				Notes: rgRun(6,
					rgNote("buzz", 0.24, 0.07, 820, 640, 1.0),
					rgNote("buzz", 0.13, 0.10, 640, 500, 0.4)),
				Repeat: [2]int{1, 2}, Gap: 2.5, Loud: 0.6, Pitch: "medium", Pattern: "harsh",
			},
			{
				// The drake's quiet, rasping "rhaeb".
				Kind:   "call",
				Notes:  []core.Note{rgWob("buzz", 0.32, 0.4, 420, 360, 0.6, 30, 0.12)},
				Repeat: [2]int{2, 4}, Gap: 0.5, Loud: 0.3, Pitch: "low", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "duck", Primary: "grey", Secondary: "green",
			Marking: "glossy green head with a white neck ring", Bill: "flat", Flight: "direct",
		},
		Difficulty: 1,
		Similar:    []string{"common_moorhen"},
		Relations: []string{
			"Ducklings are taken by grey herons and marsh harriers, so broods stay close to reed cover.",
			"Its dabbling stirs up seeds and insects that moorhens pick over afterwards.",
		},
	}
}

func rgCommonMoorhen() core.Species {
	return core.Species{
		ID:     "common_moorhen",
		Name:   "Common Moorhen",
		Sci:    "Gallinula chloropus",
		Family: "Rails & Crakes",
		Desc: "A dark, nervous waterbird of reedy margins, somewhere between a duck and a chicken. It swims with a jerky, " +
			"nodding head and flicks its tail to flash white as it slips back into cover.",
		IDTips: "Slate-black and olive-brown with a red bill shield tipped yellow, a broken white line along the flank and " +
			"white under the cocked tail. Smaller and slimmer than any duck, with long green legs. Its call is a sudden, " +
			"bubbling 'kurr-uk' from the reeds.",
		Fact: "Moorhens have no webbing on their long green toes, yet they swim well and can even walk across lily pads. " +
			"Young from the first brood often stay to help feed their parents' next chicks.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionMurmurMarsh, core.RegionGreenhollow},
		Habitats: []core.HabitatWeight{rgHab("marsh", 0.6), rgHab("river", 0.4)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.33, Wingspan: 0.52, Plump: 1.1, Neck: 0.3, Legs: 0.55,
			Tail: 0.45, TailShape: "cocked", Bill: 0.7, BillShape: "cone", WingShape: "rounded",
			Colors: core.Palette{
				Back: "#3d3a2e", Belly: "#34383f", Head: "#26282d", Wing: "#40392c",
				Tail: "#23211f", Bill: "#d8322a", Legs: "#a9b83a", Eye: "#7a1c14",
			},
			Marks: []core.Mark{
				rgMark("wingbar", "#f2f0e6"), // the white line along the flank
				rgMark("tailtip", "#f5f5f0"), // white undertail, flashed with every flick
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "swim", Speed: 10, FlapHz: 7},
		Behavior: core.Behavior{
			Perches:   []string{"reed", "water", "shore", "ground"},
			Feeding:   "ground",
			Activity:  [6]float32{0.9, 0.8, 0.5, 0.7, 0.9, 0.3},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 45, Shyness: 14, Vocal: 2, Density: 0.9,
			Camo: 0.3, Skulking: 0.65, Habituate: 0.7,
			Specials: []string{"bathing", "social", "nesting"},
		},
		Calls: []core.Call{
			{
				// An explosive, bubbling "kurr-UK!" out of nowhere.
				Kind: "call",
				Notes: []core.Note{
					rgWob("trill", 0.26, 0.02, 850, 1500, 0.9, 34, 0.6),
					rgNote("buzz", 0.11, 0.35, 1650, 1250, 1.0),
				},
				Repeat: [2]int{1, 2}, Gap: 4, Loud: 0.55, Pitch: "medium", Pattern: "single",
			},
			{
				// Sharp "kittick" of alarm as it scuttles for the reeds.
				Kind:   "alarm",
				Notes:  rgTimes(2, rgNote("buzz", 0.06, 0.06, 3100, 2700, 0.9)),
				Repeat: [2]int{1, 3}, Gap: 0.6, Loud: 0.45, Pitch: "high", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "rail", Primary: "black", Secondary: "brown",
			Marking: "red bill shield and a white line along the flank", Bill: "short", Flight: "direct",
		},
		Difficulty: 2,
		Similar:    []string{"mallard"},
		Relations: []string{
			"Shares quiet pools with mallards but keeps closer to the reeds, where it hides from marsh harriers.",
			"Eats seeds, snails and water plants, and helps keep the pond margins open.",
		},
	}
}

func rgGreyHeron() core.Species {
	return core.Species{
		ID:     "grey_heron",
		Name:   "Grey Heron",
		Sci:    "Ardea cinerea",
		Family: "Herons & Bitterns",
		Desc: "A tall, grey sentinel of the shallows. It stands motionless for minutes at the water's edge, then strikes " +
			"with a dagger bill; in the air it rows along on slow, bowed wings with its neck tucked back.",
		IDTips: "Unmistakably huge, long-legged and long-necked. Grey above and whitish below, with a white head, a black " +
			"plume trailing behind the eye and a heavy yellow bill. It flies with deep, slow beats and its neck folded " +
			"into an S. The call is a single harsh, barking 'fraank'.",
		Fact: "One elongated bone in a heron's neck works like a hinge, letting the neck fold into an S and then uncoil in " +
			"a lightning strike. Herons nest together in treetop heronries that may be used for generations.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionMurmurMarsh, core.RegionGreenhollow, core.RegionWhisperingCoast},
		Habitats: []core.HabitatWeight{rgHab("marsh", 0.45), rgHab("river", 0.35), rgHab("beach", 0.2)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.94, Wingspan: 1.85, Plump: 0.8, Neck: 1.0, Legs: 1.0,
			Tail: 0.25, TailShape: "square", Bill: 2.4, BillShape: "dagger", WingShape: "broad",
			Colors: core.Palette{
				Back: "#8f98a3", Belly: "#e9e9e4", Head: "#f3f3ee", Wing: "#7c8691",
				Tail: "#6f7780", Bill: "#e0b23c", Legs: "#8a7a4a", Eye: "#e8c93a",
			},
			Marks: []core.Mark{
				rgMark("eyestripe", "#1d1f24"), // black plume from the eye to the nape
				rgMark("streaks", "#2a2c30"),   // dashes down the front of the neck
				rgMark("wingpatch", "#2b2e34"), // black shoulder and flight feathers
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "wade", Speed: 12, FlapHz: 2.2},
		Behavior: core.Behavior{
			Perches:   []string{"shore", "snag", "branch", "ground"},
			Feeding:   "hunt",
			Activity:  [6]float32{1.0, 0.7, 0.4, 0.6, 1.0, 0.3},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 220, Shyness: 60, Vocal: 0.4, Density: 0.25,
			Camo: 0.35, Skulking: 0.15, Habituate: 0.2,
			Specials: []string{"preening", "nesting"},
		},
		Calls: []core.Call{
			{
				// One rough, barking "FRAANK", usually as it takes off.
				Kind:   "call",
				Notes:  []core.Note{rgWob("buzz", 0.5, 0.3, 560, 360, 1.0, 46, 0.35)},
				Repeat: [2]int{1, 2}, Gap: 3, Loud: 0.75, Pitch: "low", Pattern: "harsh",
			},
		},
		Traits: core.Traits{
			Size: "huge", Shape: "heron", Primary: "grey", Secondary: "white",
			Marking: "black plume behind the eye on a white head", Bill: "dagger", Flight: "direct",
		},
		Difficulty: 2,
		Similar:    []string{"eurasian_bittern", "great_cormorant"},
		Relations: []string{
			"The top fishing predator of the shallows: where herons gather, fish and frogs are plentiful.",
			"Follows creeks from the marsh into the woods and out to the coast, linking all three.",
		},
	}
}

func rgReedWarbler() core.Species {
	return core.Species{
		ID:     "eurasian_reed_warbler",
		Name:   "Eurasian Reed Warbler",
		Sci:    "Acrocephalus scirpaceus",
		Family: "Warblers",
		Desc: "A plain brown warbler that lives its whole summer inside the reedbed. You will hear its unhurried, " +
			"chattering song long before you glimpse it sidling up a stem.",
		IDTips: "Small, slim and unmarked: warm brown above, buff-white below, with a pale throat, a faintly rusty rump and " +
			"a long thin bill on a flat forehead. No eyebrow, no streaks, no wing bars. The song is the giveaway: a low, " +
			"grumbling chatter in which each scratchy note is repeated two or three times.",
		Fact: "Its nest is a deep cup woven around several reed stems, so the eggs stay put when the reeds thrash in the " +
			"wind. It is one of the cuckoo's favourite hosts, and often ends up feeding a chick several times its own size.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionMurmurMarsh},
		Habitats: []core.HabitatWeight{rgHab("marsh", 0.9), rgHab("river", 0.1)},
		Seasons:  rgSummerVisitor,
		Look: core.Appearance{
			Length: 0.13, Wingspan: 0.19, Plump: 0.9, Neck: 0.1, Legs: 0.35,
			Tail: 0.75, TailShape: "square", Bill: 0.7, BillShape: "thin", WingShape: "rounded",
			Colors: core.Palette{
				Back: "#8a6a45", Belly: "#ead9bd", Head: "#86663f", Wing: "#7b5c3a",
				Tail: "#7d5d3c", Bill: "#5a4a3a", Legs: "#6f6a66", Eye: "#2a1d14",
			},
			Marks: []core.Mark{
				rgMark("throat", "#f4eee0"),
				rgMark("rump", "#a0703f"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 8, FlapHz: 13},
		Behavior: core.Behavior{
			Perches:   []string{"reed", "shrub"},
			Feeding:   "glean",
			Activity:  [6]float32{1.0, 0.8, 0.45, 0.6, 0.9, 0.35},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 25, Shyness: 8, Vocal: 6, Density: 1.3,
			Camo: 0.5, Skulking: 0.9, Habituate: 0.5,
			Specials: []string{"nesting"},
		},
		Calls: []core.Call{
			{
				// "trek trek trek, chirruc chirruc, tirri tirri tirri, churr churr, tek tek":
				// a patient, metronomic chatter, every unit said two or three times.
				Kind: "song",
				Notes: rgPhrase(
					rgTimes(3, rgNote("buzz", 0.07, 0.06, 2600, 2400, 0.8)),
					rgTimes(2, rgWob("trill", 0.11, 0.05, 3400, 3000, 0.85, 40, 0.5)),
					rgTimes(3, rgNote("whistle", 0.06, 0.04, 4300, 4700, 0.7)),
					rgTimes(2, rgWob("trill", 0.14, 0.06, 2300, 2200, 0.9, 55, 0.6)),
					rgTimes(2, rgNote("buzz", 0.06, 0.08, 3000, 2800, 0.75)),
				),
				Repeat: [2]int{3, 8}, Gap: 0.2, Loud: 0.4, Pitch: "medium", Pattern: "chatter",
			},
			{
				// A scolding "tcharr" at anything creeping through its reeds.
				Kind:   "alarm",
				Notes:  []core.Note{rgWob("trill", 0.25, 0.2, 2400, 2100, 0.8, 60, 0.6)},
				Repeat: [2]int{1, 3}, Gap: 1, Loud: 0.3, Pitch: "medium", Pattern: "harsh",
			},
		},
		Traits: core.Traits{
			Size: "small", Shape: "warbler", Primary: "brown", Secondary: "buff",
			Marking: "plain unmarked face with a pale throat", Bill: "thin", Flight: "direct",
		},
		Difficulty: 3,
		Similar:    []string{"common_chiffchaff", "eurasian_blackcap", "eurasian_wren"},
		Relations: []string{
			"Depends entirely on standing reeds, and is a favourite host of the cuckoo.",
			"Its scolding churr often gives away a marsh harrier or bittern moving through the reedbed.",
		},
	}
}

func rgBittern() core.Species {
	return core.Species{
		ID:     "eurasian_bittern",
		Name:   "Eurasian Bittern",
		Sci:    "Botaurus stellaris",
		Family: "Herons & Bitterns",
		Desc: "A stocky, secretive heron cloaked in golden buff and black streaks, almost never seen outside the reeds. At " +
			"dawn, at dusk and through the night the male's deep boom rolls across the marsh like someone blowing over " +
			"the neck of a huge bottle.",
		IDTips: "Smaller and far thicker-necked than a grey heron, and tawny rather than grey: golden buff all over, barred " +
			"and streaked with black, with a black crown and moustache and green legs. When alarmed it freezes with its " +
			"bill pointing skyward and sways with the reeds. Usually it is only a voice: a slow series of very deep, " +
			"far-carrying booms.",
		Fact: "The bittern's boom is one of the lowest and farthest-carrying of all bird sounds, audible for several " +
			"kilometres on a still night. Each male's boom is slightly different, so researchers count bitterns by ear " +
			"without ever seeing them.",
		Rarity:   core.Rare,
		Regions:  []core.RegionID{core.RegionMurmurMarsh},
		Habitats: []core.HabitatWeight{rgHab("marsh", 1.0)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.75, Wingspan: 1.30, Plump: 1.15, Neck: 0.7, Legs: 0.6,
			Tail: 0.2, TailShape: "square", Bill: 1.6, BillShape: "dagger", WingShape: "broad",
			Colors: core.Palette{
				Back: "#b08a4a", Belly: "#d6b877", Head: "#c49a55", Wing: "#a57f43",
				Tail: "#9c783f", Bill: "#b8a44a", Legs: "#9aa24a", Eye: "#d8a23a",
			},
			Marks: []core.Mark{
				rgMark("cap", "#2a2018"),
				rgMark("cheek", "#33261a"), // the dark moustache
				rgMark("streaks", "#3a2a1a"),
				rgMark("bars", "#3d2c1c"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "wade", Speed: 11, FlapHz: 2.8},
		Behavior: core.Behavior{
			Perches:   []string{"reed", "shore"},
			Feeding:   "hunt",
			Activity:  [6]float32{1.0, 0.3, 0.1, 0.2, 0.9, 0.8},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 180, Shyness: 45, Vocal: 1.2, Density: 0.06,
			Camo: 0.95, Skulking: 0.97, Habituate: 0.1,
			// "hiding" is the famous sky-pointing freeze among the reed stems.
			Specials: []string{"hiding", "preening"},
		},
		Calls: []core.Call{
			{
				// Two quiet gulps of air, then three booms: each a short indrawn "uh"
				// and a deep, foghorn "WHOOMP" a couple of seconds apart.
				Kind: "boom",
				Notes: rgPhrase(
					rgTimes(2, rgNote("sine", 0.07, 0.22, 210, 190, 0.18)),
					rgTimes(3,
						rgNote("sine", 0.12, 0.08, 200, 175, 0.3),
						rgNote("sine", 0.55, 1.15, 178, 148, 1.0)),
				),
				Repeat: [2]int{1, 2}, Gap: 9, Loud: 1.0, Pitch: "low", Pattern: "booming",
			},
			{
				// A hoarse, gull-like "kau" from a bird flying over the reeds at dusk.
				Kind:   "call",
				Notes:  []core.Note{rgWob("buzz", 0.26, 0.4, 720, 520, 0.9, 30, 0.15)},
				Repeat: [2]int{1, 3}, Gap: 2, Loud: 0.5, Pitch: "low", Pattern: "single",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "heron", Primary: "buff", Secondary: "brown",
			Marking: "golden buff streaked like dead reeds, black crown", Bill: "dagger", Flight: "direct",
		},
		Difficulty: 5,
		Similar:    []string{"grey_heron"},
		Relations: []string{
			"Needs large, wet, undisturbed reedbeds full of eels and frogs; its presence marks a healthy marsh.",
			"Reed warblers scold it when it creeps past their nests.",
		},
	}
}

func rgMarshHarrier() core.Species {
	return core.Species{
		ID:     "western_marsh_harrier",
		Name:   "Western Marsh Harrier",
		Sci:    "Circus aeruginosus",
		Family: "Hawks & Eagles",
		Desc: "A long-winged hawk that drifts low over the reedbeds, wings raised in a shallow V, tilting from side to side " +
			"as it searches. Females are chocolate brown with a cream crown and throat; males add grey wing panels and " +
			"black wingtips.",
		IDTips: "Look for the hunting style first: a few slow flaps, then a long, wavering glide just above the reed tops " +
			"with the wings held up in a V. It is slimmer, longer-tailed and longer-winged than a buzzard, and the cream " +
			"head on a dark body stands out at long range. It is usually silent; the male's display call is a thin, " +
			"wailing 'kwee-oo'.",
		Fact: "In spring the male passes food to his mate in mid-air: she rises beneath him, flips onto her back and catches " +
			"the prey as he lets it fall. Unlike most hawks, marsh harriers nest on the ground, deep inside the reeds.",
		Rarity:   core.Uncommon,
		Regions:  []core.RegionID{core.RegionMurmurMarsh},
		Habitats: []core.HabitatWeight{rgHab("marsh", 0.8), rgHab("meadow", 0.2)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.52, Wingspan: 1.25, Plump: 0.85, Neck: 0.2, Legs: 0.5,
			Tail: 0.95, TailShape: "square", Bill: 0.6, BillShape: "hooked", WingShape: "long",
			Colors: core.Palette{
				Back: "#4f3626", Belly: "#5a3d2a", Head: "#e6d3a3", Wing: "#4a3324",
				Tail: "#5c4230", Bill: "#2b2b2e", Legs: "#e0c040", Eye: "#c9a23a",
			},
			Marks: []core.Mark{
				rgMark("cap", "#ecdcae"),
				rgMark("throat", "#ead8a8"),
				rgMark("eyestripe", "#3d2a1e"),
				rgMark("wingpatch", "#d9c594"), // cream leading edge of the wing
			},
		},
		Move: core.Movement{Flight: "flapglide", Ground: "walk", Speed: 9, FlapHz: 3},
		Behavior: core.Behavior{
			Perches:   []string{"snag", "ground", "shrub"},
			Feeding:   "hunt",
			Activity:  [6]float32{0.7, 1.0, 0.7, 0.9, 0.7, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 350, Shyness: 50, Vocal: 0.3, Density: 0.12,
			Camo: 0.3, Skulking: 0.1, Habituate: 0.2,
			// The sky-dance and mid-air food pass, the drop onto prey, the brief hover.
			Specials: []string{"social", "diving", "hovering"},
		},
		Calls: []core.Call{
			{
				// The displaying male's thin, lapwing-like wail: "kwee-oo".
				Kind: "call",
				Notes: []core.Note{
					rgNote("whistle", 0.28, 0.03, 1750, 2400, 0.8),
					rgNote("whistle", 0.30, 0.50, 2400, 1500, 0.9),
				},
				Repeat: [2]int{1, 3}, Gap: 2.5, Loud: 0.45, Pitch: "medium", Pattern: "whistle",
			},
			{
				// A chattering "kek-ek-ek-ek" near the nest.
				Kind:   "alarm",
				Notes:  rgTimes(6, rgNote("buzz", 0.06, 0.07, 2300, 2000, 0.9)),
				Repeat: [2]int{1, 2}, Gap: 1.5, Loud: 0.4, Pitch: "medium", Pattern: "chatter",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "raptor", Primary: "brown", Secondary: "buff",
			Marking: "cream crown and throat on a chocolate-brown body", Bill: "hooked", Flight: "flapglide",
		},
		Difficulty: 3,
		Similar:    []string{"common_buzzard", "golden_eagle"},
		Relations: []string{
			"Hunts moorhen chicks, ducklings, frogs and voles over the reedbed.",
			"Ducks and gulls rise in alarm as it passes, a wave of panic that betrays its route.",
		},
	}
}

// ---------------------------------------------------------------------------
// Windpeak Highlands

func rgWheatear() core.Species {
	return core.Species{
		ID:     "northern_wheatear",
		Name:   "Northern Wheatear",
		Sci:    "Oenanthe oenanthe",
		Family: "Thrushes & Chats",
		Desc: "A dapper, upright little bird of open stony ground. It dashes between boulders, stops to bob and flick its " +
			"tail, then flies off low to show a dazzling white rump.",
		IDTips: "The white rump and the black upside-down T on the tail are obvious the moment it flies. Perched, the male " +
			"is blue-grey above with a black mask and wings and a peach-buff breast. It stands tall on rocks and never " +
			"hides. The song is a brief, hurried, scratchy warble; the alarm is a whistle followed by hard 'chack' notes, " +
			"like two pebbles knocked together.",
		Fact: "The name has nothing to do with wheat or ears: it comes from old words meaning 'white rump'. Wheatears are " +
			"astonishing travellers, and every one of them, even those that nest in arctic Canada and Alaska, spends the " +
			"winter in Africa.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionWindpeak},
		Habitats: []core.HabitatWeight{rgHab("alpine", 0.7), rgHab("meadow", 0.2), rgHab("cliff", 0.1)},
		Seasons:  rgSummerVisitor,
		Look: core.Appearance{
			Length: 0.15, Wingspan: 0.28, Plump: 0.95, Neck: 0.15, Legs: 0.55,
			Tail: 0.6, TailShape: "square", Bill: 0.6, BillShape: "thin", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#8e99a6", Belly: "#f0e2c8", Head: "#8e99a6", Wing: "#2a2a2e",
				Tail: "#1f1f22", Bill: "#1c1c1e", Legs: "#1c1c1e", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("mask", "#1b1b1e"),
				rgMark("rump", "#fafaf6"),
				rgMark("breast", "#e9bd8a"),
				rgMark("tailtip", "#18181a"), // the bar of the black T
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 11, FlapHz: 10},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "ground", "snag"},
			Feeding:   "ground",
			Activity:  [6]float32{0.9, 1.0, 0.6, 0.8, 0.8, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 60, Shyness: 22, Vocal: 3, Density: 0.9,
			Camo: 0.2, Skulking: 0.05, Habituate: 0.5,
			// The brief fluttering song flight, and nesting deep in a rock crevice.
			Specials: []string{"hovering", "nesting", "social"},
		},
		Calls: []core.Call{
			{
				// A hurried jumble of sweet whistles and scratchy, creaking notes.
				Kind: "song",
				Notes: []core.Note{
					rgNote("whistle", 0.08, 0.03, 3200, 4200, 0.7),
					rgNote("buzz", 0.07, 0.03, 2600, 2200, 0.8),
					rgNote("whistle", 0.09, 0.02, 4500, 3300, 0.7),
					rgWob("trill", 0.12, 0.03, 3000, 3600, 0.75, 45, 0.5),
					rgNote("buzz", 0.06, 0.03, 2200, 2700, 0.8),
					rgNote("whistle", 0.10, 0.03, 3900, 4800, 0.65),
					rgNote("buzz", 0.08, 0.04, 2500, 2000, 0.8),
					rgNote("whistle", 0.07, 0.20, 4200, 3500, 0.6),
				},
				Repeat: [2]int{2, 5}, Gap: 2.5, Loud: 0.35, Pitch: "high", Pattern: "chatter",
			},
			{
				// "weet, chack-chack": a whistle and two knocked pebbles.
				Kind: "alarm",
				Notes: []core.Note{
					rgNote("whistle", 0.12, 0.08, 3400, 4300, 0.7),
					rgNote("click", 0.04, 0.10, 2200, 1800, 1.0),
					rgNote("click", 0.04, 0.30, 2200, 1800, 1.0),
				},
				Repeat: [2]int{1, 4}, Gap: 1.2, Loud: 0.35, Pitch: "high", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "small", Shape: "songbird", Primary: "grey", Secondary: "buff",
			Marking: "white rump and a black T on the tail", Bill: "thin", Flight: "direct",
		},
		Difficulty: 2,
		Similar:    []string{"grey_wagtail", "snow_bunting"},
		Relations: []string{
			"Nests in rock crevices and old burrows on grazed, stony ground.",
			"A raven or eagle overhead sends it diving for cover among the boulders.",
		},
	}
}

func rgRaven() core.Species {
	return core.Species{
		ID:     "common_raven",
		Name:   "Common Raven",
		Sci:    "Corvus corax",
		Family: "Crows & Jays",
		Desc: "The great black crow of crags and lonely country, as big as a buzzard. Pairs patrol the ridges together, " +
			"soaring on the wind and calling to each other with deep, hollow croaks.",
		IDTips: "All black and very large, with a massive bill, shaggy throat feathers and long, fingered wings. In flight " +
			"the tail is a clear wedge or diamond, not a fan. It soars and glides like a bird of prey, and often flips onto " +
			"its back for a moment in mid-air. The croak is far deeper than any other crow's: a resonant 'prruk, prruk'.",
		Fact: "Ravens are among the cleverest of all birds: they solve puzzles, plan ahead and remember faces. They also " +
			"play, sliding down snowbanks and tumbling through the air apparently just for the fun of it.",
		Rarity:  core.Common,
		Regions: []core.RegionID{core.RegionWindpeak, core.RegionFrostveil},
		Habitats: []core.HabitatWeight{
			rgHab("alpine", 0.4), rgHab("cliff", 0.3), rgHab("snow", 0.2), rgHab("conifer", 0.1),
		},
		Seasons: rgResident,
		Look: core.Appearance{
			Length: 0.64, Wingspan: 1.30, Plump: 1.0, Neck: 0.3, Legs: 0.4,
			Tail: 0.75, TailShape: "pointed", Bill: 1.3, BillShape: "cone", WingShape: "long",
			Colors: core.Palette{
				Back: "#17181d", Belly: "#1a1b20", Head: "#15161a", Wing: "#1b1d26",
				Tail: "#141518", Bill: "#121214", Legs: "#141416", Eye: "#2a2018",
			},
			Marks: []core.Mark{
				rgMark("throat", "#24262e"),    // shaggy hackles
				rgMark("wingpatch", "#262a3a"), // a faint purple-blue gloss
			},
		},
		Move: core.Movement{Flight: "soaring", Ground: "walk", Speed: 13, FlapHz: 3.5},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "snag", "ground", "branch"},
			Feeding:   "scavenge",
			Activity:  [6]float32{0.7, 1.0, 0.8, 0.9, 0.7, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 400, Shyness: 45, Vocal: 1.2, Density: 0.2,
			Camo: 0.05, Skulking: 0.05, Habituate: 0.35,
			// Aerial tumbling and half-rolls; pairs nest on crags while snow still lies.
			Specials: []string{"social", "nesting"},
		},
		Calls: []core.Call{
			{
				// "PRRUK, prruk, prruk": deep, hollow and rolling.
				Kind: "call",
				Notes: rgRun(3,
					rgWob("buzz", 0.30, 0.17, 440, 340, 1.0, 36, 0.3),
					rgWob("buzz", 0.28, 0.30, 410, 310, 0.85, 36, 0.3)),
				Repeat: [2]int{1, 3}, Gap: 3, Loud: 0.8, Pitch: "low", Pattern: "harsh",
			},
			{
				// A hollow, bell-like "tok", like a knock on a wooden box.
				Kind:   "call",
				Notes:  []core.Note{rgNote("sine", 0.09, 0.4, 1150, 820, 0.9)},
				Repeat: [2]int{1, 3}, Gap: 1.2, Loud: 0.45, Pitch: "medium", Pattern: "single",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "corvid", Primary: "black", Secondary: "black",
			Marking: "all black with a shaggy throat and wedge-shaped tail", Bill: "stout", Flight: "soaring",
		},
		Difficulty: 2,
		Similar:    []string{"common_buzzard", "golden_eagle", "great_cormorant"},
		Relations: []string{
			"A scavenger that cleans up carrion in the hills, and shadows golden eagles in the hope of leftovers.",
			"Its old stick nests on crags are later taken over by other cliff-nesting birds.",
		},
	}
}

func rgRingOuzel() core.Species {
	return core.Species{
		ID:     "ring_ouzel",
		Name:   "Ring Ouzel",
		Sci:    "Turdus torquatus",
		Family: "Thrushes & Chats",
		Desc: "The mountain blackbird: a shy, sooty thrush with a bright white crescent across its breast. It keeps to " +
			"rocky gullies and high scrub, and sings its simple, lonely piping from a boulder or crag.",
		IDTips: "Like a blackbird wearing a white bib. The wings look paler and silvery, especially in flight, and the body " +
			"feathers have fine pale edges that give a scaly look. It is far warier than a blackbird, flying off high and " +
			"far with hard 'tac-tac-tac' calls. The song is two to four clear fluting notes, a pause, then the same again.",
		Fact: "'Ouzel' is an old word for blackbird, and the scientific name torquatus means 'wearing a collar'. Where " +
			"blackbirds love gardens, the ouzel nests among heather, crags and old stone walls, often far above the last tree.",
		Rarity:   core.Uncommon,
		Regions:  []core.RegionID{core.RegionWindpeak},
		Habitats: []core.HabitatWeight{rgHab("alpine", 0.5), rgHab("cliff", 0.25), rgHab("shrub", 0.25)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.24, Wingspan: 0.40, Plump: 1.0, Neck: 0.2, Legs: 0.5,
			Tail: 0.8, TailShape: "square", Bill: 0.7, BillShape: "thin", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#26221f", Belly: "#2c2825", Head: "#221f1d", Wing: "#5a5650",
				Tail: "#1f1c1a", Bill: "#d9b23c", Legs: "#4a3f36", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("bib", "#f6f4ec"),       // the white crescent
				rgMark("wingpatch", "#8a8680"), // silvery panel on the closed wing
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 13, FlapHz: 8},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "shrub", "ground", "branch"},
			Feeding:   "ground",
			Activity:  [6]float32{1.0, 0.8, 0.5, 0.7, 0.9, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 110, Shyness: 40, Vocal: 2.5, Density: 0.3,
			Camo: 0.3, Skulking: 0.4, Habituate: 0.2,
			Specials: []string{"nesting", "bathing"},
		},
		Calls: []core.Call{
			{
				// "tri-uu, tri-uu, tri-uu" and a soft afterthought of a twitter.
				Kind: "song",
				Notes: rgPhrase(
					rgTimes(3,
						rgNote("whistle", 0.08, 0.02, 2750, 2950, 0.8),
						rgNote("whistle", 0.21, 0.20, 2550, 2350, 1.0)),
					[]core.Note{rgWob("trill", 0.22, 0.3, 3500, 4000, 0.35, 32, 0.6)},
				),
				Repeat: [2]int{2, 5}, Gap: 3, Loud: 0.65, Pitch: "medium", Pattern: "whistle",
			},
			{
				// Hard, stony "tac-tac-tac" as it flees up the gully.
				Kind:   "alarm",
				Notes:  rgTimes(3, rgNote("click", 0.04, 0.10, 1700, 1300, 1.0)),
				Repeat: [2]int{1, 3}, Gap: 0.8, Loud: 0.5, Pitch: "medium", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "thrush", Primary: "black", Secondary: "white",
			Marking: "white crescent across the breast", Bill: "thin", Flight: "direct",
		},
		Difficulty: 3,
		Similar:    []string{"common_blackbird"},
		Relations: []string{
			"Feeds on worms on short turf and gorges on rowan and juniper berries, spreading their seeds across the hills.",
			"Replaced by the blackbird wherever the hills give way to woodland.",
		},
	}
}

func rgGoldenEagle() core.Species {
	return core.Species{
		ID:     "golden_eagle",
		Name:   "Golden Eagle",
		Sci:    "Aquila chrysaetos",
		Family: "Hawks & Eagles",
		Desc: "The great eagle of the high mountains: dark brown, with a pale golden nape and enormous, long-fingered wings. " +
			"It soars for hours along ridges on barely a wingbeat, and can vanish over a skyline in seconds.",
		IDTips: "Far bigger than a buzzard, with a longer tail, a head and neck that project well forward, and long wings " +
			"pinched in at the body and held in a shallow V when soaring. The golden nape shows when the bird banks in " +
			"sunlight. It is almost always silent; the rare call is a surprisingly thin, yelping 'kyew'.",
		Fact: "A pair may hold a home range of more than a hundred square kilometres and keep several nests, adding sticks " +
			"year after year until an old eyrie is taller than a person. In a hunting stoop a golden eagle can exceed " +
			"240 km/h.",
		Rarity:   core.Rare,
		Regions:  []core.RegionID{core.RegionWindpeak},
		Habitats: []core.HabitatWeight{rgHab("alpine", 0.55), rgHab("cliff", 0.45)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.85, Wingspan: 2.10, Plump: 1.0, Neck: 0.3, Legs: 0.45,
			Tail: 0.8, TailShape: "fan", Bill: 0.9, BillShape: "hooked", WingShape: "broad",
			Colors: core.Palette{
				Back: "#4a3524", Belly: "#3f2d1f", Head: "#b98d4a", Wing: "#45311f",
				Tail: "#3a2a1c", Bill: "#3a3a3c", Legs: "#e2c33e", Eye: "#b8862e",
			},
			Marks: []core.Mark{
				rgMark("nape", "#d0a352"),
				rgMark("wingbar", "#7a6247"), // faded pale panel across the upperwing
				rgMark("tailtip", "#2a1e14"),
			},
		},
		Move: core.Movement{Flight: "soaring", Ground: "walk", Speed: 14, FlapHz: 2.2},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "snag"},
			Feeding:   "hunt",
			Activity:  [6]float32{0.3, 0.9, 1.0, 0.9, 0.4, 0},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 600, Shyness: 90, Vocal: 0.12, Density: 0.04,
			Camo: 0.2, Skulking: 0, Habituate: 0.05,
			// The undulating sky-dance over the home range, and the stoop.
			Specials: []string{"social", "diving"},
		},
		Calls: []core.Call{
			{
				// Thin, puppy-like yelps, absurdly small for so large a bird.
				Kind: "call",
				Notes: rgRun(4,
					rgNote("whistle", 0.17, 0.24, 2600, 1900, 0.9),
					rgNote("whistle", 0.15, 0.30, 2400, 1800, 0.7)),
				Repeat: [2]int{1, 2}, Gap: 5, Loud: 0.5, Pitch: "medium", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "huge", Shape: "raptor", Primary: "brown", Secondary: "buff",
			Marking: "golden nape and vast, long-fingered wings", Bill: "hooked", Flight: "soaring",
		},
		Difficulty: 5,
		Similar:    []string{"common_buzzard", "western_marsh_harrier", "common_raven"},
		Relations: []string{
			"The apex predator of the highlands, hunting hares and mountain gamebirds and taking carrion in winter.",
			"Ravens often mob it noisily, which is the best clue that an eagle is in the air.",
		},
	}
}

// ---------------------------------------------------------------------------
// Whispering Coast

func rgHerringGull() core.Species {
	return core.Species{
		ID:     "herring_gull",
		Name:   "Herring Gull",
		Sci:    "Larus argentatus",
		Family: "Gulls & Terns",
		Desc: "The big, bold, noisy gull of harbours, beaches and cliffs. Adults are white with a pale grey back, black " +
			"wingtips spotted with white, pink legs and a fierce pale eye.",
		IDTips: "A large gull with a pale silver-grey back, pink legs and a heavy yellow bill marked with a red spot. Young " +
			"birds are mottled brown and take four years to turn white and grey. The voice is the sound of the seaside: a " +
			"loud, laughing long-call that starts slowly, then tumbles out in a string of yelps with the head thrown back.",
		Fact: "The red spot on the bill is a target: a hungry chick pecks at it, and the parent responds by bringing up " +
			"food. Herring gulls also patter their feet on wet ground to imitate rain and bring worms to the surface.",
		Rarity:  core.Common,
		Regions: []core.RegionID{core.RegionWhisperingCoast, core.RegionMurmurMarsh},
		Habitats: []core.HabitatWeight{
			rgHab("beach", 0.35), rgHab("cliff", 0.25), rgHab("ocean", 0.2), rgHab("marsh", 0.2),
		},
		Seasons: rgResident,
		Look: core.Appearance{
			Length: 0.60, Wingspan: 1.40, Plump: 1.05, Neck: 0.3, Legs: 0.45,
			Tail: 0.45, TailShape: "square", Bill: 1.1, BillShape: "hooked", WingShape: "long",
			Colors: core.Palette{
				Back: "#b4bcc4", Belly: "#fafaf7", Head: "#fbfbf8", Wing: "#aab3bc",
				Tail: "#f8f8f4", Bill: "#e8c63a", Legs: "#e7a9a0", Eye: "#e8dc7a",
			},
			Marks: []core.Mark{
				rgMark("wingpatch", "#1c1d20"), // the black wingtips
			},
		},
		Move: core.Movement{Flight: "soaring", Ground: "walk", Speed: 13, FlapHz: 3},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "shore", "structure", "water", "ground"},
			Feeding:   "scavenge",
			Activity:  [6]float32{0.9, 1.0, 0.8, 0.9, 0.9, 0.1},
			Sociality: "flock", FlockMin: 3, FlockMax: 12,
			Territory: 350, Shyness: 14, Vocal: 3, Density: 1.1,
			Camo: 0.05, Skulking: 0, Habituate: 0.85,
			Specials: []string{"social", "bathing"},
		},
		Calls: []core.Call{
			{
				// The long-call: two slow, rising "aaow" notes, then head back and a
				// cascade of yelps, "kyee-kyee-kyee-kyau-kyau-kyau", running downhill.
				Kind: "call",
				Notes: rgPhrase(
					[]core.Note{
						rgNote("buzz", 0.36, 0.12, 700, 920, 0.7),
						rgNote("buzz", 0.32, 0.10, 760, 1020, 0.8),
					},
					rgRun(8,
						rgNote("buzz", 0.17, 0.07, 1400, 1050, 1.0),
						rgNote("buzz", 0.12, 0.10, 1150, 900, 0.55)),
				),
				Repeat: [2]int{1, 2}, Gap: 4, Loud: 0.9, Pitch: "medium", Pattern: "laughing",
			},
			{
				// The everyday "kyow".
				Kind:   "call",
				Notes:  []core.Note{rgNote("buzz", 0.32, 0.3, 1150, 800, 1.0)},
				Repeat: [2]int{1, 3}, Gap: 1.5, Loud: 0.7, Pitch: "medium", Pattern: "single",
			},
			{
				// A low, anxious "ga-ga-ga" when something comes too close.
				Kind:   "alarm",
				Notes:  rgTimes(3, rgNote("buzz", 0.10, 0.07, 620, 560, 0.9)),
				Repeat: [2]int{1, 3}, Gap: 1, Loud: 0.5, Pitch: "low", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "gull", Primary: "white", Secondary: "grey",
			Marking: "pale grey back, black wingtips and pink legs", Bill: "stout", Flight: "soaring",
		},
		Difficulty: 1,
		// No other bird in the guide is really like it.
		Similar: []string{},
		Relations: []string{
			"A scavenger and opportunist that follows the tideline, the fishing boats and the plough alike.",
			"Chases puffins and cormorants to rob them of their catch, and wanders inland to bathe in marsh pools.",
		},
	}
}

func rgOystercatcher() core.Species {
	return core.Species{
		ID:     "eurasian_oystercatcher",
		Name:   "Eurasian Oystercatcher",
		Sci:    "Haematopus ostralegus",
		Family: "Waders",
		Desc: "A loud, stocky, black-and-white shorebird with a long carrot-orange bill and pink legs. It is rarely quiet " +
			"for long, piping shrilly as it flies along the tideline.",
		IDTips: "Nothing else on the shore is so boldly pied: black head, breast and back, white belly, and a broad white " +
			"wing bar and rump in flight. The straight orange-red bill and red eye are visible from far away. The call is " +
			"a piercing 'kleep, kleep'; excited groups run together with bills pointed down, piping in a rising, " +
			"trilling chorus.",
		Fact: "Despite the name it mostly eats mussels and cockles. Each bird is either a 'hammerer' that smashes the shell " +
			"or a 'stabber' that slips its bill between the two halves, and chicks learn the trade from their parents.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionWhisperingCoast},
		Habitats: []core.HabitatWeight{rgHab("beach", 0.85), rgHab("cliff", 0.15)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.42, Wingspan: 0.83, Plump: 1.1, Neck: 0.3, Legs: 0.6,
			Tail: 0.4, TailShape: "square", Bill: 2.2, BillShape: "dagger", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#17181b", Belly: "#fafaf6", Head: "#141518", Wing: "#1a1b1f",
				Tail: "#1c1c1f", Bill: "#f0661e", Legs: "#e89aa0", Eye: "#c81e1e",
			},
			Marks: []core.Mark{
				rgMark("breast", "#141518"), // the black hood ends in a clean line
				rgMark("wingbar", "#fbfbf7"),
				rgMark("rump", "#fbfbf7"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "walk", Speed: 15, FlapHz: 6},
		Behavior: core.Behavior{
			Perches:   []string{"shore", "rock", "ground"},
			Feeding:   "probe",
			Activity:  [6]float32{0.9, 0.9, 0.7, 0.9, 1.0, 0.4},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 120, Shyness: 28, Vocal: 4, Density: 0.8,
			Camo: 0.05, Skulking: 0, Habituate: 0.5,
			// "social" is the piping display: birds running side by side, bills down.
			Specials: []string{"social", "bathing", "nesting"},
		},
		Calls: []core.Call{
			{
				// "k-LEEP, k-LEEP": a shrill, far-carrying pipe.
				Kind: "call",
				Notes: rgTimes(2,
					rgNote("whistle", 0.05, 0, 2700, 3900, 0.9),
					rgNote("whistle", 0.14, 0.24, 3900, 3500, 1.0)),
				Repeat: [2]int{2, 6}, Gap: 0.5, Loud: 0.85, Pitch: "high", Pattern: "repeated",
			},
			{
				// The piping display: "kip kip kip-kip-kipkip" speeding up into a
				// long, bubbling trill.
				Kind: "song",
				Notes: rgPhrase(
					rgRun(7,
						rgNote("whistle", 0.07, 0.09, 3300, 3700, 0.8),
						rgNote("whistle", 0.05, 0.03, 3500, 3900, 1.0)),
					[]core.Note{rgWob("trill", 0.9, 0.3, 3700, 3300, 0.9, 22, 0.8)},
				),
				Repeat: [2]int{1, 2}, Gap: 2, Loud: 0.8, Pitch: "high", Pattern: "trill",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "wader", Primary: "black", Secondary: "white",
			Marking: "long carrot-orange bill and pink legs", Bill: "dagger", Flight: "direct",
		},
		Difficulty: 1,
		Similar:    []string{"atlantic_puffin"},
		Relations: []string{
			"Its numbers follow the mussel and cockle beds of the shore.",
			"Its alarm piping warns every other bird on the beach that something is coming.",
		},
	}
}

func rgCormorant() core.Species {
	return core.Species{
		ID:     "great_cormorant",
		Name:   "Great Cormorant",
		Sci:    "Phalacrocorax carbo",
		Family: "Cormorants",
		Desc: "A big, dark, reptilian-looking waterbird that swims low with its bill tilted upward and dives for fish. " +
			"Afterwards it stands on a rock with its wings held out to dry.",
		IDTips: "Blackish with a bronze, scaly sheen on the wings, a white chin and cheek patch, yellow skin at the base of " +
			"a long hooked bill, and a thick snaky neck. On the water only the back, neck and head show, far lower than " +
			"any duck. In flight it looks like a black cross, with the neck held straight out. Mostly silent away from " +
			"the colony, where it gives deep guttural croaks.",
		Fact: "A cormorant's feathers soak up water instead of shedding it, which makes the bird less buoyant and a better " +
			"underwater hunter. That is why it must stand with its wings spread to dry after fishing.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionWhisperingCoast},
		Habitats: []core.HabitatWeight{rgHab("ocean", 0.45), rgHab("cliff", 0.3), rgHab("beach", 0.25)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.90, Wingspan: 1.45, Plump: 0.95, Neck: 0.75, Legs: 0.2,
			Tail: 0.55, TailShape: "square", Bill: 1.5, BillShape: "hooked", WingShape: "long",
			Colors: core.Palette{
				Back: "#2a2a24", Belly: "#15171a", Head: "#16181b", Wing: "#33302a",
				Tail: "#121315", Bill: "#8a8573", Legs: "#141416", Eye: "#2f8f6a",
			},
			Marks: []core.Mark{
				rgMark("throat", "#f2efe6"),
				rgMark("cheek", "#e6c247"), // bare yellow skin at the gape
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "swim", Speed: 16, FlapHz: 4.5},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "water", "snag", "structure", "shore"},
			Feeding:   "dive",
			Activity:  [6]float32{0.8, 1.0, 0.7, 0.8, 0.7, 0},
			Sociality: "flock", FlockMin: 2, FlockMax: 5,
			Territory: 300, Shyness: 40, Vocal: 0.4, Density: 0.4,
			Camo: 0.1, Skulking: 0, Habituate: 0.4,
			// "preening" is the heraldic wing-drying pose.
			Specials: []string{"diving", "preening", "bathing"},
		},
		Calls: []core.Call{
			{
				// "korr-korr-korr-korr": deep, guttural, pig-like croaks.
				Kind: "call",
				Notes: rgRun(4,
					rgWob("buzz", 0.22, 0.14, 310, 250, 1.0, 32, 0.3),
					rgWob("buzz", 0.20, 0.20, 280, 230, 0.7, 32, 0.3)),
				Repeat: [2]int{1, 2}, Gap: 3, Loud: 0.4, Pitch: "low", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "huge", Shape: "seabird", Primary: "black", Secondary: "white",
			Marking: "white chin patch on a snaky black neck", Bill: "hooked", Flight: "direct",
		},
		Difficulty: 2,
		Similar:    []string{"grey_heron", "common_raven"},
		Relations: []string{
			"Fishes the same inshore waters as puffins but dives deeper, down to the sea bed.",
			"Gulls loiter near fishing cormorants, hoping to steal a catch.",
		},
	}
}

func rgPuffin() core.Species {
	return core.Species{
		ID:     "atlantic_puffin",
		Name:   "Atlantic Puffin",
		Sci:    "Fratercula arctica",
		Family: "Auks",
		Desc: "A small, stout seabird in black and white with a huge, brightly banded bill and orange feet. It nests in " +
			"burrows on grassy clifftops and whirrs out to sea on small, fast-beating wings.",
		IDTips: "Smaller than most people expect: a dumpy, upright black-and-white bird with a pale grey face, a triangular " +
			"bill banded in orange-red, blue-grey and yellow, and bright orange legs. It flies low and straight on a blur " +
			"of wingbeats, like a wind-up toy. At the burrow it gives a low, creaking growl, like a distant chainsaw.",
		Fact: "Backward-pointing spines on a puffin's tongue and palate let it hold a dozen or more small fish crosswise in " +
			"its bill while it catches yet another. The bright outer plates of the bill are shed after the breeding season.",
		Rarity:   core.Uncommon,
		Regions:  []core.RegionID{core.RegionWhisperingCoast},
		Habitats: []core.HabitatWeight{rgHab("cliff", 0.55), rgHab("ocean", 0.45)},
		Seasons:  rgSummerVisitor,
		Look: core.Appearance{
			Length: 0.28, Wingspan: 0.55, Plump: 1.3, Neck: 0.1, Legs: 0.3,
			Tail: 0.25, TailShape: "square", Bill: 1.2, BillShape: "cone", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#17181b", Belly: "#fbfbf7", Head: "#17181b", Wing: "#1b1c20",
				Tail: "#151618", Bill: "#e8562a", Legs: "#f27a1e", Eye: "#2a1c14",
			},
			Marks: []core.Mark{
				rgMark("cheek", "#eeeae0"), // the pale clown face
				rgMark("collar", "#17181b"),
			},
		},
		Move: core.Movement{Flight: "whirring", Ground: "swim", Speed: 22, FlapHz: 8},
		Behavior: core.Behavior{
			Perches:   []string{"rock", "water", "ground"},
			Feeding:   "dive",
			Activity:  [6]float32{0.9, 1.0, 0.6, 0.8, 1.0, 0},
			Sociality: "flock", FlockMin: 3, FlockMax: 10,
			Territory: 250, Shyness: 16, Vocal: 0.8, Density: 0.45,
			Camo: 0.05, Skulking: 0.1, Habituate: 0.8,
			// "social" is billing: pairs rattling their bills together at the burrow.
			Specials: []string{"social", "diving", "nesting"},
		},
		Calls: []core.Call{
			{
				// "arrr-UUUH": one long creaking groan that rises, then sags.
				Kind: "call",
				Notes: []core.Note{
					rgWob("buzz", 0.55, 0.08, 330, 420, 0.8, 26, 0.25),
					rgWob("buzz", 0.70, 0.40, 420, 250, 1.0, 26, 0.3),
				},
				Repeat: [2]int{1, 2}, Gap: 4, Loud: 0.25, Pitch: "low", Pattern: "single",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "seabird", Primary: "black", Secondary: "white",
			Marking: "huge banded orange bill on a pale clown face", Bill: "stout", Flight: "whirring",
		},
		Difficulty: 3,
		Similar:    []string{"eurasian_oystercatcher"},
		Relations: []string{
			"Relies on shoals of sand eels close to the colony; in poor fish years few chicks survive.",
			"Herring gulls chase incoming puffins to make them drop their fish.",
		},
	}
}

// ---------------------------------------------------------------------------
// Amberwood

func rgRedwing() core.Species {
	return core.Species{
		ID:     "redwing",
		Name:   "Redwing",
		Sci:    "Turdus iliacus",
		Family: "Thrushes & Chats",
		Desc: "A small, neat thrush that arrives from the north in autumn. Flocks strip berries from hedges and rowans and " +
			"hop across the leaf litter, flying up together into the treetops when alarmed.",
		IDTips: "Like a small, dark song thrush with two extras: a bold creamy stripe over the eye and a rusty-red patch on " +
			"the flank that continues under the wing. The breast is streaked rather than spotted. The usual call is a " +
			"thin, drawn-out, very high 'tseeep', often given in flight.",
		Fact: "Redwings migrate at night. On still autumn evenings their thin calls drift down from the dark sky as unseen " +
			"flocks pass overhead, keeping in touch with one another as they fly.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionAmberwood},
		Habitats: []core.HabitatWeight{rgHab("woodland", 0.5), rgHab("shrub", 0.3), rgHab("meadow", 0.2)},
		Seasons:  rgWinterVisitor,
		Look: core.Appearance{
			Length: 0.21, Wingspan: 0.34, Plump: 1.0, Neck: 0.2, Legs: 0.45,
			Tail: 0.7, TailShape: "square", Bill: 0.65, BillShape: "thin", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#6b5136", Belly: "#f1e9d8", Head: "#644b32", Wing: "#5f4830",
				Tail: "#5a442d", Bill: "#4a3b28", Legs: "#c9a184", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("eyestripe", "#f3e7c6"),
				rgMark("wingpatch", "#b5482a"), // the rusty flank showing at the wing's edge
				rgMark("streaks", "#4a3826"),
			},
		},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 13, FlapHz: 9},
		Behavior: core.Behavior{
			Perches:   []string{"branch", "canopy", "shrub", "ground"},
			Feeding:   "ground",
			Activity:  [6]float32{0.8, 1.0, 0.7, 0.9, 0.8, 0.25}, // a few still call on the move after dark
			Sociality: "flock", FlockMin: 5, FlockMax: 14,
			Territory: 200, Shyness: 26, Vocal: 3, Density: 1.0,
			Camo: 0.3, Skulking: 0.3, Habituate: 0.4,
			Specials: []string{"social", "bathing"},
		},
		Calls: []core.Call{
			{
				// "tseeeep": thin as a drawn wire, slightly buzzy, falling a little.
				Kind:   "call",
				Notes:  []core.Note{rgWob("whistle", 0.3, 0.2, 7800, 6700, 0.8, 60, 0.03)},
				Repeat: [2]int{1, 3}, Gap: 2.5, Loud: 0.4, Pitch: "very high", Pattern: "single",
			},
			{
				// A dry "chittuck" from a nervous flock.
				Kind: "alarm",
				Notes: []core.Note{
					rgNote("click", 0.04, 0.05, 2300, 1900, 0.8),
					rgNote("buzz", 0.08, 0.25, 2500, 2000, 0.8),
				},
				Repeat: [2]int{1, 4}, Gap: 0.7, Loud: 0.3, Pitch: "medium", Pattern: "chatter",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "thrush", Primary: "brown", Secondary: "red",
			Marking: "cream eyebrow and rust-red flanks", Bill: "thin", Flight: "direct",
		},
		Difficulty: 2,
		Similar:    []string{"song_thrush"},
		Relations: []string{
			"Strips rowan, hawthorn and holly berries and scatters the seeds across the forest.",
			"Travels in mixed flocks with other winter thrushes and feeds alongside blackbirds.",
		},
	}
}

func rgBrambling() core.Species {
	return core.Species{
		ID:     "brambling",
		Name:   "Brambling",
		Sci:    "Fringilla montifringilla",
		Family: "Finches",
		Desc: "The northern cousin of the chaffinch, a winter visitor that gathers in flocks wherever beech mast has " +
			"fallen. Orange shoulders and breast, a white belly and a white rump make a feeding flock flicker like blown " +
			"leaves.",
		IDTips: "Chaffinch-shaped, but with an orange breast and shoulder patch, a clean white belly and, in flight, a long " +
			"white rump where a chaffinch is greenish. In winter the head is mottled grey-brown and the bill yellow with " +
			"a dark tip. Listen for the call: a harsh, rising, nasal wheeze, 'tchwaay'.",
		Fact: "In winters when the beech trees crop heavily, bramblings gather at night roosts numbering in the millions, " +
			"among the largest gatherings of any songbird on Earth.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionAmberwood},
		Habitats: []core.HabitatWeight{rgHab("woodland", 0.65), rgHab("meadow", 0.2), rgHab("shrub", 0.15)},
		Seasons:  rgWinterVisitor,
		Look: core.Appearance{
			Length: 0.15, Wingspan: 0.26, Plump: 1.05, Neck: 0.1, Legs: 0.35,
			Tail: 0.7, TailShape: "forked", Bill: 0.6, BillShape: "cone", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#4a3d33", Belly: "#f6f1e6", Head: "#55483d", Wing: "#26221f",
				Tail: "#1f1c1a", Bill: "#e3b84a", Legs: "#a8765a", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("breast", "#e8883a"),
				rgMark("wingpatch", "#e8883a"), // orange shoulder
				rgMark("wingbar", "#f2e3c8"),
				rgMark("rump", "#fbfbf7"),
				rgMark("spots", "#3a2f28"), // dark flecks along the flank
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "hop", Speed: 12, FlapHz: 12},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch", "ground"},
			Feeding:   "seeds",
			Activity:  [6]float32{0.8, 1.0, 0.7, 0.9, 0.7, 0},
			Sociality: "flock", FlockMin: 6, FlockMax: 20,
			Territory: 220, Shyness: 18, Vocal: 3, Density: 0.9,
			Camo: 0.4, Skulking: 0.2, Habituate: 0.5,
			Specials: []string{"social", "bathing"},
		},
		Calls: []core.Call{
			{
				// "tchwaaay": a rising, nasal, almost rude wheeze.
				Kind:   "call",
				Notes:  []core.Note{rgWob("buzz", 0.42, 0.35, 2500, 3200, 0.9, 70, 0.08)},
				Repeat: [2]int{1, 3}, Gap: 2, Loud: 0.4, Pitch: "medium", Pattern: "harsh",
			},
			{
				// "yeck, yeck" from birds flying over.
				Kind:   "call",
				Notes:  rgTimes(2, rgNote("buzz", 0.07, 0.11, 2100, 1800, 0.8)),
				Repeat: [2]int{1, 3}, Gap: 0.8, Loud: 0.3, Pitch: "medium", Pattern: "repeated",
			},
		},
		Traits: core.Traits{
			Size: "small", Shape: "finch", Primary: "orange", Secondary: "black",
			Marking: "orange breast and shoulders with a white rump", Bill: "short", Flight: "undulating",
		},
		Difficulty: 2,
		Similar:    []string{"common_chaffinch", "hawfinch"},
		Relations: []string{
			"Lives on fallen beech mast in winter; flock sizes rise and fall with the beech crop.",
			"Mixes with chaffinches under the trees, so every finch flock is worth a second look.",
		},
	}
}

func rgHawfinch() core.Species {
	return core.Species{
		ID:     "hawfinch",
		Name:   "Hawfinch",
		Sci:    "Coccothraustes coccothraustes",
		Family: "Finches",
		Desc: "A big-headed, bull-necked finch with a bill powerful enough to crack cherry stones. Despite its size and " +
			"rich colours it is wary and elusive, spending its days high in the crowns of old trees.",
		IDTips: "Top-heavy and short-tailed, with an enormous conical bill, a tawny-orange head, grey collar, black bib and " +
			"a broad white band on blue-black wings. In flight it looks front-heavy, with a white-tipped tail and a " +
			"translucent white wing stripe. Most are found by ear: an abrupt, metallic 'tzick!', harder and more " +
			"explosive than a robin's tick.",
		Fact: "The hawfinch's jaw muscles and ridged bill can press with a force of forty kilograms or more, enough to " +
			"split a cherry stone, though the bird itself weighs barely as much as a hen's egg.",
		Rarity:   core.Rare,
		Regions:  []core.RegionID{core.RegionAmberwood},
		Habitats: []core.HabitatWeight{rgHab("woodland", 1.0)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.18, Wingspan: 0.31, Plump: 1.25, Neck: 0.05, Legs: 0.3,
			Tail: 0.45, TailShape: "square", Bill: 1.2, BillShape: "cone", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#6a4630", Belly: "#d9a98a", Head: "#c98a4e", Wing: "#1d2233",
				Tail: "#7a5133", Bill: "#8892a0", Legs: "#c98f7a", Eye: "#c9c0b0",
			},
			Marks: []core.Mark{
				rgMark("mask", "#151416"),
				rgMark("bib", "#151416"),
				rgMark("nape", "#9aa0a6"), // the grey collar
				rgMark("wingpatch", "#f5f3ec"),
				rgMark("tailtip", "#f5f3ec"),
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "hop", Speed: 14, FlapHz: 11},
		Behavior: core.Behavior{
			Perches:   []string{"canopy", "branch"},
			Feeding:   "seeds",
			Activity:  [6]float32{0.9, 1.0, 0.5, 0.7, 0.6, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			Territory: 260, Shyness: 55, Vocal: 0.8, Density: 0.1,
			Camo: 0.35, Skulking: 0.75, Habituate: 0.1,
			// Coming down to a puddle to drink and bathe is the best chance of a close view.
			Specials: []string{"bathing", "social"},
		},
		Calls: []core.Call{
			{
				// "TZICK! ... TZICK!": like two steel balls struck together.
				Kind: "call",
				Notes: rgTimes(2,
					rgNote("click", 0.02, 0, 6400, 5200, 1.0),
					rgNote("whistle", 0.05, 0.4, 5800, 4800, 0.85)),
				Repeat: [2]int{1, 4}, Gap: 1.2, Loud: 0.35, Pitch: "high", Pattern: "repeated",
			},
			{
				// A thin "sriii" that is easily passed over as a redwing.
				Kind:   "call",
				Notes:  []core.Note{rgWob("whistle", 0.22, 0.3, 7000, 7500, 0.6, 45, 0.02)},
				Repeat: [2]int{1, 2}, Gap: 2, Loud: 0.2, Pitch: "very high", Pattern: "single",
			},
		},
		Traits: core.Traits{
			Size: "small", Shape: "finch", Primary: "brown", Secondary: "orange",
			Marking: "massive steel-grey bill on a bull-necked head", Bill: "stout", Flight: "undulating",
		},
		Difficulty: 5,
		Similar:    []string{"common_chaffinch", "brambling"},
		Relations: []string{
			"Depends on old hornbeam, cherry, beech and yew for the hard seeds that only its bill can open.",
			"Neatly split cherry stones under a tree are a sign that one has been feeding overhead.",
		},
	}
}

// ---------------------------------------------------------------------------
// Frostveil

func rgSnowBunting() core.Species {
	return core.Species{
		ID:     "snow_bunting",
		Name:   "Snow Bunting",
		Sci:    "Plectrophenax nivalis",
		Family: "Buntings",
		Desc: "A hardy little bird of snowfields and bare, windswept ground. Flocks swirl low over the drifts, flashing " +
			"white wings, then drop and scurry over the ground like mice.",
		IDTips: "Mostly white below with a sandy-ginger wash on the crown, cheeks and breast sides, and big white wing " +
			"panels that make a flying flock look like blowing snowflakes. On the ground it runs rather than hops. The " +
			"flight call is a soft, rippling, tinkling 'tirrirrirrip', often followed by a clear descending 'tew'.",
		Fact: "No songbird nests farther north. Males return to the high Arctic while it is still thirty degrees below " +
			"freezing to claim the best rock crevices, and feathered legs help keep out the cold.",
		Rarity:   core.Common,
		Regions:  []core.RegionID{core.RegionFrostveil},
		Habitats: []core.HabitatWeight{rgHab("snow", 0.7), rgHab("alpine", 0.3)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.16, Wingspan: 0.35, Plump: 1.1, Neck: 0.1, Legs: 0.3,
			Tail: 0.6, TailShape: "forked", Bill: 0.5, BillShape: "cone", WingShape: "pointed",
			Colors: core.Palette{
				Back: "#a08566", Belly: "#fbfaf6", Head: "#f3ead8", Wing: "#26221f",
				Tail: "#1e1d1c", Bill: "#e0b040", Legs: "#1c1b1a", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("cap", "#c9955a"),
				rgMark("cheek", "#cf9c62"),
				rgMark("wingpatch", "#fbfaf6"), // the great white wing panel
			},
		},
		Move: core.Movement{Flight: "undulating", Ground: "walk", Speed: 13, FlapHz: 11},
		Behavior: core.Behavior{
			Perches:   []string{"ground", "rock"},
			Feeding:   "seeds",
			Activity:  [6]float32{0.7, 1.0, 0.8, 0.9, 0.6, 0},
			Sociality: "flock", FlockMin: 6, FlockMax: 25,
			Territory: 240, Shyness: 10, Vocal: 3.5, Density: 1.0,
			Camo: 0.55, Skulking: 0.05, Habituate: 0.85,
			// "bathing" here is snow-bathing: shuffling and fluttering in powder.
			Specials: []string{"social", "bathing"},
		},
		Calls: []core.Call{
			{
				// "tirrirrirrip": a quick ripple of tiny falling bells.
				Kind: "call",
				Notes: rgRun(7,
					rgNote("whistle", 0.04, 0.02, 5000, 4400, 0.9),
					rgNote("whistle", 0.04, 0.03, 4300, 3800, 0.7)),
				Repeat: [2]int{1, 3}, Gap: 1.5, Loud: 0.35, Pitch: "high", Pattern: "trill",
			},
			{
				// A clear, falling "tew".
				Kind:   "call",
				Notes:  []core.Note{rgNote("whistle", 0.15, 0.3, 3400, 2700, 0.8)},
				Repeat: [2]int{1, 2}, Gap: 1.5, Loud: 0.3, Pitch: "medium", Pattern: "whistle",
			},
		},
		Traits: core.Traits{
			Size: "small", Shape: "finch", Primary: "white", Secondary: "buff",
			Marking: "big white wing panels and a ginger cap", Bill: "short", Flight: "undulating",
		},
		Difficulty: 2,
		Similar:    []string{"northern_wheatear", "rock_ptarmigan"},
		Relations: []string{
			"Feeds on seeds blown across the snow crust and exposed on windswept ridges.",
			"Flocks scatter low over the drifts when a snowy owl or raven passes over.",
		},
	}
}

func rgPtarmigan() core.Species {
	return core.Species{
		ID:     "rock_ptarmigan",
		Name:   "Rock Ptarmigan",
		Sci:    "Lagopus muta",
		Family: "Grouse",
		Desc: "A plump mountain grouse dressed for snow: pure white apart from a black tail, with thickly feathered feet. " +
			"It trusts its camouflage completely, crouching motionless until you are almost upon it.",
		IDTips: "A white, chicken-shaped bird that walks over the snow rather than flying. Males show a black stripe from " +
			"bill to eye and a small red comb; the black tail is hidden until the bird bursts away on whirring white " +
			"wings and glides downhill. Often the first clue is the voice: a dry, creaking rattle, like a stick dragged " +
			"along a wooden fence.",
		Fact: "The ptarmigan moults three times a year to match the mountainside, from winter white to mottled brown to " +
			"autumn grey. Its feathered feet work like snowshoes, and on the coldest nights it digs a burrow in the snow " +
			"to sleep in.",
		Rarity:   core.Uncommon,
		Regions:  []core.RegionID{core.RegionFrostveil},
		Habitats: []core.HabitatWeight{rgHab("snow", 0.65), rgHab("alpine", 0.35)},
		Seasons:  rgResident,
		Look: core.Appearance{
			Length: 0.35, Wingspan: 0.57, Plump: 1.3, Neck: 0.2, Legs: 0.3,
			Tail: 0.4, TailShape: "square", Bill: 0.4, BillShape: "cone", WingShape: "rounded",
			Colors: core.Palette{
				Back: "#f8f8f5", Belly: "#fbfbf9", Head: "#f8f8f5", Wing: "#f6f6f2",
				Tail: "#1a1a1c", Bill: "#1c1c1e", Legs: "#f4f4ef", Eye: "#1a1410",
			},
			Marks: []core.Mark{
				rgMark("eyestripe", "#17171a"), // the male's black bridle
			},
		},
		Move: core.Movement{Flight: "whirring", Ground: "walk", Speed: 17, FlapHz: 9},
		Behavior: core.Behavior{
			Perches:   []string{"ground", "rock"},
			Feeding:   "ground",
			Activity:  [6]float32{1.0, 0.8, 0.4, 0.7, 0.9, 0},
			Sociality: "pair", FlockMin: 1, FlockMax: 2,
			// Low shyness on purpose: it sits tight and lets the camouflage do the work.
			Territory: 130, Shyness: 12, Vocal: 0.8, Density: 0.3,
			Camo: 0.97, Skulking: 0.3, Habituate: 0.6,
			Specials: []string{"hiding", "social"},
		},
		Calls: []core.Call{
			{
				// "ar-ar-ar-KRRRRRRR-ka-ka-ka-ka": a dry, wooden rattle that winds up,
				// runs, and ticks to a stop. The pattern word is "drumming" because that
				// is what the player hears: an even, percussive roll, not a voice.
				Kind: "call",
				Notes: rgPhrase(
					rgRun(3,
						rgNote("click", 0.035, 0.12, 950, 750, 0.7),
						rgNote("click", 0.035, 0.06, 950, 750, 0.9)),
					[]core.Note{rgWob("trill", 0.55, 0.12, 820, 640, 1.0, 26, 0.95)},
					rgRun(4,
						rgNote("click", 0.035, 0.07, 800, 640, 0.8),
						rgNote("click", 0.035, 0.16, 720, 600, 0.5)),
				),
				Repeat: [2]int{1, 2}, Gap: 4, Loud: 0.5, Pitch: "low", Pattern: "drumming",
			},
		},
		Traits: core.Traits{
			Size: "medium", Shape: "grouse", Primary: "white", Secondary: "black",
			Marking: "pure white with a black tail and feathered feet", Bill: "short", Flight: "whirring",
		},
		Difficulty: 4,
		Similar:    []string{"snowy_owl", "snow_bunting"},
		Relations: []string{
			"Browses the buds and shoots of dwarf willow and heather that poke through the snow.",
			"A staple prey of snowy owls, which is why it trusts stillness over flight.",
		},
	}
}

func rgSnowyOwl() core.Species {
	return core.Species{
		ID:     "snowy_owl",
		Name:   "Snowy Owl",
		Sci:    "Bubo scandiacus",
		Family: "Owls",
		Desc: "A great white owl of the open snow, heavy, round-headed and yellow-eyed. It sits upright on a hummock or " +
			"rock for hours, watching, then flies low over the ground on broad, silent wings.",
		IDTips: "Very large and almost wholly white; females and young birds carry dark bars and spots, old males are " +
			"nearly pure white. The round head has no ear tufts and the eyes are lemon yellow. Unlike most owls it hunts " +
			"in daylight and perches on the ground in the open. The voice is a deep, hoarse bark, repeated slowly, that " +
			"carries a long way over the snow.",
		Fact: "Snowy owls evolved under the midnight sun, so they hunt by day as readily as by night. In some winters, " +
			"when food runs short in the far north, they wander far to the south and appear where none has been seen " +
			"for decades.",
		Rarity:   core.Legendary,
		Regions:  []core.RegionID{core.RegionFrostveil},
		Habitats: []core.HabitatWeight{rgHab("snow", 0.85), rgHab("alpine", 0.15)},
		Seasons:  rgWinterOnly,
		Look: core.Appearance{
			Length: 0.60, Wingspan: 1.50, Plump: 1.3, Neck: 0.05, Legs: 0.3,
			Tail: 0.45, TailShape: "square", Bill: 0.4, BillShape: "hooked", WingShape: "broad",
			Colors: core.Palette{
				Back: "#f4f4f0", Belly: "#fafaf8", Head: "#fbfbf9", Wing: "#efefea",
				Tail: "#f2f2ee", Bill: "#2a2a2c", Legs: "#f5f5f0", Eye: "#f2c21a",
			},
			Marks: []core.Mark{
				rgMark("bars", "#5a554e"), // sparse dark barring
			},
		},
		Move: core.Movement{Flight: "flapglide", Ground: "walk", Speed: 13, FlapHz: 2.6},
		Behavior: core.Behavior{
			Perches:   []string{"ground", "rock", "snag"},
			Feeding:   "hunt",
			Activity:  [6]float32{1.0, 0.4, 0.2, 0.4, 1.0, 0.7},
			Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 500, Shyness: 85, Vocal: 0.15, Density: 0.02,
			Camo: 0.85, Skulking: 0, Habituate: 0.05,
			// "diving" is the low glide that ends in a pounce through the snow crust.
			Specials: []string{"diving", "preening"},
		},
		Calls: []core.Call{
			{
				// "KROW ... krow ... krow": deep, hoarse, unhurried barks.
				Kind: "call",
				Notes: rgRun(3,
					rgWob("buzz", 0.30, 0.65, 340, 250, 1.0, 28, 0.25),
					rgWob("buzz", 0.30, 0.80, 320, 235, 0.85, 28, 0.25)),
				Repeat: [2]int{1, 2}, Gap: 6, Loud: 0.75, Pitch: "low", Pattern: "repeated",
			},
			{
				// Bill-snapping: sharp clacks from a bird that feels crowded.
				Kind:   "alarm",
				Notes:  rgTimes(4, rgNote("click", 0.03, 0.13, 1400, 1100, 0.9)),
				Repeat: [2]int{1, 2}, Gap: 1.5, Loud: 0.2, Pitch: "medium", Pattern: "chatter",
			},
		},
		Traits: core.Traits{
			Size: "large", Shape: "owl", Primary: "white", Secondary: "grey",
			Marking: "lemon-yellow eyes in a round, white, tuftless head", Bill: "hooked", Flight: "flapglide",
		},
		Difficulty: 5,
		Similar:    []string{"rock_ptarmigan", "tawny_owl"},
		Relations: []string{
			"Hunts voles, lemmings and ptarmigan across the open snowfields.",
			"Ravens will mob a snowy owl on the ground and give its position away.",
		},
	}
}
