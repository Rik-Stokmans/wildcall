// Package save persists a WILDCALL adventure: one versioned JSON file per save
// directory (the world seed, the player profile including the journal, the clock and
// a few session counters) plus the player's photographs as JPEG files.
//
// Robustness rules (docs/superpowers/plans Review Focus 2):
//   - Writes are atomic: the new file is written to a temporary file, synced and
//     renamed over save.json; the previous save.json is kept as save.json.bak.
//   - Loading never fails the game. A missing file is a new game. A file that cannot
//     be decoded, or that does not hold a usable profile, is moved aside as
//     save.corrupt-<n>.json and the game starts fresh. A file written by a save format
//     this build cannot read (older than MinVersion, or newer than Version) is moved
//     aside as save.v<version>-<n>.json and the game starts fresh. Older formats from
//     MinVersion on load as they are: the session migrates the profile
//     (progress.Normalize), and the next save is written in the current format.
package save

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/env"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Version is the save-format version. Bump it whenever File changes.
//
//	1  the first playable build
//	2  phase 2: buffs, forage records, recipes, herbarium and nest journal in the
//	   profile; species facts in the narrator state (all additive: a version 1 file
//	   loads and is migrated by progress.MigrateLarder)
//	3  grid inventory: inventory and storage stacks carry x, y, r (their cell and
//	   turn in the backpack / storage grid). Additive: a version 1 or 2 file loads
//	   with every stack at 0,0, and progress.RepairGrids (via Normalize) re-packs
//	   it; what no longer fits the backpack goes to cabin storage, nothing is lost
const Version = 3

// MinVersion is the oldest save format this build still loads.
const MinVersion = 1

// MaxPhotoBytes is the largest photo (decoded JPEG) the store accepts.
const MaxPhotoBytes = 400 * 1024

const (
	fileName  = "save.json"
	photosDir = "photos"
)

// File is the whole persisted adventure.
type File struct {
	Version  int            `json:"version"`
	SavedAt  time.Time      `json:"savedAt"`
	Seed     int64          `json:"seed"`
	SeedText string         `json:"seedText"`
	Profile  *proto.Profile `json:"profile"`
	Clock    env.State      `json:"clock"`
	// Narrator is the narrator's memory (recently used lines, pacing).
	Narrator *narrator.State `json:"narrator,omitempty"`
	// Seq holds the id counters, so ids stay unique across sessions.
	Seq Seq `json:"seq"`
}

// Seq are monotonically increasing id counters.
type Seq struct {
	Photo   int `json:"photo"`
	Rec     int `json:"rec"`
	Mystery int `json:"mystery"`
	Obs     int `json:"obs"`
}

// Status describes what Load found.
type Status int

const (
	Missing Status = iota // no save: start a new game
	Loaded                // a valid save was loaded
	Corrupt               // the save could not be used and was moved aside: start a new game
	Old                   // the save has another format version and was moved aside: start a new game
)

func (s Status) String() string {
	return [...]string{"missing", "loaded", "corrupt", "old-version"}[s]
}

// Store is a save directory. Its methods are safe for concurrent use: writes of
// save.json are serialised.
type Store struct {
	dir string
	mu  sync.Mutex
}

// Open prepares a save directory (creating it and its photos folder).
func Open(dir string) (*Store, error) {
	if dir == "" {
		return nil, errors.New("save: empty directory")
	}
	if err := os.MkdirAll(filepath.Join(dir, photosDir), 0o755); err != nil {
		return nil, fmt.Errorf("save: %w", err)
	}
	return &Store{dir: dir}, nil
}

// Dir is the save directory.
func (s *Store) Dir() string { return s.dir }

// Path is the path of the main save file.
func (s *Store) Path() string { return filepath.Join(s.dir, fileName) }

// Load reads the save. It never returns a nil error together with a nil File unless
// the status is Missing, Corrupt or Old; aside names the file a bad save was moved
// to. The error is only for logging: the caller should start a new game.
func (s *Store) Load() (f *File, st Status, aside string, err error) {
	data, err := os.ReadFile(s.Path())
	if errors.Is(err, os.ErrNotExist) {
		return nil, Missing, "", nil
	}
	if err != nil {
		aside, _ = s.moveAside("corrupt")
		return nil, Corrupt, aside, err
	}
	var probe struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		aside, _ = s.moveAside("corrupt")
		return nil, Corrupt, aside, fmt.Errorf("save: decode: %w", err)
	}
	if probe.Version < MinVersion || probe.Version > Version {
		aside, _ = s.moveAside(fmt.Sprintf("v%d", probe.Version))
		return nil, Old, aside, fmt.Errorf("save: format version %d, want %d", probe.Version, Version)
	}
	f = &File{}
	if err := json.Unmarshal(data, f); err != nil {
		aside, _ = s.moveAside("corrupt")
		return nil, Corrupt, aside, fmt.Errorf("save: decode: %w", err)
	}
	if f.Profile == nil {
		aside, _ = s.moveAside("corrupt")
		return nil, Corrupt, aside, errors.New("save: no profile")
	}
	return f, Loaded, "", nil
}

