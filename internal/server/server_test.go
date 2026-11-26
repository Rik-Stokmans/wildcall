package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/game"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/save"
)

type testServer struct {
	url    string
	srv    *Server
	runner *game.Runner
	sess   *game.Session
	dir    string
	stop   func()
}

func startServer(t *testing.T) *testServer {
	t.Helper()
	dir := t.TempDir()
	st, err := save.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := game.New(game.Config{Store: st, Dev: true, Seed: "ws-test"})
	if err != nil {
		t.Fatal(err)
	}
	runner := game.NewRunner(sess)
	srv := New(Options{Runner: runner})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	hs := &http.Server{Handler: srv}
	go hs.Serve(ln)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { runner.Run(ctx); close(done) }()
	ts := &testServer{url: "http://" + ln.Addr().String(), srv: srv, runner: runner, sess: sess, dir: dir}
	ts.stop = func() {
		_ = hs.Close()
		srv.CloseAll()
		cancel()
		<-done
	}
	t.Cleanup(ts.stop)
	return ts
}

type client struct {
	t    *testing.T
	ws   *websocket.Conn
	text chan proto.Envelope
	bin  chan []byte
	done chan struct{}
}

func dial(t *testing.T, ts *testServer, origin string) (*client, *http.Response, error) {
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	ws, resp, err := websocket.DefaultDialer.Dial(strings.Replace(ts.url, "http", "ws", 1)+"/ws", h)
	if err != nil {
		return nil, resp, err
	}
	c := &client{t: t, ws: ws, text: make(chan proto.Envelope, 4096), bin: make(chan []byte, 256), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		for {
			mt, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if mt == websocket.BinaryMessage {
				select {
				case c.bin <- data:
				default:
				}
				continue
			}
			var env proto.Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				t.Errorf("server sent invalid JSON: %v", err)
				continue
			}
			select {
			case c.text <- env:
			default: // the test is not draining; drop
			}
		}
	}()
	return c, resp, nil
}

func (c *client) send(typ string, v any) {
	c.t.Helper()
	b, _ := proto.Encode(typ, v)
	if err := c.ws.WriteMessage(websocket.TextMessage, b); err != nil {
		c.t.Fatal(err)
	}
}

// wait reads messages until one of type typ arrives.
func (c *client) wait(typ string, d time.Duration) (proto.Envelope, bool) {
	tm := time.After(d)
	for {
		select {
		case e := <-c.text:
			if e.T == typ {
				return e, true
			}
		case <-tm:
			return proto.Envelope{}, false
		}
	}
}

