# Contributing to Tendril 🌱

Thank you for your interest in contributing to Tendril! Tendril is an open-source AI coding harness specifically tailored for Android developers coding on their devices in Termux.

---

## 📱 Developing Directly on Android (in Termux)

Tendril is uniquely designed so that it can be developed, tested, and run directly on an Android phone inside Termux without requiring a separate PC.

### 1. Prerequisites in Termux
```bash
pkg update && pkg install -y nodejs-lts git ripgrep
```
- **Node.js:** Node.js 24.15.0+ is strictly required (for native `node:sqlite` and modern ECMAScript features).
- **Git:** Git 2.30+.
- **ripgrep:** Required for fast file grep across workspaces.

### 2. Termux Runtime Considerations
- **Termux Wake-Lock:** Android may suspend Termux background processes when the screen turns off. Run:
  ```bash
  termux-wake-lock
  ```
  during long builds or tests.
- **Android Phantom Process Killer (Android 12+):** Android limits child processes spawned by apps to 32 by default. To disable this via ADB or Termux (if root/wireless debugging is available):
  ```bash
  /system/bin/device_config put activity_manager max_phantom_processes 2147483647
  ```
  See [`docs/KNOWN-LIMITS.md`](docs/KNOWN-LIMITS.md) for more details.
- **Zero Native Addons Policy:**
  - Because `node-gyp` and C++ compilation frequently fail or produce incompatible binaries on mobile ARM/Android environments, Tendril enforces a strict **Zero Native Addons Policy**.
  - Never add dependencies that require native C/C++ compilation. Use pure JavaScript, TypeScript, or platform-independent WebAssembly (such as `sql.js` if fallback is ever needed).
  - Database access is strictly handled via Node 24's built-in `node:sqlite`.

---

## 🏗️ Monorepo Architecture

Tendril is structured as an npm workspaces monorepo:

```
tendril/
├── packages/
│   ├── core/           # Database store (SQLite), workspace isolation, tool registry, agent loop, models
│   ├── server/         # Hono daemon server, Bearer & Cookie auth, SSE hub, pairing endpoints
│   ├── cli/            # cac CLI, interactive REPL, slash commands, ask mode, doctor
│   └── web/            # React + Vite mobile-first web interface, Zustand stores, SSE client
├── apps/
│   └── android-shell/  # Native Android WebView shell (Kotlin + Material Design 3)
├── scripts/            # Build, e2e, budget-check, and lint scripts
└── docs/               # PRD, TRD, App Flow, Design Brief, Database Schema, Implementation Plan
```

---

## 🛠️ Development & Verification Workflow

### 1. Clone & Setup
```bash
git clone https://github.com/dzshowrav/tendril.git
cd tendril
npm install
```

### 2. Run Verification Commands
Before submitting any changes, all verification gates must pass:

```bash
# 1. Build Web UI and CLI bundle
npm run build

# 2. Run TypeScript strict typecheck across all packages
npm run typecheck

# 3. Run all unit and integration tests (Vitest)
npm test

# 4. Run performance budgets and end-to-end journey tests
npm run e2e

# 5. Run shell script and Android WebView security linter
npm run lint:shell
```

### 3. Check Zero-Dependency Distribution
The final bundled package in `dist/` must have zero runtime dependencies:
```bash
cd dist && npm ls --omit=dev
```
This should output an empty dependency tree.

---

## 🛡️ Security Guidelines

- **No Remote Telemetry or Tracking:** Tendril runs 100% locally on `127.0.0.1`.
- **Secrets Redaction:** API keys (`sk-ant-...`, `sk-...`) must never appear in log files or console output. Tendril automatically scrubs them via the central `Logger` and `scrubEnvironment`.
- **Workspace Boundary:** Agent operations must never escape the workspace directory unless explicitly allowed. Symlinks pointing outside workspaces must be rejected.
- **Android WebView Safety:** Never expose `addJavascriptInterface` in the Android Shell companion app. All communication must occur over authenticated localhost HTTP/SSE.

---

## 📝 Commit Conventions

We follow clear, concise commit messages. When working through milestone steps, follow:
- `step N: <title>` (for implementation plan steps)
- `feat: <description>` (for new features)
- `fix: <description>` (for bug fixes)
- `docs: <description>` (for documentation updates)
- `refactor: <description>` (for code refactoring)

---

## 🚀 Submitting a Pull Request

1. Fork the repository and create your branch from `main`.
2. Make your changes adhering to the Zero Native Addons policy and coding standards.
3. Ensure all tests (`npm test && npm run e2e`) pass locally.
4. Submit a Pull Request clearly explaining:
   - What changed and why.
   - Any mobile/Termux-specific testing performed.
   - Confirmation that all automated checks passed.
