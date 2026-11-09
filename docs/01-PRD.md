# PRD: Tendril

> **I'm building:** An open-source AI coding harness (in the family of Claude Code, opencode, Antigravity, Hermes Agent) that runs natively in Termux on Android: one headless agent daemon, a CLI client, and a WebView-based UI that are all connected to the same live sessions.
> **Audience:** Android developers and tinkerers who code on their phone in Termux, plus open-source contributors who want a hackable, provider-agnostic agent harness.
>
> **Name:** "Tendril" is a working name (the CLI reaches out into a WebView). Verify npm and GitHub availability before Step 1. Every doc uses it consistently, so renaming is one find-and-replace across `docs/`.

## Overview

Tendril is an agent harness for phones. A background daemon owns the agent loop, tools, sessions, and a local SQLite database. Two clients attach to it: a terminal CLI (in Termux) and a mobile-first web UI (in a companion Android WebView app or any phone browser). Both show the same session live, and either one can answer a permission prompt. It works with any Anthropic or OpenAI-compatible model, and it knows it is running inside Termux (no root, `pkg`, `$PREFIX`, no `/tmp`).

## Goals

- A developer can go from `npm i -g tendril` to a first successful edit-and-run task on a mid-range Android phone in under 10 minutes.
- CLI and WebView are two views of one session: type in either, watch in both, approve in either.
- Safe by default on a device that has no real sandbox: every mutating action is gated by a permission mode, every file edit is diffable and undoable, the daemon is reachable only from the device itself.
- Provider-agnostic: Anthropic Messages API and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Gemini's OpenAI-compatible endpoint, Ollama, LM Studio, Groq, DeepSeek) with the same behavior.
- Zero native dependencies, so installation never compiles anything on the phone.
- Fully open source (MIT), buildable and contributable from a phone, with CI doing the heavy builds (APK, npm publish).

## Out of scope (v1)

- MCP servers, plugins, skills, hooks, custom slash commands, subagents.
- Remote access (LAN, tunnels, TLS, multiple human users). The daemon binds `127.0.0.1` only.
- Full-screen TUI (Ink or similar). v1 CLI is a streaming line REPL.
- Background/long-running shell processes (dev servers, `run_in_background`) and persistent shell state between `bash` calls.
- Web search tool, image/PDF input, voice input, extended-thinking display.
- A real sandbox (proot-distro, containers). Permissions are the guard; the docs say so plainly.
- Git checkpoints/worktrees beyond per-edit undo; `export` of sessions; session sharing.
- Light theme, tablet/landscape-specific layouts, iOS, desktop packaging.
- Push notifications when a long turn finishes, cloud sync, telemetry of any kind.
- Cost tracking in currency (token counts only).

## Features

### F1: Daemon (`tendril serve`)
- **What it does:** A single headless Node process per device that owns the agent loop, tools, permissions, sessions, the SQLite database, and an HTTP+SSE API on `127.0.0.1`. It serves any number of workspaces and clients at once.
- **What the user does:** Usually nothing. Running `tendril` starts it automatically if it is not running. Power users run `tendril serve`, `tendril status`, `tendril stop`, `tendril logs`.
- **What happens next:** The daemon writes `~/.tendril/state.json` (pid, port, CLI token, version, start time), logs to `~/.tendril/logs/daemon.log` (5 files x 1 MB, rotated), detaches from the terminal so closing the Termux session does not end it, and calls `termux-wake-lock` when available. On start, any session left `running` is marked `interrupted`.
- **Edge cases:**
  - Default port 7421 busy: pick the next free port up to 7430 and record it in `state.json`; if all busy, exit with a message naming the port range.
  - Stale `state.json` whose pid is dead: remove it and start fresh.
  - Two simultaneous starts: `~/.tendril/daemon.lock` ensures only one wins; the other attaches to it.
  - Android kills the daemon mid-turn (phantom-process killer, battery optimization): next start marks the session `interrupted`; the user can continue the session and the partial turn is kept as-is.
  - Database file locked or corrupt: refuse to start, keep the file, print the path and a one-line recovery hint. Never auto-delete user data.

