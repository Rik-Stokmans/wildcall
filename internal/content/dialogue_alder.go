package content

import "fmt"

// alderSpeaker is the researcher: precise, dry, delighted by anything that does not
// fit the records. He teaches identification confidence, documentation levels, the
// research desk and rare discoveries, and hands out the research quests.
func alderSpeaker() *speaker {
	return &speaker{
		id: NPCAlder,
		voice: voice{
			offer:    "Hm. I have a problem that wants a second pair of eyes.",
			taken:    "Good. Write everything down, and if something does not fit, write that down first.",
			declined: "Quite right. Do not take a question you are not ready to answer. It will keep.",
			report:   "Ah. You have the look of someone holding a result. Put it on the table.",
			thanks:   "Thank you. This goes in the record under your name, which is more than most get.",
			busy:     "Not that one yet. It builds on something else.",
			nothing:  "Nothing outstanding. Which is to say I have a great many questions, but none of them are yours.",
			bye:      "Good day. Mind the creek.",
		},
		hub: alderHub,
		topics: []topic{
			{id: "a_confidence", title: "How does identification confidence work?", lines: alderConfidence},
			{id: "a_levels", title: "What makes a species \"documented\"?", lines: alderLevels},
			{id: "a_desk", title: "What do I do at the Research Desk?", lines: alderDesk},
			{id: "a_rare", title: "What counts as a rare discovery?", lines: alderRare},
			{id: "a_similar", title: "Some birds look alike. Any advice?", lines: alderSimilar},
			// Lessons the research standing unlocks (spec §16.2).
			{id: "a_difficult", title: "Which identifications are the hardest?", lines: alderDifficult, minRep: 40},
			{id: "a_scarce", title: "How does one find the truly rare birds?", lines: alderScarce, minRep: 100},
		},
		done: map[string][]string{
			"visitor_from_afar": {"A bird in the wrong country. Do you know how long I have waited for someone to bring me one of those in a hand I do not have to decipher? Thank you. It goes in the record at once."},
			"harrows_survey":    {"Four of her records, repeated, thirty years later. It is the first time that survey has been added to by anyone. I am going to need a larger drawer."},
			"booming_dusk":      {"Listen to that. You can feel it before you hear it. It is going into the archive exactly as it is."},
			"the_long_view":     {"Long glass, honest work. The coast is a hard school, and you did well."},
			"white_on_white":    {"Nobody has written anything down on the plateau for forty years. I have been waiting a long time for this. Sit down, and tell me all of it."},
		},
	}
}

func alderHub(c *dctx) []string {
	f := c.facts()
	var l []string
	switch {
	case !c.turnedIn(TutorialQuest):
		l = append(l, "Ah. The new naturalist. Mara tells me you can listen. Good. It is the one skill I cannot teach, and I have tried.")
	case f.documented == 0:
		l = append(l, "Welcome back. You have names in your journal but no evidence beneath them. A photograph or a recording turns a sighting into a record.")
	default:
		docs := fmt.Sprintf("%d of them documented", f.documented)
		switch {
		case f.documented >= f.species && f.species == 1:
			docs = "and documented"
		case f.documented >= f.species:
			docs = "every one of them documented"
		}
		l = append(l, fmt.Sprintf("Welcome back. %s identified, %s. That is a respectable table of data.", capitalFirst(speciesWord(f.species)), docs))
	}
	if c.status("quiet_creek") == StatusActive {
		l = append(l, "June has sent you about the creek, I gather. A healthy stream announces itself through its small residents: insect-eaters that need clean, quick water. If you have found them, I am reassured. If you have not, I should very much like to know why.")
	}
	if f.rare != nil {
		l = append(l, fmt.Sprintf("And I hear you logged \"%s\". I should like to see the notes.", f.rare.Title))
	}
	if c.p.Rep[FactionResearch] >= 100 {
		l = append(l, "Your name is on a good many of my records now. You are, I am afraid, a colleague.")
	}
	return l
}

