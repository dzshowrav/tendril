# Implementation Plan: Tendril

> **I'm building:** An open-source AI coding harness for Termux: one headless agent daemon, a CLI client, and a WebView-based UI, all connected to the same live sessions.
> **Audience:** Android developers who code on their phone in Termux, and open-source contributors.

Rules for the agent:
- Build one step at a time.
- After each step, run the app and confirm it works before moving on.

Additional rules for this project:
- Stack and dependencies are exactly those in `02-TRD.md`. No native addons. No library that is not listed there.
- Every step ends with tests (Vitest) for the new behavior and a green `npm run typecheck && npm test`.
- Commit after each step with message `step N: <title>`.
- Develop on the phone in Termux where possible (`tsx`, `vite`, `vitest` all work there). The Android shell (Step 13) is built only by GitHub Actions.
- If a doc is missing information or two docs disagree, stop and ask.

## Steps

### Step 1: Repo, toolchain, and `doctor` stub (F13, F14 groundwork)
Create the npm-workspaces monorepo from the TRD layout: `packages/{core,server,cli,web}`, `apps/android-shell` (empty placeholder), `scripts/`, `docs/` (the six docs), `AGENTS.md`, MIT `LICENSE`. Verify the project name is free on npm and GitHub first (rename across docs if not). TypeScript strict, Prettier, Vitest, `tsx`, esbuild bundle script that produces `dist/tendril.mjs` with a shebang. `ci.yml` runs typecheck + tests on Node 24. Implement `tendril --version` and a first `tendril doctor` that reports Node version (needs 24.15+), whether `import("node:sqlite")` works, and whether it is running in Termux.
**Done when:** on the phone in Termux, `npm install && npm run build && node dist/tendril.mjs doctor` prints PASS for Node and sqlite; `npm run typecheck` and `npm test` pass locally; CI is green on the first push.

### Step 2: Core foundations: paths, config, ids, logging, store (F1, F8 storage)
In `packages/core`: `paths.ts` (`~/.tendril` layout, 0700/0600 permissions), `config.ts` + `auth.ts` (zod-validated JSON, env-var key override, atomic writes via temp file + rename), `ids.ts`, `log.ts` (rotating file logger with secret redaction), and `store.ts` wrapping `node:sqlite` with migration runner and migration 1 exactly as in `05-BACKEND-SCHEMA.md`. Add typed repository functions for sessions, messages, tool_runs, snapshots, permission_rules, web_clients.
**Done when:** a test creates a temp home, runs migrations, inserts and reads one row in every table, cascades a session delete, and confirms a database with a higher `schema_migrations.version` is refused; file modes on `auth.json` and the DB are verified in a test.

### Step 3: Provider adapters (F5)
Implement the normalized `Message/Block` types, the `ProviderAdapter` interface, the SSE line parser, the retry policy, the `anthropic` adapter (with prompt-caching markers) and the `openai-compatible` adapter (tool-call fragment reassembly, missing-usage fallback). Add provider presets (OpenAI, OpenRouter, Gemini OpenAI-compatible endpoint, Ollama, LM Studio, Groq, DeepSeek) and verify each preset base URL against the provider's current docs. Add a `scripts/try-provider.ts` that streams one prompt and one tool-call round trip.
**Done when:** fixture-based tests pass for both adapters (text stream, tool-call stream, 429 then success, mid-stream abort); with a real key, `tsx scripts/try-provider.ts <provider> "say hi"` streams tokens and a forced tool call returns a parsed `tool_use` for at least one Anthropic and one OpenAI-compatible provider.

### Step 4: Workspace guard and read-only tools (F6)
Implement `workspace.ts` (resolve + `realpath` + containment check + `additionalDirs`) and the tools `read_file`, `list_dir`, `glob`, `grep` (with `rg` and the JS fallback), and `todo_write`, plus the tool registry (`ToolSpec`, JSON schema generation from zod, class tagging). Implement the read-tracking table used later for read-before-edit.
**Done when:** tests prove path traversal (`../`), absolute paths outside the workspace, and a symlink pointing outside are all rejected; `read_file` handles line ranges, binary refusal, and the 2 MB rule; `grep` returns the same matches with and without `rg` on a fixture repo.

