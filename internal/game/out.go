package game

import (
	"encoding/json"
	"math"
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// BinarySink is implemented by sinks that can carry binary frames (terrain chunks).
type BinarySink interface {
	SendBinary(data []byte)
}

// send encodes and delivers one message (dropped when no client is attached).
func (s *Session) send(t string, payload any) {
	if s.out == nil {
		return
	}
	data, err := proto.Encode(t, payload)
	if err != nil {
		s.logf("game: encode %s: %v", t, err)
		return
	}
	s.bytesOut += int64(len(data))
	s.devCount(t, len(data))
	s.out.Send(t, data)
}

func (s *Session) sendRaw(t string, data []byte) {
	if s.out == nil {
		return
	}
	s.bytesOut += int64(len(data))
	s.devCount(t, len(data))
	s.out.Send(t, data)
}

// fail sends a gentle error message. The profile is left as it was.
func (s *Session) fail(msg string) {
	s.send(proto.SError, proto.ErrorMsg{Msg: msg})
}

func (s *Session) failErr(err error) {
	if err == nil {
		return
	}
	s.fail(err.Error())
}

// toast sends a small HUD notification.
func (s *Session) toast(kind, title, text string, xp int, icon string) {
	s.send(proto.SToast, proto.Toast{Kind: kind, Title: title, Text: text, XP: xp, Icon: icon})
}

// changed marks the profile as changed: it is pushed at the end of the current
// message or tick.
func (s *Session) changed() { s.dirty = true }

// flush pushes the profile client view if it changed.
func (s *Session) flush() {
	if s.out == nil || !s.greeted {
		return
	}
	if s.dirty || (s.minor && s.now-s.lastPush >= minorPushGap) {
		s.send(proto.SProfile, s.clientView())
		s.dirty, s.minor = false, false
		s.lastPush = s.now
	}
}

// narrate offers an event to the narrator and sends the line it may produce. The
// narrator is isolated: a fault in it never disturbs the session.
//
// While a client message is being handled the lines are held back and sent after the
// message's direct reply (see Handle), so that, for example, the narrator's comment on
// an identification never reaches the client before the identifyResult itself.
func (s *Session) narrate(ev narrator.Event) {
	s.safeNarrator(func() {
		if n, ok := s.narr.Offer(ev, s.now); ok {
			if s.holdNarr {
				s.heldNarr = append(s.heldNarr, n)
				return
			}
			s.send(proto.SNarrate, n)
		}
	})
}

// releaseNarration sends the lines held back while a message was handled.
func (s *Session) releaseNarration() {
	s.holdNarr = false
	for _, n := range s.heldNarr {
		s.send(proto.SNarrate, n)
	}
	s.heldNarr = s.heldNarr[:0]
}

// inDialog reports whether a conversation is (probably) open on the client: the
// narrator keeps quiet then.
func (s *Session) inDialog() bool { return s.now < s.dialogUntil }

func (s *Session) safeNarrator(fn func()) {
	defer func() {
		if r := recover(); r != nil {
			s.logf("narrator: panic: %v", r)
		}
	}()
	fn()
}

// birdsFrame encodes a bird snapshot. The contract's BirdsMsg uses float32 arrays,
// which cannot hold 32-bit bird ids exactly; this encoder writes the same JSON
// shape with exact integer ids and centimetre positions.
func (s *Session) birdsFrame(birds []core.BirdState) []byte {
	b := make([]byte, 0, 48+len(birds)*64)
	b = append(b, `{"t":"birds","d":{"tick":`...)
	b = strconv.AppendUint(b, uint64(s.tick), 10)
	b = append(b, `,"b":[`...)
	for i, bd := range birds {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, '[')
		b = strconv.AppendUint(b, uint64(bd.ID), 10)
		b = append(b, ',')
		b = strconv.AppendInt(b, int64(bd.Species), 10)
		b = append(b, ',')
		b = strconv.AppendUint(b, uint64(bd.Act), 10)
		b = append(b, ',')
		b = strconv.AppendUint(b, uint64(bd.Flags), 10)
		for _, v := range [...]float32{bd.Pos.X, bd.Pos.Y, bd.Pos.Z} {
			b = append(b, ',')
			b = appendNum(b, v, 2)
		}
		b = append(b, ',')
		b = appendNum(b, bd.Yaw, 3)
		b = append(b, ',')
		b = appendNum(b, bd.Speed, 2)
		b = append(b, ']')
	}
	b = append(b, "]}}"...)
	return b
}

func appendNum(b []byte, v float32, prec int) []byte {
	f := float64(v)
	if math.IsNaN(f) || math.IsInf(f, 0) {
		f = 0
	}
	return strconv.AppendFloat(b, f, 'f', prec, 32)
}

// mustJSON is a tiny helper for tests and debug output.
func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
