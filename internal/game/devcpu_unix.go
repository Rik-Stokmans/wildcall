//go:build unix

package game

import (
	"syscall"
	"time"
)

// processCPU is the engine process's CPU time so far (user + system), for the -dev
// soak metrics: tick wall times include waiting for a core on a busy machine, the
// CPU share does not.
func processCPU() time.Duration {
	var ru syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &ru) != nil {
		return 0
	}
	return time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
}
