package eco

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Visibility of perched birds (the owner's "birds are not visible at all"):
// within their real habits, birds should spend a good share of their perched time
// on perches a player can see them on - low cover, outer branches, tree tops.

// visStats is what a run measured for one species.
type visStats struct {
	perched, low int // perched samples; those at cover < visLowCover
	sing, singLo int // singing samples; those at cover < visLowCover
	hist         [5]int
}

const visLowCover = 0.35

var visBands = [...]float32{1, 3, 6, 10}

// visRun simulates a morning in the woods around pos with a still observer at it
// and samples every perched (or singing) bird within r metres.
func visRun(t *testing.T, text string, at func(w *world.World) core.Vec3, day int, from float32, steps int) (map[int]*visStats, []core.Species) {
	t.Helper()
	s, w, spp := realSim(t, text)
	pos := at(w)
	env := envAt(day, from)
	obs := stillObserver(w, pos)
	out := map[int]*visStats{}
	for i := 0; i < steps; i++ {
		obs.Still += 0.1
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
		if i < 300 || i%20 != 0 {
			continue
		}
		for j := range s.birds {
			b := &s.birds[j]
			if !b.alive || b.moving || b.airborne() || b.pos.DistXZ(pos) > 400 {
				continue
			}
			switch b.act {
			case core.ActPerched, core.ActPreening, core.ActSocial, core.ActAlert, core.ActForaging, core.ActFeeding, core.ActClimbing:
			default:
				if b.flags&core.FlagSinging == 0 {
					continue
				}
			}
			st := out[int(b.sp)]
			if st == nil {
				st = &visStats{}
				out[int(b.sp)] = st
			}
			st.perched++
			lo := b.cover < visLowCover
			if lo {
				st.low++
			}
			if b.flags&core.FlagSinging != 0 {
				st.sing++
				if lo {
					st.singLo++
				}
			}
			h := heightAbove(w, b.pos)
			k := 0
			for k < len(visBands) && h >= visBands[k] {
				k++
			}
			st.hist[k]++
		}
	}
	return out, spp
}

func visReport(out map[int]*visStats, spp []core.Species) string {
	var ids []int
	for k := range out {
		ids = append(ids, k)
	}
	sort.Slice(ids, func(i, j int) bool { return spp[ids[i]].ID < spp[ids[j]].ID })
	var sb strings.Builder
	fmt.Fprintf(&sb, "%-24s %6s %7s %8s   %s\n", "species", "n", "cov<.35", "sing<.35", "height <1 | 1-3 | 3-6 | 6-10 | 10+ m")
	var n, lo int
	for _, k := range ids {
		st := out[k]
		if st.perched < 30 {
			continue
		}
		n += st.perched
		lo += st.low
		sing := "    -"
		if st.sing >= 10 {
			sing = fmt.Sprintf("%5.0f%%", 100*float64(st.singLo)/float64(st.sing))
		}
		var h []string
		for _, c := range st.hist {
			h = append(h, fmt.Sprintf("%3.0f%%", 100*float64(c)/float64(st.perched)))
		}
		fmt.Fprintf(&sb, "%-24s %6d %6.0f%% %8s   %s\n", spp[k].ID, st.perched, 100*float64(st.low)/float64(st.perched), sing, strings.Join(h, " "))
	}
	fmt.Fprintf(&sb, "%-24s %6d %6.0f%%\n", "ALL", n, 100*float64(lo)/float64(max(n, 1)))
	return sb.String()
}

// TestVisibilityReport prints, per species, the share of perched time spent at
// cover < 0.35 and the perch heights, for a spring morning around the cabin and in
// Amberwood. Set WILDCALL_VIS=1 to run it (it is a measuring aid).
func TestVisibilityReport(t *testing.T) {
	if os.Getenv("WILDCALL_VIS") == "" {
		t.Skip("set WILDCALL_VIS=1 to print the perch visibility report")
	}
	out, spp := visRun(t, "scenic", func(w *world.World) core.Vec3 { return cabinPos(t, w) }, 2, 6, 3600)
	t.Logf("Greenhollow (cabin), spring 06:00-12:00, still observer:\n%s", visReport(out, spp))
	out, spp = visRun(t, "scenic", func(w *world.World) core.Vec3 {
		p, ok := regionLand(w, core.RegionAmberwood)
		if !ok {
			t.Skip("no Amberwood")
		}
		return p
	}, 10, 7, 3600)
	t.Logf("Amberwood, autumn 07:00-13:00, still observer:\n%s", visReport(out, spp))
}

// TestBirdsShowThemselves: through a spring morning around the cabin, perched birds
// spend most of their time on perches a watcher can see them on, the birds of the
// crowns included - but the skulkers still keep to cover.
func TestBirdsShowThemselves(t *testing.T) {
	out, spp := visRun(t, "scenic", func(w *world.World) core.Vec3 { return cabinPos(t, w) }, 2, 6, 2400)
	var n, lo int
	share := func(id string) (float64, int) {
		k := indexOf(spp, id)
		st := out[k]
		if st == nil || st.perched == 0 {
			return 0, 0
		}
		return float64(st.low) / float64(st.perched), st.perched
	}
	for _, st := range out {
		n += st.perched
		lo += st.low
	}
	if f := float64(lo) / float64(max(n, 1)); f < 0.7 {
		t.Errorf("only %.0f%% of perched time at low cover", 100*f)
	}
	for _, id := range []string{"blue_tit", "common_chiffchaff", "goldcrest", "common_chaffinch"} {
		if f, m := share(id); m >= 100 && f < 0.55 {
			t.Errorf("%s: %.0f%% of %d samples at low cover", id, 100*f, m)
		}
	}
	for _, id := range []string{"eurasian_blackcap", "eurasian_wren"} {
		if f, m := share(id); m >= 100 && f > 0.75 {
			t.Errorf("skulker %s out in the open %.0f%% of %d samples", id, 100*f, m)
		}
	}
	if st := out[indexOf(spp, "eurasian_wren")]; st != nil && st.hist[2]+st.hist[3]+st.hist[4] > st.perched/10 {
		t.Errorf("the wren left its low tangle: heights %v", st.hist)
	}
}
