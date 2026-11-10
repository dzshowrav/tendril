package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

type CommandItem struct {
	Name string
	Desc string
}

var AvailableCommands = []CommandItem{
	{Name: "/help", Desc: "Show available commands & keybindings"},
	{Name: "/model", Desc: "Switch active LLM model"},
	{Name: "/mode", Desc: "Switch session mode (ask / architect / code)"},
	{Name: "/clear", Desc: "Clear scrollback & conversation history"},
	{Name: "/compact", Desc: "Compact session context history"},
	{Name: "/crew", Desc: "Multi-agent crew swarm mode"},
	{Name: "/review", Desc: "Open document review screen"},
	{Name: "/sessions", Desc: "List & resume recent sessions"},
	{Name: "/exit", Desc: "Exit Tendril TUI"},
}

type AutocompletePopup struct {
	Active   bool
	Query    string
	Matches  []CommandItem
	Selected int
}

func (ac *AutocompletePopup) Update(input string) {
	if !strings.HasPrefix(input, "/") {
		ac.Active = false
		ac.Matches = nil
		ac.Selected = 0
		return
	}

	query := strings.ToLower(input)
	var matches []CommandItem
	for _, cmd := range AvailableCommands {
		if strings.HasPrefix(strings.ToLower(cmd.Name), query) {
			matches = append(matches, cmd)
		}
	}

	ac.Query = query
	ac.Matches = matches
	ac.Active = len(matches) > 0
	if ac.Selected >= len(matches) {
		ac.Selected = 0
	}
}

func (ac *AutocompletePopup) SelectNext() {
	if len(ac.Matches) > 0 {
		ac.Selected = (ac.Selected + 1) % len(ac.Matches)
	}
}

func (ac *AutocompletePopup) SelectPrev() {
	if len(ac.Matches) > 0 {
		ac.Selected = (ac.Selected - 1 + len(ac.Matches)) % len(ac.Matches)
	}
}

func (ac *AutocompletePopup) SelectedCommand() string {
	if len(ac.Matches) > 0 && ac.Selected < len(ac.Matches) {
		return ac.Matches[ac.Selected].Name
	}
	return ""
}

func (ac *AutocompletePopup) Render(width int) string {
	if !ac.Active || len(ac.Matches) == 0 {
		return ""
	}

	maxVisible := 6
	if maxVisible > len(ac.Matches) {
		maxVisible = len(ac.Matches)
	}

	var rows []string
	for i := 0; i < maxVisible; i++ {
		item := ac.Matches[i]
		isSel := (i == ac.Selected)

		caret := "  "
		cmdStyle := StyleCyan
		descStyle := StyleMuted

		if isSel {
			caret = GlyphFocus + " "
			cmdStyle = lipgloss.NewStyle().Bold(true).Foreground(ColorCyan)
			descStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#E5E7EB"))
		}

		cmdCol := cmdStyle.Render(fmt.Sprintf("%-12s", item.Name))
		descCol := descStyle.Render(item.Desc)

		row := fmt.Sprintf("%s%s  %s", caret, cmdCol, descCol)
		rows = append(rows, row)
	}

	boxWidth := width - 4
	if boxWidth < 40 {
		boxWidth = 40
	}

	content := strings.Join(rows, "\n")
	return StylePopupBorder.Width(boxWidth).Render(content)
}
