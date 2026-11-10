package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/dzshowrav/tendril/packages/cli-go/client"
)

type AppState int

const (
	StateNormal AppState = iota
	StateApproval
)

type SSEMsg client.SSEEvent

type TickMsg time.Time

type Model struct {
	client        *client.TendrilClient
	session       *client.Session
	eventChan     chan client.SSEEvent
	state         AppState

	// UI Components
	viewport      viewport.Model
	textarea      textarea.Model
	spinner       spinner.Model

	// Screen dimensions
	width         int
	height        int
	ready         bool

	// Conversation Content
	historyLines  []string
	currentTurn   strings.Builder
	isThinking    bool
	isBusy        bool
	busyStartTime time.Time
	elapsedSecs   int

	// Autocomplete
	autocomplete  AutocompletePopup
	popupOpen     bool
	popupItems    []string
	popupIndex    int

	// Approval Dialog State
	pendingReqID  string
	approvalTool  string
	approvalDesc  string
	approvalOpts  []string
	approvalIndex int

	// Context info
	contextPercent int
}

func NewModel(c *client.TendrilClient, sess *client.Session) Model {
	ta := textarea.New()
	ta.Placeholder = "Ask anything   / commands   @ files   ! shell"
	ta.Focus()
	ta.Prompt = "> "
	ta.CharLimit = 4000
	ta.ShowLineNumbers = false
	ta.SetHeight(2)

	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(ColorCyan)

	ch := make(chan client.SSEEvent, 100)

	return Model{
		client:         c,
		session:        sess,
		eventChan:      ch,
		state:          StateNormal,
		textarea:       ta,
		spinner:        sp,
		contextPercent: 14,
	}
}

func (m Model) Init() tea.Cmd {
	// Start SSE subscription
	_ = m.client.SubscribeEvents(m.session.ID, m.eventChan)

	return tea.Batch(
		textarea.Blink,
		m.spinner.Tick,
		m.waitForSSE(),
		m.tickTimer(),
	)
}

func (m Model) waitForSSE() tea.Cmd {
	return func() tea.Msg {
		ev := <-m.eventChan
		return SSEMsg(ev)
	}
}

