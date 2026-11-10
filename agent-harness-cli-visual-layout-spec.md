# Agent Harness: Text-based CLI Visual Layout Design Spec

| তথ্য | বিবরণ |
|---|---|
| উদ্দেশ্য | AI agent harness-এর terminal UI-এর **দৃশ্যমান (visual) লেআউট ডিজাইন**: কোন জিনিস স্ক্রিনের কোথায়, কেমন দেখাবে, কত কলাম জায়গা নেবে |
| ধাঁচ | Claude Code / Antigravity-এর মতো text-based, বর্ডারযুক্ত ইনপুট বক্স, `●` বুলেট দিয়ে tool call, নিচে footer |
| তৈরির তারিখ | November 10, 2026 |
| পূর্ববর্তী ডকুমেন্ট | `agent-harness-ui-ux-instructions.md` (আচরণ ও নীতি)। এই ফাইল সেটির **ভিজ্যুয়াল পরিপূরক** |

## ০. পড়ার আগে (গুরুত্বপূর্ণ)

1. **ডায়াগ্রামগুলো স্পেক-ওয়্যারফ্রেম।** এগুলো Claude Code বা Antigravity-র হুবহু স্ক্রিনশট নয়। Claude Code-ধাঁচের পরিচিত কনভেনশন (বুলেট, `⎿` সংযোগকারী, বর্ডারযুক্ত prompt box, নিচের hint footer) এবং Kiro Terminal UI ডকের আচরণ মিলিয়ে তৈরি।
2. **Antigravity CLI-র সঠিক লেআউট আমি যাচাই করিনি।** তাই সেটির নামে কোনো নির্দিষ্ট দাবি এখানে নেই। আপনি স্ক্রিনশট দিলে আমি ফাইলটি সেই অনুযায়ী মিলিয়ে দিতে পারব।
3. ডায়াগ্রামের ভেতরের লেখা ইচ্ছাকৃতভাবে English, কারণ বাস্তব টার্মিনালে এটাই দেখা যাবে। ব্যাখ্যা বাংলায়।
4. **`<angle-brackets>` মানে runtime থেকে আসা মান।** মডেল নাম, পাথ, সংখ্যা, শতাংশ, সময় কখনো hardcode করা যাবে না। সব এসে বাস্তব state থেকে (প্রজেক্টের "কোনো নকল ডেটা নয়" নিয়ম)।
5. কোনো emoji নেই। শুধু box-drawing অক্ষর ও টেক্সট চিহ্ন। প্রতিটির ASCII fallback সেকশন ১-এ আছে।
6. সব বক্স **৭৬ কলাম চওড়া** (ডিফল্ট), ছোট টার্মিনালের রূপ সেকশন ১৯-এ।

---

## ১. গ্লিফ ভোকাবুলারি ও ASCII Fallback

প্রতিটি UI উপাদানের জন্য **একটিমাত্র** চিহ্ন। একই অর্থে দুই চিহ্ন ব্যবহার নিষেধ।

| ভূমিকা | Unicode | ASCII fallback | কোথায় |
|---|---|---|---|
| Assistant / tool বুলেট | `●` | `*` | প্রতিটি assistant বার্তা ও tool call-এর শুরুতে |
| Tool result সংযোগকারী | `⎿` | `\_` | tool call-এর নিচের ফলাফল লাইন |
| User prompt চিহ্ন | `>` | `>` | ইনপুট বক্স ও ইতিহাসে user বার্তা |
| Spinner (চলমান) | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `- \ \| /` | কাজ চলাকালে |
| সফল | `✓` | `[ok]` | tool শেষ |
| ত্রুটি | `✗` | `[x]` | tool ব্যর্থ বা denied |
| অপেক্ষা | `…` | `...` | approval বা input-এর অপেক্ষা |
| Thinking | `✻` | `~` | reasoning ব্লক |
| Task খোলা / শেষ | `☐` / `☒` | `[ ]` / `[x]` | activity tray |
| Focus caret | `▸` | `>` | picker ও মেনুর নির্বাচিত সারি |
| Box কোণ ও রেখা | `╭ ╮ ╰ ╯ │ ─ ├ ┤ ┬ ┴ ┼` | `+ \| -` | সব বক্স |
| Dashed divider | `┄` | `-` | content ও action আলাদা করতে |
| Progress bar | `█` / `░` | `#` / `.` | context, usage, MCP progress |
| Scroll নির্দেশক | `▲ ▼` | `^ v` | fullscreen ও panel |
| Comment marker | `▌` | `\|` | review screen |
| Notice | `i` `!` `x` | একই | info, warn, error |

**নিয়ম:** `capabilities` মডিউল Unicode সমর্থন না পেলে (বা `ASCII_MODE` চালু থাকলে) পুরো ইন্টারফেস ASCII টেবিলে নামবে। কোনো কম্পোনেন্ট নিজে থেকে চিহ্ন বেছে নেবে না; সবাই একটি `glyphs` মডিউল থেকে নেবে।

---

## ২. স্ক্রিনের কাঠামো (Zones)

পর্দা ছয়টি জোনে ভাগ। উপর থেকে নিচে ক্রম **সবসময় একই**।

```text
╭─ Terminal viewport ──────────────────────────────────────────────────────╮
│ A  BANNER         session header, printed once, scrolls away             │
├──────────────────────────────────────────────────────────────────────────┤
│ B  CONVERSATION   user message, thinking, tool cards, markdown replies   │
│                   inline mode: append-only into terminal scrollback      │
│                   fullscreen mode: own scrollable viewport               │
├──────────────────────────────────────────────────────────────────────────┤
│ C  LIVE REGION    spinner + elapsed time, queued messages, task tray     │
│                   1 to 8 rows, redrawn in place                          │
├──────────────────────────────────────────────────────────────────────────┤
│ D  APPROVAL BAR   only when a tool needs consent; sits above input       │
├──────────────────────────────────────────────────────────────────────────┤
│ E  INPUT BOX      bordered, 3 to 10 rows, grows with content             │
├──────────────────────────────────────────────────────────────────────────┤
│ F  FOOTER         1 row: hints (left)   mode | model | context (right)   │
╰──────────────────────────────────────────────────────────────────────────╯
```

### দুটি রেন্ডার মোড

