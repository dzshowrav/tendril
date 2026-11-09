# UI-UX Design Brief: Tendril

> **I'm building:** An open-source AI coding harness for Termux: one headless agent daemon, a CLI client, and a WebView-based UI, all connected to the same live sessions.
> **Audience:** Android developers who code on their phone in Termux, and open-source contributors.

## Style

- **Mood:** Minimal, calm, technical. A dark "terminal at night" feel with one accent color. Dense but readable on a 360 px wide screen. No decoration that does not carry information: no gradients, no illustrations, no emoji in UI chrome.
- **Reference apps:** Claude Code and opencode (tool-card transcripts), GitHub Mobile (lists, diffs), Termux itself (monospace, extra-keys row), Linear mobile (calm density).
- **Principles:**
  1. The conversation is the product: chat gets the whole screen; everything else is one tap away in a sheet.
  2. Mobile first, one-handed: primary actions live in the bottom 40% of the screen.
  3. State is always visible: running / waiting for you / idle is shown in the header at all times.
  4. Destructive and powerful actions are boring and explicit (Allow/Deny buttons are labeled words, never icons).
  5. Works offline from the internet; no remote fonts, no remote images, no CDN.
- **Theme:** Dark only in v1 (light theme is out of scope). The web UI sets `color-scheme: dark`.

## Color palette

Contrast ratios were computed against WCAG 2.x (AA needs 4.5:1 for text).

| Role | Hex | Notes |
| --- | --- | --- |
| Background | `#0B0F14` | App background |
| Surface | `#121821` | Cards, sheets, tool cards, composer |
| Surface raised | `#1A2230` | Inputs, chips, hover/pressed states |
| Border | `#263042` | 1 px dividers and outlines |
| Text | `#E6EDF3` | 16.3:1 on Background, 15.1:1 on Surface |
| Text muted | `#8B98A9` | 6.6:1 on Background, 5.4:1 on Surface raised |
| Text disabled | `#6B7788` | Disabled controls only (exempt from contrast rules) |
| Primary | `#3DDC97` | Buttons, active tab, links, user prompt marker; 10.9:1 on Background |
| On primary | `#04120B` | Text on Primary buttons; 10.8:1 |
| Secondary | `#7AA2F7` | Tool names, info, secondary links; 7.6:1 on Background |
| Success | `#3DDC97` | Same as Primary (success states) |
| Warning | `#E0AF68` | Pending permission, interrupted, doctor WARN; 8.9:1 on Surface |
| Error | `#F7768E` | Errors, Deny, doctor FAIL; 7.3:1 on Background |
| Diff add background | `#0F2A1D` | Text `#3DDC97` on it is 8.7:1 |
| Diff remove background | `#2D1620` | Text `#F7768E` on it is 6.4:1 |
| Code block background | `#0E131B` | Inline and block code |
| Overlay scrim | `rgba(0,0,0,0.6)` | Behind sheets |

Syntax highlight palette (highlight.js theme, custom, on `#0E131B`): keyword `#BB9AF7` (8.1:1), string `#9ECE6A` (10.2:1), number `#FF9E64` (9.2:1), comment `#7D8AA0` italic (5.3:1), function `#7AA2F7` (7.4:1), type `#2AC3DE` (8.8:1), variable `#E6EDF3` (15.8:1), attribute `#E0AF68` (9.3:1). All pass AA.

CSS custom properties (declare once in `:root`): `--bg --surface --surface-2 --border --text --muted --primary --on-primary --secondary --warning --error --diff-add-bg --diff-del-bg --code-bg`.

## Typography

