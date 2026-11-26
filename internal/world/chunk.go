package world

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Chunk binary format (contract §2.3), version 2.
const (
	chunkVersion  = 2
	chunkHeader   = 16
	vegRecordSize = 20
	maxLOD        = 2
)

// Chunk returns the encoded binary chunk frame for (cx, cz) at a LOD (0..2).
// Frames are cached.
func (w *World) Chunk(cx, cz, lod int) ([]byte, error) {
	if lod < 0 || lod > maxLOD {
		return nil, fmt.Errorf("world: chunk lod %d out of range 0..%d", lod, maxLOD)
	}
	return w.chunks.get(lodKey{cx, cz, lod}, func() []byte { return w.encodeChunk(cx, cz, lod) }), nil
}

// chunkSide returns the vertex count per side and grid stride for a LOD.
func chunkSide(lod int) (n, stride int) {
	cell := 2 << lod
	return core.ChunkSize/cell + 1, 1 << lod
}

func (w *World) encodeChunk(cx, cz, lod int) []byte {
	gr := w.grid(cx, cz)
	vs := w.vegetation(cx, cz)
	n, stride := chunkSide(lod)
	nv := n * n
	nveg := 0
	for _, l := range vs.lod {
		if int(l) >= lod {
			nveg++
		}
	}
	body := chunkHeader + nv*(4+3+3+1+1)
	padded := (body + 3) &^ 3
	buf := make([]byte, padded+4+nveg*vegRecordSize)
	copy(buf, "WCHK")
	buf[4] = chunkVersion
	buf[5] = byte(lod)
	le := binary.LittleEndian
	le.PutUint16(buf[6:], uint16(n))
	le.PutUint32(buf[8:], uint32(int32(cx)))
	le.PutUint32(buf[12:], uint32(int32(cz)))
	oh := chunkHeader
	on := oh + nv*4
	oc := on + nv*3
	or := oc + nv*3
	ob := or + nv
	for iz := 0; iz < n; iz++ {
		for ix := 0; ix < n; ix++ {
			i := iz*n + ix
			v := &gr.v[iz*stride*gridN+ix*stride]
			le.PutUint32(buf[oh+i*4:], math.Float32bits(v.h))
			buf[on+i*3], buf[on+i*3+1], buf[on+i*3+2] = byte(v.nrm[0]), byte(v.nrm[1]), byte(v.nrm[2])
			buf[oc+i*3], buf[oc+i*3+1], buf[oc+i*3+2] = v.col[0], v.col[1], v.col[2]
			buf[or+i] = v.reg
			buf[ob+i] = v.hab
		}
	}
	le.PutUint32(buf[padded:], uint32(nveg))
	o := padded + 4
	for i := range vs.veg {
		if int(vs.lod[i]) < lod {
			continue
		}
		v := &vs.veg[i]
		buf[o] = byte(v.Kind)
		buf[o+1] = v.Variant
		rot := math.Mod(float64(v.Rot), 2*math.Pi)
		if rot < 0 {
			rot += 2 * math.Pi
		}
		le.PutUint16(buf[o+2:], uint16(math.Round(rot/(2*math.Pi)*65535)))
		le.PutUint32(buf[o+4:], math.Float32bits(v.Pos.X))
		le.PutUint32(buf[o+8:], math.Float32bits(v.Pos.Y))
		le.PutUint32(buf[o+12:], math.Float32bits(v.Pos.Z))
		le.PutUint32(buf[o+16:], math.Float32bits(v.Scale))
		o += vegRecordSize
	}
	return buf
}
