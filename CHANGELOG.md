# Changelog 📜

All notable changes to the **Tendril** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-11-10

### 🚀 Initial Public Release

Tendril is the open-source AI coding harness built specifically for Termux on Android. It bridges a headless agent daemon, a rich terminal CLI client, and a native Android WebView companion app to live coding sessions on your phone.

---

### ✨ Features by Milestone

#### Milestone M1: Headless Agent Foundation (Steps 1–7)
- **Monorepo Architecture (F14):** Strict TypeScript monorepo with `packages/{core,server,cli,web}` and `apps/android-shell`.
- **Database Engine (F1, F8):** Zero-addon native SQLite integration (`node:sqlite`) with WAL mode, schema migrations, foreign keys, and atomic commits.
- **Paths & Security Sandbox (F1, F4):** Secure home layout (`~/.tendril`) with `0700` directory and `0600` file permissions. Automatic key redaction in logging and environment scrubbing (`scrubEnvironment`).
- **Multi-Provider Adapters (F5):**
  - Native Anthropic streaming adapter with prompt-caching markers.
  - OpenAI-compatible streaming adapter with robust multi-part tool call fragment reassembly.
  - Pre-configured presets for Anthropic, OpenRouter, DeepSeek, Gemini, Ollama, LM Studio, and Groq.
  - Exponential backoff retry policy handling rate limits (429) and network blips.
- **Workspace Containment Guard (F6):** Strict boundary validation (`realpath` + traversal guard) rejecting directory traversal (`../`), external absolute paths, and external symlinks.
- **Safe Tool Execution Suite (F6):**
  - Read-only tools: `read_file`, `list_dir`, `glob`, `grep` (with ripgrep and pure-JS fallback), and `todo_write`.
  - Mutating tools: `write_file` and `edit_file` with read-before-edit verification.
  - Snapshot & Undo engine: Unified diff calculation with complete snapshot history in SQLite, allowing instant `/undo` rollbacks.
  - Process Isolation: `bash` tool execution with process groups, timeouts, child/grandchild abort escalation, and environment scrubbing.
  - Pure-function hard guard `isCatastrophic()` blocking system-destructive patterns (`rm -rf /`, `mkfs`, raw device writes).
- **Permission Engine & Execution Modes (F7):**
  - 4 Operating Modes: `ask`, `code`, `plan`, and `bypass`.
  - First-answer-wins concurrency resolver across multiple active clients (CLI and Web).
  - Rule persistence for session-scoped and persistent approvals.
- **Agent Loop & Context Management (F6, F9, F11):**
  - Autonomous model-tool-model cycle with stuck-loop detection (3 consecutive identical failures).
  - Context compaction at 80% window limit with automated summary persistence.
  - Interrupted session recovery on daemon startup.

#### Milestone M2: CLI Harness (Steps 8–9)
- **Background Daemon Server (F1, F4):**
  - Lightweight Hono HTTP & SSE server listening strictly on `127.0.0.1:7421-7430`.
  - DNS-rebinding guard (421 Misdirected Request) and foreign Origin guard (403 Forbidden).
  - Real-time SSE hub with 2,000-event ring buffer, sequence IDs, and `Last-Event-ID` replay.
  - Secure ephemeral 6-digit pairing codes with rate limiting (5 attempts = 60s cooldown).
  - Background process detachment with lock file and wake-lock management.
- **Terminal CLI Client (F2, F5, F8, F10):**
  - Interactive REPL powered by `cac` and `readline` with full slash commands: `/help`, `/model`, `/mode`, `/new`, `/sessions`, `/resume`, `/undo`, `/diff`, `/compact`, `/ui`, `/rules`, `/clear`, `/exit`.
  - Non-interactive scriptable `ask` mode supporting standard input pipes and newline-delimited JSON output (`--json`).
  - First-run provider setup wizard (`tendril login`) and automated pairing command (`tendril pair`).
  - Terminal-adaptive rendering respecting `NO_COLOR` and `TENDRIL_ASCII`.

#### Milestone M3: WebView Mobile UI & Android Companion (Steps 10–13)
- **Mobile-First Web Interface (F3):**
  - Vite + React + TypeScript web app adhering strictly to mobile touch ergonomics and Dark/Light token design system.
  - Bundled local typography (`JetBrains Mono` and `Inter`) with zero external CDN dependencies.
  - Pair screen, Sessions drawer, real-time Chat with streaming Markdown (`marked` + `DOMPurify`), syntax highlighting, tool cards, diff cards, and inline permission request modal.
  - Changes drawer with instant visual diff review and one-tap `/undo`.
  - File browser and Settings dashboard (Providers CRUD, Default Mode, Permission Rules, Connected Clients).
  - Initial JS bundle optimized to **130.18 KB gzipped** (well within the < 400 KB budget).
- **Termux System Integration (F13, F14):**
  - `tendril doctor`: Comprehensive 10-point diagnostic check evaluating Node version, `node:sqlite`, git, ripgrep, Termux storage permissions, Termux:API, `allow-external-apps`, battery optimizations, and wake-locks.
  - `termux_api` tool: Secure permission-gated wrapper for Termux:API commands (battery status, clipboard, notifications, TTS).
  - Automated one-line installer script (`scripts/install.sh`).
- **Native Android Shell Companion (F12):**
  - Kotlin + Material Design 3 companion APK (`apps/android-shell`).
  - Hardened WebView loading `http://127.0.0.1:<port>` with `network-security-config` restricted exclusively to cleartext loopback.
  - Auto-start daemon and automated zero-click pairing via Termux `RUN_COMMAND` intent.
  - Built-in Setup help screen for permission troubleshooting.

#### Milestone M4: Hardening, E2E Testing & Release Packaging (Steps 14–15)
- **Comprehensive Hardening & Security:**
  - DNS-rebinding, Host header spoofing, and foreign origin rejection.
  - Automated redaction of API keys from daemon logs and child environment variables.
  - SSE soak test with 1,000 rapid events and simulated random client disconnects.
  - Concurrent two-client permission approval race verification.
  - Interrupted session recovery and database corruption fail-fast safety.
- **Budget & Performance Guarantees:**
  - Web JS bundle: **130.18 KB gzipped** (Budget: < 400 KB).
  - Daemon idle RSS memory: **62.65 MB** (Budget: < 150 MB).
  - CLI cold startup: **1.5s** (Budget: < 2.5s on mobile / < 1.5s on CI).
- **Packaging:**
  - Single standalone executable `dist/tendril.mjs` with zero runtime dependencies.
  - GitHub Actions CI matrix running monorepo build, unit tests, end-to-end tests, budget assertions, and Android APK compilation.