- **UI font:** Inter, weights 400, 500, 600 (bundled via `@fontsource/inter`, Latin subset). Fallback stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Mono font:** JetBrains Mono, weights 400 and 600 (bundled via `@fontsource/jetbrains-mono`, Latin subset). Fallback: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.
- **Scale (px, with line-height):**
  - Screen title: Inter 600, 20 / 28
  - Section title: Inter 600, 16 / 24
  - Body (chat prose): Inter 400, 16 / 24
  - UI label / button: Inter 500, 15 / 20
  - Caption / meta: Inter 400, 13 / 18 (muted)
  - Code and tool output: JetBrains Mono 400, 13.5 / 20
  - Diff lines: JetBrains Mono 400, 13 / 19
- User-controlled text size: respects Android font scale up to 130% without clipping (use `rem`, not px, for text).

## Components

- **Spacing:** 4 px base grid; screen horizontal padding 16 px; vertical rhythm 8/12/16/24.
- **Radius:** 12 px cards and sheets, 10 px inputs and buttons, 999 px chips.
- **Touch targets:** minimum 48 x 48 dp for every tappable element, 8 dp minimum gap between targets.
- **Buttons:**
  - Primary: background `#3DDC97`, text `#04120B`, height 48, radius 10, weight 500.
  - Secondary: background `#1A2230`, 1 px border `#263042`, text `#E6EDF3`.
  - Destructive (Deny, Delete, Revoke): background transparent, 1 px border `#F7768E`, text `#F7768E`; filled `#F7768E` with text `#0B0F14` when it is the confirming button in a confirm sheet.
  - Text button: no background, text `#7AA2F7`.
  - Pressed state: darken 8%; focus ring 2 px `#7AA2F7` outside 2 px offset (visible with hardware keyboards).
- **Inputs:** height 48, background `#1A2230`, border `#263042` (focus: border `#3DDC97`), placeholder `#8B98A9`; error: border `#F7768E` + message below in 13 px error color.
- **Composer:** pinned to bottom; multi-line, grows from 1 to 6 lines then scrolls; Send button 48 dp circle (Primary); becomes Stop (Error outline, square icon with the text label "Stop") while running; shows keyboard-safe padding using the visual viewport.
- **Chips:** height 32 (touch target extended to 48 with padding), background `#1A2230`, mono 13 px; used for mode, model, workspace.
- **Cards (tool cards):** Surface background, 1 px border `#263042`, radius 12. Header row: tool name in Secondary color (mono, 600) + one-line summary in Text, status dot at the right (running: pulsing Warning; ok: Success; error: Error; denied: muted). Body collapsed by default; expands to show input and output.
- **Message layout:** No bubbles. User messages: full-width block with a 3 px Primary left bar and the text in Text color. Assistant messages: plain prose on Background. Tool cards sit inline between prose blocks.
- **Modals / sheets:** Bottom sheets only (no centered dialogs), radius 16 on top corners, drag handle, scrim, max height 85%; always have a labeled primary action at the bottom.
- **Navigation:**
  - Global: Sessions screen is home; gear icon top right.
  - In a session: bottom tab bar with three tabs, **Chat**, **Changes**, **Files** (icon + label, 56 dp high, active tab Primary color).
  - Back arrow top left on every non-home screen (also maps to Android back).
- **Toasts:** bottom, above the composer/tab bar, 3 s, Surface raised background.
- **Icons:** Lucide set (inline SVG, 24 px, 1.75 stroke) imported individually, never as a whole font.
- **Motion:** 150 ms ease-out for sheets and chips; streaming text appends with no animation; honor `prefers-reduced-motion` (remove pulsing and slide animations).
- **Status header (Chat):** a 2 px bar under the top app bar: Primary when running (indeterminate shimmer), Warning when awaiting permission (solid), none when idle, Error when error.

## Screens

### Pair (`/pair`)
- Layout, top to bottom: app wordmark "tendril" (mono 600, 20) centered at 20% height → one line of explanation ("Enter the code from `tendril pair`") → 8-character code field (mono 24, letter-spaced, auto-uppercase, auto-submits when complete) → **Connect** primary button → "How to get a code" text button that expands two code snippets with Copy.
- Key elements: code field, Connect, inline error line, help accordion. When opened with `#code=…` in the URL, the field is filled and submitted automatically with a "Connecting…" state.