func (m Model) tickTimer() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return TickMsg(t)
	})
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var (
		tiCmd tea.Cmd
		vpCmd tea.Cmd
		spCmd tea.Cmd
		cmds  []tea.Cmd
	)

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

		headerHeight := 8 // Banner
		footerHeight := 1 // Status bar
		inputHeight := m.textarea.Height() + 2
		vpHeight := m.height - headerHeight - footerHeight - inputHeight
		if vpHeight < 5 {
			vpHeight = 5
		}

		if !m.ready {
			m.viewport = viewport.New(msg.Width, vpHeight)
			m.viewport.SetContent(strings.Join(m.historyLines, "\n"))
			m.ready = true
		} else {
			m.viewport.Width = msg.Width
			m.viewport.Height = vpHeight
		}

		m.textarea.SetWidth(msg.Width - 4)

	case TickMsg:
		if m.isBusy {
			m.elapsedSecs = int(time.Since(m.busyStartTime).Seconds())
		}
		cmds = append(cmds, m.tickTimer())

	case SSEMsg:
		cmds = append(cmds, m.waitForSSE())
		ev := client.SSEEvent(msg)

		switch ev.Type {
		case "text.delta":
			txt, _ := ev.Data["text"].(string)
			m.currentTurn.WriteString(txt)
			m.syncViewport()

		case "tool.start":
			toolName, _ := ev.Data["name"].(string)
			if toolName == "" {
				toolName, _ = ev.Data["tool"].(string)
			}
			m.commitCurrentTurn()
			m.historyLines = append(m.historyLines, StyleTitle.Render(fmt.Sprintf("%s %s()", GlyphBullet, toolName)))
			m.syncViewport()

		case "tool.output":
			chunk, _ := ev.Data["chunk"].(string)
			lines := strings.Split(chunk, "\n")
			for _, l := range lines {
				if strings.TrimSpace(l) != "" {
					m.historyLines = append(m.historyLines, StyleMuted.Render("     "+l))
				}
			}
			m.syncViewport()

		case "tool.end":
			summary, _ := ev.Data["summary"].(string)
			if summary == "" {
				summary = "Done"
			}
			m.historyLines = append(m.historyLines, StyleSuccess.Render(fmt.Sprintf("  %s %s %s", GlyphConnector, GlyphSuccess, summary)))
			m.historyLines = append(m.historyLines, "")
			m.syncViewport()

		case "tool.permission":
			m.isBusy = false
			m.state = StateApproval
			reqID, _ := ev.Data["requestId"].(string)
			toolName, _ := ev.Data["tool"].(string)
			summary, _ := ev.Data["summary"].(string)

			m.pendingReqID = reqID
			m.approvalTool = toolName
			m.approvalDesc = summary
			m.approvalOpts = []string{
				"1. Yes, once",
				"2. Yes, and allow always",
				"3. No, deny",
			}
			m.approvalIndex = 0

		case "session.status":
			status, _ := ev.Data["status"].(string)
			if status == "idle" {
				m.isBusy = false
				m.commitCurrentTurn()
				m.syncViewport()
			}
		}

	case tea.KeyMsg:
		if m.state == StateApproval {
			switch msg.String() {
			case "y", "1":
				_ = m.client.ResolvePermission(m.session.ID, m.pendingReqID, "allow_once", "")
				m.state = StateNormal
				m.isBusy = true
				return m, nil
			case "a", "2":
				_ = m.client.ResolvePermission(m.session.ID, m.pendingReqID, "allow_always", "")
				m.state = StateNormal
				m.isBusy = true
				return m, nil
			case "n", "3", "esc":
				_ = m.client.ResolvePermission(m.session.ID, m.pendingReqID, "deny", "")
				m.state = StateNormal
				return m, nil
			case "up":
				if m.approvalIndex > 0 {
					m.approvalIndex--
				}
				return m, nil
			case "down":
				if m.approvalIndex < len(m.approvalOpts)-1 {
					m.approvalIndex++
				}
				return m, nil
			case "enter":
				dec := "allow_once"
				if m.approvalIndex == 1 {
					dec = "allow_always"
				} else if m.approvalIndex == 2 {
					dec = "deny"
				}
				_ = m.client.ResolvePermission(m.session.ID, m.pendingReqID, dec, "")
				m.state = StateNormal
				if dec != "deny" {
					m.isBusy = true
				}
				return m, nil
			}
			return m, nil
		}

		// Handle normal mode keys
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit

		case tea.KeyEsc:
			if m.autocomplete.Active {
				m.autocomplete.Active = false
				return m, nil
			}
			if m.isBusy {
				_ = m.client.AbortSession(m.session.ID)
				m.isBusy = false
				m.historyLines = append(m.historyLines, StyleWarning.Render(fmt.Sprintf("  %s %s Interrupted by user", GlyphConnector, GlyphWaiting)), "")
				m.commitCurrentTurn()
				m.syncViewport()
				return m, nil
			}

		case tea.KeyUp:
			if m.autocomplete.Active {
				m.autocomplete.SelectPrev()
				return m, nil
			}

		case tea.KeyDown:
			if m.autocomplete.Active {
				m.autocomplete.SelectNext()
				return m, nil
			}

		case tea.KeyTab:
			if m.autocomplete.Active {
				cmd := m.autocomplete.SelectedCommand()
				if cmd != "" {
					m.textarea.SetValue(cmd + " ")
					m.autocomplete.Active = false
					return m, nil
				}
			}

		case tea.KeyEnter:
			input := strings.TrimSpace(m.textarea.Value())
			if input == "" {
				return m, nil
			}

			// If autocomplete was active and user pressed Enter without spaces
			if m.autocomplete.Active && !strings.Contains(input, " ") {
				sel := m.autocomplete.SelectedCommand()
				if sel != "" {
					input = sel
				}
				m.autocomplete.Active = false
			}

			// Built-in slash commands
			if strings.HasPrefix(input, "/") {
				parts := strings.Fields(input)
				rootCmd := strings.ToLower(parts[0])

				switch rootCmd {
				case "/clear":
					m.historyLines = nil
					m.currentTurn.Reset()
					m.viewport.SetContent("")
					m.textarea.Reset()
					m.autocomplete.Active = false
					return m, nil

				case "/exit", "/quit":
					return m, tea.Quit

				case "/help":
					m.textarea.Reset()
					m.autocomplete.Active = false
					m.historyLines = append(m.historyLines,
						StyleCyan.Render(fmt.Sprintf("%s %s", GlyphPrompt, input)),
						m.renderHelpOverlay(),
						"",
					)
					m.syncViewport()
					return m, nil

				case "/mode":
					m.textarea.Reset()
					m.autocomplete.Active = false
					if len(parts) > 1 {
						newMode := strings.ToLower(parts[1])
						if newMode == "ask" || newMode == "architect" || newMode == "code" {
							m.session.Mode = newMode
							m.historyLines = append(m.historyLines,
								StyleCyan.Render(fmt.Sprintf("%s %s", GlyphPrompt, input)),
								StyleSuccess.Render(fmt.Sprintf("  %s Switched mode to: %s", GlyphSuccess, newMode)),
								"",
							)
						} else {
							m.historyLines = append(m.historyLines,
								StyleError.Render("  Usage: /mode <ask | architect | code>"),
								"",
							)
						}
					} else {
						m.historyLines = append(m.historyLines,
							StyleTitle.Render(fmt.Sprintf("  Current mode: %s (Available: ask, architect, code)", m.session.Mode)),
							"",
						)
					}
					m.syncViewport()
					return m, nil

				case "/model":
					m.textarea.Reset()
					m.autocomplete.Active = false
					if len(parts) > 1 {
						newModel := parts[1]
						m.session.Model = newModel
						m.historyLines = append(m.historyLines,
							StyleCyan.Render(fmt.Sprintf("%s %s", GlyphPrompt, input)),
							StyleSuccess.Render(fmt.Sprintf("  %s Switched model to: %s", GlyphSuccess, newModel)),
							"",
						)
					} else {
						m.historyLines = append(m.historyLines,
							StyleTitle.Render(fmt.Sprintf("  Current model: %s", m.session.Model)),
							"",
						)
					}
					m.syncViewport()
					return m, nil
				}
			}

			// Normal prompt
			m.historyLines = append(m.historyLines, StyleCyan.Render(fmt.Sprintf("%s %s", GlyphPrompt, input)), "")
			m.textarea.Reset()
			m.autocomplete.Active = false
			m.isBusy = true
			m.busyStartTime = time.Now()
			m.elapsedSecs = 0

			// Send to daemon
			_ = m.client.SendMessage(m.session.ID, input)
			m.syncViewport()
			return m, nil
		}
	}

	m.textarea, tiCmd = m.textarea.Update(msg)
	m.autocomplete.Update(m.textarea.Value())
	m.viewport, vpCmd = m.viewport.Update(msg)
	m.spinner, spCmd = m.spinner.Update(msg)

	cmds = append(cmds, tiCmd, vpCmd, spCmd)
	return m, tea.Batch(cmds...)
}

