# App Flow: Tendril

> **I'm building:** An open-source AI coding harness for Termux: one headless agent daemon, a CLI client, and a WebView-based UI, all connected to the same live sessions.
> **Audience:** Android developers who code on their phone in Termux, and open-source contributors.

Tendril has three user-facing surfaces that all talk to the same daemon: the **CLI** (`tendril`), the **Web UI** (served by the daemon), and the **Android Shell** (a WebView host for the Web UI). Feature ids (F1 to F14) refer to the PRD.

## Pages

### Web UI (routes)
- **Pair** `/pair`: enter or auto-consume a pairing code (F4)
- **Sessions** `/`: all sessions grouped by workspace; gear to Settings; "New session" button (F8)
- **New session sheet** (modal over `/`): choose workspace folder, provider/model, mode (F8, F5, F7)
- **Chat** `/s/:id`: conversation, tool cards, composer, mode and model chips, usage meter, Stop button (F3, F6, F11)
- **Permission sheet** (modal over Chat): Allow once / Allow always / Deny (F7)
- **Changes** `/s/:id/changes`: list of file edits in this session with Undo (F10)
- **Diff** `/s/:id/changes/:toolRunId`: unified diff viewer for one change (F10)
- **Files** `/s/:id/files` and `/s/:id/files/*path`: read-only workspace browser and file viewer (F3)
- **Settings** `/settings`: index of settings sections
- **Settings > Providers** `/settings/providers`, `/settings/providers/:id`: add/edit/test providers and models (F5)
- **Settings > Permissions** `/settings/permissions`: saved "always" rules, default mode (F7)
- **Settings > Clients** `/settings/clients`: paired devices, revoke (F4)
- **Settings > About** `/settings/about`: version, Doctor results, daemon port, licenses (F13)
- **Daemon offline** (full-screen state, any route) (F3)

### CLI (commands and states)
- **REPL** (`tendril`): interactive session in the current folder (F2)
- **One-shot** (`tendril ask "…"`) (F2)
- **Login wizard** (`tendril login`) (F5)
- **Sessions** (`tendril sessions`, `tendril resume`) (F8)
- **Pair / UI** (`tendril pair`, `tendril ui`) (F4)
- **Daemon control** (`tendril serve`, `stop`, `status`, `logs`) (F1)
- **Doctor** (`tendril doctor`) (F13)

### Android Shell screens
- **Launcher / Status**: checks daemon, starts it, pairs, then hands over to the WebView (F12)
- **Web host**: full-screen WebView showing the Web UI (F12)
- **Setup help**: Termux missing, permission missing, `allow-external-apps` not set, `tendril` not installed (F12)
- **Shell settings**: port, start-on-launch toggle (F12)

## User journeys

### J1: First-time setup (CLI first)
1. User installs Termux (F-Droid/GitHub), runs `pkg install nodejs-lts git ripgrep` then `npm i -g tendril`.
2. Runs `tendril doctor` → sees PASS/WARN lines with fixes (F13).
3. `cd ~/projects/my-app && tendril`. No provider yet → **Login wizard** opens: provider type → name → base URL → API key → default model → context window.
4. Wizard sends a test request → "Connected to <provider>".
5. REPL opens: `session 01J… · my-app · ask mode · <model>`. User types: `add a dark mode toggle`.
6. Agent streams text, calls `read_file` (auto), then `edit_file` → **permission prompt** `[y] once [a] always [n] deny` → user presses `y` → colored diff prints → agent finishes.

### J2: Connect the Web UI from a phone browser
1. In the REPL, user types `/ui` (or runs `tendril ui`).
2. CLI creates a pairing code (`POST /api/pair/code`), builds `http://127.0.0.1:7421/pair#code=XXXXXXXX`, calls `termux-open-url`.
3. Browser opens **Pair**; the page reads the code from the fragment, calls `POST /api/pair`, clears the fragment, receives the cookie.
4. Redirect to **Sessions** (`/`) → user taps the running session → **Chat** shows the same conversation live.
5. User types a prompt in the web composer → CLI prints it as `[web] …` and mirrors the streamed answer.

