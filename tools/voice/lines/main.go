// Command lines prints every sentence the narrator can ever say, as JSON, for the
// voice generator (tools/voice/generate.mjs) and for review:
//
//	go run ./tools/voice/lines            # [{"id","text","kind"}, …] (pretty)
//	go run ./tools/voice/lines -compact   # one line of JSON
//	go run ./tools/voice/lines -stats     # counts per pool family, to stderr-free stdout
//
// The list comes from narrator.AllLines over the full species catalog
// (internal/species), so it includes every species' facts.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/species"
)

func main() {
	compact := flag.Bool("compact", false, "print compact JSON")
	stats := flag.Bool("stats", false, "print counts per pool family instead of the lines")
	flag.Parse()

	lines := narrator.AllLines(species.All())
	if *stats {
		count := map[string]int{}
		chars := 0
		for _, l := range lines {
			fam := l.Kind
			if strings.HasPrefix(fam, "sp.") {
				fam = "sp.*." + fam[strings.LastIndexByte(fam, '.')+1:]
			} else if i := strings.IndexByte(fam, '.'); i > 0 {
				fam = fam[:i]
			}
			count[fam]++
			chars += len(l.Text)
		}
		var keys []string
		for k := range count {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Printf("%-16s %5d\n", k, count[k])
		}
		fmt.Printf("%-16s %5d lines, %d characters\n", "total", len(lines), chars)
		return
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if !*compact {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(lines); err != nil {
		fmt.Fprintln(os.Stderr, "lines:", err)
		os.Exit(1)
	}
}
