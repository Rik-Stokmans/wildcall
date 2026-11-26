package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// cameraItems: the camera types of spec §9.6. Base: 3× zoom, stability 0.4,
// autofocus 1.0 /s, quality 0.5 (photo scores cap at 40 + 60·quality), 1 frame/s,
// shutter noise 0.5, 0.6 s to raise, 12 frames of film. Each body is a different
// answer to "what kind of photographer are you": reach, silence, speed, close
// detail or sheer image quality — never all of them.
func cameraItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "starter_camera", Name: "Starter Camera",
			Desc: "A plain, dependable compact with a short zoom. It will not flatter a distant bird, but it has never once failed to fire.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 1, Rarity: proto.RarityCommon,
			Source: "start", Icon: "camera",
			Pros: []string{"Simple and quick to bring up", "Twelve frames to a roll"},
			Cons: []string{"Short 3× zoom", "Modest image quality", "A clacky shutter"},
			Upgrades: []proto.UpgradeDef{
				up("starter_camera_grip", "Leather Hand Grip",
					"Something to hold on to. Fewer frames lost to a trembling hand.", 40,
					mods{"camStability": 0.06}),
				up("starter_camera_lens", "Sharper Kit Lens",
					"A better-corrected lens with a touch more reach.", 90,
					mods{"camQuality": 0.07, "camZoom": 0.5}),
			},
		},
		{
			ID: "wildlife_camera", Name: "Wildlife Camera",
			Desc: "A proper field body with a 5× zoom: the all-rounder. Sharper and faster to focus than the starter, and loud enough that the birds know it.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 260, ReqRank: 2, Source: "shop", Icon: "camera",
			Mods: mods{"camZoom": 2, "camQuality": 0.15, "camFocus": 0.3, "camStability": -0.05, "camNoise": 0.08},
			Pros: []string{"5× zoom", "Clearly better image quality", "Quicker autofocus"},
			Cons: []string{"Heavier: more shake at full zoom", "The mirror slap startles nearby birds"},
			Upgrades: []proto.UpgradeDef{
				up("wildlife_camera_hood", "Lens Hood & Filter",
					"Cuts flare and haze. Cleaner frames in hard light.", 110,
					mods{"camQuality": 0.06}),
				atWorkshop(up("wildlife_camera_damper", "Shutter Damper",
					"Felt and a patient afternoon at the workbench take the crack out of the shutter.", 140,
					mods{"camNoise": -0.12})),
			},
		},
		{
			ID: "silent_camera", Name: "Silent Camera",
			Desc: "A small rangefinder with a leaf shutter that barely whispers. For the photographer who would rather sit close than shoot fast.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 250, ReqRank: 2, Source: "shop", Icon: "camera",
			Mods: mods{"camNoise": -0.38, "camQuality": 0.05, "camReady": -0.1, "camBurst": -0.4, "camFocus": -0.2},
			Pros: []string{"Near-silent shutter: birds rarely notice a frame", "Small and fast to raise"},
			Cons: []string{"Slow, deliberate frames: no burst to speak of", "Sluggish focus", "Still only a 3× lens"},
			Upgrades: []proto.UpgradeDef{
				up("silent_camera_tele", "Short Tele Adapter",
					"A screw-on converter for a little more reach without a sound.", 160,
					mods{"camZoom": 1.5}),
			},
		},
		{
			ID: "macro_camera", Name: "Macro Camera",
			Desc: "A close-focus body with a superb short lens. Feather detail, an eye-ring, the bloom on a berry — provided you can get near enough.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 230, ReqRank: 2, Source: "shop", Icon: "camera",
			Mods: mods{"camQuality": 0.2, "composition": 0.12, "camFocus": 0.4, "camZoom": -1, "camReady": 0.08},
			Pros: []string{"Exquisite detail at close range", "Naturally well-balanced frames", "Precise, quick focus"},
			Cons: []string{"Only 2× zoom: you must earn your distance", "Fiddly to bring up"},
			Upgrades: []proto.UpgradeDef{
				up("macro_camera_diffuser", "Diffuser Ring",
					"Softens hard light on a near subject: gentler shadows, truer colour.", 130,
					mods{"camQuality": 0.05, "composition": 0.05}),
			},
		},
		{
			ID: "telephoto_camera", Name: "Telephoto Camera",
			Desc: "A long 8× lens on a solid body. It brings the far bank to you, and asks for steady hands and time to settle in return.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 3, Rarity: proto.RarityRare,
			Price: 560, ReqRank: 3, Source: "shop", Icon: "camera",
			Mods: mods{"camZoom": 5, "camQuality": 0.25, "camStability": -0.15, "camFocus": -0.25, "camReady": 0.35, "camNoise": 0.05},
			Pros: []string{"8× zoom: frame-filling portraits from a respectful distance", "Excellent image quality"},
			Cons: []string{"Every tremor is magnified", "Slow to raise and slow to find focus", "Heavy glass"},
			Upgrades: []proto.UpgradeDef{
				atWorkshop(up("telephoto_camera_collar", "Monopod Collar",
					"A lens collar and folding monopod you fit yourself. The long lens finally sits still.", 190,
					mods{"camStability": 0.14})),
				atWorkshop(up("telephoto_camera_motor", "Focus Motor",
					"A geared focus drive: the lens stops hunting.", 210,
					mods{"camFocus": 0.4})),
			},
		},
		{
			ID: "fast_action_camera", Name: "Fast-Action Camera",
			Desc: "A motor-driven body that fires five frames a second and focuses almost before you ask. Built for wings, dives and squabbles.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 3, Rarity: proto.RarityRare,
			Price: 540, ReqRank: 3, Source: "shop", Icon: "camera",
			Mods: mods{"camBurst": 4, "camFocus": 1.2, "camReady": -0.2, "camQuality": 0.1, "camZoom": 1, "momentBonus": 0.2,
				"camNoise": 0.2, "camStability": -0.05},
			Pros: []string{"Five frames a second", "Near-instant autofocus and readiness", "Catches behaviour other cameras miss"},
			Cons: []string{"The motor drive rattles: expect birds to react", "Burns through a roll in seconds", "A little twitchy in the hand"},
			Upgrades: []proto.UpgradeDef{
				up("fast_action_camera_back", "Bulk Film Back",
					"A long-roll back, so a burst no longer ends the outing.", 180,
					mods{"filmCap": 12}),
			},
		},
		{
			ID: "vintage_camera", Name: "Vintage Rangefinder",
			Desc: "A mid-century rangefinder Finn keeps under the counter for customers he likes. Nothing made since draws a feather quite like it.",
			Kind: KindEquipment, Slot: SlotCamera, Tier: 3, Rarity: proto.RarityRare,
			Price: 480, ReqRank: 3, ReqRep: 40, Source: "shop", Icon: "camera",
			Mods: mods{"camQuality": 0.3, "composition": 0.1, "camNoise": -0.15, "filmCap": -4, "camFocus": -0.5, "camBurst": -0.5, "camZoom": -0.5},
			Pros: []string{"Glorious rendering: the finest image quality Finn sells", "A soft, polite shutter", "Its framelines teach composition"},
			Cons: []string{"Eight-frame film backs", "Manual focus, one considered frame at a time", "A short lens"},
			Upgrades: []proto.UpgradeDef{
				atWorkshop(up("vintage_camera_back", "Twelve-Frame Back",
					"A period-correct back restored at your workbench.", 150,
					mods{"filmCap": 4})),
			},
		},
	}
}
