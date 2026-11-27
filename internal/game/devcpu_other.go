//go:build !unix

package game

import "time"

// processCPU is not measured on this platform (the -dev soak metrics report 0).
func processCPU() time.Duration { return 0 }
