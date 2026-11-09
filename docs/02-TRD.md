# TRD: Tendril

> **I'm building:** An open-source AI coding harness for Termux: one headless agent daemon, a CLI client, and a WebView-based UI, all connected to the same live sessions.
> **Audience:** Android developers who code on their phone in Termux, and open-source contributors.

## Architecture at a glance

```
 Android phone
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Termux                                                                  │
 │  ┌───────────────┐   HTTP + SSE (127.0.0.1:7421)   ┌──────────────────┐  │
 │  │ tendril (CLI) │ ───────────────────────────────▶│                  │  │
 │  │ REPL / ask    │◀─────────── events ─────────────│   tendril serve  │  │
 │  └───────────────┘      Bearer cliToken            │   (daemon)       │  │
 │                                                    │  ┌────────────┐  │  │
 │  Android apps                                      │  │ agent loop │  │  │
 │  ┌───────────────────────────┐  cookie tdl_session │  │ tools      │  │  │
 │  │ Tendril Shell APK         │ ───────────────────▶│  │ permissions│  │  │
 │  │  WebView ─ React web UI   │◀────── events ──────│  │ providers  │  │  │
 │  │  starts daemon via        │                     │  └─────┬──────┘  │  │
 │  │  Termux RUN_COMMAND       │                     │   SQLite (WAL)   │  │
 │  └───────────────────────────┘                     └─────────┬────────┘  │
 │   (or any phone browser)                                     │ HTTPS     │
 └──────────────────────────────────────────────────────────────┼───────────┘
                                                                ▼
                                       Anthropic API / OpenAI-compatible APIs
```

**The core idea:** the agent is a server, not a CLI. The CLI and the WebView are interchangeable thin clients (the same client/server split opencode uses). This is what makes "CLI-connected WebView" real: both clients subscribe to one session's event stream and either can send prompts or answer permissions.

## Stack

- **Frontend:** React 19 + Vite 7 + TypeScript (strict), Zustand for state, `wouter` for routing, `marked` + `DOMPurify` + `highlight.js` (core + 10 languages) for markdown/code. Fonts bundled locally via `@fontsource/inter` and `@fontsource/jetbrains-mono` (the WebView must work with no network). Output is static files embedded in the npm package. Reason: the author already knows React + Vite + Capacitor-style tooling; static output means no Node-side rendering.
- **Backend (daemon):** Node.js 24.15 or newer (Termux `nodejs-lts`, which tracked 24.x as of mid-2026) + TypeScript, Hono + `@hono/node-server` for HTTP and SSE, `zod` for request validation. Reason: small, pure JS, first-class streaming, no native modules.
- **CLI:** TypeScript, `cac` for command parsing, `picocolors` for color, `@clack/prompts` for the login wizard, `node:readline` for the REPL. No markdown renderer in the terminal in v1: stream text as-is and style code fences with a tiny state machine. Reason: streaming markdown to a terminal is a flicker/wrap problem on phones; plain text is robust.
- **Database:** SQLite through the built-in `node:sqlite` (`DatabaseSync`), WAL mode, hand-written SQL migrations. Reason: it is zero-install and needs no native compile. As of Node 24.15 it is "release candidate" with no warning and no flag (Node 22 still labels it "active development"), so the minimum Node version is pinned at 24.15 and `doctor` enforces it. All DB access sits behind one `store.ts` module so a driver swap is a one-file change.
- **Hosting:** Local only. The daemon runs in Termux; the web UI is served by the daemon; the APK is distributed via GitHub Releases; the npm package via npm; CI on GitHub Actions. There is no cloud backend.
- **Android shell:** Kotlin, one `Activity`, AndroidX AppCompat + Core + WebKit (nothing else), minSdk 26, compileSdk/targetSdk 35, Gradle with the Android Gradle Plugin on JDK 17, built only in GitHub Actions (no Gradle on the phone).

## Tools

