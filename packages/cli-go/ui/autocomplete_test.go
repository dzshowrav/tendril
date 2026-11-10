package ui

import (
	"strings"
	"testing"
)

func TestAutocompleteUpdate_NoSlash(t *testing.T) {
	ac := &AutocompletePopup{}
	ac.Update("hello world")

	if ac.Active {
		t.Errorf("expected autocomplete to be inactive for non-slash input")
	}
	if len(ac.Matches) != 0 {
		t.Errorf("expected 0 matches, got %d", len(ac.Matches))
	}
}

func TestAutocompleteUpdate_Slash(t *testing.T) {
	ac := &AutocompletePopup{}
	ac.Update("/")

	if !ac.Active {
		t.Errorf("expected autocomplete to be active for '/'")
	}
	if len(ac.Matches) != len(AvailableCommands) {
		t.Errorf("expected %d matches, got %d", len(AvailableCommands), len(ac.Matches))
	}
}

func TestAutocompleteUpdate_Filter(t *testing.T) {
	ac := &AutocompletePopup{}
	ac.Update("/he")

	if !ac.Active {
		t.Errorf("expected active autocomplete for '/he'")
	}
	if len(ac.Matches) != 1 || ac.Matches[0].Name != "/help" {
		t.Errorf("expected match [/help], got %+v", ac.Matches)
	}
}

func TestAutocompleteNavigation(t *testing.T) {
	ac := &AutocompletePopup{}
	ac.Update("/")

	if ac.Selected != 0 {
		t.Errorf("expected initial index 0, got %d", ac.Selected)
	}

	ac.SelectNext()
	if ac.Selected != 1 {
		t.Errorf("expected index 1 after SelectNext, got %d", ac.Selected)
	}

	ac.SelectPrev()
	if ac.Selected != 0 {
		t.Errorf("expected index 0 after SelectPrev, got %d", ac.Selected)
	}

	// Wrap around backward
	ac.SelectPrev()
	if ac.Selected != len(ac.Matches)-1 {
		t.Errorf("expected wrap around to %d, got %d", len(ac.Matches)-1, ac.Selected)
	}
}

func TestAutocompleteRender(t *testing.T) {
	ac := &AutocompletePopup{}
	ac.Update("/mo")

	rendered := ac.Render(80)
	if !strings.Contains(rendered, GlyphFocus) {
		t.Errorf("expected render to contain selection glyph %s, got:\n%s", GlyphFocus, rendered)
	}
	if !strings.Contains(rendered, "/model") || !strings.Contains(rendered, "/mode") {
		t.Errorf("expected render to contain /model and /mode, got:\n%s", rendered)
	}
}

func TestRenderMarkdown(t *testing.T) {
	md := "# Title\n\n- item 1\n- item 2\n\n```go\nfunc main() {}\n```"
	rendered := RenderMarkdown(md, 80)
	if len(rendered) == 0 {
		t.Errorf("expected non-empty rendered markdown")
	}
}
