package ui

import "github.com/charmbracelet/lipgloss"

var (
	// Text Colors
	ColorPrimary = lipgloss.Color("#10B981") // Emerald / Green
	ColorCyan    = lipgloss.Color("#06B6D4") // Cyan
	ColorMuted   = lipgloss.Color("#6B7280") // Dim Gray
	ColorWarning = lipgloss.Color("#F59E0B") // Amber / Yellow
	ColorError   = lipgloss.Color("#EF4444") // Red
	ColorSuccess = lipgloss.Color("#10B981") // Green
	ColorPurple  = lipgloss.Color("#8B5CF6") // Purple / Violet

	// Styles
	StyleTitle = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorPrimary)

	StyleBold = lipgloss.NewStyle().
			Bold(true)

	StyleMuted = lipgloss.NewStyle().
			Foreground(ColorMuted)

	StyleCyan = lipgloss.NewStyle().
			Foreground(ColorCyan)

	StyleWarning = lipgloss.NewStyle().
			Foreground(ColorWarning)

	StyleError = lipgloss.NewStyle().
			Foreground(ColorError)

	StyleSuccess = lipgloss.NewStyle().
			Foreground(ColorSuccess)

	// Box Borders
	StyleBannerBorder = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorPrimary).
				Padding(0, 1)

	StyleInputBorder = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorPrimary).
				Padding(0, 1)

	StyleShellBorder = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorWarning).
				Padding(0, 1)

	StyleDialogBorder = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorWarning).
				Padding(0, 1)

	StylePopupBorder = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(ColorCyan).
				Padding(0, 1)

	// Glyphs (Strict Section 1 Spec)
	GlyphBullet    = "●"
	GlyphConnector = "⎿"
	GlyphPrompt    = ">"
	GlyphShell     = "!"
	GlyphSuccess   = "✓"
	GlyphError     = "✗"
	GlyphWaiting   = "…"
	GlyphThinking  = "✻"
	GlyphFocus     = "▸"
	GlyphUp        = "▲"
	GlyphDown      = "▼"
)