- **Authentication:** Local only. CLI: random token in `~/.tendril/state.json` (0600) sent as `Authorization: Bearer`. Web: one-time pairing code → HttpOnly cookie `tdl_session` (random 32 bytes, stored as SHA-256 hash). Model provider keys: `~/.tendril/auth.json` (0600), env override `TENDRIL_<PROVIDERID>_API_KEY`.
- **Payments:** None (not needed in v1).
- **Email / notifications:** None (not needed in v1). The optional `termux_api` tool can fire a local Termux notification only when the agent is explicitly allowed to.
- **Analytics:** None. No telemetry, no crash reporting, no network calls except to the user's configured model providers and `web_fetch` URLs the user approves.
- **Testing:** Vitest (unit + integration, runs on Termux and CI). Provider adapters are tested against recorded fixtures; one opt-in live test per provider behind an env var.
- **Linting/formatting:** `tsc --noEmit` in strict mode + Prettier. No ESLint in v1 (fewer moving parts).
- **Bundling:** `esbuild` bundles core + server + cli into one ESM file `dist/tendril.mjs` so the published package has zero runtime dependencies. `tsx` runs TypeScript in development.
- **IDs:** Own 16-byte time-sortable id helper (timestamp prefix + random), no `ulid` dependency.
- **Diffs:** `diff` (jsdiff) for unified diffs. **Globbing:** `tinyglobby`. **HTML to text:** `node-html-markdown`. **Search:** shell out to `rg` when installed, otherwise a pure-JS fallback.

### Dependency policy
Only the libraries named in this document may be added. Anything else needs a doc update first. No package with a native addon, ever (`node-gyp` on phones is the number-one reason Termux projects fail to install).

## APIs

