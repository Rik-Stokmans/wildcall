package narrator

import (
	"fmt"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// bank holds every line pool by name. Pools are registered by the lines_*.go files
// and species_lines.go.
//
// Writing rules for every line (enforced by tests): one or two sentences, at most 25
// words once slots are filled, speakable aloud (letters and . , ' ? ! ; : - only; no
// digits, symbols or parentheses). The narrator is an original character: warm,
// curious, gently wry, affectionate to small creatures, never mocking the player,
// never gamey (no XP, quests or levels), never a tutorial.
//
// Pool naming:
//
//	call.*  focus  observe.*  evidence.*  behaviour.*  flush  settle  rare.*
//	identify.*  photo.*  rec.*  place.*  region.*  time.*  weather.*  season.*
//	stillness  walking  cabin  rest  welcome  resume  rank  idle.*
//	sp.<species id>.hear|watch|note   shape.<shape>      (identified birds only)
//
// Only sp.* and shape.* pools, and templates using {name} or {aname}, may name a bird.
var bank = map[string][]string{}

func register(pools map[string][]string) {
	for k, v := range pools {
		if _, dup := bank[k]; dup {
			panic(fmt.Sprintf("narrator: pool %q registered twice", k))
		}
		bank[k] = v
	}
}

// LineCount returns the number of authored lines (templates) in the bank.
func LineCount() int {
	n := 0
	for _, v := range bank {
		n += len(v)
	}
	return n
}

// namingPool reports whether a pool may name a bird (only reachable for identified
// species).
func namingPool(pool string) bool {
	return strings.HasPrefix(pool, "sp.") || strings.HasPrefix(pool, "shape.")
}

// shortNames are the everyday names used in speech.
var shortNames = map[string]string{
	"european_robin": "robin", "blue_tit": "blue tit", "great_tit": "great tit",
	"common_blackbird": "blackbird", "eurasian_wren": "wren", "common_chaffinch": "chaffinch",
	"great_spotted_woodpecker": "great spotted woodpecker", "eurasian_jay": "jay",
	"eurasian_nuthatch": "nuthatch", "eurasian_treecreeper": "treecreeper", "tawny_owl": "tawny owl",
	"common_buzzard": "buzzard", "song_thrush": "song thrush", "goldcrest": "goldcrest",
	"long_tailed_tit": "long-tailed tit", "eurasian_blackcap": "blackcap",
	"common_chiffchaff": "chiffchaff", "grey_wagtail": "grey wagtail",
	"common_kingfisher": "kingfisher", "golden_oriole": "golden oriole", "mallard": "mallard",
	"common_moorhen": "moorhen", "grey_heron": "grey heron", "eurasian_reed_warbler": "reed warbler",
	"eurasian_bittern": "bittern", "western_marsh_harrier": "marsh harrier",
	"northern_wheatear": "wheatear", "common_raven": "raven", "ring_ouzel": "ring ouzel",
	"golden_eagle": "golden eagle", "herring_gull": "herring gull",
	"eurasian_oystercatcher": "oystercatcher", "great_cormorant": "cormorant",
	"atlantic_puffin": "puffin", "redwing": "redwing", "brambling": "brambling",
	"hawfinch": "hawfinch", "snow_bunting": "snow bunting", "rock_ptarmigan": "ptarmigan",
	"snowy_owl": "snowy owl",
}

// shortName is the spoken name of an identified species.
func shortName(sp *core.Species) string {
	if s, ok := shortNames[sp.ID]; ok {
		return s
	}
	if n := cleanWords(strings.ToLower(sp.Name), 5); n != "" {
		return n
	}
	return "bird"
}