| মোড | আচরণ | কখন |
|---|---|---|
| **Inline** (ডিফল্ট) | A ও B টার্মিনালের স্বাভাবিক scrollback-এ লেখা হয়; শুধু C, D, E, F নিচে "live region" হিসেবে বারবার আঁকা হয় | সাধারণ ব্যবহার, scrollback ও copy-paste বজায় থাকে |
| **Fullscreen** | alternate screen; B নিজস্ব scrollable viewport, মাউস স্ক্রল সহ; E ও F নিচে স্থির | দীর্ঘ সেশন, মনিটর, review |

**নিয়ম:** Live region (C-F) **কখনো scrollback-এ ছাপা হবে না**। প্রতিটি ফ্রেমে আগের live region মুছে নতুন করে আঁকতে হবে। স্থায়ী ইতিহাসে যাবে শুধু A ও B।

---

## ৩. Welcome Banner (জোন A)

### ৩.১ পূর্ণ রূপ (৭০ কলাম বা তার বেশি)

```text
╭─ Agent Harness <version> ────────────────────────────────────────────────╮
│                                                                          │
│   <model-name>                          cwd   <short-cwd>                │
│   <account-or-plan-label>               mode  <permission-mode>          │
│                                                                          │
│   /help  commands     @  file reference     !  shell     ctrl+c  exit    │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

### ৩.২ সংক্ষিপ্ত রূপ (৫০ কলামের কম)

```text
╭─ Agent Harness <version> ────────────────╮
│ <model-name>                             │
│ <short-cwd>                              │
│ /help   @file   !shell                   │
╰──────────────────────────────────────────╯
```

### ৩.৩ নিয়ম

- Banner **একবারই** ছাপা হয়, সেশনের শুরুতে। পরে আর আঁকা হয় না।
- `/clear` বা নতুন সেশনে আবার ছাপা যাবে।
- Banner-এ শুধু **আসল মান** থাকবে। যে মান জানা নেই (যেমন account label) সেই সারি বাদ যাবে, ফাঁকা বা "unknown" দেখানো যাবে না।
- কোনো animation বা ASCII লোগো নয়। লোগো চাইলে সর্বোচ্চ ১ সারি, `capabilities` অনুযায়ী ঐচ্ছিক।

---

## ৪. Idle অবস্থা: Input Box ও Footer (জোন E ও F)

### ৪.১ খালি ইনপুট

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ > Ask anything   /  commands   @  files   !  shell                       │
╰──────────────────────────────────────────────────────────────────────────╯
```
```text
  ? for shortcuts                                <mode> | <model> | ctx <pct>%
```

- Placeholder টেক্সট **dim** রঙে; টাইপ শুরু হলেই মুছে যায়।
- Footer-এর বাম পাশ: প্রসঙ্গভিত্তিক hint (সেকশন ২৪)। ডান পাশ: mode, model, context শতাংশ।
- ইনপুট বক্স ও footer-এর মাঝে **কোনো ফাঁকা সারি নেই**।

### ৪.২ মাল্টি-লাইন ইনপুট (বক্স উপরের দিকে বাড়ে)

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ > Refactor the settings loader so that it                                │
│   1. reads precedence from flag, env, file                               │
│   2. reports which source won                                            │
│   keeps the public API unchanged_                                        │
╰──────────────────────────────────────────────────────────────────────────╯
```
```text
  shift+enter newline · esc clear                <mode> | <model> | ctx <pct>%
```

- বক্সের **নিচের প্রান্ত স্থির**, উপরের প্রান্ত উপরে ওঠে (সর্বোচ্চ ১০ সারি, তারপর ভেতরে স্ক্রল)।
- দ্বিতীয় লাইন থেকে `>` এর জায়গায় **ফাঁকা indent** (২ কলাম), যাতে টেক্সট সোজা থাকে।
- কার্সার `_` বা block cursor, টার্মিনালের নিজস্ব cursor ব্যবহার করুন।

### ৪.৩ দীর্ঘ পেস্ট (chip)

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ > Please review this: [pasted text <n> lines]                            │
╰──────────────────────────────────────────────────────────────────────────╯
```
```text
  tab expand chip · backspace remove chip        <mode> | <model> | ctx <pct>%
```

### ৪.৪ Shell escape মোড

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ ! <command being typed>                                                  │
╰──────────────────────────────────────────────────────────────────────────╯
```
```text
  shell mode · enter run · esc exit shell mode   <mode> | <model> | ctx <pct>%
```

প্রথম অক্ষর `!` হলে প্রম্পট চিহ্ন `>` থেকে `!` হয় এবং বক্সের বর্ডার **mode-accent** রঙে বদলায়।

### ৪.৫ ইনপুট বক্সের অবস্থা ও বর্ডার রঙ

| অবস্থা | বর্ডার | Prompt চিহ্ন |
|---|---|---|
| Normal | `border.default` | `>` |
| Focused (ডিফল্টে সবসময়) | `border.focus` | `>` |
| Shell mode | `prompt.accent` | `!` |
| Plan mode | `status.waiting` (একটি স্বতন্ত্র রঙ) | `>` এবং footer-এ `plan` |
| Agent চলছে, ইনপুট queue হচ্ছে | `border.default` + dim | `>` |
| অনুমোদনের অপেক্ষা (ইনপুট নিষ্ক্রিয়) | dim | লুকানো, সেকশন ৯ |

---

## ৫. একটি সম্পূর্ণ Turn-এর লেআউট (জোন B)

কথোপকথন **বাম-সারিবদ্ধ**, কোনো chat-bubble নেই। মূল নিয়ম: বাম গাটার ২ কলাম, বুলেটের পরে টেক্সট।

```text
> Add pagination to the products list endpoint

  ✻ Thinking…  (ctrl+o to expand)

● I'll start by reading the current handler and its tests.

● Read(<path/to/handler>)
  ⎿  Read <n> lines

● Search(pattern: "<pattern>", path: "<dir>")
  ⎿  Found <n> matches  (ctrl+o to expand)

● Update(<path/to/handler>)
  ⎿  Updated <path/to/handler> with <a> additions and <r> removals
       <ln>  -  <removed line>
       <ln>  +  <added line>

● Bash(<test command>)
  ⎿  ✓ Done (exit 0) · <n> lines  (ctrl+o to expand)

● Pagination is in place. Summary:

  - <point one>
  - <point two>

  Next, you may want to <suggestion>.
