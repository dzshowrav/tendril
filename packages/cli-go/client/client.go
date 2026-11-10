package client

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type DaemonInfo struct {
	PID      int    `json:"pid"`
	Port     int    `json:"port"`
	Host     string `json:"host"`
	BaseURL  string `json:"baseUrl"`
	CLIToken string `json:"cliToken"`
}

type Session struct {
	ID            string `json:"id"`
	WorkspacePath string `json:"workspace_path"`
	Mode          string `json:"mode"`
	Model         string `json:"model"`
	Title         string `json:"title"`
}

type CreateSessionResponse struct {
	Session Session `json:"session"`
}

type SSEEvent struct {
	Type string
	Data map[string]interface{}
	Raw  string
}

type TendrilClient struct {
	BaseURL    string
	CLIToken   string
	HTTPClient *http.Client
}

func NewClient() *TendrilClient {
	return &TendrilClient{
		BaseURL: "http://127.0.0.1:7421",
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *TendrilClient) EnsureDaemon() error {
	// 1. Try reading ~/.tendril/daemon.json
	homeDir, _ := os.UserHomeDir()
	daemonPath := filepath.Join(homeDir, ".tendril", "daemon.json")

	if data, err := os.ReadFile(daemonPath); err == nil {
		var info DaemonInfo
		if json.Unmarshal(data, &info) == nil && info.BaseURL != "" {
			c.BaseURL = info.BaseURL
			c.CLIToken = info.CLIToken
		}
	}

	// 2. Ping /api/health
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/health")
	if err == nil && resp.StatusCode == http.StatusOK {
		resp.Body.Close()
		return nil
	}

	// 3. Try to start daemon via `tendril serve --daemon`
	cmd := exec.Command("tendril", "serve", "--daemon")
	_ = cmd.Run()

	// Wait up to 3 seconds for daemon
	for i := 0; i < 15; i++ {
		time.Sleep(200 * time.Millisecond)
		resp, err := c.HTTPClient.Get(c.BaseURL + "/api/health")
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			return nil
		}
	}

	return nil
}

func (c *TendrilClient) CreateSession(workspace, mode, model string) (*Session, error) {
	body := map[string]string{
		"workspace": workspace,
		"mode":      mode,
		"model":     model,
		"title":     "Go TUI: " + filepath.Base(workspace),
	}
	data, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", c.BaseURL+"/api/sessions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.CLIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.CLIToken)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("create session failed (%d): %s", resp.StatusCode, string(b))
	}

	var res CreateSessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}
	return &res.Session, nil
}

func (c *TendrilClient) SendMessage(sessionID, text string) error {
	body := map[string]string{"text": text}
	data, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/sessions/%s/messages", c.BaseURL, sessionID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.CLIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.CLIToken)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *TendrilClient) ResolvePermission(sessionID, requestID, decision, note string) error {
	body := map[string]string{
		"decision": decision,
		"note":     note,
	}
	data, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/sessions/%s/permissions/%s", c.BaseURL, sessionID, requestID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.CLIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.CLIToken)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *TendrilClient) AbortSession(sessionID string) error {
	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/sessions/%s/abort", c.BaseURL, sessionID), nil)
	if err != nil {
		return err
	}
	if c.CLIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.CLIToken)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *TendrilClient) SubscribeEvents(sessionID string, eventChan chan<- SSEEvent) error {
	url := fmt.Sprintf("%s/api/sessions/%s/events", c.BaseURL, sessionID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	if c.CLIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.CLIToken)
	}

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}

	go func() {
		defer resp.Body.Close()
		reader := bufio.NewReader(resp.Body)
		var currentEvent string

		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimSpace(line)

			if strings.HasPrefix(line, "event:") {
				currentEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			} else if strings.HasPrefix(line, "data:") {
				dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				var parsed map[string]interface{}
				_ = json.Unmarshal([]byte(dataStr), &parsed)

				eventChan <- SSEEvent{
					Type: currentEvent,
					Data: parsed,
					Raw:  dataStr,
				}
				currentEvent = ""
			}
		}
	}()

	return nil
}
