package ui

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

var (
	cachedRenderer *glamour.TermRenderer
	cachedWidth    int
)

func getRenderer(width int) *glamour.TermRenderer {
	targetWidth := width - 6
	if targetWidth < 30 {
		targetWidth = 30
	}

	if cachedRenderer != nil && cachedWidth == targetWidth {
		return cachedRenderer
	}

	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle("dark"),
		glamour.WithWordWrap(targetWidth),
	)
	if err == nil {
		cachedRenderer = r
		cachedWidth = targetWidth
		return r
	}
	return nil
}

func RenderMarkdown(text string, width int) string {
	r := getRenderer(width)
	if r != nil {
		rendered, err := r.Render(text)
		if err == nil {
			return strings.TrimRight(rendered, "\n")
		}
	}
	return text
}
