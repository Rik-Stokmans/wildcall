package narrator

// Activity mumbles (docs/contract.md §13): short, first-person, in-the-moment asides
// for the things the player does — picking plants, cooking and tasting, filling the
// pack, collecting finds, climbing, wading, sheltering, sitting, finding nests, raising
// the binoculars on nothing and running out of film. Muttered, warm and brief.
//
// Pool keys use the pinned ids of §12: forage.<plant id>, forage.yield.<ingredient id>,
// cook.<food id>, eat.<food or ingredient id>, nest.<site>.
//
// Nest lines never name or classify the owner: only nest.known (reachable only with
// Event.Known, i.e. an identified species) uses {name}/{aname}.

// PlantIDs are the forage plant ids of §12 (every one has its own forage pool).
var PlantIDs = []string{
	"bramble", "wild_strawberry", "bilberry", "elder", "dog_rose", "hazel", "sweet_chestnut",
	"nettle", "wild_garlic", "water_mint", "chamomile", "young_pine", "chanterelle",
	"penny_bun", "sea_buckthorn", "samphire", "cloudberry", "wild_thyme",
}

// FoodIDs are the prepared foods of §12 (every one has a cook and an eat pool).
var FoodIDs = []string{
	"pine_tip_tea", "mint_tea", "chamomile_tea", "thyme_honey_tea", "nettle_tea",
	"elderflower_cordial", "elderberry_syrup", "rosehip_syrup", "sea_buckthorn_juice",
	"berry_oat_bars", "hazelnut_trail_mix", "roasted_chestnuts", "cloudberry_preserve",
	"bilberry_tart", "nettle_soup", "wild_garlic_flatbread", "mushroom_broth",
	"forager_stew", "samphire_salad",
}

// RawFoodIDs are ingredients with their own "eaten raw" lines. Any other ingredient
// eaten as it is gets the generic eat.raw lines.
var RawFoodIDs = []string{
	"blackberry", "wild_strawberry", "bilberry", "cloudberry", "sea_buckthorn", "hazelnut", "chestnut",
}

// NestSites are the core.NestInfo.Site values with their own nest pools ("none" has none).
var NestSites = []string{
	"cavity", "cup_shrub", "cup_fork", "platform", "dome", "pendant", "ground", "scrape",
	"reed", "floating", "burrow", "ledge",
}

