package progress

import (
	"errors"
	"fmt"
)

// Rule violations. Every error returned by this package wraps exactly one of these,
// so callers can branch with errors.Is while showing err.Error() to the player.
var (
	ErrUnknown      = errors.New("unknown id")              // no such item / skill / upgrade / slot
	ErrInvalid      = errors.New("invalid request")         // wrong kind of thing for this action
	ErrNotOwned     = errors.New("not owned")               // the player does not have it (or not here)
	ErrAlreadyOwned = errors.New("already owned")           // one-of-a-kind thing owned / bought already
	ErrNotForSale   = errors.New("not for sale")            // Finn does not stock it
	ErrCredits      = errors.New("not enough credits")      // cannot afford it
	ErrRank         = errors.New("rank too low")            // naturalist rank requirement
	ErrReputation   = errors.New("reputation too low")      // reputation requirement
	ErrRequirement  = errors.New("requirement not met")     // tier points / cabin prerequisite
	ErrSkillPoints  = errors.New("not enough skill points") // cannot afford the skill
	ErrMaxed        = errors.New("already at maximum")      // skill fully learned
	ErrPackFull     = errors.New("pack full")               // no room in the backpack
)

// RuleError is a rule violation with a gentle, player-facing message. The game stays
// cozy (spec rule 8): these explain what is needed, they never scold.
type RuleError struct {
	Kind error  // one of the Err… sentinels
	Msg  string // player-facing sentence
}

func (e *RuleError) Error() string { return e.Msg }
func (e *RuleError) Unwrap() error { return e.Kind }

func fail(kind error, format string, args ...any) error {
	return &RuleError{Kind: kind, Msg: fmt.Sprintf(format, args...)}
}
