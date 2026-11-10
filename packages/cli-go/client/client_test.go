package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientCreateSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sessions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Fatalf("unexpected method: %s", r.Method)
		}

		resp := CreateSessionResponse{
			Session: Session{
				ID:            "sess-test-123",
				WorkspacePath: "/tmp/test",
				Mode:          "ask",
				Model:         "claude-3-5-sonnet",
				Title:         "Go TUI Test",
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := NewClient()
	c.BaseURL = server.URL

	sess, err := c.CreateSession("/tmp/test", "ask", "claude-3-5-sonnet")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sess.ID != "sess-test-123" {
		t.Errorf("expected session ID sess-test-123, got %s", sess.ID)
	}
}

func TestClientSendMessage(t *testing.T) {
	var receivedBody map[string]string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sessions/sess-123/messages" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewClient()
	c.BaseURL = server.URL

	err := c.SendMessage("sess-123", "Hello agent!")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if receivedBody["text"] != "Hello agent!" {
		t.Errorf("expected message 'Hello agent!', got '%s'", receivedBody["text"])
	}
}

func TestClientResolvePermission(t *testing.T) {
	var receivedBody map[string]string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sessions/sess-123/permissions/req-456" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewClient()
	c.BaseURL = server.URL

	err := c.ResolvePermission("sess-123", "req-456", "allow_once", "approved by test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if receivedBody["decision"] != "allow_once" {
		t.Errorf("expected decision 'allow_once', got '%s'", receivedBody["decision"])
	}
}