### Step 5: Mutating tools: `write_file`, `edit_file`, `bash`, `web_fetch` (F6, F10)
Implement `write_file` and `edit_file` (read-before-edit with hash check, uniqueness rule, `replace_all`), snapshot + unified diff creation into `snapshots`, and `undo` logic (hash-mismatch refusal, created-file deletion, `--force`). Implement `bash` (process group, timeouts, abort kill escalation, env scrub, 12k/12k output truncation, streamed output callback) and `web_fetch` (limits, HTML→markdown). Add the hard-guard pattern list as a pure function `isCatastrophic(command)`.
**Done when:** tests cover: edit with 0 and 2 matches, stale-file refusal, snapshot + undo restore, undo refusal after outside modification, bash timeout kills a child that spawned a grandchild, abort kills the tree, provider keys absent from the child's `env`, and a table of at least 20 command strings classified by the hard guard (both blocked and allowed).

### Step 6: Permission engine and modes (F7)
Implement the decision order (hard guard → mode gate → saved rules → prompt), the mode matrix from the TRD, bash pattern normalization with the compound-command exclusion, the pending-request registry (`requestId`, first-answer-wins, abort = deny), and rule persistence.
**Done when:** a matrix test enumerates every class × every mode and matches the TRD table; "allow always" is refused for `a && b`, `$(…)`, pipes, and redirects; a concurrent double-answer test shows exactly one winner and one `already_resolved`.

### Step 7: Agent loop, prompts, context management (F6, F9, F11)
Implement `agent.ts`: build system prompt (base + environment block + global/workspace `AGENTS.md` with 32 KB caps + mode block), run the model→tools→model cycle with parallel read-only tools and sequential mutating tools, step cap, stuck-loop detection (3 identical failing calls), abort handling, usage accounting, interrupted-session recovery on startup, token estimation, tool-result truncation and old-result placeholders, auto-compaction at 80% and manual compaction. Everything emits typed events through an `EventSink` interface (no HTTP yet).
**Done when:** an integration test with a scripted fake provider runs a 3-step task (read → edit with a permission answer → final text) and asserts the emitted event sequence and DB rows; a test forces compaction with a tiny context window and asserts the summary is stored and later requests are smaller; a test kills the process mid-turn (simulated) and the next start marks the session `interrupted`; `AGENTS.md` content appears in the system prompt and is re-read each turn.

### Step 8: Daemon server: HTTP, auth, SSE, lifecycle (F1, F4)
In `packages/server`: Hono app with all routes from the TRD "Protocol" table, Host/Origin guard, pairing codes (in memory, 5 min, rate limit), cookie sessions with hashed tokens, Bearer `cliToken`, SSE hub with per-session sequence ids, 2000-event ring buffer, `Last-Event-ID` replay and `resync`, 20 s pings, permission endpoints, changes/files/fs endpoints, provider/config/rules/clients/doctor endpoints, static file serving with SPA fallback and the CSP header. Daemon lifecycle: lock file, port search 7421–7430, `state.json`, detach, graceful shutdown, wake lock, log rotation.
**Done when:** integration tests (real HTTP on an ephemeral port) prove: unauthenticated `/api/sessions` → 401; wrong Host header → 421/403; foreign Origin → 403; pairing happy path and single use; 5 bad codes lock for 60 s; SSE replay after reconnect delivers missed events in order; two simultaneous message POSTs give one 202 and one 409; revoked client's stream closes within 5 s; `curl` against a running daemon can complete a full prompt using the Bearer token.

### Step 9: CLI client (F2, F5, F8, F4, F10)
In `packages/cli`: command routing (`cac`), auto-start/attach, REPL with history and multi-line input, event renderers per the Design Brief's CLI style (tool lines, diffs, permission prompt with single-key answers, usage line), slash commands (`/help /model /mode /new /sessions /resume /undo /diff /compact /ui /rules /clear /exit`), `ask` with exit codes and `--json` (newline-delimited events), `login` wizard with test request, `sessions`, `resume`, `pair [--json]`, `ui` (via `termux-open-url`, printing the URL when unavailable), `serve/stop/status/logs`. Honor `NO_COLOR`, non-TTY, `TENDRIL_ASCII`.
**Done when:** on the phone, `tendril login` configures a real provider; `tendril` in a scratch folder completes "create hello.txt containing hi" with a permission prompt answered by `y`; `/undo` removes the file; `tendril ask "…" --mode plan` runs read-only and exits 0; piping stdin into `ask` works; killing the CLI mid-turn with Ctrl-C twice leaves a usable session; `tendril resume` continues it.

