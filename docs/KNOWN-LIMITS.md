# Known Platform Limits & Constraints

This document details known constraints, system boundaries, and architectural trade-offs in Tendril on Android/Termux and other platforms, as specified in the Technical Requirements Document (`docs/02-TRD.md`).

---

## 1. Security & Sandbox Boundaries

### No Native Process Sandbox on Android (Single-UID Model)
- **Constraint:** Android does not provide per-command cgroups, namespaces, or native sandboxing for command-line tools without `proot` or root privileges. Inside Termux, all subprocesses spawned by the `bash` tool run as the Termux user UID (`u0_a...`).
- **Rationale:** Termux operates as a single Android application. Any child process has the same filesystem permissions as Termux itself.
- **Mitigation:**
  1. **Strict Permission Modes:** `plan` mode disallows execution entirely; `ask` mode requires user approval for all mutating, executing, network, and system tools; `auto-edit` allows only in-workspace edits without permission; `yolo` mode is gated behind an explicit `--yolo` flag.
  2. **Catastrophic Command Guard:** Commands matching catastrophic destructive patterns (such as `rm -rf /`, `rm -rf ~`, `mkfs`, raw block device writes, `chmod -R 777 /`) are unconditionally rejected by `isCatastrophic()` regardless of session mode.
  3. **Workspace Boundary Enforcement:** File read, write, and edit tools validate canonical paths using `WorkspaceGuard`, preventing path traversal (`../`) and symlink escapes outside the workspace root.
  4. **Subprocess Environment Scrubbing:** Secret tokens, API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.), passwords, and internal `TENDRIL_*` variables are stripped from subprocess environments via `scrubEnvironment()` before spawning child processes.
  5. **Network Boundaries:** The daemon binds strictly to `127.0.0.1` (never `0.0.0.0`). The `hostGuard` rejects DNS-rebinding attempts with `421 Misdirected Request`, and `originGuard` rejects cross-origin browser requests with `403 Forbidden`.

### Storage Permissions (`~/storage/shared`)
- **Constraint:** Termux can only access external shared Android storage (`/sdcard` or `~/storage/shared`) if the user grants the Android system permission (`termux-setup-storage`).
- **Mitigation:** `tendril doctor` tests access to `~/storage/shared` and outputs the exact command to grant permission if missing.

---

## 2. Android OS & Process Management

### Android Phantom Process Killer (Android 12+)
- **Constraint:** Android 12, 13, and 14 introduce the Phantom Process Killer, which terminates background child processes if an app spawns more than 32 processes or if background CPU consumption spikes.
- **Mitigation:**
  1. The daemon acquires a wake lock via `termux-wake-lock` on startup (`--wake-lock`).
  2. `tendril serve --detach` launches the daemon in a detached background process unlinked from the active shell.
  3. `tendril doctor` warns about battery optimization and provides instructions to disable it for Termux (and points to [dontkillmyapp.com](https://dontkillmyapp.com)).
  4. Interrupted session recovery: If Android kills the daemon mid-turn, on next launch the daemon marks interrupted sessions as `interrupted` and preserves all partial assistant output.

### Termux Distribution Lineage
- **Constraint:** The version of Termux published on Google Play is deprecated and cannot receive updates due to Android target SDK requirements. Installing the Google Play version will cause package management and linking errors.
- **Requirement:** Termux must be installed from F-Droid or GitHub Releases. Both the Termux app and the Tendril Android Shell (and Termux:API companion app if used) must share compatible build signatures.

---

## 3. Node.js Runtime & Native Addons

### Zero Native Addons Policy (`node-gyp` avoidance)
- **Constraint:** C++ compilation tools (`gcc`, `g++`, `make`, `python`) frequently fail or encounter header mismatches when compiling native Node.js addons (`node-gyp`) on Android arm64.
- **Requirement:** Tendril requires Node.js 24.15 or newer with built-in `node:sqlite` (`DatabaseSync`). It has zero native addon dependencies (`better-sqlite3`, etc. are strictly excluded). All dependencies must be pure JavaScript/TypeScript.

### Mobile Cold-Start Performance
- **Constraint:** Node.js cold startup on low-power mobile ARM cores without V8 code caches can take 1.0–1.8 seconds.
- **Mitigation:**
  1. The production CLI is bundled and minified with `esbuild`, reducing bundle size from 1.7 MB to ~950 KB.
  2. Heavy modules (server, repl) are dynamically imported or gated behind subcommands so commands like `--version` and `--help` execute rapidly.
  3. Budgets: CLI start < 1.5s on desktop / < 2.5s on mobile Termux; Web bundle < 400 KB gzipped (actual: ~130 KB); Daemon idle RSS < 150 MB (actual: ~65 MB).

---

## 4. Search & Repository Scaling

### Ripgrep vs Pure JavaScript Fallback
- **Constraint:** Pure JavaScript recursive file tree traversal and regex filtering on large repositories (e.g., > 10,000 files) can take 5–8 seconds due to mobile filesystem I/O constraints.
- **Mitigation:** Tendril utilizes native `ripgrep` (`rg`) when available in `$PATH`, returning search results across 10,000 files in under 2 seconds. The JS fallback is used only if `rg` is not installed, and `tendril doctor` warns the user to install ripgrep via `pkg install ripgrep`.

---

## 5. Web UI & WebView Compatibility

### Android System WebView Version
- **Constraint:** Ancient Android System WebView versions (below Chromium 120) lack modern CSS Container Queries and baseline ES2022 features.
- **Requirement:** Android 8.0 (API 26) or newer with Android System WebView 120+. The Web UI is also fully tested and supported in Chrome, Firefox, and Samsung Internet for Android.
- **Hardening:**
  - Strict Content-Security-Policy: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'`.
  - Zero `addJavascriptInterface` declarations in Android Shell.
  - All rendered assistant markdown sanitized with `DOMPurify`.
