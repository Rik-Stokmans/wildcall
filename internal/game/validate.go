package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/species"
)

// ValidateCatalogs checks the authored catalogs against each other (items, skills,
// species, quests, dialogue, plants, recipes) and returns every problem found. The
// engine logs them at start-up; the tests require none. homePOIs are the pinned
// home-valley POI ids quests may reference (world.HomePOIs).
func ValidateCatalogs(homePOIs []string) []error {
	errs := progress.Validate()
	var spIDs, itemIDs, skillIDs []string
	for _, sp := range species.All() {
		spIDs = append(spIDs, sp.ID)
	}
	for _, it := range progress.Items() {
		itemIDs = append(itemIDs, it.ID)
	}
	for _, sk := range progress.Skills() {
		skillIDs = append(skillIDs, sk.ID)
	}
	errs = append(errs, content.Validate(spIDs, itemIDs, homePOIs, skillIDs)...)
	errs = append(errs, progress.ValidateLarder(content.Recipes(), content.Plants())...)
	return errs
}

// HomePOIIDs lists the pinned home-valley POI ids of the current world.
func (s *Session) HomePOIIDs() []string {
	var ids []string
	for _, p := range s.world.HomePOIs() {
		ids = append(ids, p.ID)
	}
	return ids
}
