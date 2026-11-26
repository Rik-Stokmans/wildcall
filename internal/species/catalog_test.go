package species

import "testing"

// TestCatalogValid is shared by both roster tasks: the assembled catalog must satisfy
// the contract vocabulary.
func TestCatalogValid(t *testing.T) {
	for _, err := range Validate(All()) {
		t.Error(err)
	}
	for i, sp := range All() {
		if sp.Index != i {
			t.Errorf("%s: index %d at position %d", sp.ID, sp.Index, i)
		}
	}
}
