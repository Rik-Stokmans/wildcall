package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// The pinned catalogs of docs/contract.md and the task brief. Tests check the
// content's references against these lists and not against the other packages, which
// are built in parallel.

var pinnedSpecies = []string{
	"european_robin", "blue_tit", "great_tit", "common_blackbird", "eurasian_wren", "common_chaffinch",
	"great_spotted_woodpecker", "eurasian_jay", "eurasian_nuthatch", "eurasian_treecreeper", "tawny_owl",
	"common_buzzard", "song_thrush", "goldcrest", "long_tailed_tit", "eurasian_blackcap", "common_chiffchaff",
	"grey_wagtail", "common_kingfisher", "golden_oriole",
	"mallard", "common_moorhen", "grey_heron", "eurasian_reed_warbler", "eurasian_bittern", "western_marsh_harrier",
	"northern_wheatear", "common_raven", "ring_ouzel", "golden_eagle",
	"herring_gull", "eurasian_oystercatcher", "great_cormorant", "atlantic_puffin",
	"redwing", "brambling", "hawfinch",
	"snow_bunting", "rock_ptarmigan", "snowy_owl",
}

var pinnedItems = []string{
	"basic_binoculars", "starter_camera", "canvas_satchel", "trail_map", "field_clothes", "basic_recorder",
	"explorer_binoculars", "forgotten_journal", "historical_binoculars", "vintage_recorder", "explorers_lens",
	"naturalists_compass", "research_backpack", "film_roll", "seed_mix",
	// Ingredients: the 19 foraged yields and the pantry staples (contract §12).
	"blackberry", "wild_strawberry", "bilberry", "elderflower", "elderberry", "rosehip", "hazelnut", "chestnut",
	"nettle", "wild_garlic", "water_mint", "chamomile", "pine_tips", "chanterelle", "penny_bun", "sea_buckthorn",
	"samphire", "cloudberry", "wild_thyme", "oats", "honey", "flour",
	// Food.
	"pine_tip_tea", "mint_tea", "chamomile_tea", "thyme_honey_tea", "nettle_tea", "elderflower_cordial",
	"elderberry_syrup", "rosehip_syrup", "sea_buckthorn_juice", "berry_oat_bars", "hazelnut_trail_mix",
	"roasted_chestnuts", "cloudberry_preserve", "bilberry_tart", "nettle_soup", "wild_garlic_flatbread",
	"mushroom_broth", "forager_stew", "samphire_salad",
}

var pinnedPOIs = []string{
	"cabin", "npc_mara", "woodland_entrance", "shop_finn", "npc_finn", "old_oak", "creekside",
	"research_creekside", "npc_alder", "fern_valley", "meadow_clearing", "ranger_station", "npc_june",
	"old_watchtower", "hidden_pond", "hide_creek", "viewpoint_lookout", "hidden_cabin", "camp_survey",
	"cache_watchtower", "cache_hidden_cabin", "cache_camp", "page_0",
}

var pinnedSkills = []string{
	"keen_ears", "sound_direction", "acoustic_memory", "frequency_awareness", "deep_listening", "echo_reading",
	"natural_recognition", "sharp_eyes", "movement_recognition", "patience", "habitat_reading",
	"peripheral_awareness", "tracking", "natural_instinct", "steady_hands", "quick_shot", "focus_control",
	"silent_shutter", "wildlife_composition", "long_lens_mastery", "perfect_moment", "field_experience",
	"species_recognition", "habitat_knowledge", "seasonal_awareness", "behavioral_insight",
	"ecological_knowledge", "master_naturalist", "quiet_steps", "trail_sense", "weather_sense", "concealment",
	"campcraft", "wildlife_familiarity", "woodland_mastery",
}

// newProfile is a fresh beginner's profile.
func newProfile() *proto.Profile {
	return &proto.Profile{
		Name: "Test", Level: 1, Rank: 1, Credits: 60,
		Rep: map[string]int{}, Flags: map[string]bool{}, Quests: map[string]*proto.QuestState{},
		Journal: proto.Journal{
			Species: map[string]*proto.SpeciesEntry{}, Locations: map[string]*proto.LocEntry{},
			Collectibles: map[string]int{},
		},
	}
}

// setStatus forces quest statuses, as a save file would hold them.
func setStatus(p *proto.Profile, status string, ids ...string) {
	for _, id := range ids {
		p.Quests[id] = &proto.QuestState{Status: status, Progress: map[string]int{}}
	}
}

// afterTutorial is a profile that has handed in The Unseen Singer.
func afterTutorial() *proto.Profile {
	p := newProfile()
	setStatus(p, StatusTurnedIn, TutorialQuest)
	p.Rank = 2
	return p
}

// speciesEntry records an identified species in the journal.
func speciesEntry(p *proto.Profile, id string, level int, method string) {
	p.Journal.Species[id] = &proto.SpeciesEntry{ID: id, Level: level, Method: method}
}

var noPlace = At{}
