package content

// pages are the eight pages of the Forgotten Field Journal: the diary of Edith Harrow,
// the last keeper of the Old Watchtower. They are handed out in order wherever pages
// are found (page_0 lies inside the tower). Each hints at the kinds of hidden place
// the world holds, or at the conditions of a rare bird, through what she noticed and
// never through coordinates. The birds are described, never named: the reader must
// still earn the identification.
var pages = [PageCount]struct{ title, text string }{
	{"Journal Page: The Tower",
		"3 April. Took the tower again this spring. Forty steps up and the whole valley lies open: the creek a thread, the meadow a green coin. I keep two books now. The keeper's log says what the sky is doing; this one says what I am glad of. There are places I have left out of the log. A pond that no path goes near, ringed with reeds, where something small and shy comes at dusk. I shall write of it when I trust this page."},
	{"Journal Page: Still Water",
		"19 April. Went down to the still water at last light. No trail, only a pull in the ground and a line of reeds where there ought to be none. Two small dark birds on the water, a chorus of frogs, and a sound out of the rushes I could not place. I sat until I could not see my hands. A pond is not hidden because it is far. It is hidden because nobody looked for wet ground where the map says dry."},
	{"Journal Page: The Grey Rock",
		"2 May. A grey rock stands clear of the trees on the north side, bare as a knuckle. I went up on a clear morning and was well paid for it: by noon the air lifts off the hill and the big hunters sail out in circles without a wingbeat. The climb is the price. Nobody finds a rock like that by walking the path. You must look for the place where the trees stop."},
	{"Journal Page: The Trapper's Cabin",
		"14 May. Found the trapper's cabin, or what the weather has left of it: a straight roofline sagging in the deep wood, the door long gone. Someone left a case behind the stove, wrapped against the damp. I did not open it. It is theirs still, in a way. Cabins like this are scattered through every great wood, and in the old forests they keep the best secrets, being farthest from anyone."},
	{"Journal Page: The Camp in the Pines",
		"30 May. The old survey camp, in the pines. The ground is soft with needles and the trees close overhead. I slept one night with the tent open and was woken three times by calls from either side, answering each other across the dark. Someone left a bundle under oilcloth. I took nothing. When the dark is this good you do not need to carry anything out."},
	{"Journal Page: The Flute",
		"9 June, a little after sunrise. Heard it again at last: a flute in the crown of the tallest oaks, liquid and unhurried. Yellow as a lemon, and all but impossible to see; a flash between two leaves and gone. I have heard it only in late spring, only in the morning, only at the very top. By the end of June there is nothing. Does it ever come down? Not in my time."},
	{"Journal Page: My Sister's Letter",
		"Copied from my sister's letter, who walks the marshes. Down in the reed country there are old stations on stilts, listening houses, which no one visits now. They are the best places to hear the great boom that rolls across the water at dusk in spring, from a bird too shy to be seen, shaped like a heron and standing like a reed. She writes: go at dusk, in spring, and sit in the silence."},
	{"Journal Page: Go Further",
		"Last page. My sister writes of the summits too: cairns of stacked stones on the high places, built by someone for someone, and further north a white country where a pale owl hunts by day, but only in the depths of winter. I shall not see it. Whoever reads this: go further than I did. The valley is a beginning. Every kind of place I have written of here has a cousin out there, and some of them have a better view. E. H."},
}
