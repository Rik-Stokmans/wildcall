package game

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/save"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// One world instance per seed for the whole test binary (world generation caches
// are the expensive part; the world is safe for concurrent use).
var (
	worldsMu sync.Mutex
	worlds   = map[int64]*world.World{}
)

func sharedWorld(seed int64) *world.World {
	worldsMu.Lock()
	defer worldsMu.Unlock()
	w := worlds[seed]
	if w == nil {
		w = world.New(seed)
		worlds[seed] = w
	}
	return w
}

// outMsg is one message the session sent.
type outMsg struct {
	T string
	D json.RawMessage
}

// capture is a Sink that keeps everything.
type capture struct {
	mu   sync.Mutex
	msgs []outMsg
	bin  [][]byte
}

func (c *capture) Send(t string, data []byte) {
	var env proto.Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		panic("session sent invalid JSON for " + t + ": " + err.Error())
	}
	if env.T != t {
		panic("envelope type " + env.T + " != " + t)
	}
	c.mu.Lock()
	c.msgs = append(c.msgs, outMsg{T: t, D: append(json.RawMessage(nil), env.D...)})
	c.mu.Unlock()
}

func (c *capture) SendBinary(data []byte) {
	c.mu.Lock()
	c.bin = append(c.bin, data)
	c.mu.Unlock()
}

type harness struct {
	t   *testing.T
	s   *Session
	out *capture
	dir string
	// all keeps every message ever sent (out.msgs is drained by take).
	all []outMsg
}

const testSeedText = "wildcall-test-valley"

func newSession(t testing.TB, dir, seed string, dev bool) *Session {
	t.Helper()
	st, err := save.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	logf := func(f string, a ...any) {
		msg := fmt.Sprintf(f, a...)
		if strings.Contains(msg, "panic") {
			t.Errorf("session panicked: %s", msg)
			return
		}
		t.Log(msg)
	}
	s, err := New(Config{Store: st, Dev: dev, Seed: seed, Worlds: sharedWorld, Logf: logf})
	if err != nil {
		t.Fatal(err)
	}
	// Autosaves are written on a helper goroutine: let an in-flight write finish
	// before the test's temporary save directory is removed (cleanups run LIFO, and
	// the directory was created before this session).
	t.Cleanup(func() {
		for i := 0; i < 500 && s.saving.Load(); i++ {
			time.Sleep(10 * time.Millisecond)
		}
	})
	return s
}

// newHarness starts a session in a fresh save dir and says hello.
func newHarness(t *testing.T, dev bool) *harness {
	t.Helper()
	h := &harness{t: t, dir: t.TempDir(), out: &capture{}}
	h.s = newSession(t, h.dir, testSeedText, dev)
	h.s.Attach(h.out)
	h.send(proto.CHello, proto.Hello{Name: "Tester"})
	if _, ok := h.last(proto.SWelcome); !ok {
		t.Fatal("no welcome")
	}
	return h
}

func (h *harness) send(t string, v any) {
	h.t.Helper()
	var raw []byte
	switch x := v.(type) {
	case []byte:
		raw = x
	case string:
		raw = []byte(x)
	default:
		var err error
		if raw, err = json.Marshal(v); err != nil {
			h.t.Fatal(err)
		}
	}
	h.s.Handle(t, raw)
}

// take returns and clears the messages sent since the last take.
func (h *harness) take() []outMsg {
	h.out.mu.Lock()
	m := h.out.msgs
	h.out.msgs = nil
	h.out.mu.Unlock()
	h.all = append(h.all, m...)
	return m
}

// last returns the payload of the most recent message of type t since the last take
// (and takes everything).
func (h *harness) last(t string) (json.RawMessage, bool) {
	var d json.RawMessage
	ok := false
	for _, m := range h.take() {
		if m.T == t {
			d, ok = m.D, true
		}
	}
	return d, ok
}

func (h *harness) tick(n int) {
	for i := 0; i < n; i++ {
		h.s.Tick(0.1)
	}
}

func (h *harness) ground(x, z float32) core.Vec3 {
	return core.V(x, h.s.world.HeightAt(x, z), z)
}

// pose builds a standing pose at a feet position.
func standPose(feet core.Vec3, yaw float32) proto.Pose {
	return proto.Pose{X: feet.X, Y: feet.Y + core.EyeHeight, Z: feet.Z, Yaw: yaw, Move: "still",
		Tool: "none", FOV: 70, Zoom: 1, Sharp: 1}
}

// stand puts the player at feet (a teleport: no walking distance, no velocity).
func (h *harness) stand(feet core.Vec3, yaw float32) {
	h.s.Teleport(feet, yaw)
	h.send(proto.CPose, standPose(feet, yaw))
}

// standNear teleports the player next to a POI.
func (h *harness) standNear(poiID string, off float32) core.Vec3 {
	h.t.Helper()
	poi, ok := h.s.world.POI(poiID)
	if !ok {
		h.t.Fatalf("no POI %s", poiID)
	}
	best := poi.Pos
	for a := 0; a < 16; a++ {
		ang := float32(a) / 16 * 2 * math.Pi
		p := poi.Pos.Add(core.HeadingDir(ang).Scale(off))
		if gy := h.s.world.HeightAt(p.X, p.Z); gy > 0.2 {
			best = core.V(p.X, gy, p.Z)
			break
		}
	}
	h.stand(best, core.HeadingTo(best, poi.Pos))
	return best
}

func aim(eye, target core.Vec3) (yaw, pitch float32) {
	yaw = core.HeadingTo(eye, target)
	d := eye.DistXZ(target)
	pitch = float32(math.Atan2(float64(target.Y-eye.Y), float64(d)))
	return
}

func decodeAs[T any](t testing.TB, d json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(d, &v); err != nil {
		t.Fatalf("decode %T: %v (%s)", v, err, string(d))
	}
	return v
}

// profileJSON is a canonical snapshot of the server-side profile.
func profileJSON(s *Session) string {
	b, _ := json.Marshal(s.p)
	return string(b)
}

var testJPEG = func() string {
	img := image.NewRGBA(image.Rect(0, 0, 64, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, color.RGBA{uint8(60 + x), uint8(90 + y), 70, 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 70})
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}()

func countType(ms []outMsg, t string) int {
	n := 0
	for _, m := range ms {
		if m.T == t {
			n++
		}
	}
	return n
}

func hasError(ms []outMsg) (string, bool) {
	for _, m := range ms {
		if m.T == proto.SError {
			var e proto.ErrorMsg
			_ = json.Unmarshal(m.D, &e)
			return e.Msg, true
		}
	}
	return "", false
}

// stripCandidates removes every "candidates":[...] array from a JSON document (the
// candidate table legitimately lists species ids: it is the field guide's answer
// key the player weighs, built only from the player's own evidence).
func stripCandidates(js string) string {
	for {
		i := strings.Index(js, `"candidates":[`)
		if i < 0 {
			return js
		}
		j := i + len(`"candidates":[`)
		depth := 1
		for j < len(js) && depth > 0 {
			switch js[j] {
			case '[':
				depth++
			case ']':
				depth--
			}
			j++
		}
		js = js[:i] + `"candidates":null` + js[j:]
	}
}
