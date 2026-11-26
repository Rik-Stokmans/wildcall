package narrator

// Species lines: ONLY reachable when the player has identified the species
// (Event.Known). hear = recognising its voice, watch = seeing it, note = a behaviour or
// character note. Each line is true to the real bird and names no other species.
type speciesLines struct {
	hear, watch, note []string
}

var speciesBank = map[string]speciesLines{
	"european_robin": {
		hear: []string{
			"That wistful, trickling song is a robin. Robins sing nearly all year, even on the gloomiest winter afternoon.",
			"A robin's thin tick, tick. Somebody nearby has noticed us.",
		},
		watch: []string{
			"A robin, watching me with that bright, black eye. I suspect it's hoping I'll turn over some soil.",
			"There's the robin, puffed up on its perch. That red breast is a warning to rivals, not a welcome.",
		},
		note: []string{"Robins are fiercely territorial. That sweet little bird would happily fight its own reflection."},
	},
	"blue_tit": {
		hear: []string{
			"That bright, tinkling trill belongs to a blue tit, somewhere in the twigs.",
			"Blue tits, scolding away. They're never quiet for long.",
		},
		watch: []string{
			"A blue tit, hanging upside down like a tiny acrobat. Dignity is not a priority.",
			"Look at that little blue cap. A blue tit, working through every bud on the branch.",
		},
		note: []string{"A blue tit raises an enormous brood, timed to the very week the caterpillars hatch."},
	},
	"great_tit": {
		hear: []string{
			"Teacher, teacher. A great tit, ringing out its two notes like a squeaky wheelbarrow.",
			"The great tit has dozens of calls. That one, I'm fairly sure, is simply showing off.",
		},
		watch: []string{
			"A great tit, with that black tie down its yellow front. The broader the tie, the bolder the bird.",
			"There's the great tit, bossing the smaller birds about. It rather fancies itself.",
		},
		note: []string{"Great tits are clever problem solvers. Show one a puzzle with a reward, and it will work it out."},
	},
	"common_blackbird": {
		hear: []string{
			"That unhurried, fluting song is a blackbird. Nobody takes their time quite so beautifully.",
			"A blackbird's alarm, chinking away. Something has upset it, quite possibly me.",
		},
		watch: []string{
			"A blackbird, head cocked, listening to the ground. It can hear the worms, or near enough.",
			"The blackbird, with that golden bill and eye-ring. Simple colours, worn very well.",
		},
		note: []string{"Blackbirds sing loveliest at dusk, from a high perch, as though closing the day properly."},
	},
	"eurasian_wren": {
		hear: []string{
			"That thin, hurried chirp is typical of a wren. An astonishing voice for something so small.",
			"The wren, rattling off its song at full volume. Ounce for ounce, the loudest singer in the woods.",
		},
		watch: []string{
			"A wren, tail cocked, vanishing and reappearing in the undergrowth like a small brown mouse.",
			"There it is, the wren, bobbing on a root. It seems thoroughly annoyed that I've noticed.",
		},
		note: []string{"The male wren builds several nests and lets the female choose. Rather a lot of work for a maybe."},
	},
	"common_chaffinch": {
		hear: []string{
			"A chaffinch, rattling down the scale and finishing with a flourish, like a bowler running in.",
			"That bright pink, pink call is a chaffinch, keeping in touch with the others.",
		},
		watch: []string{
			"A chaffinch, shuffling about on the ground. Those white wing-bars flash every time it moves.",
			"The chaffinch, pink-breasted and blue-capped, looking very pleased with itself.",
		},
		note: []string{"Chaffinch songs have local dialects. A bird from the next valley would sound faintly foreign."},
	},
	"great_spotted_woodpecker": {
		hear: []string{
			"That drumming is a great spotted woodpecker, rattling a dead branch to announce itself.",
			"A sharp kik. The woodpecker, somewhere along the trunks.",
		},
		watch: []string{
			"A great spotted woodpecker, braced on its stiff tail. That crimson under the tail is quite the flourish.",
			"There's the woodpecker, chiselling away. Its skull is built rather like a crash helmet.",
		},
		note: []string{"Woodpeckers don't drum for food. It's a signal, a woodland telegram, saying this tree is taken."},
	},
	"eurasian_jay": {
		hear: []string{
			"That harsh screech is a jay. The most colourful bird in the wood, and quite the worst singer.",
			"A jay, raising the alarm. Every creature for a hundred yards now knows we're here.",
		},
		watch: []string{
			"A jay, with that little patch of electric blue on the wing. A jewel worn by a rather shifty character.",
			"There's the jay, hopping about with an acorn. It's planning for winter.",
		},
		note: []string{"A single jay may bury thousands of acorns each autumn. The ones it forgets become the next oak wood."},
	},
	"eurasian_nuthatch": {
		hear: []string{
			"That loud, ringing whistle is a nuthatch, carrying through the trees.",
			"A nuthatch, calling from the trunks. A big voice for a small bird.",
		},
		watch: []string{
			"A nuthatch, walking head first down the trunk. Everyone else here does it the other way up.",
			"There's the nuthatch, wedging a nut into the bark and hammering it open. Very practical.",
		},
		note: []string{"Nuthatches plaster mud around their nest hole until only they can squeeze through. Home improvements, of a sort."},
	},
	"eurasian_treecreeper": {
		hear: []string{
			"That thin, high trickle is a treecreeper. Easy to miss, much like the bird itself.",
			"A treecreeper, singing so softly you'd think it was embarrassed.",
		},
		watch: []string{
			"A treecreeper, spiralling up the trunk like a fallen leaf going the wrong way.",
			"There's the treecreeper, probing the bark with that fine curved bill.",
		},
		note: []string{"Treecreepers only ever climb upwards. At the top, they flutter down to the foot of the next tree."},
	},
	"tawny_owl": {
		hear: []string{
			"A tawny owl. That long, wavering hoot is the sound of the wood after dark.",
			"Kee-wick. A tawny owl, calling to its mate somewhere in the dark.",
		},
		watch: []string{
			"A tawny owl, tucked against the trunk. Those dark eyes miss very little.",
			"There's the owl, perfectly still, pretending to be part of the tree. It's rather good at it.",
		},
		note: []string{"Tawny owls keep the same territory all their lives. This one knows every branch here by heart."},
	},
	"common_buzzard": {
		hear: []string{
			"That plaintive mewing overhead is a buzzard, circling on the warm air.",
			"A buzzard, calling high above. It sounds rather like a lost kitten.",
		},
		watch: []string{
			"A buzzard, wings held in a shallow V, turning slow circles. Barely a single wingbeat.",
			"There's the buzzard, hunched on a post. It will happily wait an hour for a vole to make a mistake.",
		},
		note: []string{"Buzzards will walk about a field eating earthworms. Not the noble hunt you'd expect, but very sensible."},
	},
	"song_thrush": {
		hear: []string{
			"A song thrush, saying everything twice, or three times, just to be quite sure.",
			"That's the song thrush. Each phrase repeated, as though it's practising.",
		},
		watch: []string{
			"A song thrush, with neat dark spots on a cream breast. Every one placed with care.",
			"The song thrush, pausing on the grass, head tilted. Then a sudden lunge.",
		},
		note: []string{"Song thrushes smash snails on a favourite stone. Find a scatter of broken shells and you've found the thrush."},
	},
	"goldcrest": {
		hear: []string{
			"That very high, thin song is a goldcrest. Some people can't hear it at all.",
			"A goldcrest, somewhere in the pines, its voice as fine as a needle.",
		},
		watch: []string{
			"A goldcrest, flickering through the needles. That golden stripe on its crown is like a struck match.",
			"There it is, the goldcrest, hovering to pick a spider off a twig. It weighs less than a coin.",
		},
		note: []string{"The goldcrest is the smallest bird in these woods, and yet some cross the sea every autumn. Extraordinary."},
	},
	"long_tailed_tit": {
		hear: []string{
			"Those thin, buzzing calls are long-tailed tits. A whole family, passing through.",
			"Long-tailed tits, chattering to keep the party together as they move.",
		},
		watch: []string{
			"Long-tailed tits, like little lollipops with tails. One after another across the gap.",
			"There they are, a party of long-tailed tits, flitting through the branches and never quite still.",
		},
		note: []string{"Long-tailed tits huddle together in a row on cold nights. Rather touching, and very sensible."},
	},
	"eurasian_blackcap": {
		hear: []string{
			"That rich, rushing warble is a blackcap. One of the finest songs in the wood.",
			"A blackcap's tack, tack. Hidden in the leaves, as usual.",
		},
		watch: []string{
			"A blackcap, and a male, with that neat black cap. The females wear theirs in chestnut.",
			"There's the blackcap, picking at berries. It has impeccable taste in fruit.",
		},
		note: []string{"More and more blackcaps now spend the winter here rather than flying south. The world shifts, and they shift with it."},
	},
	"common_chiffchaff": {
		hear: []string{
			"Chiff, chaff, chiff, chaff. The bird that very kindly sings its own name.",
			"A chiffchaff. One of the first voices of spring, and not one to vary the tune.",
		},
		watch: []string{
			"A chiffchaff, flicking its tail, picking tiny insects from the leaves. Rather plain, rather wonderful.",
			"There's the chiffchaff, dipping its tail with every hop. Dark legs, if you look closely.",
		},
		note: []string{"A chiffchaff weighs about as much as a sheet of paper, and still flies here every spring. Remarkable."},
	},
	"grey_wagtail": {
		hear: []string{
			"That sharp, metallic call by the water is a grey wagtail.",
			"A grey wagtail, calling as it bounds along the stream.",
		},
		watch: []string{
			"A grey wagtail, on a stone in the stream. That long tail never stops pumping.",
			"There's the wagtail, lemon yellow underneath, which seems rather unfair for a bird called grey.",
		},
		note: []string{"Grey wagtails pick insects from the very lip of the water. They'll follow a stream for miles."},
	},
	"common_kingfisher": {
		hear: []string{
			"That shrill whistle, low over the water, is a kingfisher. Look quickly.",
			"A kingfisher, calling as it shoots past. One hears them far more often than one sees them.",
		},
		watch: []string{
			"A kingfisher, perched over the water. That blue is almost too bright to be real.",
			"There's the kingfisher, dead still, watching the water. Patience, and then a splash.",
		},
		note: []string{"A kingfisher's blue isn't pigment at all. It's light itself, scattered by the feathers."},
	},
	"golden_oriole": {
		hear: []string{
			"That rich, fluting whistle is a golden oriole. It sounds like somewhere much further south.",
			"An oriole, singing from the treetops. Liquid, golden, and very hard to pin down.",
		},
		watch: []string{
			"A golden oriole. All that gold, and still it manages to vanish into the leaves.",
			"There's the oriole, high in the canopy. A bird that seems lit from within.",
		},
		note: []string{"Golden orioles spend the winter in Africa. They come for the summer, and then they're gone again."},
	},
	"mallard": {
		hear: []string{
			"That loud quacking is a female mallard. The males, oddly, can only manage a quiet rasp.",
			"Mallards, chuntering away on the water. A comfortable, familiar sound.",
		},
		watch: []string{
			"A mallard drake, that glossy green head catching the light. Commonplace, and quite magnificent.",
			"There's the mallard, upending to feed. Tail to the sky, head among the weeds.",
		},
		note: []string{"Nearly every farmyard duck in the world is descended from the mallard."},
	},
	"common_moorhen": {
		hear: []string{
			"That abrupt, gargling call from the reeds is a moorhen.",
			"A moorhen, complaining from the water's edge. They always sound mildly startled.",
		},
		watch: []string{
			"A moorhen, flicking its white tail with every step. That red bill shield looks freshly painted.",
			"There's the moorhen, picking its way across the weed on those enormous green feet.",
		},
		note: []string{"Young moorhens from an early brood often help feed their younger brothers and sisters. A family business."},
	},
	"grey_heron": {
		hear: []string{
			"That harsh, croaking frank is a grey heron. Not a bird known for its singing.",
			"A heron, protesting loudly at being disturbed.",
		},
		watch: []string{
			"A grey heron, standing in the shallows like a patient old gentleman waiting for a bus.",
			"There's the heron, utterly motionless. Then a stab, and it's swallowing something whole.",
		},
		note: []string{"Herons nest together high in the treetops. A great untidy village of sticks, quite unexpected."},
	},
	"eurasian_reed_warbler": {
		hear: []string{
			"That chattering, scratchy rhythm in the reeds is a reed warbler, going on and on.",
			"A reed warbler, talking to itself among the stems. It never seems to finish a sentence.",
		},
		watch: []string{
			"A reed warbler, clasping two stems at once, legs splayed. A marsh gymnast.",
			"There's the reed warbler, plain and brown, which is exactly the point in a reedbed.",
		},
		note: []string{"Reed warblers weave their nests around living reed stems, so the whole cradle sways with the wind."},
	},
	"eurasian_bittern": {
		hear: []string{
			"That deep boom across the marsh is a bittern. Like someone blowing across the top of an enormous bottle.",
			"The bittern, booming. One feels it as much as hears it.",
		},
		watch: []string{
			"A bittern, neck stretched upward, swaying with the reeds. It believes it's invisible, and very nearly is.",
			"There's the bittern, every streak matching the reeds. I could lose it again in a blink.",
		},
		note: []string{"A bittern's boom can carry for miles on a still evening, yet the bird itself is almost never seen."},
	},
	"western_marsh_harrier": {
		hear: []string{
			"That thin, high call over the reeds is a marsh harrier.",
			"Marsh harriers calling. A pair, perhaps, keeping in touch above the marsh.",
		},
		watch: []string{
			"A marsh harrier, quartering the reeds low and slow, wings held in a shallow V.",
			"There's the harrier, tilting on the breeze, looking down for the slightest movement.",
		},
		note: []string{"Marsh harriers pass food in mid air. The male drops it, and the female flips over and catches it."},
	},
	"northern_wheatear": {
		hear: []string{
			"That hard chack, like two stones knocked together, is a wheatear.",
			"A wheatear, chattering from a rock somewhere up the slope.",
		},
		watch: []string{
			"A wheatear, bobbing on a boulder. Watch for the white rump when it flies.",
			"There's the wheatear, upright and alert, then off in a low dash to the next stone.",
		},
		note: []string{"Some wheatears fly from Africa to the far north every spring. Not bad for a bird you could hold in one hand."},
	},
	"common_raven": {
		hear: []string{
			"That deep, hollow cronk is a raven. One of the great voices of the high country.",
			"A raven, calling from the crags. It has a remarkable vocabulary, if one listens long enough.",
		},
		watch: []string{
			"A raven, tumbling over in flight, apparently for the sheer joy of it.",
			"There's the raven, enormous and glossy, with that shaggy throat and wedge of a tail.",
		},
		note: []string{"Ravens remember faces and hold grudges. It's best to stay on their good side."},
	},
	"ring_ouzel": {
		hear: []string{
			"That piping, plaintive song up here is a ring ouzel, the thrush of the high slopes.",
			"A ring ouzel, calling from the scree. A sound with a great deal of empty space around it.",
		},
		watch: []string{
			"A ring ouzel, with that white crescent across its breast like a bib.",
			"There's the ring ouzel, flicking between the rocks. Shy, and very much at home up here.",
		},
		note: []string{"Ring ouzels come up to the high slopes to breed, then head south, feasting on berries on the way."},
	},
	"golden_eagle": {
		hear: []string{
			"That thin yelping, high above, is a golden eagle. A small sound for such a large bird.",
			"A golden eagle, calling from somewhere over the ridge.",
		},
		watch: []string{
			"A golden eagle, turning on the updraft. Those long, fingered wings barely move.",
			"There's the eagle, golden across the nape, surveying the valley as if it owns it. Which it rather does.",
		},
		note: []string{"A pair of golden eagles may use the same nest for generations, adding sticks year after year."},
	},
	"herring_gull": {
		hear: []string{
			"That raucous, laughing call is a herring gull. The coast wouldn't sound like the coast without it.",
			"A herring gull, throwing back its head and yelling. Very little is said quietly at the seaside.",
		},
		watch: []string{
			"A herring gull, pink-legged and pale-backed, eyeing me as though I owe it lunch.",
			"There's the gull, riding the wind along the cliff with barely a twitch of the wing.",
		},
		note: []string{"That red spot on a herring gull's bill is a target. The chicks peck at it to ask for food."},
	},
	"eurasian_oystercatcher": {
		hear: []string{
			"That loud piping is an oystercatcher. They never do anything quietly.",
			"Oystercatchers, piping along the shore as though the tide were an emergency.",
		},
		watch: []string{
			"An oystercatcher, that carrot-orange bill probing the sand. Black, white and impossible to miss.",
			"There's the oystercatcher, prising open a shell with that bill. Very much a specialist.",
		},
		note: []string{"Young oystercatchers learn their parents' way of opening shells. Hammering or stabbing, it runs in the family."},
	},
	"great_cormorant": {
		hear: []string{
			"That low, guttural croak is a cormorant. They save their voices for the nest.",
			"A cormorant, grumbling from the rocks.",
		},
		watch: []string{
			"A cormorant, wings hung out to dry like washing on a line.",
			"There's the cormorant, riding low in the water. Then a neat little leap, and under it goes.",
		},
		note: []string{"Cormorant feathers soak up water, which helps them dive deep. Hence all that drying out afterwards."},
	},
	"atlantic_puffin": {
		hear: []string{
			"That low groaning from the burrows is a puffin. Not the sound you'd expect from such a cheerful face.",
			"Puffins, murmuring underground. Rather like a distant engine having a nap.",
		},
		watch: []string{
			"A puffin, that great striped bill full of tiny silver fish. However does it hold on to them all?",
			"There's the puffin, whirring in to land and getting it slightly wrong. Endearing, every time.",
		},
		note: []string{"Puffins spend the whole winter far out at sea, and only come ashore to nest. We're lucky to see one."},
	},
	"redwing": {
		hear: []string{
			"That thin, high seep overhead is a redwing, passing over. Autumn has truly arrived.",
			"A redwing, calling from the hedges. A small voice, all the way from the north.",
		},
		watch: []string{
			"A redwing, with that creamy eyebrow and the rusty red along its flanks.",
			"There's the redwing, stripping berries from the branch as fast as it can swallow them.",
		},
		note: []string{"Redwings migrate by night, calling to one another in the dark to stay together. Listen on a clear autumn evening."},
	},
	"brambling": {
		hear: []string{
			"That nasal, wheezing call is a brambling. A visitor from the north for the cold months.",
			"A brambling, calling from the beech litter.",
		},
		watch: []string{
			"A brambling, orange-breasted, with that white rump showing as it flies.",
			"There's the brambling, sifting through fallen beech mast. Every nut counts in winter.",
		},
		note: []string{"In a good beech mast year, bramblings gather in their thousands. In a poor one, you'll hardly see any."},
	},
	"hawfinch": {
		hear: []string{
			"That sharp, clipped tick is a hawfinch. Easy to dismiss, and you'd miss a great deal.",
			"A hawfinch, high in the treetops, quietly ticking.",
		},
		watch: []string{
			"A hawfinch, and what a bill. It can crack a cherry stone as though it were nothing.",
			"There's the hawfinch, bull-necked and handsome, sitting perfectly still at the very top of the tree.",
		},
		note: []string{"Hawfinches are wary and quiet, and spend most of their time up in the canopy. Seeing one well is a treat."},
	},
	"snow_bunting": {
		hear: []string{
			"That rippling, tinkling call over the snow is a snow bunting.",
			"Snow buntings, calling as the flock lifts and turns.",
		},
		watch: []string{
			"A snow bunting, white and buff, almost lost against the snow until it moves.",
			"There they go, snow buntings, swirling over the ground like blown snow.",
		},
		note: []string{"Snow buntings breed further north than nearly any other small bird. The cold is simply home."},
	},
	"rock_ptarmigan": {
		hear: []string{
			"That dry, rattling croak is a ptarmigan. It sounds like a stick drawn along a fence.",
			"A ptarmigan, grumbling from the rocks.",
		},
		watch: []string{
			"A ptarmigan, crouched among the stones. It trusts its camouflage completely, and rightly so.",
			"There's the ptarmigan, white as the snow it sits on. Even its feet are feathered.",
		},
		note: []string{"Ptarmigan change their plumage with the seasons. Mottled grey in summer, pure white in winter."},
	},
	"snowy_owl": {
		hear: []string{
			"That deep, booming hoot across the snow is a snowy owl.",
			"A snowy owl, calling low over the frozen ground. A sound I never expected to hear.",
		},
		watch: []string{
			"A snowy owl, white as the drifts, those golden eyes half closed against the glare.",
			"There's the snowy owl, sitting on a hummock as though waiting for the whole world to come to it.",
		},
		note: []string{"Snowy owls hunt by day as well as by night. In the far north, in summer, there's no night to speak of."},
	},
}