func (m *Model) commitCurrentTurn() {
	if m.currentTurn.Len() > 0 {
		text := m.currentTurn.String()
		rendered := RenderMarkdown(text, m.width)
		lines := strings.Split(rendered, "\n")
		for i, l := range lines {
			if i == 0 {
				m.historyLines = append(m.historyLines, StyleTitle.Render(fmt.Sprintf("%s %s", GlyphBullet, l)))
			} else {
				m.historyLines = append(m.historyLines, "  "+l)
			}
		}
		m.historyLines = append(m.historyLines, "")
		m.currentTurn.Reset()
	}
}

func (m *Model) syncViewport() {
	content := strings.Join(m.historyLines, "\n")
	if m.currentTurn.Len() > 0 {
		content += "\n" + StyleTitle.Render(fmt.Sprintf("%s %s", GlyphBullet, m.currentTurn.String()))
	}
	m.viewport.SetContent(content)
	m.viewport.GotoBottom()
}

func (m Model) View() string {
	if !m.ready {
		return "Initializing Tendril TUI..."
	}

	var sb strings.Builder

	// Zone A: Welcome Banner (76 cols or width)
	bannerBox := StyleBannerBorder.Width(m.width - 4).Render(
		fmt.Sprintf("Tendril v0.1.0  ·  Workspace: %s\nModel: %s   Mode: %s   Port: 7421\nCommands: /help   @files   !shell   Ctrl+C exit",
			m.session.WorkspacePath, m.session.Model, m.session.Mode),
	)
	sb.WriteString(bannerBox)
	sb.WriteString("\n")

	// Zone B: Scrollable Conversation Viewport
	sb.WriteString(m.viewport.View())
	sb.WriteString("\n")

	// Zone C: Live Region (Spinner + elapsed timer when busy)
	if m.isBusy {
		spinnerLine := fmt.Sprintf("  %s %s (%ds · esc to interrupt)\n",
			m.spinner.View(), StyleCyan.Render("Thinking…"), m.elapsedSecs)
		sb.WriteString(spinnerLine)
	}

	// Zone D: Approval Dialog if waiting for consent
	if m.state == StateApproval {
		var optLines []string
		for i, opt := range m.approvalOpts {
			if i == m.approvalIndex {
				optLines = append(optLines, StyleCyan.Render(fmt.Sprintf("  %s %s", GlyphFocus, opt)))
			} else {
				optLines = append(optLines, StyleMuted.Render(fmt.Sprintf("    %s", opt)))
			}
		}
		dialogContent := fmt.Sprintf("Tool: %s\nAction: %s\n\nAllow this action?\n%s\n\n%s",
			StyleBold.Render(m.approvalTool),
			m.approvalDesc,
			strings.Join(optLines, "\n"),
			StyleMuted.Render("enter select · y once · a always · n deny"),
		)
		dialogBox := StyleDialogBorder.Width(m.width - 4).Render(dialogContent)
		sb.WriteString(dialogBox)
		sb.WriteString("\n")
	} else {
		// Zone D: Autocomplete popup above input box
		if m.autocomplete.Active {
			popupBox := m.autocomplete.Render(m.width)
			if popupBox != "" {
				sb.WriteString(popupBox)
				sb.WriteString("\n")
			}
		}

		// Zone E: Input Box (Bordered, upward expanding)
		boxStyle := StyleInputBorder
		if strings.HasPrefix(strings.TrimSpace(m.textarea.Value()), "!") {
			boxStyle = StyleShellBorder
		}
		inputBox := boxStyle.Width(m.width - 4).Render(m.textarea.View())
		sb.WriteString(inputBox)
		sb.WriteString("\n")
	}

	// Zone F: 1-Row Status Bar Footer
	hint := "? for shortcuts · / commands · ! shell"
	if m.isBusy {
		hint = "esc to interrupt · ctrl+o expand"
	} else if m.state == StateApproval {
		hint = "enter select · tab add note · esc cancel"
	} else if m.autocomplete.Active {
		hint = "↑/↓ navigate · tab complete · esc dismiss"
	} else if strings.HasPrefix(strings.TrimSpace(m.textarea.Value()), "!") {
		hint = "shell command mode · enter execute · esc clear"
	}
	statusRight := fmt.Sprintf("%s | %s | ctx %d%%", m.session.Mode, m.session.Model, m.contextPercent)
	gap := m.width - lipgloss.Width(hint) - lipgloss.Width(statusRight) - 4
	if gap < 2 {
		gap = 2
	}
	footerLine := fmt.Sprintf("  %s%s%s", StyleMuted.Render(hint), strings.Repeat(" ", gap), StyleMuted.Render(statusRight))
	sb.WriteString(footerLine)

	return sb.String()
}

func (m Model) renderHelpOverlay() string {
	helpText := fmt.Sprintf("%s\n  %s  Send prompt\n  %s  Insert newline\n  %s  Interrupt busy agent / close popup\n  %s  Exit Tendril TUI\n  %s  Tool consent (1 once, 2 always, 3 deny)\n\n%s\n  %-14s  Show this help screen\n  %-14s  Clear conversation scrollback\n  %-14s  Switch model (/model <id>)\n  %-14s  Switch mode (/mode ask|architect|code)\n  %-14s  Exit Tendril TUI",
		StyleBold.Render("Keyboard Shortcuts:"),
		StyleCyan.Render("Enter"),
		StyleCyan.Render("Ctrl+J"),
		StyleCyan.Render("Esc"),
		StyleCyan.Render("Ctrl+C"),
		StyleCyan.Render("y / a / n"),
		StyleBold.Render("Slash Commands:"),
		"/help",
		"/clear",
		"/model <name>",
		"/mode <type>",
		"/exit",
	)
	boxWidth := m.width - 6
	if boxWidth < 50 {
		boxWidth = 50
	}
	return StyleBannerBorder.Width(boxWidth).Render(helpText)
}
