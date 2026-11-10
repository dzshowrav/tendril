package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/dzshowrav/tendril/packages/cli-go/client"
	"github.com/dzshowrav/tendril/packages/cli-go/ui"
)

func main() {
	// Parse workspace argument
	workspace, _ := os.Getwd()
	if len(os.Args) > 1 && !stringsHasPrefix(os.Args[1], "-") {
		abs, err := filepath.Abs(os.Args[1])
		if err == nil {
			workspace = abs
		}
	}

	mode := "ask"
	model := "claude-3-5-sonnet"

	c := client.NewClient()

	// 1. Ensure Daemon is active
	if err := c.EnsureDaemon(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Tendril daemon is not running. Please run `tendril serve` first.\n")
		os.Exit(1)
	}

	// 2. Create or resume session
	sess, err := c.CreateSession(workspace, mode, model)
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

func stringsHasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[0:len(prefix)] == prefix
}
