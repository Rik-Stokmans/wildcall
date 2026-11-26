// Command wildcall is the WILDCALL engine: it generates the world, runs the
// simulation and serves the web client over HTTP + WebSocket (docs/contract.md §6).
//
//	wildcall [-addr 127.0.0.1:8080] [-seed <text>] [-save <dir>] [-daylen 1440]
//	         [-dev] [-open] [-parent-stdin]
//
// As soon as the engine accepts connections it prints exactly one line to stdout:
//
//	WILDCALL_LISTENING http://127.0.0.1:<port>
//
// Everything else (diagnostics, timings) goes to stderr.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/game"
	"github.com/Rik-Stokmans/wildcall/internal/save"
	"github.com/Rik-Stokmans/wildcall/internal/server"
)

func main() {
	start := time.Now()
	addr := flag.String("addr", "127.0.0.1:8080", "listen address (host:port; port 0 picks a free one)")
	seed := flag.String("seed", "", "world seed used when no save exists yet (text or number; empty = random)")
	saveDir := flag.String("save", "", "save directory (default: <user config dir>/Wildcall)")
	dayLen := flag.Float64("daylen", 1440, "real seconds per in-game day")
	dev := flag.Bool("dev", false, "serve web/ from disk and enable debug commands")
	open := flag.Bool("open", false, "open the system browser (development)")
	parentStdin := flag.Bool("parent-stdin", false, "exit (after saving) when stdin reaches EOF")
	flag.Parse()

	logger := log.New(os.Stderr, "wildcall: ", log.Ltime|log.Lmicroseconds)
	logf := logger.Printf

	if err := run(start, *addr, *seed, *saveDir, float32(*dayLen), *dev, *open, *parentStdin, logf); err != nil {
		logger.Printf("fatal: %v", err)
		os.Exit(1)
	}
}

func run(start time.Time, addr, seed, saveDir string, dayLen float32, dev, open, parentStdin bool, logf func(string, ...any)) error {
	since := func() string { return time.Since(start).Round(time.Millisecond).String() }

	if saveDir == "" {
		cfg, err := os.UserConfigDir()
		if err != nil {
			return fmt.Errorf("no -save given and no user config directory: %w", err)
		}
		saveDir = filepath.Join(cfg, "Wildcall")
	}
	if !(dayLen > 0) || dayLen > 1e6 {
		return fmt.Errorf("-daylen must be a positive number of seconds")
	}
	store, err := save.Open(saveDir)
	if err != nil {
		return err
	}
	logf("save dir %s", store.Dir())

	// Bind first so a bad address fails fast, but announce only once serving.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	logf("[%s] bound %s", since(), ln.Addr())

	sess, err := game.New(game.Config{Store: store, Dev: dev, DayLen: dayLen, Seed: seed, Logf: logf})
	if err != nil {
		ln.Close()
		return err
	}
	logf("[%s] world ready: seed %d, %d birds active", since(), sess.Seed(), sess.Sim().Count())
	for _, e := range game.ValidateCatalogs(sess.HomePOIIDs()) {
		logf("catalog: %v", e)
	}

	runner := game.NewRunner(sess)
	srv := server.New(server.Options{Runner: runner, Dev: dev, WebDir: findWebDir(), Logf: logf})
	httpSrv := &http.Server{Handler: srv, ReadHeaderTimeout: 10 * time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	simDone := make(chan struct{})
	go func() { runner.Run(ctx); close(simDone) }()

	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()

	url := "http://" + listenURLHost(ln.Addr())
	fmt.Fprintln(os.Stdout, "WILDCALL_LISTENING "+url)
	logf("[%s] listening on %s (dev=%v)", since(), url, dev)
	if open {
		openBrowser(url, logf)
	}

	// Stop on a signal, on stdin EOF (-parent-stdin) or when the server fails.
	stop := make(chan string, 2)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { s := <-sig; stop <- "signal " + s.String() }()
	if parentStdin {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			stop <- "stdin closed"
		}()
	}
	var runErr error
	select {
	case why := <-stop:
		logf("shutting down: %s", why)
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			runErr = err
		}
	}

	// Graceful shutdown: stop accepting, close the WebSockets, let the simulation
	// drain its queue and save.
	sctx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer scancel()
	_ = httpSrv.Shutdown(sctx)
	srv.CloseAll()
	cancel()
	select {
	case <-simDone:
		logf("saved; bye")
	case <-time.After(10 * time.Second):
		logf("simulation did not stop in time")
	}
	return runErr
}

// listenURLHost renders the bound address for the announcement line. A wildcard
// bind is announced as loopback (the desktop shell connects locally).
func listenURLHost(a net.Addr) string {
	ta, ok := a.(*net.TCPAddr)
	if !ok {
		return a.String()
	}
	host := "127.0.0.1"
	if ta.IP != nil && !ta.IP.IsUnspecified() {
		host = ta.IP.String()
		if ta.IP.To4() == nil {
			host = "[" + host + "]"
		}
	}
	return host + ":" + strconv.Itoa(ta.Port)
}

// findWebDir locates the client sources on disk for -dev: ./web, or a web/
// directory beside or above the executable or the working directory.
func findWebDir() string {
	var roots []string
	if wd, err := os.Getwd(); err == nil {
		roots = append(roots, wd)
	}
	if exe, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Dir(exe))
	}
	for _, r := range roots {
		dir := r
		for i := 0; i < 5; i++ {
			cand := filepath.Join(dir, "web")
			if fi, err := os.Stat(filepath.Join(cand, "index.html")); err == nil && !fi.IsDir() {
				return cand
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "web"
}

func openBrowser(url string, logf func(string, ...any)) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		logf("open browser: %v", err)
	}
}