// moveAside renames save.json to save.<tag>-<n>.json with the first free n.
func (s *Store) moveAside(tag string) (string, error) {
	for n := 1; n < 10000; n++ {
		p := filepath.Join(s.dir, fmt.Sprintf("save.%s-%d.json", tag, n))
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			return p, os.Rename(s.Path(), p)
		}
	}
	return "", errors.New("save: no free name to move a bad save aside")
}

// Save writes the file atomically and keeps the previous save as save.json.bak.
func (s *Store) Save(f *File) error {
	data, err := Encode(f)
	if err != nil {
		return err
	}
	return s.Write(data)
}

// Encode serialises a save file (stamping the version and time). Encoding is the
// part that must see a consistent profile; Write can then run on another goroutine.
func Encode(f *File) ([]byte, error) {
	if f == nil || f.Profile == nil {
		return nil, errors.New("save: nothing to save")
	}
	f.Version = Version
	f.SavedAt = time.Now().UTC()
	data, err := json.Marshal(f)
	if err != nil {
		return nil, fmt.Errorf("save: encode: %w", err)
	}
	return data, nil
}

// Write stores already encoded save data atomically (temp file, sync, rename) and
// keeps the previous save as save.json.bak.
func (s *Store) Write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tmp, err := os.CreateTemp(s.dir, "save-*.tmp")
	if err != nil {
		return fmt.Errorf("save: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("save: write: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("save: sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("save: %w", err)
	}
	if _, err := os.Stat(s.Path()); err == nil {
		// Keep the previous save. On Windows Rename does not replace, so remove first.
		bak := s.Path() + ".bak"
		_ = os.Remove(bak)
		if err := os.Rename(s.Path(), bak); err != nil {
			return fmt.Errorf("save: backup: %w", err)
		}
	}
	if err := os.Rename(tmpName, s.Path()); err != nil {
		return fmt.Errorf("save: rename: %w", err)
	}
	return nil
}

// ClearPhotos deletes every stored photo (a new adventure starts with an empty album).
func (s *Store) ClearPhotos() error {
	dir := filepath.Join(s.dir, photosDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".jpg") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	return nil
}

var photoID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidPhotoID reports whether id is safe to use as a file name.
func ValidPhotoID(id string) bool { return photoID.MatchString(id) }

// DecodePhoto turns a JPEG data URL ("data:image/jpeg;base64,…") into JPEG bytes,
// checking the size limit and that the bytes really are a decodable JPEG.
func DecodePhoto(dataURL string) ([]byte, error) {
	const prefix = "data:image/jpeg;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return nil, errors.New("photo is not a JPEG data URL")
	}
	b64 := dataURL[len(prefix):]
	if base64.StdEncoding.DecodedLen(len(b64)) > MaxPhotoBytes+3 {
		return nil, fmt.Errorf("photo is larger than %d KB", MaxPhotoBytes/1024)
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errors.New("photo data is not valid base64")
	}
	if len(data) > MaxPhotoBytes {
		return nil, fmt.Errorf("photo is larger than %d KB", MaxPhotoBytes/1024)
	}
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 || data[2] != 0xFF {
		return nil, errors.New("photo is not a JPEG")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 4096 || cfg.Height > 4096 {
		return nil, errors.New("photo is not a valid JPEG")
	}
	return data, nil
}

// SavePhoto validates a JPEG data URL and stores it as photos/<id>.jpg.
func (s *Store) SavePhoto(id, dataURL string) error {
	if !ValidPhotoID(id) {
		return errors.New("bad photo id")
	}
	data, err := DecodePhoto(dataURL)
	if err != nil {
		return err
	}
	dir := filepath.Join(s.dir, photosDir)
	tmp, err := os.CreateTemp(dir, "photo-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	dst := filepath.Join(dir, id+".jpg")
	_ = os.Remove(dst)
	return os.Rename(name, dst)
}

// PhotoPath returns the file of a stored photo; ok is false for a bad id or a
// missing file.
func (s *Store) PhotoPath(id string) (string, bool) {
	if !ValidPhotoID(id) {
		return "", false
	}
	p := filepath.Join(s.dir, photosDir, id+".jpg")
	if fi, err := os.Stat(p); err != nil || fi.IsDir() {
		return "", false
	}
	return p, true
}
