package coretest

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func TestFixtures(t *testing.T) {
	f := NewFlat()
	if got := f.PerchesNear(200, 200, 40, nil); len(got) < 20 {
		t.Fatalf("expected plenty of perches, got %d", len(got))
	}
	if f.HabitatAt(512, 1536) != core.HabRiver || f.HeightAt(512, 1536) >= 0 {
		t.Fatal("pond missing")
	}
	if len(Species()) != 3 {
		t.Fatal("want 3 fixture species")
	}
}
