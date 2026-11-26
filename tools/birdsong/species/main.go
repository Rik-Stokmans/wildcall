// Command species writes the species list the birdsong fetch tool plans from.
//
//	go run ./tools/birdsong/species            # writes tools/birdsong/species.json
//	go run ./tools/birdsong/species -o -       # prints to stdout
//
// The list carries, for every species of the catalog: id, index, common and scientific
// name, and the kind / pattern of each synthesised call (the call index is the index the
// client uses in manifest.json, so recordings line up with CallMsg.Call).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/Rik-Stokmans/wildcall/internal/species"
)

type callInfo struct {
	Index   int     `json:"index"`
	Kind    string  `json:"kind"`
	Pattern string  `json:"pattern"`
	Loud    float32 `json:"loud"`
}

type entry struct {
	ID     string     `json:"id"`
	Index  int        `json:"index"`
	Name   string     `json:"name"`
	Sci    string     `json:"sci"`
	Family string     `json:"family"`
	Calls  []callInfo `json:"calls"`
}

func main() {
	out := flag.String("o", "tools/birdsong/species.json", "output file, - for stdout")
	flag.Parse()
	var list []entry
	for _, sp := range species.All() {
		e := entry{ID: sp.ID, Index: sp.Index, Name: sp.Name, Sci: sp.Sci, Family: sp.Family}
		for i, c := range sp.Calls {
			e.Calls = append(e.Calls, callInfo{Index: i, Kind: c.Kind, Pattern: c.Pattern, Loud: c.Loud})
		}
		list = append(list, e)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data = append(data, '\n')
	if *out == "-" {
		os.Stdout.Write(data)
		return
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "wrote %d species to %s\n", len(list), *out)
}
