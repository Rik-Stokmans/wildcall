package game

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Runner drives a Session on its own goroutine: a 10 Hz ticker plus a queue of
// work from connections. All session state changes happen on that goroutine.
type Runner struct {
	s    *Session
	in   chan func(*Session)
	mu   sync.Mutex
	conn uint64 // id of the attached connection (0 = none)
	next uint64
	done chan struct{}
}

// NewRunner wraps a session.
func NewRunner(s *Session) *Runner {
	return &Runner{s: s, in: make(chan func(*Session), 1024), done: make(chan struct{})}
}

// Terrain is the current world, safe from any goroutine.
func (r *Runner) Terrain() *world.World { return r.s.Terrain() }

// Explored reports whether a map tile has an explored cell (any goroutine).
func (r *Runner) Explored(tx, tz int) bool { return r.s.Explored(tx, tz) }

// Dev reports whether debug commands are enabled.
func (r *Runner) Dev() bool { return r.s.cfg.Dev }

// Store path helpers for the HTTP layer.
func (r *Runner) PhotoPath(id string) (string, bool) { return r.s.cfg.Store.PhotoPath(id) }

// Do queues work on the simulation goroutine and waits for it.
func (r *Runner) Do(fn func(*Session)) {
	ch := make(chan struct{})
	select {
	case r.in <- func(s *Session) { defer close(ch); fn(s) }:
		select {
		case <-ch:
		case <-r.done:
		}
	case <-r.done:
	}
}

// post queues work without waiting.
func (r *Runner) post(fn func(*Session)) {
	select {
	case r.in <- fn:
	case <-r.done:
	}
}

// Attach makes a connection the active one, replacing any previous one (which is
// told to close through its sink's Close, if it has one). It returns the id the
// connection must use.
func (r *Runner) Attach(sink Sink) uint64 {
	r.mu.Lock()
	r.next++
	id := r.next
	r.conn = id
	r.mu.Unlock()
	r.Do(func(s *Session) {
		if old, ok := s.out.(interface{ Close() }); ok && s.out != sink {
			old.Close()
		}
		if s.out != nil && s.out != sink {
			_ = s.Save()
		}
		s.Attach(sink)
	})
	return id
}

func (r *Runner) current(id uint64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.conn == id
}

// Detach disconnects a connection (a no-op if it was already replaced) and saves.
func (r *Runner) Detach(id uint64) {
	r.mu.Lock()
	if r.conn != id {
		r.mu.Unlock()
		return
	}
	r.conn = 0
	r.mu.Unlock()
	r.Do(func(s *Session) { s.Detach() })
}

// Message hands a client message to the session (ignored for a replaced connection).
func (r *Runner) Message(id uint64, t string, d json.RawMessage) {
	r.post(func(s *Session) {
		if r.current(id) {
			s.Handle(t, d)
		}
	})
}

// Run ticks the session at 10 Hz until ctx is cancelled, then saves.
func (r *Runner) Run(ctx context.Context) {
	defer close(r.done)
	t := time.NewTicker(time.Second / 10)
	defer t.Stop()
	last := time.Now()
	for {
		select {
		case <-ctx.Done():
			// Drain queued work, then save.
		drain:
			for {
				select {
				case fn := <-r.in:
					fn(r.s)
				default:
					break drain
				}
			}
			if err := r.s.Save(); err != nil {
				r.s.logf("save on shutdown: %v", err)
			}
			return
		case fn := <-r.in:
			fn(r.s)
		case now := <-t.C:
			dt := now.Sub(last).Seconds()
			last = now
			if dt > 0.25 {
				dt = 0.25
			}
			r.s.Tick(float32(dt))
		}
	}
}
