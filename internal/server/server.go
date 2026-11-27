// Package server is WILDCALL's HTTP and WebSocket front: it serves the embedded web
// client, map tiles and photographs, and connects one player at a time to the game
// session over /ws (docs/contract.md §6).
package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/pprof"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Rik-Stokmans/wildcall/internal/game"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/web"
)

// Options configures the server.
type Options struct {
	Runner *game.Runner
	// Dev serves the client from WebDir on disk (no caching) when it exists.
	Dev    bool
	WebDir string
	Logf   func(format string, args ...any)
}

// Server is the HTTP handler set.
type Server struct {
	opt   Options
	mux   *http.ServeMux
	conns sync.Map // *conn → struct{}
	// Stats.
	wsBytes atomic.Int64
}

// New builds the server.
func New(opt Options) *Server {
	if opt.Logf == nil {
		opt.Logf = func(string, ...any) {}
	}
	s := &Server{opt: opt, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /ws", s.handleWS)
	s.mux.HandleFunc("GET /map/{tx}/{tz}", s.handleMap)
	s.mux.HandleFunc("GET /photos/{file}", s.handlePhoto)
	s.mux.Handle("GET /", s.static())
	if opt.Dev {
		// Profiling for soak tests (tools/soak); never served without -dev.
		s.mux.HandleFunc("GET /debug/pprof/", pprof.Index)
		s.mux.HandleFunc("GET /debug/pprof/profile", pprof.Profile)
	}
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

// BytesSent is the number of WebSocket bytes written so far.
func (s *Server) BytesSent() int64 { return s.wsBytes.Load() }

// CloseAll closes every WebSocket connection (used on shutdown; http.Server.Shutdown
// does not close hijacked connections).
func (s *Server) CloseAll() {
	s.conns.Range(func(k, _ any) bool {
		k.(*conn).Close()
		return true
	})
}

func (s *Server) static() http.Handler {
	if s.opt.Dev && s.opt.WebDir != "" {
		if fi, err := os.Stat(s.opt.WebDir); err == nil && fi.IsDir() {
			fsrv := http.FileServer(http.Dir(s.opt.WebDir))
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				fsrv.ServeHTTP(w, r)
			})
		}
		s.opt.Logf("server: -dev web dir %q not found; serving the embedded client", s.opt.WebDir)
	}
	sub, _ := fs.Sub(web.FS, ".")
	fsrv := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		fsrv.ServeHTTP(w, r)
	})
}

const maxTile = 1 << 20

func parseCoord(s string) (int, bool) {
	n, err := strconv.Atoi(s)
	if err != nil || n < -maxTile || n > maxTile {
		return 0, false
	}
	return n, true
}