// shapeBank holds fallback lines for identified species without their own lines,
// keyed by Traits.Shape.
var shapeBank = map[string][]string{
	"songbird":   {"The {name}, perched and alert. Small birds live life at a gallop.", "There's the {name}. Plain at first glance, perhaps, but never dull."},
	"finch":      {"{aname}, and a bill built for seeds. A practical sort of bird.", "The {name}, cracking seeds with great efficiency."},
	"tit":        {"{aname}, never still for a moment.", "The {name}, inspecting every twig as though it's lost something."},
	"thrush":     {"{aname}, head cocked, listening to the ground.", "The {name}. Such a fine, upright bearing."},
	"warbler":    {"{aname}, flitting through the leaves. A restless little bird.", "The {name}, picking insects from the foliage one by one."},
	"woodpecker": {"{aname}, braced against the trunk.", "The {name}, tapping away at the bark."},
	"owl":        {"{aname}. Silent wings, sharp ears.", "The {name}, watching from the shadows."},
	"raptor":     {"{aname}, riding the air. Everything below is watching it.", "The {name}. A hunter, and every inch looks it."},
	"duck":       {"{aname}, paddling about without a care.", "The {name}, dabbling along the edge."},
	"heron":      {"{aname}, standing perfectly still. Patience itself.", "The {name}, all neck and intent."},
	"wader":      {"{aname}, probing the mud.", "The {name}, busy along the water's edge."},
	"gull":       {"{aname}, loud and entirely unbothered.", "The {name}, riding the breeze."},
	"corvid":     {"{aname}. Clever birds. Possibly cleverer than us.", "The {name}, looking at me as though it's working something out."},
	"seabird":    {"{aname}, perfectly at home on the sea.", "The {name}, out where the waves are."},
	"generic":    {"The {name}. Always good to see.", "{aname}, going about its day."},
}

func init() {
	pools := map[string][]string{}
	for id, s := range speciesBank {
		pools["sp."+id+".hear"] = s.hear
		pools["sp."+id+".watch"] = s.watch
		pools["sp."+id+".note"] = s.note
	}
	for k, v := range shapeBank {
		pools["shape."+k] = v
	}
	register(pools)
}
