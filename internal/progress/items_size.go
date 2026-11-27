package progress

import (
	"fmt"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Item footprints (spec §9.2 backpack organisation): every item takes W x H cells of
// the backpack or storage grid, so big gear takes real room and packing is a small
// puzzle. A stack takes the item's footprint whatever its quantity. Supplies,
// ingredients and food are 1x1 unless listed here; every other item must be listed
// (Validate checks 1 <= W, H <= MaxItemSide for all of them).
//
// Rule of thumb: a hand-sized thing is 1x1, a pocket thing 1x2, a boxy thing the
// size of a book 2x2, a long lens or a folded garment 2x3, a tripod or scope 1x4,
// a dish 3x3.
var footprints = map[string][2]int{
	// Optics
	"basic_binoculars":      {2, 2},
	"explorer_binoculars":   {2, 2},
	"wide_field_binoculars": {2, 2},
	"specialist_binoculars": {2, 3},
	"spotting_scope":        {1, 4},
	"historical_binoculars": {2, 2},
	// Cameras
	"starter_camera":     {2, 2},
	"wildlife_camera":    {2, 3},
	"silent_camera":      {2, 2},
	"macro_camera":       {2, 2},
	"telephoto_camera":   {3, 2},
	"fast_action_camera": {2, 3},
	"vintage_camera":     {2, 2},
	// Audio
	"basic_recorder":         {1, 2},
	"directional_microphone": {1, 3},
	"parabolic_microphone":   {3, 3},
	"advanced_recorder":      {2, 2},
	"vintage_recorder":       {2, 2},
	// Backpacks (folded or rolled when not worn)
	"canvas_satchel":    {2, 2},
	"explorer_pack":     {2, 3},
	"expedition_pack":   {3, 3},
	"research_backpack": {3, 3},
	// Navigation
	"trail_map":           {1, 2},
	"field_compass":       {1, 2},
	"survey_kit":          {2, 2},
	"naturalists_compass": {1, 1},
	// Clothing
	"field_clothes":    {2, 2},
	"rain_shell":       {2, 2},
	"sturdy_boots":     {2, 2},
	"camouflage_smock": {2, 3},
	// Gadgets and the keepsake
	"headphones":         {2, 2},
	"pocket_guide":       {1, 2},
	"pocket_barometer":   {1, 1},
	"field_stool":        {2, 3},
	"tripod":             {1, 4},
	"audio_analyzer":     {1, 2},
	"spectrogram_device": {2, 2},
	"explorers_lens":     {1, 1},
	"forgotten_journal":  {1, 2},
}

// MaxItemSide is the longest side an item may have, in cells: everything fits the
// smallest backpack in one orientation or the other.
const MaxItemSide = 4

// packRoomCon is the Cons line of a carried gadget or keepsake; applyFootprints
// replaces it with the item's real size ("Takes 2×2 cells of your pack").
const packRoomCon = "Takes room in your pack"

// applyFootprints sets W and H on every catalog item (buildItems calls it).
// Stackable things default to one cell; anything else not listed keeps 0x0, which
// Validate reports.
func applyFootprints(all []proto.ItemDef) {
	for i := range all {
		it := &all[i]
		if fp, ok := footprints[it.ID]; ok {
			it.W, it.H = fp[0], fp[1]
		} else if stackable(it) {
			it.W, it.H = 1, 1
		}
		for j, c := range it.Cons {
			if c == packRoomCon && it.W > 0 && it.H > 0 {
				it.Cons[j] = fmt.Sprintf("Takes %d×%d cells of your pack", it.W, it.H)
			}
		}
	}
}
