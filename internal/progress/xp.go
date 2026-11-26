package progress

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// MaxLevel is the level cap. Each level gained grants one skill point.
const MaxLevel = 40

// XP amounts (spec §7.3, contract §3.4). These are BASE amounts: AwardXP multiplies
// by Stats.XPMult. First-identification XP depends on rarity and lives on the
// species (core.Species.FirstIDXP: 100 / 150 / 250 / 400).
const (
	XPLandmark       = 25  // discover a landmark / point of interest
	XPSpot           = 50  // first encounter of a species
	XPIdentify       = 100 // first identification of a common species
	XPPhoto          = 40  // first photograph of a species (at one star)
	XPPhotoStar      = 15  // per star above one, paid only when the player's best improves
	XPRecording      = 35  // first recording of a species (at one star)
	XPRecordingStar  = 15  // per star above one, likewise
	XPBehavior       = 75  // unique behaviour, first time per species and behaviour
	XPRare           = 250 // rare discovery
	XPResearchQuest  = 300 // a research quest (quest data carries the real figure)
	XPRegion         = 100 // first time ever in a region type
	XPCollectible    = 30  // feather, page or relic picked up
	SkillPointsLevel = 1   // skill points per level gained
)

// Anti-grind sources (spec §7.4). Profile.XPLog is keyed "<source>:<key>", where key
// is whatever makes the deed unique: a species id, a POI id, a discovery id.
const (
	SrcLandmark        = "landmark"    // key: POI id               once
	SrcSpot            = "spot"        // key: species id           once
	SrcIdentify        = "identify"    // key: species id           improvable (probable → confirmed)
	SrcPhoto           = "photo"       // key: species id           improvable (better stars)
	SrcRecording       = "recording"   // key: species id           improvable (better stars)
	SrcBehavior        = "behavior"    // key: BehaviorKey(sp, act) once
	SrcRare            = "rare"        // key: rare discovery id    once
	SrcRegion          = "region"      // key: region key           once
	SrcCollectible     = "collectible" // key: collectible id       once
	SrcSubmitPhoto     = "submit_photo"
	SrcSubmitRecording = "submit_rec"
)

// improvable sources pay the difference when a later deed is worth more than what
// was already paid for that key (a better photo, a confirmed identification). Every
// other source pays exactly once per key.
var improvable = map[string]bool{
	SrcIdentify:        true,
	SrcPhoto:           true,
	SrcRecording:       true,
	SrcSubmitPhoto:     true,
	SrcSubmitRecording: true,
}

// XPForLevel is the XP needed to go from level l to level l+1: 200 + 120·(l−1).
func XPForLevel(l int) int {
	if l < 1 {
		l = 1
	}
	return 200 + 120*(l-1)
}

// TotalXPForLevel is the cumulative XP needed to reach level l from a new profile.
func TotalXPForLevel(l int) int {
	l = min(max(l, 1), MaxLevel)
	n := l - 1
	return 200*n + 120*n*(n-1)/2
}

// PhotoXP is the base XP a photograph with this star rating is worth for its
// species: 40 for the first star, +15 for each further star; 0 without a subject.
// Pass it to AwardXP(p, SrcPhoto, speciesID, …): the log then pays it in full for
// the first photo and only the improvement afterwards.
func PhotoXP(stars int) int {
	if stars <= 0 {
		return 0
	}
	return XPPhoto + XPPhotoStar*(min(stars, 5)-1)
}

// RecordingXP is PhotoXP's counterpart for audio recordings: 35, +15 per extra star.
func RecordingXP(stars int) int {
	if stars <= 0 {
		return 0
	}
	return XPRecording + XPRecordingStar*(min(stars, 5)-1)
}

// IdentifyXP is the base XP for an identification worth full XP (use
// core.Species.FirstIDXP): a "probable" identification pays half now; awarding the
// full amount later (on confirmation) pays the rest through the log.
func IdentifyXP(full int, probable bool) int {
	if probable {
		return full / 2
	}
	return full
}

// BehaviorXP is the base XP for a unique behaviour: 75, raised by up to 50 % with
// Stats.BehaviorInsight (the stat's "bonus XP for unique behaviour").
func BehaviorXP(p *proto.Profile) int {
	return int(math.Round(XPBehavior * (1 + 0.5*float64(p.Stats.BehaviorInsight))))
}

// BehaviorKey is the log key for a unique-behaviour award: once per species AND
// behaviour ("european_robin/bathing").
func BehaviorKey(speciesID, behavior string) string { return speciesID + "/" + behavior }

// LogKey is the Profile.XPLog key for a source and a deed.
func LogKey(source, key string) string { return source + ":" + key }