### J3: Core coding task with approval from either client
1. User sends "run the tests and fix failures" from the web **Chat**.
2. Agent calls `bash: npm test` → session status `awaiting_permission` → **Permission sheet** appears in the web UI and a prompt appears in the CLI.
3. User taps **Allow once** on the phone UI (or presses `y` in the CLI): first answer wins; the other client's prompt closes.
4. `tool.output` streams into a collapsed tool card; failing test names appear.
5. Agent calls `edit_file` → permission → Allow → diff card appears in Chat and in **Changes**.
6. User taps the diff card → **Diff** → reviews → taps **Undo** (optional) → file restored, card shows "undone".

### J4: Returning user, resume
1. User opens the Android Shell (J5 handles daemon start).
2. **Sessions** lists recent sessions per workspace. User taps one → **Chat** loads history, then subscribes to SSE with `Last-Event-ID`.
3. Or in Termux: `tendril resume` shows a numbered list; user picks one; REPL continues with full context.

### J5: Android Shell cold start
1. User opens the Tendril Shell app → **Launcher / Status** shows "Checking daemon…".
2. Health check fails → app sends Termux `RUN_COMMAND` `tendril serve --detach` → status "Starting daemon…" (max 20 s).
3. App sends `RUN_COMMAND` `tendril pair --json` with a result PendingIntent → receives `{url}`.
4. **Web host** loads the URL → Pair consumes the code → Sessions list. Next launches skip pairing (cookie persists) and go straight to Sessions.
5. If any step fails → **Setup help** shows the exact fix for that step with Retry.

### J6: Recovery after Android kills the daemon
1. Daemon dies while a turn runs. Web UI SSE drops → banner "Reconnecting…".
2. After 10 s of failures UI shows **Daemon offline** with Retry (and Start daemon in the Android Shell).
3. User starts the daemon (button, or `tendril` in Termux). On start, the running session is marked `interrupted`.
4. UI reconnects, session header shows "Interrupted — partial answer kept". User types "continue" and the session proceeds.

### J7: Change provider or model mid-session
1. In **Chat**, user taps the model chip → sheet lists configured providers/models → picks one.
2. `PATCH /api/sessions/:id` → `session.updated` event → CLI header line updates. Or in CLI: `/model openrouter/some-model`.
3. Next turn uses the new model; history is sent as-is (the normalized format works across providers).

### J8: Manage security
1. **Settings > Clients** lists paired devices with last-seen time. User taps **Revoke** → client's SSE closes, cookie invalid.
2. **Settings > Permissions** lists saved rules (`bash: npm test*` in `~/projects/my-app`). User taps **Remove** to delete one.

### J9: Project instructions (F9)
1. User creates `AGENTS.md` in the project root (conventions, test command, style rules).
2. User sends any prompt in CLI or Web. The daemon re-reads the file at the start of the turn and includes it in the system prompt after the Termux environment block.
3. If the file is over 32 KB, the first client output of the turn shows a warning ("AGENTS.md truncated to 32 KB") and the model is told it was cut.
4. Editing `AGENTS.md` between turns takes effect on the next turn with no restart.

### J10: Install and update (F14)
1. User runs `npm i -g tendril` (or the installer script) and installs the APK from GitHub Releases.
2. `tendril --version` and `tendril doctor` confirm the setup (see J1).
3. To update: `npm i -g tendril@latest`, then `tendril stop` so the next start runs the new version; the APK is updated by installing the newer release over the old one (same signing key).

## Button and action map

### Web UI