func TestWebSocketEndToEnd(t *testing.T) {
	ts := startServer(t)

	// HTTP: the client page.
	resp, err := http.Get(ts.url + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(strings.ToLower(string(body)), "<html") {
		t.Fatalf("GET / = %d", resp.StatusCode)
	}

	// A foreign origin is refused.
	if _, resp, err := dial(t, ts, "http://evil.example.com"); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin not refused: %v", err)
	}

	port := ts.url[strings.LastIndex(ts.url, ":")+1:]
	c, _, err := dial(t, ts, "http://127.0.0.1:"+port)
	if err != nil {
		t.Fatal(err)
	}
	defer c.ws.Close()

	c.send(proto.CHello, proto.Hello{Name: "WS"})
	env, ok := c.wait(proto.SWelcome, 10*time.Second)
	if !ok {
		t.Fatal("no welcome")
	}
	var w proto.Welcome
	if err := json.Unmarshal(env.D, &w); err != nil {
		t.Fatal(err)
	}
	if len(w.Species) == 0 || len(w.Items) == 0 || len(w.Skills) == 0 || len(w.Quests) == 0 || len(w.NPCs) == 0 ||
		len(w.Regions) != int(core.RegionCount) || len(w.Ranks) == 0 || len(w.Collectibles) == 0 || len(w.Lore) == 0 ||
		len(w.POIs) < 23 || len(w.Trails) == 0 || len(w.Shop) == 0 || len(w.CabinUps) == 0 || len(w.Disciplines) == 0 {
		t.Fatalf("welcome catalogs incomplete: %d species %d items %d skills %d quests %d pois %d trails",
			len(w.Species), len(w.Items), len(w.Skills), len(w.Quests), len(w.POIs), len(w.Trails))
	}
	var spIDs, itemIDs, poiIDs, skillIDs []string
	for i, sp := range w.Species {
		if sp.Index != i {
			t.Fatalf("species %s has index %d at %d", sp.ID, sp.Index, i)
		}
		spIDs = append(spIDs, sp.ID)
	}
	for _, it := range w.Items {
		itemIDs = append(itemIDs, it.ID)
	}
	for _, p := range w.POIs {
		poiIDs = append(poiIDs, p.ID)
	}
	for _, sk := range w.Skills {
		skillIDs = append(skillIDs, sk.ID)
	}
	if errs := content.Validate(spIDs, itemIDs, poiIDs, skillIDs); len(errs) > 0 {
		t.Fatalf("content does not validate against the real catalogs: %v", errs)
	}
	for _, id := range w.Shop {
		found := false
		for _, it := range itemIDs {
			found = found || it == id
		}
		if !found {
			t.Fatalf("shop sells unknown item %s", id)
		}
	}
	if w.World.Seed != w.Seed || w.World.MapURL == "" || w.World.ChunkSize != 64 {
		t.Fatalf("world info %+v", w.World)
	}

	// Chunks at every LOD, including negative coordinates.
	for _, req := range []proto.ChunkReq{{CX: 0, CZ: 0, LOD: 0}, {CX: -3, CZ: -2, LOD: 1}, {CX: 5, CZ: -7, LOD: 2}, {CX: -1, CZ: -1, LOD: 0}} {
		c.send(proto.CChunkReq, req)
		select {
		case b := <-c.bin:
			checkChunk(t, b, req)
		case <-time.After(10 * time.Second):
			t.Fatalf("no chunk for %+v", req)
		}
	}
	// A bad chunk request is an error, not a crash.
	c.send(proto.CChunkReq, proto.ChunkReq{LOD: 9})
	if _, ok := c.wait(proto.SError, 5*time.Second); !ok {
		t.Fatal("no error for a bad chunk request")
	}

	// Walk about and listen.
	got := map[string]int{}
	start := w.Spawn.Pos
	deadline := time.Now().Add(12 * time.Second)
	yaw := float32(0.5)
	pos := start
	for time.Now().Before(deadline) && (got[proto.SBirds] < 10 || got[proto.SEnv] < 2 || got[proto.SCall] < 1 || got[proto.SProfile] < 1) {
		dir := core.HeadingDir(yaw)
		pos = pos.Add(dir.Scale(0.24))
		y := ts.runner.Terrain().HeightAt(pos.X, pos.Z)
		c.send(proto.CPose, proto.Pose{X: pos.X, Y: y + core.EyeHeight, Z: pos.Z, Yaw: yaw, Speed: 2.4, Move: "walk", Tool: "none", FOV: 70, Zoom: 1, Sharp: 1})
		tm := time.After(100 * time.Millisecond)
	drain:
		for {
			select {
			case e := <-c.text:
				got[e.T]++
				if e.T == proto.SBirds {
					var bm struct {
						Tick uint32      `json:"tick"`
						B    [][]float64 `json:"b"`
					}
					if err := json.Unmarshal(e.D, &bm); err != nil {
						t.Fatalf("birds: %v", err)
					}
					for _, b := range bm.B {
						if len(b) != 9 || int(b[1]) < 0 || int(b[1]) >= len(w.Species) {
							t.Fatalf("bad bird row %v", b)
						}
					}
				}
			case <-tm:
				break drain
			}
		}
	}
	t.Logf("messages in the walk: %v", got)
	if got[proto.SBirds] < 10 || got[proto.SEnv] < 2 || got[proto.SCall] < 1 {
		t.Fatalf("missing streams: %v", got)
	}

	// The map tile under the player has been explored; a far one has not.
	tx, tz := int(math.Floor(float64(pos.X/512))), int(math.Floor(float64(pos.Z/512)))
	ok = false
	for i := 0; i < 20 && !ok; i++ {
		ok = ts.runner.Explored(tx, tz)
		time.Sleep(50 * time.Millisecond)
	}
	r, err := http.Get(ts.url + "/map/" + itoa(tx) + "/" + itoa(tz) + ".png")
	if err != nil {
		t.Fatal(err)
	}
	png, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 || len(png) < 8 || string(png[1:4]) != "PNG" || r.Header.Get("Cache-Control") == "" {
		t.Fatalf("explored map tile: %d", r.StatusCode)
	}
	for path, want := range map[string]int{
		"/map/40/-40.png":       404,
		"/map/x/1.png":          400,
		"/map/1/2":              400,
		"/map/99999999/0.png":   400,
		"/photos/..%2fsave.jpg": 404,
		"/photos/nope.jpg":      404,
	} {
		r, err := http.Get(ts.url + path)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != want {
			t.Errorf("GET %s = %d, want %d", path, r.StatusCode, want)
		}
	}

	// A second connection takes over; the first is closed.
	c2, _, err := dial(t, ts, "")
	if err != nil {
		t.Fatal(err)
	}
	defer c2.ws.Close()
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		t.Fatal("the old connection was not closed when a new one connected")
	}
	c2.send(proto.CHello, proto.Hello{})
	if _, ok := c2.wait(proto.SWelcome, 10*time.Second); !ok {
		t.Fatal("no welcome on the second connection")
	}
	if _, ok := c2.wait(proto.SBirds, 5*time.Second); !ok {
		t.Fatal("no birds on the second connection")
	}

	// Shutdown saves.
	ts.stop()
	if _, err := os.Stat(filepath.Join(ts.dir, "save.json")); err != nil {
		t.Fatalf("no save after shutdown: %v", err)
	}
}

func checkChunk(t *testing.T, b []byte, req proto.ChunkReq) {
	t.Helper()
	if len(b) < 16 || string(b[:4]) != "WCHK" || b[4] != 2 || int(b[5]) != req.LOD {
		t.Fatalf("chunk header %v", b[:min(16, len(b))])
	}
	n := int(binary.LittleEndian.Uint16(b[6:8]))
	cx := int32(binary.LittleEndian.Uint32(b[8:12]))
	cz := int32(binary.LittleEndian.Uint32(b[12:16]))
	if n != 64/(2<<req.LOD)+1 || int(cx) != req.CX || int(cz) != req.CZ {
		t.Fatalf("chunk %+v: N=%d cx=%d cz=%d", req, n, cx, cz)
	}
	off := 16 + n*n*4 + n*n*3 + n*n*3 + n*n + n*n
	off = (off + 3) &^ 3
	if len(b) < off+4 {
		t.Fatalf("chunk too short: %d", len(b))
	}
	veg := int(binary.LittleEndian.Uint32(b[off:]))
	if len(b) != off+4+veg*20 {
		t.Fatalf("chunk length %d, want %d (veg %d)", len(b), off+4+veg*20, veg)
	}
	h0 := math.Float32frombits(binary.LittleEndian.Uint32(b[16:]))
	if math.IsNaN(float64(h0)) || h0 < -200 || h0 > 1000 {
		t.Fatalf("implausible height %v", h0)
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