// ScaleXP is what a base XP amount becomes after Stats.XPMult.
func ScaleXP(p *proto.Profile, base int) int {
	if base <= 0 {
		return 0
	}
	m := float64(p.Stats.XPMult)
	if m <= 0 {
		m = 1
	}
	return int(math.Round(float64(base) * m))
}

// GrantXP adds exactly amount XP (no multiplier, no log), levelling up as often as
// it takes, and returns the number of levels gained. Each level grants a skill
// point. At MaxLevel the bar stays full (XP == XPNext) and only XPTotal still grows.
// Gameplay sources should go through AwardXP or ApplyReward instead.
func GrantXP(p *proto.Profile, amount int) (levels int) {
	syncLevel(p)
	if amount <= 0 {
		return 0
	}
	p.XPTotal += amount
	if p.Level >= MaxLevel {
		return 0
	}
	p.XP += amount
	for p.Level < MaxLevel && p.XP >= XPForLevel(p.Level) {
		p.XP -= XPForLevel(p.Level)
		p.Level++
		p.SkillPoints += SkillPointsLevel
		levels++
	}
	syncLevel(p)
	return levels
}

// syncLevel keeps Level, XP and XPNext consistent.
func syncLevel(p *proto.Profile) {
	if p.Level < 1 {
		p.Level = 1
	}
	if p.XP < 0 {
		p.XP = 0
	}
	if p.Level >= MaxLevel {
		// A full bar rather than xpNext = 0, so a client dividing xp / xpNext is safe.
		p.Level = MaxLevel
		p.XPNext = XPForLevel(MaxLevel)
		p.XP = p.XPNext
		return
	}
	p.XPNext = XPForLevel(p.Level)
}

// logIncrement applies the anti-grind rule for one deed and returns the base amount
// that is still owed. The log stores the highest base amount ever paid for the key.
func logIncrement(p *proto.Profile, source, key string, amount int) int {
	if amount <= 0 {
		return 0
	}
	if p.XPLog == nil {
		p.XPLog = make(map[string]int)
	}
	k := LogKey(source, key)
	paid := p.XPLog[k]
	if paid >= amount || (paid > 0 && !improvable[source]) {
		return 0
	}
	p.XPLog[k] = amount
	return amount - paid
}

// AwardXP pays XP for a meaningful deed through the anti-grind log and returns the
// XP actually granted (after Stats.XPMult; 0 when the deed was already rewarded).
//
// amount is the BASE worth of the deed. One-off sources (landmark, spot, behaviour,
// rare, region, collectible, and any source not listed above) pay once per key.
// Improvable sources (identify, photo, recording) pay the difference whenever the
// deed is worth more than what was already paid for that key — so a second identical
// photo pays nothing, a photo with a better star rating pays +15 per extra star,
// and a probable identification pays the other half when it is confirmed. The total
// a species can ever pay is thereby independent of the order the player did things.
//
// Compare p.Level before and after to detect a level-up.
func AwardXP(p *proto.Profile, source, key string, amount int) int {
	xp := ScaleXP(p, logIncrement(p, source, key, amount))
	GrantXP(p, xp)
	return xp
}

// Awarded reports the base amount already paid for a deed (0 = never rewarded).
func Awarded(p *proto.Profile, source, key string) int { return p.XPLog[LogKey(source, key)] }

// ---------------------------------------------------------------------------
// Field Credits (spec §22)

// StartingCredits is what a new naturalist has in their pocket.
const StartingCredits = 60

// ScaleCredits is what a base credit amount becomes after Stats.CreditMult.
func ScaleCredits(p *proto.Profile, base int) int {
	if base <= 0 {
		return 0
	}
	m := float64(p.Stats.CreditMult)
	if m <= 0 {
		m = 1
	}
	return int(math.Round(float64(base) * m))
}

// GrantCredits pays base × Stats.CreditMult Field Credits and returns the amount paid.
func GrantCredits(p *proto.Profile, base int) int {
	c := ScaleCredits(p, base)
	p.Credits += c
	return c
}

// SubmissionCredits is the modest base fee the research board pays for a submitted
// photo or recording of this star rating (6, 10, 15, 21, 28).
func SubmissionCredits(stars int) int {
	if stars <= 0 {
		return 0
	}
	s := min(stars, 5)
	return 3 + 3*s + s*(s-1)/2
}

// AwardCredits pays Field Credits through the same log as AwardXP, so that credits
// never come from plain repetition (spec §22.3): with SrcSubmitPhoto /
// SrcSubmitRecording and a species id as key, submitting a second picture of the
// same species only pays if it is better than the best one already submitted.
// Returns the credits actually paid (after Stats.CreditMult).
func AwardCredits(p *proto.Profile, source, key string, amount int) int {
	return GrantCredits(p, logIncrement(p, source, key, amount))
}
