package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// NPCs returns the four characters of spec §16, with the ids, roles, factions and
// POIs pinned by the contract.
func NPCs() []proto.NPCDef {
	return []proto.NPCDef{
		{
			ID: NPCMara, Name: "Mara", Role: "Veteran Naturalist", Faction: FactionNaturalists, POI: "npc_mara",
			Bio: "Mara has walked Greenhollow for forty years and kept a journal for every one of them. She learned her craft from the old fire-watch keeper, and she teaches it the same way: she will show you how to listen, and then she will not tell you the answer.",
			Look: proto.NPCLook{
				Skin: "#c99873", Hair: "#b9b4a8", Coat: "#5c7a52", Trim: "#d9c7a0",
				Hat: "brim", Prop: "binoculars", Height: 1.64, Build: 0.95,
			},
		},
		{
			ID: NPCFinn, Name: "Finn", Role: "Equipment Specialist", Faction: FactionOutfitters, POI: "npc_finn",
			Bio: "Finn runs Field Supply from a stall by the Woodland Entrance and has personally dropped, soaked or sat on most of what he sells. He will always tell you what a piece of kit is bad at before he takes your credits.",
			Look: proto.NPCLook{
				Skin: "#e0b08a", Hair: "#8a4f2a", Coat: "#c9743a", Trim: "#554537",
				Hat: "cap", Prop: "toolbelt", Height: 1.84, Build: 1.2,
			},
		},
		{
			ID: NPCAlder, Name: "Professor Alder", Role: "Researcher", Faction: FactionResearch, POI: "npc_alder",
			Bio: "Professor Alder keeps the Creekside Field Lab: one tent, one creek and thirty years of other people's notebooks. He is precise, dry, and quietly delighted by anything that does not fit the records.",
			Look: proto.NPCLook{
				Skin: "#8d5f45", Hair: "#e6e2d8", Coat: "#6b5a48", Trim: "#627f9a",
				Hat: "none", Prop: "clipboard", Height: 1.76, Build: 0.85,
			},
		},
		{
			ID: NPCJune, Name: "June", Role: "Park Ranger", Faction: FactionRangers, POI: "npc_june",
			Bio: "June looks after Greenhollow: the trails, the towers, and whatever turns up that should not be there. She signs the ranger permits for the country beyond the valley and knows more of it than anyone admits to.",
			Look: proto.NPCLook{
				Skin: "#a9744f", Hair: "#2f2620", Coat: "#7a7446", Trim: "#355c43",
				Hat: "ranger", Prop: "staff", Height: 1.71, Build: 1.05,
			},
		},
	}
}

// NPC returns one character by id.
func NPC(id string) (proto.NPCDef, bool) {
	for _, n := range NPCs() {
		if n.ID == id {
			return n, true
		}
	}
	return proto.NPCDef{}, false
}
