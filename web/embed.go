// Package web embeds the browser client into the server binary.
package web

import "embed"

// FS holds index.html and the css, js and vendor trees.
//
//go:embed index.html css js vendor
var FS embed.FS