### Step 10: Web UI part 1: shell, Pair, Sessions, Chat, Permission sheet (F3, F4, F6, F7)
In `packages/web`: Vite + React + TypeScript project, design tokens as CSS variables from the Design Brief, bundled fonts, router, Zustand stores, SSE client with `Last-Event-ID` reconnect and `resync`, API client, Pair screen (fragment auto-submit, then fragment cleared), Sessions list and New session sheet (with folder browser), Chat screen (streaming markdown via `marked` + `DOMPurify`, code blocks with Copy, tool cards, diff cards, composer with Send/Stop, mode/model chips, usage meter, status bar, jump-to-latest), Permission sheet, Daemon offline state, CSP-compliant build copied into `packages/cli/assets/web` by the build script.
**Done when:** with the daemon running, opening the pairing URL in the phone browser pairs and shows Sessions; sending a prompt in the web Chat streams a reply; the same prompt typed in the CLI appears live in the web Chat and vice versa; a permission request shows in both clients and the first answer wins; toggling airplane mode for 10 s and back reconnects the stream and restores state with no duplicate messages; initial JS is under 400 KB gzipped (build script asserts it).

### Step 11: Web UI part 2: Changes, Diff, Files, Settings (F10, F5, F7, F4, F13)
Implement Changes list, Diff viewer with Undo (conflict dialog), Files browser/viewer (1 MB cap), Settings (Providers CRUD with masked keys and Test connection, Permissions rules + default mode, Clients with Revoke, About with Doctor results), and the remaining empty/error states from the App Flow.
**Done when:** an edit made by the agent appears in Changes within 1 s, its Diff renders with correct add/remove styling, Undo restores the file (verified on disk) and the row shows "Undone"; editing the file by hand then pressing Undo shows the conflict dialog; adding a provider in Settings makes it selectable in New session; revoking the current device lands on Pair; the Doctor button lists every check with a fix line.

### Step 12: Termux integration, `termux_api` tool, installer (F13, F14)
Complete `doctor` (install source/version hints, Node ≥ 24.15, `node:sqlite`, `git`, `rg`, storage permission, Termux:API, `allow-external-apps`, wake-lock, battery/phantom-process-killer guidance, "not Termux" detection), implement the `termux_api` tool with its allow-list and detection gating, wake lock on daemon start/stop, `scripts/install.sh` (checks Termux, installs `nodejs-lts git ripgrep`, runs `npm i -g tendril`, prints next steps; no `sudo`), and `SECURITY.md` explaining the no-sandbox reality.
**Done when:** on a phone without Termux:API, `doctor` shows WARN (not FAIL) and the model is not offered `termux_api`; with it installed, an agent-requested `battery-status` prompts for permission and returns JSON; `install.sh` run on a clean Termux install (or a fresh Termux data wipe) ends with a working `tendril doctor`; running `doctor` on a Linux desktop prints "not Termux" and still passes the generic checks.

### Step 13: Android shell app and APK CI (F12)
Build `apps/android-shell` exactly as the TRD describes: manifest and permissions, network security config (cleartext only for loopback), single `Activity` with hardened WebView, launcher/status flow (health → `RUN_COMMAND` start → `RUN_COMMAND` pair with result `PendingIntent` → load URL), Setup help screens, shell settings, adaptive icon. Add the Gradle CI job (debug APK artifact on every push) and the signed release job skeleton.
**Done when:** the debug APK from CI installs on a real phone; with Termux (same source) configured per the Setup help screen, a cold launch with the daemon stopped starts it, pairs, and shows Sessions with no manual steps; denying the Termux permission shows the Setup help screen with the exact fix; tapping an external link opens the system browser; rotation keeps the session; no `addJavascriptInterface` appears anywhere in the code (checked by a lint step).