| API | Used for | Auth method | Limits / cost |
| --- | --- | --- | --- |
| Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`, streaming SSE) | Model calls for `anthropic` providers; prompt caching on system prompt and tool definitions | `x-api-key` header + `anthropic-version` header | Paid per token; rate limits depend on the account tier. Example model ids: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5` (user-entered, never hard-coded). |
| OpenAI-compatible Chat Completions (`POST {baseUrl}/chat/completions`, streaming SSE, `tools`) | Model calls for `openai-compatible` providers (OpenAI, OpenRouter, Gemini's OpenAI-compatible endpoint, Ollama, LM Studio, Groq, DeepSeek) | `Authorization: Bearer <key>` (none for local servers) | Depends entirely on the provider; some have free tiers with strict rate limits. Verify each preset's base URL against the provider docs when implementing (Step 3). |
| Termux `RUN_COMMAND` intent (Android shell → Termux) | Start the daemon and run `tendril pair --json` from the APK | Android permission `com.termux.permission.RUN_COMMAND` + `allow-external-apps=true` in `~/.termux/termux.properties` | Local only; no cost. Requires matching Termux install source. |
| Termux:API commands (`termux-notification`, `termux-toast`, `termux-vibrate`, `termux-clipboard-get/set`, `termux-battery-status`, `termux-open-url`) | The optional `termux_api` agent tool and `tendril ui` | None (local binaries) | Needs the Termux:API app + `pkg install termux-api`; each call is permission-gated in the agent. |
| Tendril daemon API (this document, "Protocol") | CLI and web UI to daemon | Bearer token (CLI) or cookie (web) | Local only. |

## Process model

- One daemon per device, started detached (`child_process.spawn` with `detached: true`, `stdio` to log file, `unref()`), guarded by `~/.tendril/daemon.lock` (exclusive create + pid check).
- The daemon is a single Node process; each agent turn is an async task, not a thread. `bash` tool runs are child processes in their own process group (`detached: true`) so abort can kill the whole tree (`process.kill(-pid)`).
- One running turn per session (mutex in memory, mirrored in `sessions.status`). Many sessions can run concurrently; v1 caps concurrent running turns at 3 to protect phone RAM.
- On start: acquire lock, open DB, run migrations, mark `running` and `awaiting_permission` sessions `interrupted`, bind `127.0.0.1`, write `state.json`, call `termux-wake-lock` if present.
- On `SIGTERM`/`SIGINT`: abort running turns, flush, close DB, delete `state.json`, `termux-wake-unlock`.

## Directory layout

```
~/.tendril/
├─ state.json          # {pid, port, cliToken, version, startedAt}   (0600, runtime)
├─ auth.json           # provider credentials                          (0600)
├─ config.json         # defaults: provider, model, mode, port, limits
├─ AGENTS.md           # optional global instructions
├─ tendril.db          # SQLite (WAL: tendril.db-wal, tendril.db-shm)
├─ daemon.lock
└─ logs/daemon.log[.1-.4]

repo layout (npm workspaces)
tendril/
├─ package.json                # workspaces: packages/*
├─ packages/
│  ├─ core/        # types, store, providers, tools, permissions, agent loop, prompts
│  ├─ server/      # Hono app, auth, SSE hub, daemon lifecycle
│  ├─ cli/         # bin `tendril`, REPL, wizard, renderers
│  └─ web/         # Vite React UI → built into packages/cli/assets/web
├─ apps/android-shell/         # Kotlin WebView app
├─ scripts/        # install.sh, build.mjs (esbuild), release helpers
├─ docs/           # the six spec docs
├─ AGENTS.md
└─ .github/workflows/{ci.yml,release.yml}
```

## Protocol (daemon API)

Base URL `http://127.0.0.1:<port>`. JSON bodies, UTF-8. Every `/api/*` route except `GET /api/health` and `POST /api/pair` requires auth. Errors: `{ "error": { "code": "snake_case", "message": "human text" } }` with proper HTTP status.

### Routes

| Method + path | Purpose | Auth |
| --- | --- | --- |
| `GET /api/health` | `{ok, version, authed}` | none |
| `POST /api/pair` `{code, label}` | Exchange one-time code → sets `tdl_session` cookie | none (rate-limited) |
| `POST /api/pair/code` | Create a one-time pairing code (5 min, single use) | Bearer only |
| `POST /api/logout` | Revoke current web client | cookie |
| `GET /api/sessions?workspace=&cursor=` | List sessions (50/page, newest first) | any |
| `POST /api/sessions` `{workspace, provider?, model?, mode?}` | Create session | any |
| `GET /api/sessions/:id` | Session + latest messages + pending permission requests | any |
| `PATCH /api/sessions/:id` `{title?, mode?, provider?, model?}` | Update | any |
| `DELETE /api/sessions/:id` | Abort and delete | any |
| `POST /api/sessions/:id/messages` `{text}` | Start a turn → `202` or `409 session_busy` | any |
| `POST /api/sessions/:id/abort` | Abort running turn | any |
| `POST /api/sessions/:id/compact` | Manual compaction | any |
| `GET /api/sessions/:id/events` | SSE stream (supports `Last-Event-ID`) | any |
| `POST /api/sessions/:id/permissions/:requestId` `{decision: "allow_once"\|"allow_always"\|"deny", note?}` | Answer a prompt → `200` or `409 already_resolved` | any |
| `GET /api/sessions/:id/changes` | List edits (tool runs that changed files) | any |
| `GET /api/sessions/:id/changes/:toolRunId` | Unified diff + metadata | any |
| `POST /api/sessions/:id/changes/:toolRunId/undo` `{force?}` | Revert one edit | any |
| `GET /api/sessions/:id/files?path=` | List directory inside the workspace | any |
| `GET /api/sessions/:id/file?path=` | Read text file (≤ 1 MB) inside the workspace | any |
| `GET /api/fs/dirs?path=` | Directory chooser for new sessions (allowed roots only) | any |
| `GET /api/config`, `PUT /api/config` | Defaults (port change needs restart) | any |
| `GET /api/providers`, `PUT /api/providers/:id`, `DELETE /api/providers/:id`, `POST /api/providers/:id/test` | Provider CRUD (keys write-only, returned masked) | any |
| `GET /api/permissions/rules`, `DELETE /api/permissions/rules/:id` | Saved "always" rules | any |
| `GET /api/clients`, `DELETE /api/clients/:id` | Paired web clients | any |
| `GET /api/doctor` | Same checks as `tendril doctor` | any |
| `GET /*` (non-API) | Static web UI with SPA fallback to `index.html` | none (static assets only) |

### SSE events

Format: `id: <seq>` (per-session monotonically increasing integer), `event: <type>`, `data: <json>`. The server keeps the last 2000 events per active session in memory; if `Last-Event-ID` is older than the buffer, the server sends `event: resync` and the client refetches `GET /api/sessions/:id`.

| Event | Payload |
| --- | --- |
| `session.status` | `{status}` where status ∈ `idle, running, awaiting_permission, interrupted, error` |
| `session.updated` | `{title?, mode?, model?, provider?, usage}` |
| `message.created` | `{message}` (user or assistant shell with id, role) |
| `text.delta` | `{messageId, text}` |
| `tool.start` | `{toolRunId, messageId, name, input, summary}` |
| `tool.output` | `{toolRunId, chunk, stream}` (stdout/stderr chunks for `bash`) |
| `tool.permission` | `{requestId, toolRunId, name, summary, input, options}` |
| `permission.resolved` | `{requestId, decision, by}` where by ∈ `cli, web, abort, rule, mode` |
| `tool.end` | `{toolRunId, status, resultPreview, changeId?, exitCode?, durationMs}` |
| `usage` | `{inputTokens, outputTokens, contextTokens, contextWindow}` |
| `compaction` | `{status: "started"\|"done"\|"failed", droppedMessages?}` |
| `error` | `{code, message, retryable}` |
| `resync` | `{}` |
| `ping` | `{}` every 20 s (keeps proxies and the WebView connection alive) |

### Host and Origin protection
Reject any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`. For non-GET requests and for SSE, if `Origin` is present it must equal `http://127.0.0.1:<port>` or `http://localhost:<port>`. No CORS headers are ever sent. Cookies are `HttpOnly; SameSite=Strict; Path=/`.

## Providers: normalized model interface

One internal format (Anthropic-style content blocks) so the loop is provider-agnostic:

```ts
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };
type Message = { role: "user" | "assistant"; content: Block[] };

interface ProviderAdapter {
  stream(req: {
    model: string; system: string; messages: Message[];
    tools: ToolSpec[]; maxOutputTokens: number; signal: AbortSignal;
  }): AsyncIterable<ProviderEvent>;   // text_delta | tool_use_start | tool_use_input_delta | tool_use_end | usage | stop
}
```

- `anthropic` adapter: direct `fetch` to Messages API with `stream: true`; sets `cache_control` on the system block, the last tool definition, and the last user message to enable prompt caching.
- `openai-compatible` adapter: Chat Completions with `tools`; reassembles streamed `tool_calls` argument fragments; maps `tool_result` blocks to `role: "tool"` messages; tolerates providers that omit `usage` (falls back to estimates).
- Own thin adapters instead of a vendor SDK: about 300 lines each, no SDK churn, no extra dependencies.
- Retry policy: up to 3 attempts for 429/5xx/network errors, exponential backoff starting at 1 s, honoring `Retry-After`. Never retry after a tool call has started executing.

## Tools (agent tools)

| Tool | Class | Parameters | Behavior and limits |
| --- | --- | --- | --- |
| `read_file` | read | `path`, `offset?`, `limit?` | Text only; line-numbered output; default 2000 lines; refuse binary; marks file as "read" (path + sha256 + mtime) |
| `list_dir` | read | `path` | Non-recursive, dirs first, max 500 entries |
| `glob` | read | `pattern`, `path?` | `tinyglobby`, respects `.gitignore`, max 500 results |
| `grep` | read | `pattern`, `path?`, `glob?`, `context?`, `ignoreCase?` | `rg` if installed else JS fallback; max 200 matches |
| `write_file` | edit | `path`, `content` | Create or overwrite; existing file requires prior read with unchanged hash; snapshot + diff |
| `edit_file` | edit | `path`, `old_string`, `new_string`, `replace_all?` | Exact match; must be unique unless `replace_all`; requires prior read; snapshot + diff |
| `bash` | exec | `command`, `timeout?`, `description?` | `bash -c` from the workspace; new process group; stateless per call; default timeout 120 s, max 600 s; env scrubbed of provider keys and `TENDRIL_*`; streams `tool.output`; output cap 30,000 chars (12,000 head + 12,000 tail) |
| `web_fetch` | net | `url`, `maxChars?` | `http(s)` only; 20 s timeout; 1 MB body cap; HTML converted to markdown; always prompts outside `yolo` |
| `todo_write` | read (state only) | `todos[]` | Keeps a visible checklist per session; shown in both clients |
| `termux_api` | system | `command`, `args[]` | Allow-list only: `notification, toast, vibrate, clipboard-get, clipboard-set, battery-status, open-url`; offered only if Termux:API is detected |

Path rules for all file tools: resolve against the workspace root, then `realpath`; the result must stay inside the workspace's `realpath` (or a configured `additionalDirs`). Anything else returns an error to the model ("outside workspace; ask the user").

## Permission engine

Decision order for each tool call:

1. **Hard guard** (bash only): normalized command matches a catastrophic pattern → deny in every mode, tell the model.
2. **Mode gate** (table below).
3. **Saved rules** (`permission_rules` table): an `allow` rule matching tool + pattern (+ workspace) auto-approves; a `deny` rule auto-denies.
4. **Prompt** the user (creates a permission request; session → `awaiting_permission`).

| Class | `plan` | `ask` (default) | `auto-edit` | `yolo` |
| --- | --- | --- | --- | --- |
| read | allow | allow | allow | allow |
| edit | not offered to model | prompt | allow (in workspace) | allow |
| exec | not offered | prompt | prompt | allow (hard guard still applies) |
| net | not offered | prompt | prompt | allow |
| system | not offered | prompt | prompt | prompt |

Pattern normalization for "allow always": `bash` rules store the first command word plus its subcommand when the command is a single simple command (for example `npm test`, `git status`); the rule matches `npm test` followed by anything. Commands containing `;`, `&&`, `||`, `|`, `$(`, backticks, redirections, or newlines are never saved as rules. File-edit "always" rules are `edit: <workspace>`.

## System prompt composition

Order: base prompt → environment block → global `~/.tendril/AGENTS.md` → workspace `AGENTS.md` (or `CLAUDE.md`) → mode block → tool list (via the tools parameter, not text). Each file is capped at 32 KB. The environment block is regenerated every turn: platform, arch, Termux version, Node version, `$PREFIX`, `$HOME`, workspace path, date, git branch + `git status --short` (first 20 lines), `rg`/`git` availability. The Termux notes (no root, `pkg`, no `/tmp`, `$TMPDIR`, no background processes in v1, shared storage in `~/storage`) live in the base prompt.

## Context management

- Token estimate: `ceil(chars / 4)` until a provider reports usage; then use reported `input_tokens` as ground truth for the last request.
- Tool results are truncated at the tool level (see tools table). Results older than the last 8 tool runs are replaced in the model context by `[old result omitted: <tool> <summary>]`; the full result stays in the DB.
- Auto-compact at 80% of `contextWindow`: summarize everything except the last 6 messages with the session's model using a fixed summarization prompt; store in `sessions.summary` and `sessions.summary_upto_seq`.
- `contextWindow` comes from the provider/model config (default 128000).

## Android shell (apps/android-shell)

- Package id `dev.tendril.shell`. Permissions: `INTERNET`, `com.termux.permission.RUN_COMMAND`. `<queries>` declares `com.termux`.
- Network security config: cleartext allowed only for `127.0.0.1` and `localhost`; everything else HTTPS-only.
- WebView hardening: JS and DOM storage on; file/content access off; mixed content never allowed; Safe Browsing on; **no `addJavascriptInterface`**; `shouldOverrideUrlLoading` keeps navigation inside `127.0.0.1:<port>` and hands everything else to `ACTION_VIEW`; `WebView.setWebContentsDebuggingEnabled` only in debug builds.
- Start flow: `GET /api/health` → if unreachable, send `RUN_COMMAND` (path `$PREFIX/bin/tendril`, args `["serve","--detach"]`, background true) → poll health up to 20 s → send `RUN_COMMAND` for `tendril pair --json` with a result `PendingIntent` → read `stdout` from the result bundle → load the returned URL (it contains `/pair#code=…`; the web app strips the fragment after use).
- Settings screen: daemon port (default 7421), "Start daemon on launch" toggle. Nothing else.
- Release builds are signed with a keystore stored in GitHub Actions secrets; the certificate SHA-256 is published in release notes.

## CI/CD (GitHub Actions)

- `ci.yml` (on push/PR): Node 24 matrix on `ubuntu-latest` → `npm ci`, `tsc --noEmit`, `vitest run`, build web, esbuild bundle, smoke test (`node dist/tendril.mjs doctor --json`). Separate job: Android `./gradlew lint assembleDebug` on JDK 17, uploads debug APK as an artifact.
- `release.yml` (on tag `v*`): build everything, `npm publish --provenance` (trusted publishing), `./gradlew assembleRelease` with signing secrets, generate `SHA256SUMS`, create GitHub Release with APK + checksums + changelog.
- Contributors can do everything except the APK build on a phone; the APK always comes from CI.

## Constraints

- **Performance:**
  - CLI start to prompt with daemon already running: under 1.5 s on a mid-range arm64 phone.
  - Daemon idle memory: under 150 MB RSS; one active turn: under 300 MB.
  - Added latency between provider token arrival and client render: under 100 ms.
  - Web UI initial JS: under 400 KB gzipped; first meaningful paint under 2 s on a mid-range phone from the local daemon.
  - SSE reconnect after app resume: under 3 s.
  - `read_file`/`grep` on a 10k-file repo return in under 2 s with `rg`, under 8 s with the JS fallback.
- **Security:**
  - Bind `127.0.0.1` only (never `0.0.0.0`); Host and Origin allow-list; SameSite=Strict HttpOnly cookies; pairing codes single-use, 5 min, rate-limited; 0600 permissions on `state.json`, `auth.json`, `tendril.db`.
  - Secrets never logged; `Authorization`/`x-api-key` values and cookie values are redacted in logs; provider keys scrubbed from tool subprocess environments.
  - Web UI renders model output through `DOMPurify`; links get `rel="noopener noreferrer"`; no `eval`, no inline scripts (strict Content-Security-Policy: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`).
  - No sandbox on Android without proot: the `bash` tool runs as the Termux user. Mitigation is permission prompts plus the hard guard; this is documented in `SECURITY.md`.
- **Device / browser support:**
  - Android 8.0 (API 26) or newer for the shell; Termux installed from F-Droid or GitHub (Google Play builds are a separate signing lineage; all Termux apps must come from the same source).
  - Node.js 24.15 or newer; arm64 primary target, arm32 and x86_64 best-effort.
  - WebView: current Android System WebView (Chromium 120+). Web UI also works in Chrome, Firefox, and Samsung Internet on Android.
  - Development works on Linux/macOS desktops too (no Termux-only code paths outside the `termux/` module).
