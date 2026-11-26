package save

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/env"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
)

func jpegURL(t *testing.T, w, h int) string {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func testFile() *File {
	p := progress.NewProfile("Tester")
	p.Credits = 123
	p.Journal.Lore = append(p.Journal.Lore, "listen_first")
	return &File{Seed: 42, SeedText: "forty-two", Profile: p, Clock: env.New(42, 1440).State(), Seq: Seq{Photo: 3}}
}

func TestRoundTripAndBackup(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if f, s, _, err := st.Load(); f != nil || s != Missing || err != nil {
		t.Fatalf("missing save: %v %v %v", f, s, err)
	}
	f := testFile()
	if err := st.Save(f); err != nil {
		t.Fatal(err)
	}
	f.Profile.Credits = 456
	if err := st.Save(f); err != nil {
		t.Fatal(err)
	}
	g, s, _, err := st.Load()
	if s != Loaded || err != nil || g.Seed != 42 || g.SeedText != "forty-two" || g.Profile.Credits != 456 ||
		g.Seq.Photo != 3 || g.Version != Version || len(g.Profile.Journal.Lore) != 1 {
		t.Fatalf("round trip: %v %v %+v", s, err, g)
	}
	// The previous save is kept as .bak.
	bak, err := os.ReadFile(st.Path() + ".bak")
	if err != nil || !strings.Contains(string(bak), `"credits":123`) {
		t.Fatalf("no usable .bak: %v", err)
	}
	// No temp files are left behind.
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("temp file left: %s", e.Name())
		}
	}
}

func TestCorruptAndOldSavesStartFresh(t *testing.T) {
	for name, content := range map[string]string{
		"garbage":    "{not json at all",
		"truncated":  `{"version":1,"seed":4,"profile":{"name":"x","lev`,
		"no profile": `{"version":1,"seed":4}`,
		"empty":      ``,
		"old":        `{"version":0,"seed":4,"profile":{"name":"old"}}`,
		"future":     `{"version":99,"seed":4,"profile":{"name":"new"}}`,
		"wrong type": `{"version":1,"seed":"four","profile":{"name":"x"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			st, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(st.Path(), []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
			f, s, aside, _ := st.Load()
			if f != nil || s == Loaded || s == Missing {
				t.Fatalf("status %v", s)
			}
			if aside == "" {
				t.Fatal("bad save not moved aside")
			}
			if b, err := os.ReadFile(aside); err != nil || string(b) != content {
				t.Fatalf("moved-aside save lost its content: %v", err)
			}
			if name == "old" || name == "future" {
				if s != Old || !strings.Contains(filepath.Base(aside), "save.v") {
					t.Fatalf("old version: %v %s", s, aside)
				}
			} else if s != Corrupt || !strings.HasPrefix(filepath.Base(aside), "save.corrupt-") {
				t.Fatalf("corrupt: %v %s", s, aside)
			}
			if _, err := os.Stat(st.Path()); !os.IsNotExist(err) {
				t.Fatal("bad save.json still in place")
			}
			// The next load is a clean new game; a second bad file gets the next number.
			if _, s, _, _ := st.Load(); s != Missing {
				t.Fatalf("after moving aside: %v", s)
			}
			_ = os.WriteFile(st.Path(), []byte(content), 0o644)
			_, _, aside2, _ := st.Load()
			if aside2 == aside || aside2 == "" {
				t.Fatalf("second bad save overwrote the first: %s", aside2)
			}
		})
	}
}

func TestPhotos(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	good := jpegURL(t, 64, 40)
	if err := st.SavePhoto("p1", good); err != nil {
		t.Fatal(err)
	}
	path, ok := st.PhotoPath("p1")
	if !ok {
		t.Fatal("photo not stored")
	}
	if b, _ := os.ReadFile(path); len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		t.Fatal("stored photo is not a JPEG")
	}
	for name, url := range map[string]string{
		"png":       "data:image/png;base64,iVBORw0KGgo=",
		"not b64":   "data:image/jpeg;base64,%%%%",
		"not jpeg":  "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte("hello world, not a jpeg")),
		"fake soi":  "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}),
		"too big":   "data:image/jpeg;base64," + strings.Repeat("A", MaxPhotoBytes*4/3+400),
		"no prefix": good[len("data:image/jpeg;base64,"):],
	} {
		if err := st.SavePhoto("p2", url); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	for _, id := range []string{"../save", "a/b", "", "p1.jpg", strings.Repeat("x", 65), `..\x`} {
		if err := st.SavePhoto(id, good); err == nil {
			t.Errorf("bad id %q accepted", id)
		}
		if _, ok := st.PhotoPath(id); ok {
			t.Errorf("bad id %q resolved", id)
		}
	}
	if _, ok := st.PhotoPath("p2"); ok {
		t.Fatal("a rejected photo was stored")
	}
	if err := st.ClearPhotos(); err != nil {
		t.Fatal(err)
	}
	if _, ok := st.PhotoPath("p1"); ok {
		t.Fatal("ClearPhotos left a photo")
	}
}