| Page | Element | On click | Next page / result |
| --- | --- | --- | --- |
| Pair | Code field + **Connect** | `POST /api/pair {code,label}` | Success → `/`; failure → inline error ("Code expired — run `tendril pair`") |
| Pair | **How to get a code** link | Expands inline help | Shows `tendril pair` and `tendril ui` commands |
| Sessions | Session row | Open session | `/s/:id` |
| Sessions | Row long-press → **Rename** | Inline title edit → `PATCH` | Row updates |
| Sessions | Row long-press → **Delete** | Confirm sheet → `DELETE` | Row removed |
| Sessions | **New session** (FAB) | Open New session sheet | Sheet over `/` |
| Sessions | Gear icon | Open Settings | `/settings` |
| New session sheet | Workspace field → folder picker | `GET /api/fs/dirs` browse | Chosen path shown |
| New session sheet | Provider/model dropdowns | Select | Values set |
| New session sheet | Mode chips (plan / ask / auto-edit / yolo) | Select; **yolo** asks "Type YOLO to confirm" | Mode set |
| New session sheet | **Start** | `POST /api/sessions` | `/s/:newId` |
| Chat | Back arrow | Navigate back | `/` |
| Chat | Composer **Send** (or Enter on hardware keyboard) | `POST /api/sessions/:id/messages` | 202 → streaming; 409 → inline "Session is busy" |
| Chat | **Stop** (replaces Send while running) | `POST /api/sessions/:id/abort` | Turn stops; status `idle` |
| Chat | Mode chip | Open mode sheet → `PATCH` | Chip updates; CLI notified |
| Chat | Model chip | Open model sheet → `PATCH` | Chip updates |
| Chat | Usage meter | Tap | Popover: tokens used/window, **Compact now** → `POST …/compact` |
| Chat | Tool card header | Toggle expand/collapse | Shows input, output, duration |
| Chat | Tool card **Show more** | Expand output past 20 lines | Full captured output |
| Chat | Diff card **View diff** | Navigate | `/s/:id/changes/:toolRunId` |
| Chat | Code block **Copy** | Copy to clipboard | Toast "Copied" |
| Chat | Todo strip (when todos exist) | Expand | Shows checklist from `todo_write` |
| Chat | Bottom tabs **Chat / Changes / Files** | Navigate | `/s/:id`, `/changes`, `/files` |
| Permission sheet | **Allow once** | `POST …/permissions/:rid {allow_once}` | Sheet closes; tool runs |
| Permission sheet | **Allow always** | `{allow_always}` (disabled for compound commands, with reason shown) | Rule saved; tool runs |
| Permission sheet | **Deny** (+ optional note field) | `{deny, note}` | Sheet closes; model told |
| Permission sheet | Details chevron | Expand full command / path / diff preview | Read-only |
| Changes | Change row | Open diff | `/s/:id/changes/:toolRunId` |
| Diff | **Undo** | `POST …/undo`; on hash mismatch shows "File changed since — Undo anyway?" | Row shows "Undone"; `{force:true}` on confirm |
| Diff | **Copy diff** | Copy unified diff | Toast |
| Files | Directory row | Open directory | `/s/:id/files?path=…` |
| Files | File row | Open viewer (≤ 1 MB, syntax highlighted) | `/s/:id/files/*path` |
| Files | Breadcrumb segment | Go up | Parent directory |
| Settings | Section row | Open section | `/settings/providers` etc. |
| Settings > Providers | **Add provider** | Open editor with presets | `/settings/providers/new` |
| Settings > Providers | **Test connection** | `POST /api/providers/:id/test` | Inline success or provider error |
| Settings > Providers | **Save** / **Delete** | `PUT` / `DELETE` | Back to list |
| Settings > Permissions | Default mode chips | `PUT /api/config` | Saved (yolo not offered here) |
| Settings > Permissions | Rule **Remove** | `DELETE /api/permissions/rules/:id` | Rule gone |
| Settings > Clients | **Revoke** | Confirm → `DELETE /api/clients/:id` | Client removed; if it is this device, goes to `/pair` |
| Settings > About | **Run doctor** | `GET /api/doctor` | PASS/WARN/FAIL list with fixes |
| Daemon offline | **Retry** | Re-check `/api/health` | Back to previous route or stays offline |

### CLI

