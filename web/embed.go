// Package web embeds the browser client into the server binary.
package web

import "embed"

// FS holds index.html and the css, js and vendor trees, plus the optional asset
// packs: voice (pregenerated narrator lines) and birdsong (real recordings).
//
//go:embed index.html css js vendor voice birdsong
var FS embed.FS