```

### ৫.১ স্পেসিং ও ইনডেন্ট নিয়ম (সংখ্যায়)

| উপাদান | বাম অবস্থান (কলাম, ০ থেকে) | নিয়ম |
|---|---|---|
| User বার্তা | ০ | `> ` দিয়ে শুরু; দীর্ঘ লাইন wrap হলে **দ্বিতীয় লাইন কলাম ২-এ** (hanging indent) |
| Assistant বুলেট | ০ | `● ` তারপর টেক্সট |
| Assistant টেক্সটের পরের লাইন | ২ | বুলেটের টেক্সটের নিচে সোজা |
| Tool call শিরোনাম | ০ | `● Name(args)` |
| Tool result | ২ | `⎿  ` (সংযোগকারী ও দুই স্পেস), ফলাফল টেক্সট কলাম ৫ থেকে |
| Result-এর পরের লাইন | ৫ | সংযোগকারীর টেক্সটের নিচে সোজা |
| Thinking | ২ | `✻ Thinking…` |
| Code block | ২ | বর্ডারহীন, dim background বা বাম বর্ডার `│` |
| Markdown list | ২ | `- ` তারপর টেক্সট; nested প্রতি স্তরে +২ |

- দুই ব্লকের মাঝে **ঠিক একটি ফাঁকা সারি**। একই tool-এর শিরোনাম ও ফলাফলের মাঝে ফাঁকা সারি নেই।
- সর্বোচ্চ কনটেন্ট প্রস্থ = `min(টার্মিনাল কলাম - ২, ১০০)`। ১০০-র বেশি চওড়া টার্মিনালেও লাইন ১০০-তে wrap।
- Wrap হলে **hanging indent** সবসময় প্রথম অক্ষরের নিচে, বুলেটের নিচে নয়।

---

## ৬. Live Region (জোন C): চলমান অবস্থা

### ৬.১ Spinner লাইন

```text
  ⠹ Working…  (<elapsed>s · esc to interrupt)
```

অনুমোদনের অপেক্ষায় থাকলে (সময় **থেমে যায়**, সেকশন ৪.৪ আচরণ ডকুমেন্ট):

```text
  … Waiting for your approval  (timer paused)
```

কাজ শেষ হলে spinner লাইন **মুছে যায়**, ইতিহাসে কিছু রেখে যায় না।

### ৬.২ Queued বার্তা (agent চলাকালে লেখা)

```text
  ⠹ Working…  (<elapsed>s · esc to interrupt)

  Queued (<n>)
    > <first queued message, truncated with …>
    > <second queued message>
                                    up to edit · ctrl+x tray · esc clear queue
```

### ৬.৩ Spinner অ্যানিমেশন

| বিষয় | মান |
|---|---|
| ফ্রেম | ১০টি braille ফ্রেম, ক্রমানুসারে |
| ফ্রেম বিরতি | ৮০ ms |
| Elapsed কাউন্টার | প্রতি ১ সেকেন্ডে আপডেট |
| Reduced-motion বা ASCII মোড | স্থির `...` (spinner ঘুরবে না) |
| সক্রিয় সময় | শুধু `working` অবস্থার সময় গোনা হয় |

---

## ৭. Tool Card-এর অবস্থাভিত্তিক লেআউট

প্রতিটি tool call একটি **আট-অবস্থার** কার্ড। নিচে Shell tool-এর উদাহরণ; অন্য টুলে একই কাঠামো।

### ৭.১ অনুমোদনের অপেক্ষা

```text
● Bash(<command>)
  ⎿  … Waiting for approval
```

### ৭.২ চলমান (শেষ ৩ লাইন live আউটপুট)

```text
● Bash(<command>)
  ⎿  ⠹ Running…  (<n>s · ctrl+o to expand)
     <live output line, dim>
     <live output line, dim>
     <live output line, dim>
```

### ৭.৩ সফল, সংকুচিত (ডিফল্ট)

```text
● Bash(<command>)
  ⎿  ✓ Done (exit 0) · <n> lines  (ctrl+o to expand)
```

### ৭.৪ সফল, সম্প্রসারিত (head + tail)

```text
● Bash(<command>)
  ⎿  ✓ Done (exit 0) · <n> lines
     <first line 1>
     <first line 2>
     <first line 3>
     … +<n> lines hidden (ctrl+o to show all)
     <last line 1>
     <last line 2>
     <last line 3>
```

Ctrl+O আবার চাপলে সম্পূর্ণ আউটপুট (সংকোচন ছাড়া)। বড় আউটপুটে সম্পূর্ণ ফলাফল সেশনে সংরক্ষিত; মডেল শুধু preview পায়।

### ৭.৫ ব্যর্থ

```text
● Bash(<command>)
  ⎿  ✗ Failed (exit <code>)
     <last error lines, error color>
```

### ৭.৬ অনুমোদন প্রত্যাখ্যাত

```text
● Bash(<command>)
  ⎿  ✗ Denied by user
     <optional: user note given in drill-in>
```

### ৭.৭ Interrupt (ব্যবহারকারী থামিয়েছে)

```text
● Bash(<command>)
  ⎿  ✗ Interrupted
```

### ৭.৮ টুল টাইপ অনুযায়ী শিরোনাম ও সারাংশ

| টুল | শিরোনাম ফরম্যাট | সফল সারাংশ |
|---|---|---|
| Shell | `Bash(<command>)` | `Done (exit <code>) · <n> lines` |
| ফাইল পড়া | `Read(<path>)` | `Read <n> lines` |
| ফাইল লেখা (নতুন) | `Write(<path>)` | `Wrote <n> lines` |
| ফাইল এডিট | `Update(<path>)` | `<a> additions and <r> removals` + diff |
| Grep | `Search(pattern: "<p>", path: "<d>")` | `Found <n> matches` |
| Glob | `Find(<pattern>)` | `Found <n> files` |
| MCP | `<server>:<tool>(<k>: <v>, ...)` | সার্ভারের ফলাফল সারাংশ |
| Sub-agent | `Agent(<name>)  "<prompt preview>"` | `<n> tool calls · <t>s` |
| Web fetch / search | `Fetch(<url>)` / `WebSearch("<q>")` | `Received <size>` / `<n> results` |
| Code intelligence | `Code(<op>: <symbol>)` | `Found <n> references` |

### ৭.৯ MCP কার্ড (সব parameter দৃশ্যমান, progress bar সহ)

```text
● <server>:<tool>(<param-1>: <value-1>, <param-2>: <value-2>)
  ⎿  ⠹ [██████░░░░░░░░░░] <pct>%  <step> of <total>  (<n>s)