### F2: CLI client (`tendril`)
- **What it does:** A terminal client that attaches to the daemon and streams the agent's output. Interactive REPL (`tendril`), one-shot mode (`tendril ask "…"`), and management commands (`login`, `sessions`, `resume`, `pair`, `ui`, `doctor`, `serve`, `stop`, `status`, `logs`). Slash commands inside the REPL: `/help /model /mode /new /sessions /resume /undo /diff /compact /ui /rules /clear /exit`.
- **What the user does:** Runs `tendril` inside a project folder (the folder becomes the session's workspace), types a prompt, reads streaming text and tool activity, answers permission prompts with a single key (`y` once, `a` always, `n` deny).
- **What happens next:** The prompt is sent to the daemon; events stream back and are rendered (assistant text, tool calls with one-line summaries, colored diffs for edits, bash output). `ask` exits with code 0 on success, 1 on agent error, 2 on user denial/abort, 3 on daemon/provider failure. Everything typed in the CLI also appears live in any connected WebView.
- **Edge cases:**
  - No daemon running: auto-start with a spinner; if start fails show the last 10 log lines.
  - No provider configured: launch the `login` wizard first, then continue the original command.
  - Stdin is not a TTY: `ask` reads the prompt from stdin; permission prompts auto-deny unless `--mode` allows the action (never hangs waiting).
  - Ctrl-C once aborts the current turn (running tool processes are killed); twice within 2 s exits the CLI. The session stays intact.
  - Multi-line paste (bracketed paste) is sent as one message; a trailing `\` continues input on the next line.
  - Narrow terminal (under 40 columns) or Termux keyboard resize: output re-wraps; no fixed-width box drawing in v1 output.
  - Another client is mid-turn on the same session: show "session busy (running from web)" and mirror its output read-only until idle.

### F3: Web UI (WebView-ready)
- **What it does:** A mobile-first React app served by the daemon at `http://127.0.0.1:<port>/`. Screens: Sessions, Chat, Changes (diffs), Files (read-only viewer), Settings. Chat shows streaming markdown, tool cards, a permission sheet, a composer, and live status. It is a thin client: no agent logic runs in the browser.
- **What the user does:** Opens it from the companion app, from `tendril ui` (opens the default browser), or by pasting the URL. Starts or resumes a session, types prompts, taps Allow/Deny, reviews diffs, browses files, edits provider and mode settings.
- **What happens next:** The page loads its assets from the daemon (works fully offline from the network's point of view; only the model API call needs internet). Events arrive over SSE; sending a message is a `POST`. Anything done in the CLI shows up here within a second, and vice versa.
- **Edge cases:**
  - Phone sleeps or app is backgrounded and SSE drops: auto-reconnect with `Last-Event-ID` within 3 s of returning; if the server's replay buffer no longer has that event, refetch the session and continue from the fresh state.
  - Two clients send a prompt at the same moment: the second gets `409 session_busy` and the UI shows an inline "Session is busy" notice without losing the typed text.
  - Tool output over 20 lines is collapsed behind "Show more"; messages over 500 lines of text are virtualized so scrolling stays smooth.
  - On-screen keyboard covers the composer: layout follows the visual viewport so the composer stays visible.
  - Daemon unreachable: full-screen "Daemon offline" state with Retry (and in the companion app, Start daemon).
  - Cookie/site data cleared: UI falls back to the Pair screen.

### F4: Local pairing and security
- **What it does:** Restricts the daemon to its owner. The CLI authenticates with a random token stored in `~/.tendril/state.json` (file mode 0600). Web clients authenticate by exchanging a one-time pairing code for an HttpOnly session cookie. All requests are checked against a Host/Origin allow-list to defeat DNS-rebinding and cross-site requests from other web pages open on the phone.
- **What the user does:** Runs `tendril pair` (prints a URL with a one-time code) or `tendril ui` (pairs and opens the browser). The companion app does this automatically through Termux. Revokes devices in Settings > Clients.
- **What happens next:** The code is valid for 5 minutes, single use. A successful pairing creates a `web_clients` row and sets cookie `tdl_session` (`HttpOnly; SameSite=Strict; Path=/`). The browser stays paired until revoked or its cookies are cleared.
- **Edge cases:**
  - Expired or reused code: the Pair screen says "Code expired — run `tendril pair` again".
  - 5 wrong codes in 60 s: pairing endpoint locks for 60 s.
  - A different website in the phone browser tries `fetch("http://127.0.0.1:7421/api/…")`: rejected (no cookie sent due to SameSite=Strict, plus Host/Origin check, plus no CORS headers).
  - Daemon restarts: paired clients stay paired (only hashes are stored in the DB).
  - Revoked client keeps an open SSE stream: the stream is closed within 5 s.

### F5: Providers and models
- **What it does:** Lets the user register one or more model providers and pick a default model per session. Two provider types: `anthropic` (Messages API) and `openai-compatible` (Chat Completions with tool calling). Presets prefill base URLs for OpenAI, OpenRouter, Gemini (OpenAI-compatible endpoint), Ollama, LM Studio, Groq, DeepSeek.
- **What the user does:** Runs `tendril login` (wizard: type, name, base URL, API key, default model, context window) or edits providers in Settings > Providers. Switches model per session with `/model` or the model picker in the session header.
- **What happens next:** The wizard sends a 1-token test request and reports success or the provider's error text. Keys are written to `~/.tendril/auth.json` (mode 0600). Environment variable `TENDRIL_<PROVIDERID>_API_KEY` overrides the file. Keys are never logged, never sent to the web UI in full (only the last 4 characters), and never passed into tool subprocess environments.
- **Edge cases:**
  - Invalid key / 401: show the provider's message without echoing the key.
  - 429 or 5xx: retry up to 3 times with exponential backoff, honoring `Retry-After`; then surface the error and return the session to idle.
  - Network offline: error event "Can't reach <host>", session returns to idle, partial text is kept.
  - Unknown model name: the provider's error is shown verbatim with a hint to check the name.
  - Provider without tool-calling support: the test request detects it and warns that the agent will run in chat-only mode (tools disabled).
  - Context window unknown: default 128000 tokens, editable per provider/model.

### F6: Agent loop and built-in tools
- **What it does:** Runs the model-tool-model cycle: send conversation, receive text and tool calls, execute tools (subject to F7), feed results back, stop when the model ends its turn or a limit is hit. Built-in tools: `read_file`, `list_dir`, `glob`, `grep`, `write_file`, `edit_file`, `bash`, `web_fetch`, `todo_write`, and (optional, F13) `termux_api`. Read-only tools may run in parallel; mutating tools run one at a time.
- **What the user does:** Types a task in natural language. Can abort at any time (Ctrl-C in CLI, Stop button in web UI).
- **What happens next:** Each step streams to every attached client. A turn ends on end-of-turn, abort, error, or after 50 steps (configurable). All file paths are resolved against the session workspace and rejected if they escape it (including through symlinks).
- **Edge cases:**
  - Model emits malformed tool arguments: the error is returned to the model as the tool result so it can self-correct.
  - Same failing tool call repeated 3 times in a row: the turn stops with "Agent appears stuck" and the last error.
  - `read_file` on a binary file: refuse with detected type and size. On a file over 2 MB: require `offset`/`limit` line range.
  - `edit_file` where `old_string` matches 0 or more than 1 place: return the match count and ask for more context (unless `replace_all` is true).
  - `write_file`/`edit_file` on an existing file the model has not read in this session, or that changed on disk since it was read: refuse with "read it first".
  - `bash` over its timeout (default 120 s, max 600 s): kill the whole process group, return partial output plus "timed out".
  - Tool output over 30,000 characters: keep the first 12,000 and last 12,000 with a "[truncated N chars]" marker.
  - Abort during `bash`: process group gets SIGTERM, then SIGKILL after 3 s.

### F7: Permissions and modes
- **What it does:** Gates every tool call. Four modes per session: `plan` (read-only tools only), `ask` (default; prompt for edits, shell, network, system), `auto-edit` (file edits inside the workspace auto-approved; shell/network/system still prompt), `yolo` (everything auto-approved; requires an explicit flag or typed confirmation). A built-in hard guard always blocks catastrophic shell patterns (for example `rm -rf /`, `rm -rf ~`, `mkfs`, `dd of=/dev/…`, fork bombs) in every mode.
- **What the user does:** Answers prompts with Allow once / Allow always / Deny (optional note back to the model). Changes mode with `/mode` or the mode chip in the web UI. Manages saved "always" rules in Settings > Permissions or `/rules`.
- **What happens next:** A pending prompt puts the session in `awaiting_permission` and appears in every attached client. The first answer wins; others see it resolve. "Allow always" saves a rule scoped to this workspace (tool + normalized pattern, for example `bash: npm test*`). Denying tells the model what was denied so it can adapt.
- **Edge cases:**
  - Client disconnects with a prompt pending: the prompt stays pending and reappears on reconnect; there is no auto-timeout.
  - Both clients answer at once: first answer wins; the second receives `already_resolved` and its UI just closes the sheet.
  - Abort while a prompt is pending: treated as Deny.
  - "Allow always" on a compound command (`a && b`, pipes, `$(...)`): rule is stored only for fully quoted-simple commands; compound commands can only be allowed once.
  - `yolo` is never the default and is never persisted as a global default; it must be chosen per session.
  - The hard guard is a heuristic safety net, not a security boundary; docs and `tendril doctor` say so.

### F8: Sessions
- **What it does:** Persists every conversation in SQLite: messages, tool runs, snapshots, token counts, mode, model, workspace. Sessions can be listed, resumed from either client, renamed, and deleted.
- **What the user does:** `tendril` starts a new session in the current folder; `tendril resume [id|prefix]` or `/resume` continues one; the web UI Sessions screen lists them grouped by workspace; rename/delete via long-press (web) or `tendril sessions rename|rm`.
- **What happens next:** The title is the first 60 characters of the first prompt (no extra model call) until renamed. Resuming rebuilds model context from stored messages (plus a compaction summary if one exists).
- **Edge cases:**
  - Workspace folder deleted or unmounted: session opens read-only with a banner; running a prompt is disabled.
  - Deleting a running session: abort first, then delete.
  - More than 1000 sessions: lists are paginated (50 per page, newest first).
  - Id prefix matches several sessions: CLI lists the matches and asks to be more specific.
  - Same session opened in two clients: allowed; only one turn can run at a time (F3 edge case).

### F9: Project instructions and Termux-aware prompt
- **What it does:** Builds the system prompt from (1) a base prompt, (2) an environment block (Android/Termux, CPU arch, Termux and Node versions, `$PREFIX`, current date, workspace path, git branch and short status if a repo, which tools are available), (3) global `~/.tendril/AGENTS.md`, (4) the workspace's `AGENTS.md` (falling back to `CLAUDE.md`), (5) the active mode's rules.
- **What the user does:** Writes an `AGENTS.md` in the project root with conventions and commands. Nothing else.
- **What happens next:** The environment block teaches the model Termux facts that prevent wasted turns: no root or `sudo`, use `pkg install`, no `/tmp` (use `$TMPDIR`), shebangs and paths live under `$PREFIX`, shared storage is under `~/storage`, avoid long-running foreground servers (v1 has no background process support).
- **Edge cases:**
  - Instruction file over 32 KB: truncated with a visible note to the model and a warning in the client.
  - File changed mid-session: re-read at the start of each turn.
  - Both `AGENTS.md` and `CLAUDE.md` exist: `AGENTS.md` wins; the other is ignored.
  - Not a git repo: git lines are omitted; no error.

### F10: Edit review and undo
- **What it does:** Every `write_file` and `edit_file` produces a unified diff shown in the CLI (colored) and in the web Changes tab. Before each mutation the previous file content is snapshotted so the change can be reverted.
- **What the user does:** Reviews diffs inline or in Changes; taps Undo on one change, or types `/undo` to revert the latest change in the session; `/diff` re-shows the latest diff.
- **What happens next:** Undo restores the snapshot (or deletes the file if the agent created it) and records `undone_at`. The model is told on its next turn that the user reverted that change.
- **Edge cases:**
  - File was modified after the agent's edit (hash mismatch): undo is refused with an explanation; `--force` (CLI) or "Undo anyway" (web) overrides.
  - File larger than 1 MB: no snapshot is stored; the change is flagged "not undoable" before approval in `ask` mode.
  - Changes made by `bash` (for example `sed -i`, `rm`) are not snapshotted; the UI labels shell runs as "not undoable".
  - Undoing out of order (an earlier change when a later one touched the same file): refused unless forced.

### F11: Context management
- **What it does:** Keeps long sessions inside the model's context window. Estimates tokens (characters / 4 until the provider reports real usage), truncates oversized tool outputs, replaces old tool results with short placeholders, and auto-compacts: when usage passes 80% of the context window, older turns are summarized by the same model into a stored summary and only recent turns are kept verbatim.
- **What the user does:** Sees a usage meter (tokens used / window) and can run `/compact` manually.
- **What happens next:** The summary is stored on the session; the original messages stay in the database and remain visible in history; only the model's working context shrinks.
- **Edge cases:**
  - Compaction request itself fails: fall back to dropping oldest tool results first; if still too large, stop and tell the user to start a new session or raise the window.
  - A single message (or file read) larger than the window: refuse with a clear message and suggest ranges.
  - Provider reports usage that disagrees with the estimate: the provider's number wins from then on.

### F12: Android shell app (WebView)
- **What it does:** A tiny native Android app (Kotlin, one activity) that hosts the web UI in a WebView, can start the Termux daemon for you, and pairs automatically. It contains no agent logic.
- **What the user does:** Installs the APK from GitHub Releases, opens it. First run: grants the Termux "Run commands" permission and enables `allow-external-apps` in Termux (the app shows the exact one-line command). After that: tap the icon, start working.
- **What happens next:** The app checks `http://127.0.0.1:<port>/api/health`. If the daemon is down it asks Termux (via the `RUN_COMMAND` intent) to run `tendril serve --detach`, then runs `tendril pair --json` and receives the pairing URL through a result `PendingIntent`, then loads it in the WebView. The paired cookie persists in the WebView.
- **Edge cases:**
  - Termux not installed: screen with install instructions (F-Droid or GitHub releases), no crash.
  - Permission denied or `allow-external-apps` not set: screen with the exact fix, plus a "Open Termux" button.
  - `tendril` not installed in Termux: show `npm i -g tendril` and a link to the docs.
  - Daemon did not become healthy in 20 s: show the log hint (`tendril logs`) and Retry.
  - Links to other hosts open in the system browser, never inside the WebView.
  - Rotation, split-screen, back button: back navigates web history first, then exits; state survives rotation.
  - Termux and the shell must come from the same source family (F-Droid/GitHub vs Google Play builds are signed differently); the app detects a signature mismatch and explains it.

### F13: Termux integration and `doctor`
- **What it does:** Makes Termux limitations visible and manageable. `tendril doctor` checks: Termux install source and version, Node version (needs 24.15 or newer so `node:sqlite` has no warning), `node:sqlite` import, `git` and `rg` presence, shared storage permission, Termux:API availability, `allow-external-apps`, wake-lock availability, and Android battery-optimization / phantom-process-killer hints. The optional `termux_api` tool lets the agent call an allow-listed set of Termux:API commands.
- **What the user does:** Runs `tendril doctor` (or Settings > About > Doctor), follows the fixes it prints.
- **What happens next:** Each check shows PASS / WARN / FAIL with a one-line fix. The daemon acquires a wake lock on start if `termux-wake-lock` exists (configurable off). `termux_api` allow-list (v1): `notification`, `toast`, `vibrate`, `clipboard-get`, `clipboard-set`, `battery-status`, `open-url`.
- **Edge cases:**
  - Termux:API app missing: the tool is not offered to the model and `doctor` shows WARN, not FAIL.
  - Not running inside Termux (for example a Linux desktop during development): `doctor` shows "not Termux" and skips Termux checks; everything else works, so contributors can develop anywhere.
  - Every `termux_api` call asks permission in every mode except `yolo`, because it can touch clipboard and notifications.

### F14: Install and distribution
- **What it does:** Ships three artifacts per release: the npm package `tendril` (single bundled JS file with the prebuilt web UI inside, zero runtime dependencies), an `install.sh` helper for Termux, and a signed APK of the Android shell on GitHub Releases with SHA-256 checksums.
- **What the user does:** `pkg install nodejs-lts git ripgrep && npm i -g tendril`, or `curl -fsSL <raw install.sh url> | bash`; downloads the APK; runs `tendril doctor`.
- **What happens next:** `tendril --version` and `tendril doctor` confirm the setup. Updating is `npm i -g tendril@latest`. There is no auto-update and no telemetry.
- **Edge cases:**
  - Node too old: `tendril` exits immediately with the required version and the `pkg upgrade nodejs-lts` command.
  - `npm i -g` permission issues: documented fix is Termux's default prefix (no sudo needed); the installer checks `npm config get prefix`.
  - Installing on a non-arm64 phone (arm32, x86_64 emulator): works because nothing is compiled natively; documented as best-effort.
  - APK installed but unsigned/signature mismatch on update: release notes include the signing certificate fingerprint.
