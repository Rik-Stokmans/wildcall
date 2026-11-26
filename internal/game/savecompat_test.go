package game

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TestOddSavesLoad: a save that decodes but holds a sparse or strange profile must
// still give a playable session (Review Focus 2).
func TestOddSavesLoad(t *testing.T) {
	for name, js := range map[string]string{
		"minimal": `{"version":1,"seed":5,"profile":{"name":"x"}}`,
		"nulls": `{"version":1,"seed":5,"profile":{"name":"x","level":-3,"rank":99,"credits":-50,
			"journal":{"species":{"european_robin":null,"no_such_bird":{"id":"no_such_bird","level":4}},
			"mysteries":[null,{"id":"m1","species":"no_such_bird"},{"id":"m2","species":"eurasian_wren","evidence":null}],
			"photos":[null,{"id":"p1","stars":3,"subjects":null}],"recordings":[null,{"id":"r1","spIndex":999,"call":5}],
			"observations":[null],"rare":[null],"locations":{"x":null}},
			"quests":{"unseen_singer":null,"no_such_quest":{"status":"active"}},
			"inventory":[{"item":"no_such_item","qty":3},{"item":"film_roll","qty":-2}],
			"equipped":{"optics":"no_such_item","hat":"basic_binoculars"},
			"explored":{"0,0":"AAAA","bad":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="},
			"film":{"used":99,"cap":-1}},
			"clock":{"hours":-5,"blocks":[{"n":1,"start":0,"dur":-1,"weather":9}]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "save.json"), []byte(js), 0o644); err != nil {
				t.Fatal(err)
			}
			s := newSession(t, dir, "", true)
			out := &capture{}
			s.Attach(out)
			s.Handle(proto.CHello, []byte(`{"name":"x"}`))
			cabinFeet := s.feet
			s.Handle(proto.CPose, []byte(`{"x":`+ftoa(cabinFeet.X)+`,"y":`+ftoa(cabinFeet.Y+1.65)+`,"z":`+ftoa(cabinFeet.Z)+`}`))
			for i := 0; i < 30; i++ {
				s.Tick(0.1)
			}
			s.Handle(proto.CInteract, []byte(`{"poi":"cabin"}`))
			s.Handle(proto.CCabin, []byte(`{"action":"submit","id":"p1"}`))
			s.Handle(proto.CCabin, []byte(`{"action":"analyze","id":"r1"}`))
			s.Handle(proto.CIdentify, []byte(`{"mystery":"m1","species":"european_robin"}`))
			s.Handle(proto.CIdentify, []byte(`{"mystery":"m2","species":"eurasian_wren"}`))
			welcome := false
			for _, m := range out.msgs {
				welcome = welcome || m.T == proto.SWelcome
			}
			if !welcome {
				t.Fatal("no welcome")
			}
			if err := s.Save(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func ftoa(f float32) string { return mustJSON(f) }