```

- Parameter তালিকা expand না করেই দেখা যাবে। লাইন দীর্ঘ হলে প্রতি parameter **নতুন লাইনে**, `(` এর নিচে সারিবদ্ধ।
- Progress bar ১৬ ঘর চওড়া, বাস্তব অগ্রগতি থেকে। অগ্রগতি অজানা হলে bar নয়, শুধু spinner।

### ৭.১০ Sub-agent কার্ড

```text
● Agent(<name>)  "<one-line prompt preview…>"
  ⎿  ⠹ <n> tool calls · <t>s  (ctrl+o to expand)
```

---

## ৮. Diff ভিউ

ফাইল এডিটের ফলাফল ও approval-এ একই diff কম্পোনেন্ট।

```text
● Update(<path/to/file>)
  ⎿  Updated <path/to/file> with <a> additions and <r> removals
       <ln>   <unchanged context line>
       <ln>  -<removed line>
       <ln>  +<added line>
       <ln>   <unchanged context line>
       ···
       <ln>   <unchanged context line>
       <ln>  -<removed line>
       <ln>  +<added line>
```

| উপাদান | নিয়ম |
|---|---|
| লাইন নম্বর | বাম, ডানে-সারিবদ্ধ, সর্বোচ্চ লাইন নম্বরের প্রস্থ অনুযায়ী ফিক্সড কলাম |
| `-` লাইন | `diff.removed` রঙ (লাল ব্যাকগ্রাউন্ডের হালকা রূপ) |
| `+` লাইন | `diff.added` রঙ (সবুজ ব্যাকগ্রাউন্ডের হালকা রূপ) |
| Context | প্রতি hunk-এ উপরে ও নিচে ৩ লাইন, dim |
| Hunk বিচ্ছেদ | `···` লাইন |
| Intra-line বদল | বদলানো শব্দ আলাদা উজ্জ্বলতায় (SHOULD) |
| রঙহীন (`NO_COLOR`) | `-` ও `+` চিহ্নই একমাত্র পার্থক্য, তাই চিহ্ন **বাধ্যতামূলক** |
| দীর্ঘ diff | সংকুচিত ডিফল্টে; `ctrl+o` পূর্ণ diff |
| Wrap | diff-এ লাইন wrap নয়, বিচ্ছিন্ন (truncate) করে শেষে `…`, সম্প্রসারিত ভিউতে পাশে স্ক্রল না, wrap চালু |

---

## ৯. Approval Bar ও Permission Dialog (জোন D)

### ৯.১ ফাইল এডিটের অনুমতি

```text
╭─ Edit file ──────────────────────────────────────────────────────────────╮
│ <path/to/file>                                                           │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   <ln>   <context line>                                                  │
│   <ln>  -<removed line>                                                  │
│   <ln>  +<added line>                                                    │
│   <ln>   <context line>                                                  │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Apply this change?                                                       │
│                                                                          │
│  ▸ 1. Yes                                                                │
│    2. Yes, and allow edits in <dir> for this session                     │
│    3. No, and tell the agent what to do differently                      │
╰─ enter select · tab add note · esc cancel ───────────────────────────────╯
```

### ৯.২ Shell কমান্ডের অনুমতি (তিন স্তরের trust)

```text
╭─ Run command ────────────────────────────────────────────────────────────╮
│   <command>                                                              │
│   <one-line description of what it does>                                 │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Allow this command?                                                      │
│                                                                          │
│  ▸ 1. Yes, once                                                          │
│    2. Yes, and trust exactly: <command>                                  │
│    3. Yes, and trust prefix:  <command-prefix> *                         │
│    4. Yes, and trust base:    <base-command> *                           │
│    5. No, and tell the agent what to do differently                      │
╰─ enter select · tab add note · esc cancel ───────────────────────────────╯
```

- **সবচেয়ে সংকীর্ণ স্তর** (এখানে ২) পূর্বনির্বাচিত থাকে না; ডিফল্ট ফোকাস `1. Yes, once`-এ।
- সংখ্যা চাপলে সরাসরি সেই অপশন বাছা হয়। `Tab` চাপলে একটি নোট ফিল্ড খোলে (feedback)।

### ৯.৩ Queue (একাধিক অনুমোদন)

```text
╭─ Run command  (1 of <n> pending) ────────────────────────────────────────╮
│   <command>                                                              │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Allow this command?                                                      │
│  ▸ 1. Yes, once                                                          │
│    2. No, and tell the agent what to do differently                      │
╰─ enter select · tab add note · esc cancel ───────────────────────────────╯
```

শিরোনামে `(1 of <n> pending)`। একটির উত্তর দিলে পরেরটি একই জায়গায় আসে।

### ৯.৪ Approval চলাকালে বাকি স্ক্রিন

- ইনপুট বক্স **লুকানো** (dialog তার জায়গা নেয়), footer-এ শুধু dialog-এর hint।
- Busy কাউন্টার **থেমে** থাকে এবং `… Waiting for your approval` দেখায়।
- Dialog উত্তর পেলে মুছে যায়; ফলাফল tool card-এ (`✓` বা `✗ Denied`) ইতিহাসে লেখা হয়।

### ৯.৫ সব-অনুমতি মোডের নিশ্চিতকরণ

```text
╭─ Trust all tools ────────────────────────────────────────────────────────╮
│ This lets the agent run every tool without asking, for this session.     │
│ Commands can modify or delete files and run arbitrary programs.          │
│                                                                          │
│  ▸ 1. No, keep asking                                                    │
│    2. Yes, I understand the risk                                         │
╰─ enter select · esc cancel ──────────────────────────────────────────────╯
```

ডিফল্ট ফোকাস নিরাপদ অপশনে (`No`)। চালু থাকলে footer-এর mode অংশে স্থায়ী নির্দেশক (`trust-all`), সতর্ক রঙে।

---

## ১০. Autocomplete Popup

Popup ইনপুট বক্সের **ঠিক উপরে** খোলে, নিচের দিকে নয়। সর্বোচ্চ ৮ সারি দৃশ্যমান, বাকিতে স্ক্রল।

### ১০.১ Slash কমান্ড

```text
╭─ Commands ───────────────────────────────────────────────╮
│ ▸ /help       list all commands                          │
│   /context    context window and token share             │
│   /model      change model, effort, fallback             │
│   /chat       resume a previous session                  │
│   /compact    summarize to free context                  │
│   /clear      clear conversation history                 │
│                                    <n> more   ↓          │
╰──────────────────────────────────────────────────────────╯
```
```text
╭──────────────────────────────────────────────────────────────────────────╮
│ > /co                                                                    │
╰──────────────────────────────────────────────────────────────────────────╯
```

- টাইপ করা অংশ (`/co`) মিলে যাওয়া অক্ষর **উজ্জ্বল**, বাকিটা সাধারণ।
- বাম কলামে কমান্ড, ডানে dim বিবরণ। কলাম প্রস্থ নির্ধারণ হয় সবচেয়ে লম্বা দৃশ্যমান কমান্ড অনুযায়ী।
- `Tab` বা `Enter` নির্বাচিত কমান্ড বসায়; `Esc` popup বন্ধ করে ইনপুট রাখে।
- Fuzzy মিল: অক্ষর ক্রমানুসারে থাকলেই মিলবে, পরপর না হলেও।

### ১০.২ `@` ফাইল রেফারেন্স

```text
╭─ Files ──────────────────────────────────────────────────╮
│ ▸ <dir>/<file-1>                                         │
│   <dir>/<file-2>                                         │
│   <dir>/<subdir>/                                        │
│   <file-3>                                               │
│                                    <n> more   ↓          │
╰──────────────────────────────────────────────────────────╯
```
```text
╭──────────────────────────────────────────────────────────────────────────╮
│ > Explain @<partial-pa                                                   │
╰──────────────────────────────────────────────────────────────────────────╯
```

- ডিরেক্টরি শেষে `/`; নির্বাচনে ভেতরে ঢোকা যায়।
- দীর্ঘ পাথর মাঝখানে সংকুচিত: `<dir>/…/<file>`।
- `.gitignore` মেনে লুকানো ফাইল ডিফল্টে বাদ (SHOULD)।

---

## ১১. Overlay Panel

Panel কথোপকথনের **উপরে overlay** হিসেবে আসে এবং বন্ধ হলে আগের স্ক্রিন **হুবহু ফিরে** আসে। সব panel-এ: উপরে search ফিল্ড, মাঝে তালিকা, নিচে hint।

### ১১.১ `/help`

```text
╭─ Help ───────────────────────────────────────────────────────────────────╮
│ Search: <typed text>_                                                    │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ ▸ /help        list all commands                                         │
│   /context     context window and token share                            │
│   /usage       limits and credit balance                                 │
│   /model       change model, effort, fallback                            │
│   /agent       switch agent                                              │
│   /tools       available tools and trust state                           │
│   /mcp         servers and registry status                               │
│   ...                                                    <n> more  ↓     │
╰─ type to filter · up/down move · enter run · esc close ──────────────────╯
```

### ১১.২ `/context` (token bar সহ)

```text
╭─ Context ────────────────────────────────────────────────────────────────╮
│ Window  [██████████░░░░░░░░░░░░░░░░░░░░]  <pct>%  <used> / <limit> tok   │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   Source                                       Tokens       Share        │
│   System prompt                                <tok>        <pct>%       │
│   Tools and MCP definitions                    <tok>        <pct>%       │
│   Memory and instruction files                 <tok>        <pct>%       │
│   Conversation                                 <tok>        <pct>%       │
│   Attached files                               <tok>        <pct>%       │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   <file-path>                                  <tok>        <pct>%       │
│   <file-path>                                  <tok>        <pct>%       │
╰─ a add · r remove · c clear · esc close ─────────────────────────────────╯
```

- Bar ৩০ ঘর; ভরা অংশ `█`, খালি `░`। **ঘরের সংখ্যা বাস্তব শতাংশ থেকে হিসাব**, উদাহরণের ভরাট শুধু চিত্র।
- ৭০% পার হলে bar `status.warning` রঙে, ৯০% পার হলে `status.error` রঙে এবং footer-এও সতর্কতা (`compact soon`)।

### ১১.৩ `/model` (effort ও fallback সারি সহ)

```text
╭─ Model ──────────────────────────────────────────────────────────────────╮
│ ▸ <model-1>                                              current         │
│   <model-2>                                                              │
│   <model-3>                                                              │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   Effort      ‹ <low>  <medium>  <high> ›                                │
│   Fallback    <fallback-model-or-auto>                                   │
│   Thinking    <on|off>                                                   │
╰─ up/down move · left/right adjust · enter apply · esc close ─────────────╯
```

- `‹ ›` সহ সারি **বাম-ডান কী** দিয়ে বদলায়। নির্বাচিত মান উজ্জ্বল।
- অনুপলব্ধ মডেল তালিকায় dim ও `(unavailable)` চিহ্ন; নির্বাচন করা গেলেও সতর্কতা দেখায় (আচরণ নিয়ম আগের ডকুমেন্টে)।

### ১১.৪ `/usage`

```text
╭─ Usage ──────────────────────────────────────────────────────────────────╮
│ Plan limit    [████████░░░░░░░░░░░░░░░░░░░░░░]  <pct>%   resets <when>   │
│ This session  <credits> credits                                          │
│ Balance       <credits> credits                                          │
╰─ esc close ──────────────────────────────────────────────────────────────╯
```

### ১১.৫ Panel-এর সাধারণ নিয়ম

| নিয়ম | মান |
|---|---|
| উচ্চতা | সর্বোচ্চ `টার্মিনাল সারি - ৪`; বেশি হলে ভেতরে স্ক্রল ও `▲ ▼` |
| প্রস্থ | `min(টার্মিনাল কলাম, ৭৬)`; ছোট টার্মিনালে পূর্ণ প্রস্থ |
| Esc | বন্ধ; search টেক্সট থাকলে প্রথম Esc টেক্সট মোছে, দ্বিতীয় Esc বন্ধ করে |
| ফোকাস | খোলার সময় search ফিল্ডে, তালিকা `up/down` দিয়ে |
| ফাঁকা ফলাফল | `No matches for "<text>"`, তালিকা ফাঁকা রাখা যাবে না |

---

## ১২. Session Picker (`/chat`)

```text
╭─ Sessions  (<short-cwd>) ────────────────────────────────────────────────╮
│ Search: <typed text>_                                                    │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ ▸ <session-title-or-first-prompt>                     <relative-time>    │
│   <session-title-or-first-prompt>                     <relative-time>    │
│   <session-title-or-first-prompt>                     <relative-time>    │
│                                                              <n> more  ↓ │
╰─ type to filter · enter resume · esc close ──────────────────────────────╯
```

- শুধু **বর্তমান working directory-র** সেশন।
- Timestamp আপেক্ষিক (`2h ago`, `yesterday`); ডানে সারিবদ্ধ।
- শিরোনাম ৪০ কলামে সংকুচিত, শেষে `…`।

---

## ১৩. Activity Tray (`ctrl+x`)

```text
╭─ Activity ───────────────────────────────────────────────────────────────╮
│ Tasks                                                                    │
│   ☒ <completed task>                                                     │
│   ▸ ⠹ <in-progress task>                                                 │
│   ☐ <pending task>                                                       │
│   ☐ <pending task>                                                       │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Queued messages (<n>)                                                    │
│   > <queued message, truncated…>                                         │
╰─ ctrl+x close · up/down move · esc close ────────────────────────────────╯
```

- Task তালিকা agent-এর **আসল task state** থেকে আসে, নকল নয়।
- বর্তমান কাজে spinner ও `▸`। সম্পন্ন কাজ dim।
- Tray খোলা থাকলে স্ক্রিনের নিচের জোন C-তে বসে, কথোপকথন সরিয়ে দেয় না।

---

## ১৪. Crew Monitor (`ctrl+g`): দুই-প্যান

```text
╭─ Crew monitor ───────────────┬───────────────────────────────────────────╮
│ Agents                       │ Activity: <selected-agent>                │
├──────────────────────────────┼───────────────────────────────────────────┤
│ ▸ <agent-1>   ⠹              │ ● <tool-name>(<args>)                     │
│   <agent-2>   ✓              │   ⎿  <result summary>                     │
│   <agent-3>   …              │ ● <tool-name>(<args>)                     │
│                              │   ⎿  ⠹ Running…                           │
│                              │                                           │
│                              │ <agent text output, wrapped>              │
╰─ ctrl+d/u switch · q close ──┴───────────────────────────────────────────╯
```

- বাম প্যান: agent তালিকা, প্রতিটির অবস্থা চিহ্ন (`⠹` চলছে, `✓` শেষ, `…` অপেক্ষা, `✗` ব্যর্থ)।
- ডান প্যান: নির্বাচিত agent-এর কার্যকলাপ, **মূল কথোপকথনের একই tool card ফরম্যাটে**।
- **৬০ কলামের কম** টার্মিনালে দুই-প্যান নয়: তালিকা ভিউ, `enter` দিয়ে বিস্তারিত ভিউ, `esc` দিয়ে ফেরা।

---

## ১৫. Workflow Monitor

```text
╭─ Workflow <name>  ·  run <run-id>  ·  <status> ──────────────────────────╮
│ Steps                                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│   ✓ 1  <step-name>                  <cr> cr                              │
│   ✓ 2  <step-name>                  <cr> cr                              │
│ ▸ ⠹ 3  <step-name>                  <cr> cr                              │
│   … 4  <step-name>                                                       │
│   ☐ 5  <step-name>                                                       │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Output: step 3                                                           │
│   <live output line>                                                     │
│   <live output line>                                                     │
╰─ p pause · r resume · s reply · ctrl+x stop · esc back ──────────────────╯
```

### Stop-এর দ্বি-ধাপ নিশ্চিতকরণ (footer অবস্থা)

```text
  Press ctrl+x again to stop this run · esc to keep running
```

- প্রথম `ctrl+x` চাপলে footer-এ উপরের লাইন আসে (stop "armed")। ৫ সেকেন্ডে কিছু না চাপলে আপনা-আপনি disarm।
- `p`, `r`, `s` শুধু তখনই hint-এ দেখায় যখন সেই ক্রিয়া সেই অবস্থায় প্রযোজ্য।

---

## ১৬. Document / Spec Review Screen

```text
╭─ Review: <document-name>   section <n> of <total> ───────────────────────╮
│  <ln> │ ## <Section heading>                                             │
│  <ln> │                                                                  │
│  <ln> │ <paragraph text line>                                            │
│  <ln> │ <paragraph text line>                                            │
│  <ln> │▌ comment: "<staged comment text>"                                │
│  <ln> │                                                                  │
│  <ln> │ ## <Next heading>                                                │
│  <ln> │ <paragraph text line>                                            │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Comments staged: <n>                                                     │
╰─ j/k move · n/N section · ]/[ comment · enter comment · ? help · q back ─╯
```

- **বাম গাটার:** লাইন নম্বর (ডানে-সারিবদ্ধ, ফিক্সড প্রস্থ) তারপর `│`।
- Staged comment: লাইনের নিচে `▌` চিহ্নসহ ইনলাইন, `status.waiting` রঙে।
- শেষে সব comment **একটি অনুরোধে** agent-এর কাছে যায়।
- `?` চাপলে এই স্ক্রিনের সব কী-বাইন্ডিং overlay হিসেবে আসে।

---

## ১৭. Diagram রেন্ডারিং (code block-এর ভেতরে)

### ১৭.১ Flowchart (subgraph ফ্রেমসহ)

```text
╭─ Subgraph: <title> ────────────────────────────╮
│                                                │
│  ┌────────┐     ┌────────┐     ╭────────╮      │
│  │ node A │ ──▶ │ node B │ ──▶ │ node C │      │
│  └────────┘     └────────┘     ╰────────╯      │
│                                                │
╰────────────────────────────────────────────────╯
```

### ১৭.২ Node আকৃতির ভাষা

| Mermaid আকৃতি | টার্মিনাল রূপ |
|---|---|
| Rectangle | `┌──┐ │  │ └──┘` |
| Rounded / Stadium | `╭──╮ │  │ ╰──╯` |
| Decision | `◇ label ◇` (সরু টার্মিনালে `< label >`) |
| Double border | `╔══╗ ║  ║ ╚══╝` |
| Subgraph | শিরোনামসহ বড় রাউন্ডেড ফ্রেম; nested হলে nested ফ্রেম ও group marker |

### ১৭.৩ Sequence diagram

```text
   <Actor A>              <Actor B>              <Actor C>
       │                      │                      │
       │ ── <message> ──────▶ │                      │
       │                      │ ── <message> ──────▶ │
       │ ◀──── <reply> ────── │                      │
       │                      │ ◀──── <reply> ────── │
```

### ১৭.৪ রেন্ডারের সময়ের অবস্থা

```text
  ⠹ Drawing diagram…
```

ব্লক stream চলাকালে এই লাইন দেখায়। শেষে ডায়াগ্রাম বা source (কারণসহ):

````text
  i Showing source: diagram is wider than the terminal (<w> > <cols> columns)
  ```mermaid
  <source>
  ```
````

- Node-এর border রঙ node class থেকে (theme token), উৎসের `style` উপেক্ষা।
- Label সর্বোচ্চ ৪ সারি; বেশি হলে `…`।

---

## ১৮. Notice, ত্রুটি ও Fallback বার্তা

Notice **কথোপকথনের স্থায়ী অংশ** (ইতিহাসে থাকে), toast নয়। বাম গাটারে একটি চিহ্ন, বাকি লাইনে ইন্ডেন্ট।

### ১৮.১ Model fallback

```text
  ! <model-a> declined this turn. Retried with <model-b>.
    Answered by: <model-b>   Conversation model: <unchanged|model-b>
    /model fallback to configure
```

### ১৮.২ কোনো মডেলই উত্তর দেয়নি

```text
  x No model could answer this turn.
    Tried: <model-a> (<reason>), <model-b> (<reason>)
    Use /model to choose another model.
```

### ১৮.৩ সেশন শুরুর availability

```text
  ! Saved default <model-a> is unavailable. Using <model-b> for this session.
    Your saved setting is unchanged. /model to change.
```

### ১৮.৪ Interrupted turn

```text
  ✗ Interrupted by user
```

### ১৮.৫ Notice-এর স্টাইল

| ধরন | চিহ্ন | রঙ token | Bold |
|---|---|---|---|
| info | `i` | `text.muted` | না |
| warn | `!` | `status.waiting`/warning | প্রথম লাইন |
| error | `x` | `status.error` | প্রথম লাইন |

---

## ১৯. Responsive: টার্মিনাল প্রস্থ অনুযায়ী লেআউট

| প্রস্থ (কলাম) | Banner | Footer | Panel | Tool কার্ড | Monitor |
|---|---|---|---|---|---|
| **১০০ বা বেশি** | পূর্ণ | পূর্ণ hint + status | ৭৬ চওড়া | পূর্ণ আর্গুমেন্ট | দুই-প্যান |
| **৬০ থেকে ৯৯** | পূর্ণ | hint + status | পূর্ণ প্রস্থ | আর্গুমেন্ট ২ লাইনে wrap | দুই-প্যান |
| **৫০ থেকে ৫৯** | সংক্ষিপ্ত | শুধু status (hint লুকানো, `?` দিয়ে দেখা) | পূর্ণ প্রস্থ | পাথ মাঝখানে সংকুচিত | তালিকা, তারপর বিস্তারিত |
| **৫০ এর কম** | ১ সারি | শুধু `<mode> ctx <pct>%` | পূর্ণ প্রস্থ | পাথ সংকুচিত, আর্গুমেন্ট ছাঁটা | তালিকা, তারপর বিস্তারিত |

### ১৯.১ সরু টার্মিনালে নমুনা (৪৪ কলাম)

```text
╭──────────────────────────────────────────╮
│ > Ask anything                           │
╰──────────────────────────────────────────╯
```
```text
  <mode> | <short-model> | ctx <pct>%
```

```text
● Update(<…>/<parent>/<file>)
  ⎿  <a> additions, <r> removals
```

### ১৯.২ আকার বদলের নিয়ম

- Resize ঘটলে live region মুছে **নতুন প্রস্থে সম্পূর্ণ পুনরায়** আঁকতে হবে।
- ইতিহাসে ইতিমধ্যে লেখা লাইন বদলায় না (inline মোডে); fullscreen মোডে পুনরায় wrap হয়।
- Resize চলাকালে flicker এড়াতে ১০০ ms debounce।
- **Wide character** (CJK, emoji-সদৃশ) প্রস্থ ২ কলাম ধরে হিসাব করতে হবে (wcwidth নীতি)।

---

## ২০. Fullscreen মোডের লেআউট

```text
╭─ fullscreen · <session-title> ───────────────────────────────────────────╮
│ <conversation viewport, scrolls with mouse or pgup/pgdn>              ▲  │
│                                                                       ┃  │
│   ● <assistant message>                                               ┃  │
│   ● <tool card>                                                       │  │
│                                                                       ▼  │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ > <input>                                                                │
│ <hint left>                              <mode> | <model> | ctx <pct>%   │
╰──────────────────────────────────────────────────────────────────────────╯
```

- Viewport-এর ডান প্রান্তে স্ক্রলবার (`┃` ভরাট, `│` ফাঁকা)।
- ব্যবহারকারী উপরে স্ক্রল করা অবস্থায় নতুন আউটপুট এলে নিচে একটি নির্দেশক:

```text
                                         ▼ <n> new lines  (end to jump)
```

- ইনপুট ও footer স্থির; viewport বদলালে এগুলো নড়ে না।

---

## ২১. Footer (জোন F): কনটেন্ট নিয়ম

### ২১.১ ডান পাশ (status), বাম থেকে ডানে অগ্রাধিকার

1. Permission mode (`default`, `plan`, `trust-all`, ...)
2. Model সংক্ষিপ্ত নাম
3. Context শতাংশ

প্রস্থ কম পড়লে **বাম থেকে বাদ** যায়: আগে model, তারপর mode; context শতাংশ **সবশেষে** বাদ।

### ২১.২ বাম পাশ (hint) প্রসঙ্গভিত্তিক

| অবস্থা | Footer hint |
|---|---|
| Idle, ইনপুট খালি | `? for shortcuts` |
| টাইপ করছে | `shift+enter newline · esc clear` |
| Agent চলছে | `esc to interrupt · ctrl+o expand · ctrl+x tray` |
| অনুমোদনের অপেক্ষা | `enter select · tab add note · esc cancel` |
| Autocomplete খোলা | `up/down move · tab complete · esc close` |
| Shell mode | `shell mode · enter run · esc exit shell mode` |
| Plan mode | `plan mode · shift+tab to leave` |
| Stop armed (workflow) | `press ctrl+x again to stop · esc to keep running` |
| Ctrl+C একবার চাপা | `press ctrl+c again to exit` |
| Ctrl+Z একবার চাপা | `press ctrl+z again to suspend` |

---

## ২২. রঙের ভূমিকা: কোন উপাদানে কোন token

| উপাদান | Token | স্টাইল |
|---|---|---|
| User বার্তা `>` ও টেক্সট | `prompt.accent` | সাধারণ |
| Assistant বুলেট `●` | `response.accent` | সাধারণ |
| Assistant টেক্সট | `text.primary` | সাধারণ |
| Tool শিরোনাম | `text.primary` | বুলেট tool-অবস্থার রঙ (চলমান: accent, সফল: success, ব্যর্থ: error) |
| `⎿` ও ফলাফল সারাংশ | `text.muted` | dim |
| Live আউটপুট লাইন | `text.muted` | dim |
| Thinking | `text.muted` | italic (সমর্থিত হলে), dim |
| Input বক্স বর্ডার | `border.default` / `border.focus` | |
| Footer hint | `text.muted` | dim |
| Footer status | `text.muted` | mode অংশ অবস্থা-রঙে |
| Diff `+` / `-` | `diff.added` / `diff.removed` | |
| Notice warn / error | `status.waiting` / `status.error` | প্রথম লাইন bold |
| নির্বাচিত সারি `▸` | `border.focus` | সারি bold |
| Context bar | `status.running` / `warning` / `error` | শতাংশ অনুযায়ী |

**নিয়ম:** `NO_COLOR` সেট থাকলেও লেআউট বোধগম্য থাকতে হবে। অর্থ রঙে নয়, **চিহ্নে ও আকৃতিতে** (`✓ ✗`, `+ -`, `▸`) বহন করবে। শুধু dim/bold বজায় থাকতে পারে (SHOULD), যদি টার্মিনাল সমর্থন করে।

---

## ২৩. অ্যানিমেশন ও সময়ের স্পেক

| বিষয় | মান |
|---|---|
| Spinner ফ্রেম | ৮০ ms |
| Elapsed কাউন্টার | ১ s |
| Stream render | ব্যাচ করে সর্বোচ্চ ~৬০ বার/সেকেন্ড (১৬ ms), প্রতি ব্যাচে একটি synchronized-output ফ্রেম |
| Resize debounce | ১০০ ms |
| Stop "armed" স্বয়ংক্রিয় disarm | ৫ s |
| Ctrl+C / Ctrl+Z দ্বিতীয় চাপের সময়সীমা | ২ s |
| Notice | স্থায়ী, স্বয়ংক্রিয় মুছে যায় না |
| Reduced motion | spinner স্থির `...`, কোনো shimmer নয় |

---

## ২৪. রেন্ডার পাইপলাইন (বাস্তবায়নের চুক্তি)

1. **State** (core থেকে event) -> 2. **Layout** (প্রতিটি জোনের উচ্চতা মাপা, টার্মিনাল প্রস্থ জেনে) -> 3. **Line buffer** (প্রতিটি জোন স্টাইলসহ লাইনের তালিকা) -> 4. **Diff** (আগের ফ্রেমের সাথে তুলনা, শুধু বদলানো লাইন) -> 5. **Write** (synchronized output ব্লকে এক লেখায়)।

| নিয়ম | বিবরণ |
|---|---|
| একমুখী প্রবাহ | কম্পোনেন্ট সরাসরি stdout-এ লিখবে না; শুধু line buffer ফেরত দেবে |
| প্রতিটি কম্পোনেন্ট | `measure(width) -> height` ও `render(width) -> lines` এই দুই ফাংশন |
| Truncate নিরাপদ | কোনো লাইন কখনো টার্মিনাল প্রস্থ ছাড়াবে না (wrap বা `…`) |
| ANSI-সচেতন প্রস্থ | প্রস্থ হিসাবে escape sequence বাদ দিতে হবে |
| Live region উচ্চতা | বদলালে পুরনো অংশ মুছে নতুন করে; ইতিহাসে ছিটকে পড়া নয় |
| Cursor | রেন্ডার শেষে cursor ইনপুট বক্সের সঠিক অবস্থানে, IME-র জন্য |

---

## ২৫. Acceptance Checklist (ভিজ্যুয়াল)

- [ ] ছয়টি জোন (A-F) সবসময় একই ক্রমে; live region ইতিহাসে ছিটকে পড়ে না।
- [ ] সব চিহ্ন একটি `glyphs` মডিউল থেকে; ASCII মোডে পুরো UI ঠিক থাকে।
- [ ] ইনপুট বক্স উপরের দিকে বাড়ে, নিচের প্রান্ত স্থির; সর্বোচ্চ ১০ সারি।
- [ ] Tool কার্ডের আটটি অবস্থার প্রতিটির নির্দিষ্ট রূপ আছে।
- [ ] MCP কার্ডে সব parameter দৃশ্যমান; sub-agent কার্ডে এক লাইনের prompt preview।
- [ ] Diff-এ `+`/`-` চিহ্ন আছে (রঙ ছাড়াও বোঝা যায়)।
- [ ] Approval dialog ইনপুটের জায়গা নেয়; একাধিক অনুমোদন `(1 of <n> pending)` দিয়ে queue হয়।
- [ ] Popup ইনপুটের **উপরে** খোলে, সর্বোচ্চ ৮ সারি, নির্বাচিত সারিতে `▸`।
- [ ] Panel-এ search, scroll, Esc; বন্ধ হলে আগের স্ক্রিন হুবহু ফেরে।
- [ ] Footer-এর hint প্রসঙ্গ অনুযায়ী বদলায় (সেকশন ২১.২)।
- [ ] ৪৪, ৬০, ৮০, ১২০ কলামে লেআউট ভাঙে না; resize-এ live region পুনরায় আঁকা হয়।
- [ ] `NO_COLOR` ও safe থিমে অর্থ চিহ্ন দিয়ে বোঝা যায়।
- [ ] কোনো কম্পোনেন্ট hardcoded রঙ, hardcoded মডেল নাম বা নকল সংখ্যা ব্যবহার করে না।
- [ ] কোড ও UI-তে কোনো emoji নেই।

---

## ২৬. যা এখনো বাকি

- **Antigravity CLI মিলিয়ে নেওয়া:** স্ক্রিনশট বা বর্ণনা দিলে এই ফাইলের লেআউট সেটির সাথে তুলনা করে সংশোধন করব।
- **পিক্সেল-স্তরের রঙের মান:** token-এর নাম আছে, hex বা ANSI সূচক নেই। আপনার ব্র্যান্ড বা পছন্দের প্যালেট জানালে dark/light/safe-এর পূর্ণ মান বসিয়ে দেব।
- **ভাষা ও লাইব্রেরি অনুযায়ী বাস্তবায়ন:** কোন ভাষায় (যেমন Node, Rust, Go, Python) বানাচ্ছেন জানালে সেকশন ২৪-এর চুক্তি সেই ভাষার কম্পোনেন্ট কাঠামোয় নামিয়ে দেব।
