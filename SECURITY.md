# Security Policy

## The Termux Security Model & Reality

Tendril is designed specifically to run in **Termux on Android**. Developing in Termux introduces unique security realities that differ fundamentally from traditional desktop operating systems or cloud servers:

1. **Single Android UID Isolation:**
   - Android assigns a unique Linux User ID (e.g., `u0_a442`) to the Termux application sandbox. Android's OS kernel enforces strict sandboxing between Termux and other installed Android applications.
   - However, **inside Termux, all binaries, shell scripts, and Node.js processes share the exact same UID**.
   - Traditional unprivileged Linux sandbox mechanisms (such as Docker, Bubblewrap, systemd cgroups, or Linux user namespaces `CLONE_NEWUSER`) **do not exist** inside unprivileged Termux without rooting the device.
   - Any command executed within Termux has identical filesystem permissions to the user: full read and write access to `$HOME`, `$PREFIX`, and Android shared storage (`/sdcard` or `~/storage/shared`) if storage permissions were granted.

Because operating-system-level process sandboxing cannot be enforced within unprivileged Termux, **Tendril implements defense-in-depth directly into its architecture**.

---

## Defense-in-Depth Mechanisms in Tendril

### 1. Hard Catastrophic Command Guard
- All shell executions (`bash` tool) pass through a strict static analysis gate before evaluation.
- Commands matching destructive patterns are **strictly blocked with zero bypass**, even in YOLO mode:
  - Recursive root or home deletions (`rm -rf /`, `rm -rf ~`, `rm -rf $PREFIX`)
  - Direct block device manipulation (`dd of=/dev/...`, `mkfs.*`)
  - Mass process termination or fork bombs (`:(){ :|:& };:`)
  - Raw filesystem mounting or partition writes

### 2. Mode Gate & Permission Engine
Tendril operates under a 4-tier mode matrix:
- **`plan` mode:** Only read-only inspection tools (`read_file`, `list_dir`, `glob`, `grep`, `todo_write`) are exposed to the AI model. Mutating tools are completely omitted from the tool schema sent to the provider.
- **`ask` mode (Default):** Every file mutation (`write_file`, `edit_file`), shell command (`bash`), network fetch (`web_fetch`), and Android system call (`termux_api`) requires explicit, interactive user approval before running.
- **`auto-edit` mode:** File edits within the designated workspace are auto-approved for rapid iteration, but shell commands, network access, and system calls continue to require explicit user approval.
- **`yolo` mode:** Automated development mode where file, bash, and network tools run automatically. However, Android system actions (`termux_api`) still require user confirmation, and the catastrophic command guard remains active.

### 3. Workspace Jail & Traversal Prevention
- File tools validate target paths using canonical resolution (`realpathSync` where paths exist).
- Path traversal sequences (`../`, null bytes) and symlinks that resolve outside the active workspace directory are rejected before opening or writing.

### 4. Process Tree Lifetime & Resource Limits
- Commands invoked via `bash` are spawned with dedicated process groups (`setpgid: true`).
- Commands are subject to configurable timeouts (default 60 seconds).
- When a command times out or is aborted by the user, Tendril kills the entire process group tree (via negative PID signal `-pid`), preventing orphaned background processes from running indefinitely.

### 5. Automatic File Snapshots & 1-Click Rollback
- Tendril captures pre-image snapshots in SQLite before applying any file write or patch.
- Users can inspect unified diffs and perform instant 1-click Undo from the CLI or Web UI.
- Conflict detection ensures that if a file was edited externally on disk after an agent action, the user is warned before overwriting disk state.

### 6. Local Daemon & Web Isolation
- **Loopback-Only Binding:** The Tendril daemon listens exclusively on `127.0.0.1` (IPv4 loopback) on ports `7421–7430`. It never binds to `0.0.0.0` or public network interfaces.
- **DNS Rebinding Protection (Host Guard):** Requests with unrecognized or forged `Host` headers are rejected with `421 Misdirected Request`, preventing malicious websites from manipulating the local daemon via DNS rebinding.
- **Origin Guard:** Browser cross-origin requests from non-local origins are rejected with `403 Forbidden`.
- **Content Security Policy (CSP):** Strict CSP headers prevent unauthorized inline scripts, external script loading, and unsafe framing.

### 7. Pairing & Credential Security
- **One-Time Pairing Codes:** Web and mobile shell clients connect using a 6-digit numeric pairing code with a 5-minute time-to-live (TTL).
- **Brute-Force Rate Limiting:** 5 consecutive invalid pairing attempts triggers an automatic 60-second lockout.
- **Revocable Tokens:** Paired clients receive cryptographically secure 256-bit tokens and HttpOnly, SameSite=Strict cookies.
- **Active Revocation Watchdog:** Revoking a client immediately closes all active SSE connections for that client within 5 seconds.

### 8. Secrets Redaction
- API keys (such as `sk-...`), authentication tokens, and Authorization headers are automatically redacted in server logs, ring buffers, and Web UI payloads.

---

## Best Practices for Users

1. **Avoid Running in YOLO Mode on Untrusted Repositories:** Use the default `ask` mode or `plan` mode when inspecting unfamiliar codebases.
2. **Do Not Expose Daemon Ports to Public Networks:** Never use reverse proxies or tunnels (like ngrok or cloudflared) to expose your Tendril port `7421` to the public internet without proper authentication.
3. **Audit Paired Clients Regularly:** Review the Clients tab in Settings or run `tendril clients list` to ensure only trusted devices are paired.
4. **Shared Storage Discretion:** Only grant Termux shared storage permissions (`termux-setup-storage`) if you explicitly want Tendril or your projects to access files outside Termux's private directory.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Tendril, please report it responsibly:
- **Do not open a public issue.**
- Email details to **security@tendril.dev** or submit a private security advisory via GitHub Security Advisories.
- Please include steps to reproduce, affected versions, and system environment. We aim to acknowledge receipt within 48 hours and provide a fix in a timely manner.
