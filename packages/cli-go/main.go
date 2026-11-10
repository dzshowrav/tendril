package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/dzshowrav/tendril/packages/cli-go/client"
	"github.com/dzshowrav/tendril/packages/cli-go/ui"
)

func main() {
	var (
		portFlag      int
		modelFlag     string
		modeFlag      string
		workspaceFlag string
		helpFlag      bool
	)

	flag.IntVar(&portFlag, "p", 0, "Custom daemon port (e.g. 7421)")
	flag.IntVar(&portFlag, "port", 0, "Custom daemon port (e.g. 7421)")
	flag.StringVar(&modelFlag, "m", "claude-3-5-sonnet", "Default LLM model")
	flag.StringVar(&modelFlag, "model", "claude-3-5-sonnet", "Default LLM model")
	flag.StringVar(&modeFlag, "mode", "ask", "Session mode (ask, architect, code)")
	flag.StringVar(&workspaceFlag, "w", "", "Workspace path")
	flag.StringVar(&workspaceFlag, "workspace", "", "Workspace path")
	flag.BoolVar(&helpFlag, "h", false, "Show help")
	flag.BoolVar(&helpFlag, "help", false, "Show help")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: tendril-tui [options] [workspace_path]\n\n")
		fmt.Fprintf(os.Stderr, "Tendril Go TUI - High performance, dynamic terminal interface\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		fmt.Fprintf(os.Stderr, "  -p, --port <port>        Daemon port (default: 7421 or read from ~/.tendril/daemon.json)\n")
		fmt.Fprintf(os.Stderr, "  -m, --model <name>       Default AI model (default: claude-3-5-sonnet)\n")
		fmt.Fprintf(os.Stderr, "      --mode <mode>        Session mode: ask | architect | code (default: ask)\n")
		fmt.Fprintf(os.Stderr, "  -w, --workspace <dir>    Target workspace directory (default: current directory)\n")
		fmt.Fprintf(os.Stderr, "  -h, --help               Show this help message\n")
	}

	flag.Parse()

	if helpFlag {
		flag.Usage()
		os.Exit(0)
	}

	// Determine workspace
	workspace := workspaceFlag
	if workspace == "" && flag.NArg() > 0 {
		workspace = flag.Arg(0)
	}
	if workspace == "" {
		workspace, _ = os.Getwd()
	} else {
		abs, err := filepath.Abs(workspace)
		if err == nil {
			workspace = abs
		}
	}

	c := client.NewClient()
	if portFlag > 0 {
		c.BaseURL = fmt.Sprintf("http://127.0.0.1:%d", portFlag)
	}

	// 1. Ensure Daemon is active
	if err := c.EnsureDaemon(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Tendril daemon is not running. Please run `tendril serve` first.\n")
		os.Exit(1)
	}

	// 2. Create or resume session
	sess, err := c.CreateSession(workspace, modeFlag, modelFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating session: %v\n", err)
		os.Exit(1)
	}

	// 3. Start Bubbletea TUI Program
	m := ui.NewModel(c, sess)
	p := tea.NewProgram(
		m,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running TUI: %v\n", err)
		os.Exit(1)
	}
}