### Sessions (`/`)
- Layout, top to bottom: app bar (title "Sessions", gear icon right) → workspace group headers (mono 13, muted, shows folder path shortened with `~`) → session rows (title 16 / 600, second line: model chip text + relative time + status dot; 72 dp tall) → floating **New session** button (Primary, 56 dp, bottom right, label + plus icon).
- Key elements: session row (tap = open, long-press = Rename/Delete sheet), status dot (idle none, running Primary pulsing, waiting Warning, interrupted Warning hollow, error Error), FAB, gear.

### New session sheet (over `/`)
- Layout, top to bottom: sheet title "New session" → **Workspace** field (shows current path, tap opens folder browser list with breadcrumb) → recent workspaces as chips → **Model** row (provider + model, tap to change) → **Mode** chips (plan, ask, auto-edit, yolo; ask preselected; yolo has Error-colored text) → **Start** primary button.
- Key elements: folder browser (list of directories, "Use this folder" button), mode chips, Start.

### Chat (`/s/:id`)
- Layout, top to bottom: app bar (back arrow, session title truncated, overflow menu: Rename, Compact, Delete) → status bar (2 px) → sub-header row with workspace chip (path tail), model chip, mode chip, usage meter (thin 4 px bar + "42k / 200k" caption) → transcript (scrolling; auto-follows the bottom unless the user scrolls up, then shows a "Jump to latest" pill) → todo strip (collapsible, only when todos exist) → composer → bottom tab bar (Chat, Changes, Files).
- Key elements: user message blocks, assistant prose with markdown and highlighted code blocks (Copy button top right of each block), tool cards, diff cards (file path, "+12 −3", **View diff**), error cards (Error border, retry info), interrupted banner, Send/Stop.

### Permission sheet (over Chat)
- Layout, top to bottom: title "Allow Bash?" (tool name varies) → status line in Warning color "Waiting for your answer" → command or path in a mono block (scrollable, max 6 lines visible, Details chevron expands) → for edits, a compact diff preview (first 12 lines) → note field (optional, "Tell the agent why") shown only after tapping Deny → three buttons stacked at the bottom, each 48 dp: **Allow once** (Primary), **Allow always** (Secondary; disabled with reason text for compound commands), **Deny** (Destructive outline).
- Key elements: it cannot be dismissed by tapping the scrim (swipe down minimizes it to a Warning banner above the composer: "1 request waiting — Review").

### Changes (`/s/:id/changes`)
- Layout, top to bottom: app bar "Changes" (back) → list of changes newest first: file path (mono, 2 lines max, middle-ellipsis), "+N −M", time, state tag (Applied / Undone / Not undoable) → bottom tab bar.
- Key elements: change rows (tap opens Diff). Empty state: "No edits in this session yet".

### Diff (`/s/:id/changes/:toolRunId`)
- Layout, top to bottom: app bar (back, file name, overflow: Copy diff) → file path and stats line → unified diff (horizontal scroll inside the diff container only; line numbers gutter in muted; added lines on `#0F2A1D` with `#3DDC97` text and a `+` marker; removed lines on `#2D1620` with `#F7768E` text and a `−` marker; hunk headers in Secondary) → sticky bottom bar with **Undo** (Destructive outline) and **Copy diff** (Secondary).
- Key elements: Undo with conflict dialog (sheet: "File changed since this edit. Undo anyway?" with filled Destructive confirm).

### Files (`/s/:id/files`)
- Layout, top to bottom: app bar "Files" → breadcrumb row (tappable segments, horizontal scroll) → list (folders first; 56 dp rows; icon, name, size/modified caption) → bottom tab bar. Opening a file shows a viewer: line numbers, highlighted code, horizontal scroll, Copy path button in the app bar.
- Key elements: breadcrumb, rows, viewer. Binary/over-1 MB: centered message "Can't preview this file".