func init() {
	register(map[string][]string{
		// ---- Picking (forage.<plant id>) ----
		"forage.bramble": {
			"Mm. Blackberries. One for the pot, one for me.",
			"Brambles. Worth every scratch, these.",
			"Blackberries, warm from the sun. Mind the thorns.",
		},
		"forage.wild_strawberry": {
			"Wild strawberries. Tiny, and better than any in a shop.",
			"Mm. Little strawberries, hiding under their leaves.",
			"A handful of wild strawberries. Summer in miniature.",
		},
		"forage.bilberry": {
			"Bilberries. Purple fingers for the rest of the day, I expect.",
			"Mm, bilberries. Low little bushes, and every berry hard won.",
			"Bilberries. Good for the eyes at dusk, so they say.",
		},
		"forage.elder": {
			"Elder. Generous old tree, this.",
			"From the elder. It gives twice a year, if one is patient.",
			"A bit of elder. Smells of hedgerows and old summers.",
		},
		"forage.yield.elderflower": {
			"Elderflower. That smell. Like summer being uncorked.",
			"Creamy elderflower heads. Shake out the beetles first.",
		},
		"forage.yield.elderberry": {
			"Elderberries. Never raw, mind. They want cooking.",
			"Dark elderberry clusters. Into the syrup with you.",
		},
		"forage.dog_rose": {
			"Rosehips. Mind the hairy seeds inside. They're no fun at all.",
			"Hips from the dog rose. Bright as little lanterns.",
			"Rosehips. Better after a frost, they say.",
		},
		"forage.hazel": {
			"Hazelnuts. I'd best take them before the squirrels do.",
			"A few hazelnuts, rattling nicely in the husk.",
			"Cobnuts. The squirrels won't miss a handful. Probably.",
		},
		"forage.sweet_chestnut": {
			"Sweet chestnuts. Prickly cases, lovely insides.",
			"Chestnuts. Mind the fingers. Those cases bite.",
			"A pocketful of chestnuts. Roasted, later. Oh yes.",
		},
		"forage.nettle": {
			"Nettles. Gently, gently. Pinch the top leaves and hope.",
			"Young nettle tops. They lose their sting in the pot.",
			"Ow. Well. Nettles. Worth it for the soup.",
		},
		"forage.wild_garlic": {
			"Wild garlic. I could smell it from the path.",
			"Ramsons. The whole wood smells of supper.",
			"Wild garlic leaves. My hands will smell of it till tomorrow.",
		},
		"forage.water_mint": {
			"Water mint. Crush a leaf and the whole bank wakes up.",
			"A bit of mint from the water's edge. Lovely and sharp.",
			"Water mint. Smells like a cool drink on a hot day.",
		},
		"forage.chamomile": {
			"Chamomile. Little daisy faces that smell of apples.",
			"A few chamomile heads, for a quiet cup later.",
			"Chamomile. Calming just to pick, somehow.",
		},
		"forage.young_pine": {
			"Pine tips. Bright green and tasting of lemon. Who'd have thought?",
			"A few soft pine tips. The tree won't mind.",
			"Fresh pine tips. Resin on my fingers now.",
		},
		"forage.chanterelle": {
			"Chanterelles. Golden, and smelling faintly of apricots.",
			"Ah, chanterelles. Little golden trumpets in the moss.",
			"Chanterelles. Cut, don't pull. Leave some for next year.",
		},
		"forage.penny_bun": {
			"A penny bun. Fat and brown, like a bread roll in the leaves.",
			"A cep. Now that's a find worth a little dance.",
			"A penny bun. Firm, and clean underneath. Lovely.",
		},
		"forage.sea_buckthorn": {
			"Sea buckthorn. Sour as anything, and very good for you.",
			"Careful of the thorns. Sea buckthorn doesn't give its berries lightly.",
			"Sea buckthorn. Like little drops of sunshine.",
		},
		"forage.samphire": {
			"Samphire. Salty little fingers from the mud.",
			"A handful of samphire. Tastes of the sea, more or less.",
			"Samphire. Snip the tops, leave the roots.",
		},
		"forage.cloudberry": {
			"Cloudberries. Hard to find, and worth every step.",
			"A cloudberry, amber and soft. The bog's best secret.",
			"Cloudberries. One at a time, out here. Each one a small treasure.",
		},
		"forage.wild_thyme": {
			"Wild thyme. Crushed underfoot, it smells like a kitchen.",
			"A sprig of thyme. The bees aren't pleased with me.",
			"Wild thyme. The whole slope smells warm.",
		},
		"forage.any": {
			"Into the pack it goes.",
			"A little something for later.",
			"Thank you kindly. Just a few.",
		},

		// ---- Cooking (cook.<food id>) ----
		"cook.pine_tip_tea": {
			"Pine tip tea. Smells like a forest after rain.",
			"Kettle on. Pine tips in. Patience.",
		},
		"cook.mint_tea": {
			"Mint tea. Bright enough to wake the dead. Or at least me.",
			"A pot of mint tea. The steam alone clears the head.",
		},
		"cook.chamomile_tea": {
			"Chamomile tea. A gentle drink for a gentle sort of afternoon.",
			"Chamomile, steeping. Already I feel slower.",
		},
		"cook.thyme_honey_tea": {
			"Thyme and honey. The old remedy for everything.",
			"Thyme tea with a spoon of honey. Warming, that.",
		},
		"cook.nettle_tea": {
			"Nettle tea. Green and earthy. Good for whatever ails one.",
			"Nettles in the pot. No sting left in them now.",
		},
		"cook.elderflower_cordial": {
			"Elderflower cordial. Summer in a bottle.",
			"Elderflowers, sugar and patience. The kitchen smells wonderful.",
		},
		"cook.elderberry_syrup": {
			"Elderberry syrup, simmering dark and glossy.",
			"Elderberries cooked down nice and slow. That's the way.",
		},
		"cook.rosehip_syrup": {
			"Rosehip syrup. Strain it well, mind. Twice, to be safe.",
			"Rosehips bubbling away. Smells of autumn.",
		},
		"cook.sea_buckthorn_juice": {
			"Sea buckthorn juice. Sharp enough to make my eyes water.",
			"Pressing sea buckthorn. Orange everywhere. Lovely mess.",
		},
		"cook.berry_oat_bars": {
			"Berry and oat bars. Sticky fingers, full pockets.",
			"Oats, berries, a little honey. Walking food.",
		},
		"cook.hazelnut_trail_mix": {
			"Toasted hazelnuts for the trail. A handful keeps the legs going.",
			"Hazelnuts and a few berries. Pocket food, the very best kind.",
		},
		"cook.roasted_chestnuts": {
			"Roasting chestnuts. Is there a better smell in all the world?",
			"Chestnuts on the fire. Score them first, or they pop.",
		},
		"cook.cloudberry_preserve": {
			"Cloudberry preserve. Precious stuff. I'll ration it.",
			"Cloudberries and a little sugar. A jar of gold.",
		},
		"cook.bilberry_tart": {
			"Bilberry tart. Purple to the elbows, and worth it.",
			"A bilberry tart. The pastry's a bit rustic. The filling isn't.",
		},
		"cook.nettle_soup": {
			"Nettle soup. Green, hot, and far nicer than it sounds.",
			"Nettles, a few oats, a long simmer. Proper field cooking.",
		},
		"cook.wild_garlic_flatbread": {
			"Wild garlic flatbread. The whole place smells glorious.",
			"Flatbread with wild garlic. Simple, and exactly right.",
		},
		"cook.mushroom_broth": {
			"Mushroom broth. Rich and earthy. Just the thing.",
			"Mushrooms in the pot. The smell of an autumn wood.",
		},
		"cook.forager_stew": {
			"A forager's stew. A bit of everything the woods could spare.",
			"Stew, slow and patient. Rather like birdwatching.",
		},
		"cook.samphire_salad": {
			"Samphire salad. Salty, crunchy, tastes of the shore.",
			"A little samphire salad. Bright and briny.",
		},
		"cook.any": {
			"Something warm on the go. Lovely.",
			"Into the pot. The waiting is half the pleasure.",
			"There. Done, and it smells wonderful.",
		},

		// ---- Eating and drinking (eat.<food or ingredient id>) ----
		"eat.pine_tip_tea": {
			"Mm. Pine tip tea. Steady hands for the camera now.",
			"Tastes of resin and lemon. Rather good, actually.",
		},
		"eat.mint_tea": {
			"Ah. Mint tea. Every sound seems a little sharper.",
			"Mm. That wakes the ears up.",
		},
		"eat.chamomile_tea": {
			"Chamomile. Everything slows down a little. Me included.",
			"Mm. Calm as a millpond.",
		},
		"eat.thyme_honey_tea": {
			"Thyme and honey. Warm right down to the boots.",
			"Mm. Sweet, herby, and very comforting.",
		},
		"eat.nettle_tea": {
			"Nettle tea. Grassy and honest. Does one good.",
			"Mm. Tastes green. In a good way.",
		},
		"eat.elderflower_cordial": {
			"Elderflower cordial. Oh, that's lovely.",
			"Mm. Like drinking a hedgerow in June.",
		},
		"eat.elderberry_syrup": {
			"Elderberry syrup. Rich and dark. Keeps the chill out.",
			"Mm. Deep, fruity, warming.",
		},
		"eat.rosehip_syrup": {
			"Rosehip syrup. Tart and sweet at once.",
			"Mm. Tastes like autumn sunshine.",
		},
		"eat.sea_buckthorn_juice": {
			"Ooh, that's sharp. Very sharp. Wonderfully sharp.",
			"Sea buckthorn. My whole face woke up.",
		},
		"eat.berry_oat_bars": {
			"An oat bar. Good honest walking food.",
			"Mm. Chewy, sweet, and it keeps the legs going.",
		},
		"eat.hazelnut_trail_mix": {
			"A handful of nuts. Fuel for the long way round.",
			"Mm. Crunchy. That'll keep me going a while.",
		},
		"eat.roasted_chestnuts": {
			"Hot chestnuts. Burnt my fingers, and I don't care.",
			"Mm. Sweet and floury. Proper winter food.",
		},
		"eat.cloudberry_preserve": {
			"Cloudberry preserve. Oh, my. That's worth the bog.",
			"Mm. Tart, golden, extraordinary.",
		},
		"eat.bilberry_tart": {
			"Bilberry tart. Blue teeth, I expect. Worth it.",
			"Mm. That's a very good tart, if I say so myself.",
		},
		"eat.nettle_soup": {
			"Nettle soup. Hot and green. The rain can do as it likes now.",
			"Mm. Warms one right through.",
		},
		"eat.wild_garlic_flatbread": {
			"Garlic flatbread. Nobody will want to stand near me now.",
			"Mm. Garlicky and warm. Lovely.",
		},
		"eat.mushroom_broth": {
			"Mushroom broth. Rich as anything. The cold can wait.",
			"Mm. Earthy and warming.",
		},
		"eat.forager_stew": {
			"Stew. A proper hot meal. Bring on the weather.",
			"Mm. Everything the woods gave, all in one bowl.",
		},
		"eat.samphire_salad": {
			"Samphire. Salty and crisp. Lovely with the sea air.",
			"Mm. Tastes like a day at the coast.",
		},
		// Raw berries and nuts.
		"eat.blackberry": {
			"Mm. Blackberry. Still warm from the sun.",
			"One for the pot, one for me. Well. One for me.",
		},
		"eat.wild_strawberry": {
			"A wild strawberry. Tiny, and full of summer.",
			"Mm. Sweeter than any garden one.",
		},
		"eat.bilberry": {
			"Bilberries. Purple tongue, I expect.",
			"Mm. Little bursts of sharp sweetness.",
		},
		"eat.cloudberry": {
			"A cloudberry. Like honey and apricots, somehow.",
			"Mm. That was worth the wet boots.",
		},
		"eat.sea_buckthorn": {
			"Sea buckthorn, raw. Oh. Oh, that's sour.",
			"Sour enough to make one whistle. Good for me, though.",
		},
		"eat.hazelnut": {
			"A hazelnut. Crack. Mm, sweet and milky.",
			"A fresh hazelnut. The squirrels have good taste.",
		},
		"eat.chestnut": {
			"A raw chestnut. Bit crunchy. Better roasted, really.",
			"Mm. Chestnut. I should have waited for the fire.",
		},
		"eat.raw": {
			"Mm. Straight from the wild. The best way.",
			"A little nibble. That'll do nicely.",
			"Mm. Not bad at all.",
		},
		"eat.any": {
			"Mm. That's better.",
			"Ah. Just what I needed.",
			"Lovely. Back to it, then.",
		},

		// ---- The pack ----
		"pack.full": {
			"Pack's full. I'll have to eat something, or leave something.",
			"No more room. Even my pockets are full.",
			"That's the pack full. Time to head home, perhaps.",
			"Full up. The pack, I mean. Not me.",
		},

		// ---- Collecting finds (collect.<item>) ----
		"collect.feather": {
			"A feather. Somebody's lost a bit of their coat.",
			"A feather. I'll press it in the notebook.",
			"Look at the barbs on that. Beautiful thing, a feather.",
			"A feather, light as nothing. Into the journal.",
		},
		"collect.page": {
			"A journal page. Someone else's careful notes.",
			"Old handwriting, faded. Another naturalist, long before me.",
			"A page from somebody's notebook. I'll read it properly later.",
			"Notes and little sketches. Somebody loved this place too.",
		},
		"collect.relic": {
			"An old relic. I wonder who left this here.",
			"Now that's been here a while. Into the pack, gently.",
			"A little piece of somebody's story.",
		},
		"collect.cache": {
			"An old cache. Let's see what's inside.",
			"A tin box, tucked out of the weather. Somebody meant to come back.",
			"Careful. Old hinges.",
			"A cache. Like a present from a stranger.",
		},
		"collect.any": {
			"Something worth keeping.",
			"Into the pack, carefully.",
		},

		// ---- Moving through the world ----
		"climb.watchtower": {
			"Up the ladder. Mind the rungs.",
			"Oof. Quite a climb. Quite a view, though.",
			"From up here, the whole valley's breathing.",
			"The top. Now, let's just listen for a while.",
		},
		// ---- The first quest's beats (never name the singer) ----
		"tutorial.singer_heard": {
			"There. That loud, rattling little song. That's the one Mara meant.",
			"Listen to that. A big voice from somewhere low down. That's our singer.",
			"That's it, I'd put money on it. Low in the tangle, and not at all shy about singing.",
		},
		"tutorial.singer_raised": {
			"Gently now. Something small, low in the cover. Give it a moment to show itself.",
			"Steady. Let it come to the edge of the leaves on its own.",
			"Could that be our singer? Watch it, don't chase it.",
		},
		"tutorial.first_stars": {
			"A photograph with a bird in it, and in focus. That's the start of a collection.",
			"Our first proper photograph. That one deserves a place on the wall.",
			"That's a keeper. Everyone remembers their first.",
		},
		"climb.any": {
			"Up we go.",
			"Well. That was a climb.",
		},
		"wade": {
			"Cold. Very cold. Lovely, really.",
			"Wet boots again. Never mind.",
			"Into the water. Slowly, so as not to scare anything.",
			"The creek's colder than it looks. It always is.",
			"Paddling. One of the privileges of the job.",
		},
		"shelter": {
			"Under here till it passes. Listen to it drum.",
			"A dry spot. Rain on the leaves sounds like applause.",
			"Shelter. Everything out there is doing the same, I expect.",
			"I'll wait it out. The rain can't last forever. Probably.",
			"Snug enough. Rain makes everything smell new.",
		},
		"sit": {
			"I'll sit a while. Let the place forget I'm here.",
			"Sitting down. The best way to see anything is to stop looking for it.",
			"Ah. That's better. Now, quiet.",
			"A little sit. Ears open.",
			"Down I go. Let's see who comes to me.",
		},

		// ---- Gear ----
		"binoculars.empty": {
			"Nothing. Just leaves.",
			"Hm. A lovely view of a branch.",
			"Empty. Whatever it was has gone.",
			"Nothing there. Or nothing that wants to be seen.",
			"Just sky. Lovely sky, mind.",
			"Nobody home.",
		},
		"film.out": {
			"Out of film. Of course. Of course that's when.",
			"No film left. I'll just have to remember this one.",
			"That's the last frame. I'll need more film from the cabin.",
			"Out of film. Well, the eyes still work.",
		},

		// ---- Nests (by site; never names or classifies the owner) ----
		"nest.cavity": {
			"A neat hole in the trunk. Somebody's front door.",
			"A nest hole. Very discreet, very snug.",
			"A hollow in the tree. I'll keep my distance and watch it.",
		},
		"nest.cup_shrub": {
			"A little cup of a nest, tucked into the bush. Beautifully made.",
			"A nest, low in the shrub. Moss, grass, and a great deal of care.",
			"Oh. A nest, right there in the bush. Gently, now.",
		},
		"nest.cup_fork": {
			"A cup nest, wedged in the fork of a branch. Clever.",
			"Up in the fork. A neat little cup of a nest.",
			"A nest, braced in the crook of a branch. Sturdy work.",
		},
		"nest.platform": {
			"That big bundle of sticks up there is a nest. A huge one.",
			"A great platform of sticks, high in the crown. Somebody big lives there.",
			"A stick nest. Built up over years, I should think.",
		},
		"nest.dome": {
			"A little ball of a nest, with a door in the side. Charming.",
			"A domed nest, woven tight. Like a tiny hut.",
			"A round nest with a roof on. Somebody likes their privacy.",
		},
		"nest.pendant": {
			"A tiny nest, hanging under the branch like a hammock.",
			"Slung beneath the bough. Moss and cobweb, I think.",
			"A little hanging nest. How does it hold together?",
		},
		"nest.ground": {
			"Careful. A nest on the ground, right there.",
			"A nest in the grass. Easy to step on. Let's not.",
			"Tucked into the ground. Hidden in plain sight.",
		},
		"nest.scrape": {
			"A bare scrape on the ground. That's a nest, believe it or not.",
			"Just a hollow in the ground. Not much of a house, but it works.",
			"A scrape. The eggs would look just like the stones.",
		},
		"nest.reed": {
			"A nest woven between the reed stems. Swaying, but quite safe.",
			"Look, among the reeds. A woven cup, slung between the stems.",
			"A reed nest. Beautiful basketwork.",
		},
		"nest.floating": {
			"A floating nest, anchored in the reeds. Clever.",
			"A heap of weed on the water. That's a nest, that is.",
			"A nest on the water. It rises and falls with the level.",
		},
		"nest.burrow": {
			"A tunnel in the bank. Somebody's burrow.",
			"A neat burrow entrance. I'll not poke my nose in.",
			"A hole in the earth. A home, by the look of the tracks.",
		},
		"nest.ledge": {
			"A nest on the ledge, right on the cliff. No fear of heights there.",
			"Up on the ledge. A nest with quite a view.",
			"A ledge nest. Brave little household.",
		},
		"nest.stage.building": {
			"Still being built, by the look of it.",
			"Fresh material. A home in progress.",
		},
		"nest.stage.eggs": {
			"Eggs, I think. I'll back away, quietly.",
			"Someone's sitting tight. Best leave them be.",
		},
		"nest.stage.chicks": {
			"Chicks. Listen to them demanding supper.",
			"Hungry chicks in there. The parents won't be far.",
		},
		"nest.stage.old": {
			"An old nest, from last year. Empty now.",
			"Last season's nest. Still tidy, after all that weather.",
		},
		"nest.any": {
			"A nest. I'll keep my distance.",
			"A nest. Worth noting, and leaving well alone.",
		},
		// An identified species' nest: the only nest pool that may name a bird.
		"nest.known": {
			"{aname}'s nest. I'd know it anywhere now.",
			"The {name} has nested here. Lovely.",
			"That nest belongs to {aname}, I'm sure of it. Gently does it.",
		},
	})
}