// handleMap serves /map/<tx>/<tz>.png, only for tiles the player has explored.
func (s *Server) handleMap(w http.ResponseWriter, r *http.Request) {
	tzs, ok := strings.CutSuffix(r.PathValue("tz"), ".png")
	tx, ok1 := parseCoord(r.PathValue("tx"))
	tz, ok2 := parseCoord(tzs)
	if !ok || !ok1 || !ok2 {
		http.Error(w, "bad tile", http.StatusBadRequest)
		return
	}
	if !s.opt.Runner.Explored(tx, tz) {
		http.Error(w, "unexplored", http.StatusNotFound)
		return
	}
	wld := s.opt.Runner.Terrain()
	etag := fmt.Sprintf(`"%d.%d.%d"`, wld.Seed(), tx, tz)
	w.Header().Set("ETag", etag)
	// The URL is the same in every world: revalidate so a new adventure never shows
	// an old world's map.
	w.Header().Set("Cache-Control", "private, no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	png, err := wld.MapTile(tx, tz)
	if err != nil {
		http.Error(w, "tile error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Write(png)
}

// handlePhoto serves /photos/<id>.jpg from the save directory.
func (s *Server) handlePhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := strings.CutSuffix(r.PathValue("file"), ".jpg")
	if !ok {
		http.NotFound(w, r)
		return
	}
	path, ok := s.opt.Runner.PhotoPath(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, path)
}

// ---------------------------------------------------------------------------
// WebSocket

func loopbackOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true // not a browser
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	h := u.Hostname()
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 64 * 1024,
	CheckOrigin:     loopbackOrigin,
}

const (
	queueSize   = 1024
	chunkQueue  = 512
	writeWait   = 10 * time.Second
	pingEvery   = 20 * time.Second
	readTimeout = 60 * time.Second
	maxMessage  = 2 << 20 // photos are data URLs of up to ~540 KB
)

type frame struct {
	binary bool
	data   []byte
}

// conn is one WebSocket client. It is the session's Sink: Send never blocks the
// simulation. Bird snapshots go through a single "latest" slot, so a slow client
// skips stale snapshots instead of backing up the queue; any other message that
// does not fit in the queue closes the connection (the client reconnects).
type conn struct {
	srv    *Server
	ws     *websocket.Conn
	queue  chan frame
	bin    chan []byte // terrain chunk frames (workers block here, never the simulation)
	chunks chan proto.ChunkReq
	birds  atomic.Pointer[[]byte]
	poke   chan struct{}
	closed chan struct{}
	once   sync.Once
}

func (c *conn) Send(t string, data []byte) {
	if t == proto.SBirds {
		c.birds.Store(&data)
		select {
		case c.poke <- struct{}{}:
		default:
		}
		return
	}
	select {
	case c.queue <- frame{data: data}:
	case <-c.closed:
	default:
		c.srv.opt.Logf("ws: client too slow, closing")
		c.Close()
	}
}

// SendBinary queues a terrain chunk. It may block (chunk workers and tests only),
// never the simulation's JSON messages, which have their own queue.
func (c *conn) SendBinary(data []byte) {
	select {
	case c.bin <- data:
	case <-c.closed:
	}
}

func (c *conn) Close() {
	c.once.Do(func() {
		close(c.closed)
		c.ws.Close()
	})
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade has answered
	}
	c := &conn{
		srv: s, ws: ws,
		queue:  make(chan frame, queueSize),
		bin:    make(chan []byte, 32),
		chunks: make(chan proto.ChunkReq, chunkQueue),
		poke:   make(chan struct{}, 1),
		closed: make(chan struct{}),
	}
	s.conns.Store(c, struct{}{})
	defer s.conns.Delete(c)
	run := s.opt.Runner
	id := run.Attach(c)
	go c.writePump()
	for i := 0; i < 2; i++ {
		go c.chunkWorker()
	}
	c.readPump(id)
	c.Close()
	run.Detach(id)
}

func (c *conn) readPump(id uint64) {
	c.ws.SetReadLimit(maxMessage)
	_ = c.ws.SetReadDeadline(time.Now().Add(readTimeout))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(readTimeout))
	})
	run := c.srv.opt.Runner
	for {
		mt, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(readTimeout))
		if mt != websocket.TextMessage {
			continue
		}
		var env proto.Envelope
		if err := json.Unmarshal(data, &env); err != nil || env.T == "" {
			c.Send(proto.SError, mustEncode(proto.SError, proto.ErrorMsg{Msg: "That message could not be read."}))
			continue
		}
		if env.T == proto.CChunkReq {
			var req proto.ChunkReq
			if err := json.Unmarshal(env.D, &req); err != nil || req.LOD < 0 || req.LOD > 2 ||
				req.CX < -maxTile || req.CX > maxTile || req.CZ < -maxTile || req.CZ > maxTile {
				c.Send(proto.SError, mustEncode(proto.SError, proto.ErrorMsg{Msg: "Bad chunk request."}))
				continue
			}
			select {
			case c.chunks <- req:
			case <-c.closed:
				return
			}
			continue
		}
		run.Message(id, env.T, env.D)
	}
}

// chunkWorker answers chunk requests off the simulation goroutine.
func (c *conn) chunkWorker() {
	for {
		select {
		case <-c.closed:
			return
		case req := <-c.chunks:
			data, err := c.srv.opt.Runner.Terrain().Chunk(req.CX, req.CZ, req.LOD)
			if err != nil {
				continue
			}
			c.SendBinary(data)
		}
	}
}

func (c *conn) write(mt int, data []byte) error {
	_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
	c.srv.wsBytes.Add(int64(len(data)))
	return c.ws.WriteMessage(mt, data)
}

func (c *conn) writePump() {
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	defer c.Close()
	for {
		select {
		case <-c.closed:
			return
		case f := <-c.queue:
			mt := websocket.TextMessage
			if f.binary {
				mt = websocket.BinaryMessage
			}
			if err := c.write(mt, f.data); err != nil {
				return
			}
		case b := <-c.bin:
			if err := c.write(websocket.BinaryMessage, b); err != nil {
				return
			}
		case <-c.poke:
			if b := c.birds.Swap(nil); b != nil {
				if err := c.write(websocket.TextMessage, *b); err != nil {
					return
				}
			}
		case <-ping.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func mustEncode(t string, v any) []byte {
	b, _ := proto.Encode(t, v)
	return b
}
