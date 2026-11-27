package content

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Seasons for PlantYield.Seasons, in the order of the array.
const (
	spring = iota
	summer
	autumn
	winter
)

// seasons builds a PlantYield.Seasons array from the seasons it bears in.
func seasons(in ...int) [4]bool {
	var s [4]bool
	for _, i := range in {
		s[i] = true
	}
	return s
}

func yield(item string, min, max int, in ...int) proto.PlantYield {
	return proto.PlantYield{Item: item, Seasons: seasons(in...), Min: min, Max: max}
}

var plantRegions = struct {
	green, marsh, wind, coast, amber, frost int
}{int(core.RegionGreenhollow), int(core.RegionMurmurMarsh), int(core.RegionWindpeak),
	int(core.RegionWhisperingCoast), int(core.RegionAmberwood), int(core.RegionFrostveil)}

// Plants returns the 18 forageable wild plants of contract §12, the herbarium's
// pages, in the order of the plant table. The descriptions are how a real forager
// would recognise each one; the cautions say what a real forager would want you to
// know. The slice is freshly built on each call.
func Plants() []proto.PlantDef {
	r := plantRegions
	return []proto.PlantDef{
		{
			ID: "bramble", Veg: int(core.VegBramble), Name: "Bramble (Blackberry)", Sci: "Rubus fruticosus agg.",
			Desc:    "A tangled, arching shrub with prickly stems that root where they touch the ground. Leaves are in threes or fives with toothed edges; flowers are white to pale pink with five petals. The fruit is a cluster of tiny glossy drupes, green, then red, then black when ripe.",
			Uses:    "Eaten raw, or cooked into bars, tarts and jam. A favourite of thrushes and blackbirds as well.",
			Caution: "Pick above knee height and away from the path. Leave the red ones: they are not ripe, and they are not wasted either.",
			Yields:  []proto.PlantYield{yield("blackberry", 1, 3, summer, autumn)},
			Regrow:  4, Regions: []int{r.green, r.amber, r.coast}, Habitat: "Woodland edges and sunny clearings", Icon: "seed",
		},
		{
			ID: "wild_strawberry", Veg: int(core.VegStrawberry), Name: "Wild Strawberry", Sci: "Fragaria vesca",
			Desc:    "A low plant with leaves in threes, each toothed and slightly hairy, and long red runners that creep along the ground. White five-petalled flowers give way to tiny, conical red fruits with the seeds on the outside.",
			Uses:    "Best eaten the moment they are picked: the flavour is a good deal more than a shop strawberry's. They are small, so a handful is a find.",
			Caution: "Do not confuse with the barren strawberry (Potentilla sterilis) whose fruit is dry and never red; wild strawberries come away easily and smell sweet.",
			Yields:  []proto.PlantYield{yield("wild_strawberry", 1, 2, summer)},
			Regrow:  3, Regions: []int{r.green, r.amber}, Habitat: "Sunny clearings and woodland banks", Icon: "seed",
		},
		{
			ID: "bilberry", Veg: int(core.VegBilberry), Name: "Bilberry", Sci: "Vaccinium myrtillus",
			Desc:    "A knee-high, wiry shrub with green angled stems and small, pale, oval leaves. Hanging pink-green bells in spring give way to single blue-black berries with a waxy bloom, and the juice stains hands and teeth purple.",
			Uses:    "Raw, or baked into a tart. Bilberries are the berry foragers remember: more flavour than a blueberry and a darker stain.",
			Caution: "Pick berries singly; do not strip the shrub. It is slow to recover from rough handling and its fruit feeds grouse and many small birds.",
			Yields:  []proto.PlantYield{yield("bilberry", 1, 3, summer, autumn)},
			Regrow:  5, Regions: []int{r.green, r.amber, r.wind, r.frost}, Habitat: "Pine woods and heather heath", Icon: "seed",
		},
		{
			ID: "elder", Veg: int(core.VegElder), Name: "Elder", Sci: "Sambucus nigra",
			Desc:    "A bushy, multi-stemmed shrub or small tree with corky grey bark and leaves of five to seven toothed leaflets. In spring it carries flat heads of tiny cream flowers with a sweet, musky scent; in autumn those are swapped for drooping clusters of shiny purple-black berries on red stalks.",
			Uses:    "Flowers make cordial; berries, well cooked, make syrup. Both are traditional, and the berries are a heavy autumn crop for birds, too.",
			Caution: "Only the flowers and cooked berries are safe. Raw berries, leaves, bark and stalks upset the stomach, and the stalks should be left behind.",
			Yields:  []proto.PlantYield{yield("elderflower", 1, 3, spring), yield("elderberry", 1, 3, autumn)},
			Regrow:  5, Regions: []int{r.green, r.marsh, r.amber}, Habitat: "Hedgerows, woodland edges and damp scrub", Icon: "tree",
		},
		{
			ID: "dog_rose", Veg: int(core.VegDogRose), Name: "Dog Rose", Sci: "Rosa canina",
			Desc:    "A scrambling shrub with long arching stems armed with hooked thorns. Flowers are pale pink and five-petalled with a boss of yellow stamens; the fruit is a glossy, oval scarlet hip that clings on into winter.",
			Uses:    "Rosehip syrup: famously rich in vitamin C. The hips ripen when the first frosts come, and a frost makes them sweeter.",
			Caution: "Never eat the hairy seeds inside; they irritate the mouth and gut. Syrup must be strained through fine cloth. Leave plenty of hips for the thrushes and waxwings.",
			Yields:  []proto.PlantYield{yield("rosehip", 1, 3, autumn, winter)},
			Regrow:  6, Regions: []int{r.green, r.coast, r.amber}, Habitat: "Hedgerows and woodland edges", Icon: "seed",
		},
		{
			ID: "hazel", Veg: int(core.VegHazel), Name: "Hazel", Sci: "Corylus avellana",
			Desc:    "A many-stemmed understorey shrub with round, softly hairy, double-toothed leaves. Yellow catkins hang from the bare twigs in late winter. Nuts grow in clusters of one to four, each in a ragged green husk that turns brown as it ripens.",
			Uses:    "Hazelnuts are good raw, better toasted, and keep for months. They are also what squirrels, jays and nuthatches are living on.",
			Caution: "Take only a few from each shrub and leave the rest for the wildlife. A nut with a tiny round hole has a grub in it: leave it.",
			Yields:  []proto.PlantYield{yield("hazelnut", 1, 3, autumn)},
			Regrow:  6, Regions: []int{r.green, r.amber}, Habitat: "Understorey of deciduous woodland", Icon: "tree",
		},
		{
			ID: "sweet_chestnut", Veg: int(core.VegChestnut), Name: "Sweet Chestnut", Sci: "Castanea sativa",
			Desc:    "A large tree with deeply spiralled, ridged bark and long, glossy, toothed leaves with a sharp point to every tooth. Nuts come two or three to a green case bristling with soft spines, and drop to the ground in autumn.",
			Uses:    "Roast them: score the shell with a knife first, or they burst. They are floury and sweet, and a well-known street food.",
			Caution: "Not a horse chestnut (conker). Sweet chestnut leaves are long and toothed, and the case has fine spines all over; a conker's case has a few stubby ones and the nut is round and bitter.",
			Yields:  []proto.PlantYield{yield("chestnut", 2, 3, autumn)},
			Regrow:  7, Regions: []int{r.amber}, Habitat: "Mature autumn forest", Icon: "tree",
		},
		{
			ID: "nettle", Veg: int(core.VegNettle), Name: "Stinging Nettle", Sci: "Urtica dioica",
			Desc:    "A tall, upright plant with square stems and heart-shaped, saw-edged opposite leaves, all covered in stinging hairs. Drooping tassels of tiny greenish flowers hang from the leaf joints in summer.",
			Uses:    "Young tops make soup and tea and taste like spinach with a mineral edge. Nettle beds are also where several butterflies lay their eggs.",
			Caution: "Wear gloves or pick with confidence from the tip. Cooking, or drying, removes the sting. Pick only the top few leaves of young plants, before flowering.",
			Yields:  []proto.PlantYield{yield("nettle", 1, 3, spring, summer)},
			Regrow:  3, Regions: []int{r.green, r.marsh, r.amber}, Habitat: "Damp, rich ground near streams and old clearings", Icon: "leaf",
		},
		{
			ID: "wild_garlic", Veg: int(core.VegWildGarlic), Name: "Wild Garlic (Ramsons)", Sci: "Allium ursinum",
			Desc:    "Broad, bright green, lance-shaped leaves with a single stalk each, carpeting a damp woodland floor and smelling strongly of garlic when crushed. In late spring it carries round white starry flower heads.",
			Uses:    "Leaves go into soups, pestos and flatbreads. The flavour is mild and green.",
			Caution: "Always crush a leaf and smell it. Lily-of-the-valley and lords-and-ladies look similar in leaf and are poisonous; neither smells of garlic.",
			Yields:  []proto.PlantYield{yield("wild_garlic", 2, 3, spring)},
			Regrow:  4, Regions: []int{r.green, r.amber}, Habitat: "Damp woodland floor in spring", Icon: "leaf",
		},
		{
			ID: "water_mint", Veg: int(core.VegWaterMint), Name: "Water Mint", Sci: "Mentha aquatica",
			Desc:    "A hairy, square-stemmed plant growing in shallow water and on wet banks, with oval toothed leaves, often flushed purple, and a strong minty smell when brushed. Pale lilac flowers cluster in a round head at the tip of each stem in late summer.",
			Uses:    "Fresh leaves make a refreshing tea, hot or cold.",
			Caution: "Pick leaves from plants growing in clean, flowing water, not stagnant puddles, and wash them.",
			Yields:  []proto.PlantYield{yield("water_mint", 2, 3, spring, summer, autumn)},
			Regrow:  3, Regions: []int{r.green, r.amber, r.marsh}, Habitat: "Stream and pond edges", Icon: "leaf",
		},
		{
			ID: "chamomile", Veg: int(core.VegChamomile), Name: "Chamomile", Sci: "Matricaria chamomilla",
			Desc:    "A feathery, finely divided, apple-scented plant with daisy-like flowers whose white petals bend back as they open, leaving a raised, hollow, golden cone. It grows in open, disturbed ground and on the edges of fields.",
			Uses:    "The flower heads, dried or fresh, make a gentle, calming tea.",
			Caution: "Check that the centre is hollow when you cut it in half: stinking mayweed looks similar but smells foul, and the cone is solid.",
			Yields:  []proto.PlantYield{yield("chamomile", 2, 3, summer)},
			Regrow:  4, Regions: []int{r.green, r.amber, r.coast}, Habitat: "Open meadows and field edges", Icon: "leaf",
		},
		{
			ID: "young_pine", Veg: int(core.VegYoungPine), Name: "Young Pine", Sci: "Pinus sylvestris",
			Desc:    "A small conifer with paired needles in bluish-green twists. In spring the tips of the branches carry pale, sticky candles of new growth, soft enough to bend between the fingers. Needles come two to a bundle.",
			Uses:    "The soft tips make a resinous, lemony tea with a clean, woody smell. Best in spring; usable all year.",
			Caution: "Not a yew: yew needles are flat, in two rows, and have red berry-like arils, and every part of it is poisonous. Take only the tips, never a whole branch, and only a few per tree.",
			Yields:  []proto.PlantYield{yield("pine_tips", 2, 3, spring, summer, autumn, winter)},
			Regrow:  5, Regions: []int{r.green, r.amber, r.wind}, Habitat: "Pine stands and open conifer woodland", Icon: "tree",
		},
		{
			ID: "chanterelle", Veg: int(core.VegChanterelle), Name: "Chanterelle", Sci: "Cantharellus cibarius",
			Desc:    "A golden-yellow, trumpet-shaped mushroom with a wavy cap. Instead of true gills the underside has blunt, forked ridges that run down the stem. It smells faintly of apricots and grows among moss under beech, oak and birch.",
			Uses:    "A delicate, peppery mushroom, good in a broth or fried gently in butter.",
			Caution: "Only pick what you can identify with certainty. The false chanterelle and the poisonous jack-o'-lantern have true, sharp gills instead of blunt ridges, and look similar at a distance. If in doubt, leave it.",
			Yields:  []proto.PlantYield{yield("chanterelle", 1, 2, summer, autumn)},
			Regrow:  6, Regions: []int{r.green, r.amber}, Habitat: "Mossy deciduous woodland", Icon: "egg",
		},
		{
			ID: "penny_bun", Veg: int(core.VegPorcini), Name: "Penny Bun", Sci: "Boletus edulis",
			Desc:    "A stout mushroom with a smooth, brown, bun-shaped cap, a thick, pale, swollen stem marked with a fine white net, and a white-to-olive sponge of pores underneath in place of gills. The flesh stays white when cut.",
			Uses:    "Meaty and nutty, and the best mushroom in a stew or broth.",
			Caution: "Only pick what you can identify with certainty. The bitter bolete (Tylopilus felleus) looks similar but has pink pores and a bitter taste that ruins a dish; the devil's bolete is poisonous when raw. If the pores are red or the flesh turns blue, leave it.",
			Yields:  []proto.PlantYield{yield("penny_bun", 1, 2, autumn)},
			Regrow:  7, Regions: []int{r.green, r.amber}, Habitat: "Mossy woodland under oak, beech and birch", Icon: "egg",
		},
		{
			ID: "sea_buckthorn", Veg: int(core.VegSeaBuckthorn), Name: "Sea Buckthorn", Sci: "Hippophae rhamnoides",
			Desc:    "A thorny, silvery-leaved shrub of dunes and cliffs with narrow, grey-green leaves and dense clusters of bright orange berries packed tight along the twigs.",
			Uses:    "A very sour, vitamin-rich berry, usually sweetened with honey and made into juice.",
			Caution: "The thorns are sharp: pick gently and pull the berries off one by one rather than breaking branches. It is a vital food for winter thrushes and waxwings.",
			Yields:  []proto.PlantYield{yield("sea_buckthorn", 1, 3, autumn, winter)},
			Regrow:  7, Regions: []int{r.coast}, Habitat: "Coastal dunes and cliff tops", Icon: "seed",
		},
		{
			ID: "samphire", Veg: int(core.VegSamphire), Name: "Marsh Samphire", Sci: "Salicornia europaea",
			Desc:    "A low, jointed, leafless succulent of salt marshes and muddy shores, with fleshy, bright green stems that look like miniature candelabras and turn red in autumn. It tastes salty when raw.",
			Uses:    "Briefly blanched, it makes a crisp, salty salad or side.",
			Caution: "Pick the tips only and cut rather than pull, so the plant is left in the mud. Only from clean, unpolluted marsh.",
			Yields:  []proto.PlantYield{yield("samphire", 2, 3, summer)},
			Regrow:  4, Regions: []int{r.coast, r.marsh}, Habitat: "Salt marsh and muddy shores", Icon: "leaf",
		},
		{
			ID: "cloudberry", Veg: int(core.VegCloudberry), Name: "Cloudberry", Sci: "Rubus chamaemorus",
			Desc:    "A knee-high, unarmed, creeping plant with a single stem and a few crinkled, kidney-shaped leaves, with one large white flower on top. The fruit ripens from red to amber, like a pale raspberry.",
			Uses:    "A rare and tart northern berry, treasured in Scandinavia, eaten fresh or kept as a preserve.",
			Caution: "Cloudberries ripen slowly and sit alone on the stem: pick only fully amber ones. The bogs they grow in are soft: stay on the firm ground between the hummocks.",
			Yields:  []proto.PlantYield{yield("cloudberry", 1, 2, summer)},
			Regrow:  8, Regions: []int{r.frost}, Habitat: "Wet, mossy bogs in the north", Icon: "seed",
		},
		{
			ID: "wild_thyme", Veg: int(core.VegWildThyme), Name: "Wild Thyme", Sci: "Thymus polytrichus",
			Desc:    "A low, creeping, mat-forming herb with tiny oval leaves on woody stems and round heads of purple-pink flowers that hum with bees. It smells powerfully of thyme and likes dry, sunny, stony banks.",
			Uses:    "A fragrant tea, and a seasoning for stews. Honey from thyme-feeding bees is highly prized.",
			Caution: "Bees depend on thyme in summer: take sprigs, not clumps, and leave some in flower.",
			Yields:  []proto.PlantYield{yield("wild_thyme", 2, 3, spring, summer, autumn)},
			Regrow:  3, Regions: []int{r.wind}, Habitat: "Dry, sunny banks and stony slopes", Icon: "leaf",
		},
	}
}

var plantIndex = func() map[string]int {
	m := map[string]int{}
	for i, p := range Plants() {
		m[p.ID] = i
	}
	return m
}()

// Plant looks up a plant by id.
func Plant(id string) (proto.PlantDef, bool) {
	i, ok := plantIndex[id]
	if !ok {
		return proto.PlantDef{}, false
	}
	return Plants()[i], true
}

// PlantByVeg looks up the plant drawn as a core.VegKind (18+).
func PlantByVeg(kind int) (proto.PlantDef, bool) {
	for _, p := range Plants() {
		if p.Veg == kind {
			return p, true
		}
	}
	return proto.PlantDef{}, false
}

// YieldsIn lists what a plant bears in a season (0 spring, 1 summer, 2 autumn,
// 3 winter); empty means it cannot be picked now.
func YieldsIn(plantID string, season int) []proto.PlantYield {
	var out []proto.PlantYield
	p, ok := Plant(plantID)
	if !ok || season < 0 || season > 3 {
		return out
	}
	for _, y := range p.Yields {
		if y.Seasons[season] {
			out = append(out, y)
		}
	}
	return out
}