| Context | Input | Action | Result |
| --- | --- | --- | --- |
| Shell | `tendril` | Attach (auto-start daemon), new session in cwd | REPL |
| Shell | `tendril resume [id]` | Choose or resume | REPL with history header |
| Shell | `tendril ask "…" [--mode m] [--model x] [--json]` | One-shot turn | Streams to stdout; exit codes 0/1/2/3 |
| Shell | `tendril login` | Wizard | Provider saved |
| Shell | `tendril sessions [rename\|rm]` | List/manage | Table output |
| Shell | `tendril pair [--json]` | Create code | Prints URL (or JSON `{url, code, port}`) |
| Shell | `tendril ui` | Pair + `termux-open-url` | Browser opens Pair/Sessions |
| Shell | `tendril serve [--detach] [--port n]` | Start daemon | Prints state |
| Shell | `tendril stop` / `status` / `logs [-f]` | Daemon control | Result lines |
| Shell | `tendril doctor [--json]` | Run checks | PASS/WARN/FAIL list |
| REPL | Text + Enter | Send prompt | Streaming turn |
| REPL | `\` at end of line | Continue on next line | Multi-line message |
| REPL | Ctrl-C (once / twice in 2 s) | Abort turn / exit | Session preserved |
| REPL | `/help` | List commands | Help text |
| REPL | `/model [provider/]name` | Change model | Header updates |
| REPL | `/mode plan\|ask\|auto-edit\|yolo` | Change mode (`yolo` needs typed confirm) | Header updates |
| REPL | `/new` | New session in same folder | Fresh REPL |
| REPL | `/sessions`, `/resume [id]` | List / switch | Switches session |
| REPL | `/undo [--force]` | Undo last change | Restores file; message printed |
| REPL | `/diff` | Re-print latest diff | Colored diff |
| REPL | `/compact` | Manual compaction | "Compacted: N messages summarized" |
| REPL | `/ui` | Same as `tendril ui` | Browser opens |
| REPL | `/rules` | List/remove saved rules | Table; `d <n>` removes |
| REPL | `/clear` | Clear screen only | Redraw header |
| REPL | `/exit` or Ctrl-D | Exit REPL | Daemon keeps running |
| Permission prompt | `y` / `a` / `n` (`n` then optional note line) | Answer | Turn continues |

### Android Shell

| Screen | Element | On click | Result |
| --- | --- | --- | --- |
| Launcher / Status | Auto on open | Health → start → pair | Web host on success; Setup help on failure |
| Launcher / Status | **Retry** | Restart the sequence | Re-runs steps |
| Setup help | **Open Termux** | Launch Termux | Termux opens |
| Setup help | **Copy command** | Copy the exact fix line | Toast "Copied" |
| Setup help | **Install guide** | Open docs URL in system browser | Browser opens |
| Web host | Back button | Web history back, else exit | Previous page / app closes |
| Web host | Menu → **Reload** | Reload WebView | Page reloads |
| Web host | Menu → **Shell settings** | Open settings | Shell settings |
| Web host | External link | `ACTION_VIEW` | System browser |
| Shell settings | Port field, **Start on launch** toggle | Save | Applies next launch |

## Error and empty states

- **No provider configured** (CLI): wizard starts. (Web): Chat composer disabled with "Add a provider" button → `/settings/providers/new`.
- **No sessions yet** (Web Sessions): illustration-free empty state: "No sessions yet" + **New session** button + CLI hint `tendril`.
- **Wrong or expired pairing code**: inline error with the command to run again; 5 failures → "Too many attempts, wait 60 s".
- **Daemon unreachable**: Web → Daemon offline screen; CLI → auto-start with spinner then last 10 log lines on failure; Android Shell → Status screen with Start daemon / Retry.
- **Provider error** (401, 404 model, 429, 5xx): inline error card in Chat and red line in CLI; retryable errors show "Retried 3 times"; session returns to `idle`; typed prompt is kept.
- **Network offline**: "Can't reach <host>" error card; partial assistant text kept.
- **Session busy** (409): composer keeps text, shows inline "Session is busy (running from web/CLI)".
- **Permission denied by user**: tool card shows "Denied"; the agent continues with the denial note.
- **Permission pending after reconnect**: Chat reopens the Permission sheet automatically.
- **Outside-workspace path**: tool card shows "Blocked: outside workspace"; model told.
- **Hard-guard block**: tool card shows "Blocked for safety: <pattern>"; no override in any mode.
- **Stale edit** (file changed since read): tool card shows "Read the file again"; model self-corrects.
- **Undo conflict**: dialog "File changed since this edit — Undo anyway?"
- **Workspace missing**: session opens read-only with banner "Workspace folder not found".
- **Interrupted session**: banner "Interrupted — partial answer kept"; composer enabled.
- **Binary / huge file in viewer**: "Can't preview this file (binary or over 1 MB)".
- **Context too large**: banner "Context is full — compacted" (auto) or "Message too large for the model's window" (blocking).
- **Doctor failures**: each FAIL has a one-line fix (for example `pkg upgrade nodejs-lts`).
- **Termux or permission missing** (Android Shell): Setup help screens listed above; never a blank WebView.
- **Revoked client**: next request returns 401 → UI routes to `/pair`.
