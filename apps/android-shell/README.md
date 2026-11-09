# Tendril Android Shell (`apps/android-shell`)

Hardened native Android companion shell (Kotlin + WebView) for Tendril.

## Architecture & Security Highlights

- **Package ID:** `dev.tendril.shell` (minSdk 26, targetSdk 34).
- **Hardened WebView:**
  - JavaScript and DOM storage enabled for the Web UI SPA.
  - File access and content access strictly disabled (`allowFileAccess = false`, `allowContentAccess = false`).
  - Mixed content strictly prohibited (`MIXED_CONTENT_NEVER_ALLOW`).
  - Safe Browsing enabled.
  - **Zero JavaScript bridge interface policy** across the entire codebase.
  - Navigation restricted to `127.0.0.1:<port>` and `localhost:<port>`. All external URLs and third-party links are dispatched to the system browser via `ACTION_VIEW`.
- **Network Security Configuration:**
  - Cleartext HTTP permitted strictly for `127.0.0.1` and `localhost`. Everything else requires HTTPS.
- **Termux IPC Bridge:**
  - Communicates with Termux using `com.termux.permission.RUN_COMMAND` to launch `tendril serve --detach` and retrieve pairing URLs via `tendril pair --json`.
  - Seamless zero-touch pairing: cold launch starts daemon, retrieves one-time pairing code via PendingIntent, and immediately opens the authenticated session.
- **Setup Help State:**
  - Comprehensive troubleshooting screens for missing Termux, missing `RUN_COMMAND` permission, missing `allow-external-apps = true`, or daemon startup timeouts, with 1-tap command copying.
- **CI Built Exclusively:**
  - Built and linted in GitHub Actions CI using `./gradlew lint assembleDebug` on JDK 17 to maintain the zero native addons policy in Termux.