func alderConfidence(*dctx) []string {
	return []string{
		"Every time you watch a bird for a moment, it gives up a piece of evidence: size, then shape; then its main colour and how it flies; then secondary colours and the bill; and, on a good look, a distinct marking. What it is doing and where you find it count too.",
		"Press T and weigh your evidence against every species that could be in that place and season: your field notes give you a table of percentages. A feature that matches nudges a species up; one that does not pushes it down hard, but not to zero, because eyes lie, especially in poor light.",
		"At seventy percent or more, your identification is certain. Lower and it is merely probable, which is still progress, and it is confirmed later when your evidence improves or you obtain a photograph or recording of two stars or better. Two pieces of evidence are the least I will take. A wrong answer costs you nothing, and names one thing that does not fit.",
	}
}

func alderLevels(*dctx) []string {
	return []string{
		"A species goes through stages in your journal. Heard: a voice you cannot name. Encountered: you have seen the bird. Identified: you have put the right name to it. Documented: you hold a photograph or a recording of it. Studied: you have worked through it at the Research Desk, and need the documented stage first.",
		"The ranks need documented species, not just identified ones. Anyone can guess a name. I want to see the evidence.",
	}
}

func alderDesk(*dctx) []string {
	return []string{
		"At the Research Desk in your cabin you can review the mysteries in your journal, analyse a recording, study a documented species until you know it thoroughly, and submit a photograph or recording to the board. Each of those is paid once, modestly.",
		"The board also carries contracts. Those are the small, specific requests of labs and rangers. They are repeatable only in the sense that each is posted once, so make them count.",
	}
}

func alderRare(*dctx) []string {
	return []string{
		"The records are most interested in what should not be there: a bird far outside its normal range, blown in by weather and unable to get home; one with unusual plumage; one doing something not seen before; or one of the scarce species that follow very strict conditions of season, hour and weather.",
		"Wind and rain bring vagrants. So do the turns of the season: autumn most of all. And a really fine photograph can be a discovery of its own. If you find one, identify it and it is logged under Rare Discoveries.",
	}
}

func alderSimilar(*dctx) []string {
	return []string{
		"Every journal page has a \"compare similar\" view for exactly that reason. Do not rely on colour alone, which changes with the light. Size relative to a bird you know, the shape of the bill, the way the tail is held and how it moves are better evidence, and they are the ones a good look gives you first.",
		"Habitat helps, and so does season. A wrong guess costs nothing, so make one and let the evidence correct you.",
	}
}

// alderDifficult is the lesson on hard identifications (40 research reputation).
func alderDifficult(*dctx) []string {
	return []string{
		"The hard ones fall into three drawers. Birds that look alike and sound different: there the recorder is better evidence than the binoculars, so get the voice. Birds that sound alike and look different: the reverse. And birds that will not show themselves at all, because they live in thick cover or come out only at the edges of the day.",
		"For those, sit. A bird that has decided you are furniture will step out eventually, so wait where it must cross open ground: the edge of the water, a gap in the cover. And in poor light a recording does what your eyes cannot.",
		"The third trap is the young and the females. Half the marks in any guide belong to the adult male in spring. When the colours mislead you, trust the size, the shape, the bill and what the bird is doing. And do not be ashamed of \"probable\". I keep a drawer of my own and visit it like old friends.",
		"Every species you name for the first time goes into my records, and the research people notice whose name is on it. That is how you came to be standing here asking me this.",
	}
}

// alderScarce is the lesson on scarce species and vagrants (100 research reputation).
// It describes the conditions of the rarest birds as Harrow's diary does, and names
// none of them.
func alderScarce(*dctx) []string {
	return []string{
		"Scarce birds are not hiding from you in particular. They keep strict appointments: a season, an hour, a kind of weather, sometimes all three. Your journal records when and where you met everything; put the hours side by side and the rare ones show their pattern.",
		"From the records, and from Harrow's papers: one sings only in late spring, only in the first hours after sunrise, only in the crowns of the tallest trees. One booms from deep reeds at dusk in spring. And something pale hunts the far north, but only in the depths of winter. I will not name them. You would never forgive me.",
		"Vagrants are another matter: they are lost, not scarce. They come after strong wind and rain, most of all in autumn, and turn up where they have no business. Identify one and it is logged as a rare discovery.",
		"The first identification of a scarce bird is worth more experience than a common one: half as much again for an uncommon bird, two and a half times for a rare one, four times for the rarest of all. Spend the first minute looking, though, not reaching for the camera. I want the notes, but I want you to have seen it first.",
	}
}
