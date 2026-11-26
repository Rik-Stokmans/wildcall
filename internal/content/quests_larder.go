package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// larderQuests are the foraging and cooking errands (contract §12): two from Mara,
// one from June and a contract on the cabin board. None of them depends on the
// season, so none can strand the player: every objective can be done any time of
// the year (pine tips, water mint and the like) or with whatever is in season.
func larderQuests() []proto.QuestDef {
	return []proto.QuestDef{
		{
			ID: "tea_at_the_cabin", Name: "Tea at the Cabin", Category: CatExploration, Giver: NPCMara,
			Summary:  "Pick three different wild plants, cook something at the cabin kettle and eat it.",
			Story:    "Mara has a theory that a naturalist who has never boiled a kettle in the woods has not really been in them. She wants you to pick a few things the wood has on offer, make something hot with them, and sit down and drink it. Slowly. It is quite as much a part of the job as the binoculars.",
			Requires: []string{TutorialQuest}, Ordered: true,
			Objectives: []proto.ObjectiveDef{
				o("pick", KindForage, TargetAny, 3, "Pick from three different wild plants",
					"Press E close to a plant that has something to give. Brambles, hazel, nettle, mint by the creek and pine tips all grow in the valley; what is ready depends on the season. Check your Herbarium page first if you are unsure.",
					ParamDistinct, "true"),
				o("cook", KindCook, TargetAny, 1, "Cook something at the cabin kettle",
					"Go back to the cabin and press E at the kitchen. You know pine-tip tea, mint tea and oat bars already; the oat bars need honey and oats from Finn."),
				o("eat", KindEat, TargetAny, 1, "Eat or drink it",
					"Open your pack and use it. A drink lasts a few hours, and a new drink replaces the last.",
					ParamSlot, "drink|snack|meal"),
			},
			Rewards: proto.Reward{
				XP: 150, Credits: 60,
				Rep:  map[string]int{FactionNaturalists: 15},
				Lore: []string{"pick_with_care"},
			},
		},
		{
			ID: "a_meal_from_the_wood", Name: "A Meal from the Wood", Category: CatExploration, Giver: NPCMara,
			Summary:  "Cook three different dishes and sit down to a proper meal.",
			Story:    "A cup of tea is a start. Mara wants to see a proper meal come out of the cabin kitchen: three different things from three different pots, of whatever you have found. She has a page in her own notes about a stew the old keepers used to make, and she will give it to you if you cook for her.",
			Requires: []string{"tea_at_the_cabin"},
			Objectives: []proto.ObjectiveDef{
				o("dishes", KindCook, TargetAny, 3, "Cook three different recipes",
					"Learn new recipes by picking new plants for the first time, or by asking Mara and Finn. Each dish has to be a different one. The stove at the cabin opens up the baked recipes.",
					ParamDistinct, "true"),
				o("meal", KindEat, TargetAny, 1, "Eat a hot meal",
					"Soups, broths, flatbread and stew are meals. Nettle soup needs nettle, wild garlic and oats, all of which like the damp ground at the edge of the wood in spring.",
					ParamSlot, "meal"),
			},
			Rewards: proto.Reward{
				XP: 220, Credits: 90,
				Rep:  map[string]int{FactionNaturalists: 20, FactionOutfitters: 10},
				Lore: []string{"keepers_stew"},
			},
		},
		{
			ID: "a_fair_share", Name: "A Fair Share", Category: CatConservation, Giver: NPCJune,
			Summary:  "Forage five different wild plants in the valley, taking only a little from each.",
			Story:    "June has seen too many pickers strip a bush for one jar. She would like you to show it can be done properly: five different plants in the valley, a little from each, and something eaten on the spot, the way you would do it on a long walk.",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("plants", KindForage, TargetAny, 5, "Pick from five different plants in Greenhollow",
					"Hedgerows and clearings first: bramble, strawberry, hazel, elder, rose. Wet ground for nettle and mint. A plant gives a few things at a time, and rests for days after.",
					ParamDistinct, "true", ParamRegion, "greenhollow"),
				o("snack", KindEat, TargetAny, 1, "Eat something you picked yourself",
					"Raw berries and nuts are good as they are. Press E on the item in your pack.",
					ParamSlot, "snack"),
			},
			Rewards: proto.Reward{
				XP: 160, Credits: 80,
				Rep:  map[string]int{FactionRangers: 20},
				Lore: []string{"fair_share"},
			},
		},
		{
			ID: "contract_volunteer_tea", Name: "Contract: Tea for the Volunteers", Category: CatConservation, Giver: BoardGiver,
			Summary:  "The ranger station wants a big pot of tea for its volunteer counters: three batches of any hot drink.",
			Story:    "Posted by the Greenhollow Ranger Station: \"Dawn count on Saturday. Volunteers will be on the hide by five and nothing will be open. Wanted: three batches of tea, cordial or syrup, cooked at the cabin or a camp kettle. We pay in credits; you may keep the leftovers.\"",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("batches", KindCook, TargetAny, 3, "Cook three batches of a hot drink",
					"Teas, cordials and syrups all count. A batch is one pot: cook a recipe with a quantity of three if you have the ingredients.",
					ParamSlot, "drink"),
			},
			Rewards: proto.Reward{XP: 120, Credits: 110, Rep: map[string]int{FactionRangers: 15, FactionOutfitters: 5}},
		},
	}
}