### Settings (`/settings`)
- Layout, top to bottom: app bar "Settings" (back) → grouped list rows with chevron: Providers, Permissions, Clients, About.
- **Providers:** list of providers (name, type, base URL host, masked key "••••abcd", status of last test) + **Add provider** button. Editor: type selector (Anthropic / OpenAI-compatible), preset chips, name, base URL, API key (password field with show toggle, write-only), default model, context window, **Test connection**, **Save**, **Delete** (Destructive).
- **Permissions:** default mode chips (plan, ask, auto-edit; yolo is never offered here), then list of saved rules (tool, pattern, workspace path, **Remove**).
- **Clients:** rows with label, user agent summary, paired date, last seen, **Revoke** (Destructive); this device is tagged "This device".
- **About:** version, daemon port, workspace count, **Run doctor** button, results as rows with PASS (Success), WARN (Warning), FAIL (Error) pills and one-line fixes (copyable), license line.

### Daemon offline (full screen)
- Layout: centered column: small broken-link icon (Error color) → title "Daemon is offline" → one line "Tendril runs inside Termux" → **Retry** (Primary) → text button "How to start it" (expands `tendril serve` snippet with Copy). In the Android Shell this screen also shows **Start daemon**.

### Android Shell: Launcher / Status
- Layout: Background `#0B0F14`, wordmark centered, below it a vertical list of 3 steps with states (Check daemon, Start daemon, Pair) each with a 20 dp spinner / check / error icon, current step text in Text color, others muted; **Retry** appears on failure. System status/navigation bars colored `#0B0F14` with light icons.
- App icon: adaptive icon, `#0B0F14` background, a Primary-colored rounded square outline with a small curl (tendril) emerging from the top right; monochrome variant for themed icons.

### Android Shell: Setup help
- Layout, top to bottom: title naming the problem ("Termux isn't set up for Tendril yet") → numbered steps with mono code blocks and a **Copy command** button each → **Open Termux** (Primary) → **Retry** (Secondary) → **Install guide** text button.

### Android Shell: Web host and Shell settings
- Web host: edge-to-edge WebView inside system bars (insets handled by the web UI via `env(safe-area-inset-*)`); no native chrome. Overflow menu (top right, only on long-press of the status bar area or via the toolbar menu when the web UI is not showing its own): Reload, Shell settings.
- Shell settings: two rows: Port (number input, default 7421), Start daemon on launch (switch). Save is automatic.

## CLI visual style

- Prompt line: `›` in Primary followed by the user's text; continuation lines `…`.
- Header line (printed once per session and after `/mode` or `/model`): `tendril · <workspace tail> · <mode> · <model>` in muted color, mode word colored (plan: Secondary, ask: Text, auto-edit: Warning, yolo: Error).
- Assistant text: default terminal foreground; code fences dimmed with a leading `│ ` gutter; no box drawing beyond that single gutter character.
- Tool lines: `▸ read_file src/App.tsx` (tool name in Secondary, arguments muted); result summary on the next line in muted (`↳ 142 lines`); bash output indented two spaces in muted until it finishes, then collapsed to the last 5 lines unless the command failed.
- Diffs: added lines Success color with `+`, removed lines Error color with `-`, hunk headers Secondary; no background fills (terminal themes vary).
- Permission prompt: `? Allow bash: npm test  [y]once [a]lways [n]o ›` in Warning color; single keypress, no Enter needed.
- Errors: `✖ <message>` in Error color; warnings `! <message>` in Warning color; success `✔` in Success color.
- Color is optional: honors `NO_COLOR` and non-TTY output (no escape codes); symbols fall back to ASCII (`>`, `-`, `x`) when `TENDRIL_ASCII=1` or when the locale is not UTF-8.
- Width: wraps at terminal width; never assumes more than 40 columns.
