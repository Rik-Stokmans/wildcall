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
		l = append(l, fmt.Sprintf("Welcome back. %s identified, %d of them documented. That is a respectable table of data.", capitalFirst(speciesWord(f.species)), f.documented))
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
		"Press T and the game weighs your evidence against every species that could be in that place and season, and gives you a table of percentages. A feature that matches nudges a species up; one that does not pushes it down hard, but not to zero, because eyes lie, especially in poor light.",
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
		"Every journal page has a \"compare similar\" view for exactly that reason. Do not rely on colour alone, which changes with the light. Size relative to a bird you know, the shape of the bill, the way the tail is held and how it moves are better evidence, and they are the ones that the game collects first.",
		"Habitat helps, and so does season. A wrong guess costs nothing, so make one and let the evidence correct you.",
	}
}