### Step 14: Hardening, end-to-end tests, performance budgets (all features)
Add the cross-cutting tests: end-to-end script (`scripts/e2e.mjs`) that starts a daemon with a fake provider, drives it through CLI and HTTP, and asserts the J1–J3 journeys; DNS-rebinding/Host tests; log-redaction tests (grep logs for key material); SSE soak test (1,000 events, random disconnects); two-client approval race; interrupted-session recovery; workspace deleted mid-session; DB corruption refusal; performance checks for the TRD budgets (CLI start, idle RSS, bundle size) that fail CI when exceeded.
**Done when:** `npm run e2e` passes locally and in CI; every constraint in the TRD "Constraints" section is either asserted by a test or explicitly listed in `docs/KNOWN-LIMITS.md` with the reason; `grep -R "sk-" ~/.tendril/logs` after the e2e run finds nothing.

### Step 15: Release (F14)
Write `README.md` (what it is, 60-second Termux quick start, screenshots of CLI and web UI, architecture diagram from the TRD, security note), `CONTRIBUTING.md` (including how to develop on a phone), `CHANGELOG.md`, issue templates. Finish `release.yml`: on tag `v0.1.0` build web + bundle, `npm publish --provenance`, build and sign the release APK, generate `SHA256SUMS`, and create the GitHub Release with the signing certificate fingerprint in the notes.
**Done when:** a fresh phone (or wiped Termux) can follow only the README to install `tendril` from npm, install the APK from the Release, run a first task from the CLI and from the WebView, and `tendril doctor` is all PASS; the GitHub Release contains the APK, checksums, and fingerprint; the npm package has zero runtime dependencies (`npm ls --omit=dev` empty) and no native addons.

## Done when (summary checklist)

- [x] Step 1: `doctor` stub runs on the phone; CI green
- [x] Step 2: schema migration 1 creates all seven tables; file modes verified
- [x] Step 3: both provider adapters pass fixtures and a live round trip
- [x] Step 4: workspace escape attempts all rejected; read tools correct
- [x] Step 5: edits snapshot and undo; bash timeouts and aborts kill process trees
- [x] Step 6: permission matrix matches the TRD exactly
- [x] Step 7: scripted 3-step task, compaction, and interrupted recovery pass
- [x] Step 8: auth, Host/Origin, pairing, SSE replay, busy-409 verified over real HTTP
- [x] Step 9: CLI completes a real task, `/undo` works, `ask` exit codes correct
- [x] Step 10: web chat live-mirrors the CLI; permission race resolves; reconnect is clean
- [x] Step 11: Changes/Diff/Undo, Files, Settings, Doctor all work
- [x] Step 12: Termux checks, `termux_api`, installer verified on clean Termux
- [x] Step 13: APK cold-starts the daemon via Termux and pairs automatically
- [x] Step 14: e2e, security, and performance budgets pass
- [x] Step 15: README-only install works; release artifacts published

## Coverage map (PRD feature → steps)

| Feature | Steps |
| --- | --- |
| F1 Daemon | 2, 7 (recovery), 8, 14 |
| F2 CLI client | 9 |
| F3 Web UI | 10, 11 |
| F4 Pairing and local security | 8, 10, 11, 14 |
| F5 Providers and models | 3, 9, 11 |
| F6 Agent loop and tools | 4, 5, 7 |
| F7 Permissions and modes | 5 (guard), 6, 10, 11 |
| F8 Sessions | 2, 8, 9, 10 |
| F9 Project instructions and Termux-aware prompt | 7 |
| F10 Edit review and undo | 5, 9, 11 |
| F11 Context management | 7 |
| F12 Android shell app | 13 |
| F13 Termux integration and doctor | 1, 11, 12 |
| F14 Install and distribution | 1, 12, 15 |

## Milestones

- **M1 "Headless agent" (Steps 1–7):** the agent loop runs in tests with real providers via the script. Nothing user-facing yet.
- **M2 "CLI harness" (Steps 8–9):** a working Claude-Code-style CLI on the phone. This is the first thing worth open-sourcing as a pre-release (`v0.1.0-alpha`).
- **M3 "WebView connected" (Steps 10–13):** web UI plus the Android shell; the CLI-connected-WebView promise is real.
- **M4 "Public release" (Steps 14–15):** hardened, documented, published.
