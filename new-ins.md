# AI Agent Harness: Terminal UI/UX ইন্সট্রাকশন

তথ্যবিবরণ
- **ডকুমেন্টের উদ্দেশ্য**: AI agent harness-এর interactive terminal ইন্টারফেস ডিজাইন ও ইমপ্লিমেন্ট করার নির্দেশনা
- **ভিত্তি**: Kiro CLI Terminal UI ডকুমেন্টেশনের বিশ্লেষণ (https://kiro.dev/docs/cli/terminal-ui/, আপডেট: November 6, 2026)
- **তৈরির তারিখ**: November 10, 2026
- **ভাষা-নিরপেক্ষতা**: কোনো নির্দিষ্ট ভাষা বা TUI লাইব্রেরির ওপর নির্ভর করে না 

## ব্যবহারের নিয়ম (এই ডকুমেন্ট কীভাবে পড়বেন)

MUST = বাধ্যতামূলক। SHOULD = দৃঢ়ভাবে প্রস্তাবিত। MAY = ঐচ্ছিক।

প্রতিটি সেকশনের শেষে Acceptance Criteria আছে। এগুলো পূরণ না হলে ফিচার "সম্পন্ন" গণ্য হবে না।

Kiro-র ডকুমেন্টেশন থেকে নেওয়া আচরণ এখানে আদর্শ হিসেবে ব্যবহার করা হয়েছে। কমান্ডের নাম, env চলকের নাম ও কী-বাইন্ডিং আপনার প্রজেক্টে নিজের মতো বদলানো যাবে, তবে আচরণ ও নীতি একই রাখুন।

Kiro-র ভিডিও ও ছবির ভিজ্যুয়াল (রঙ, spacing, বাস্তব লেআউট) বিশ্লেষণ করা যায়নি। তাই ভিজ্যুয়াল নির্দেশনা এখানে কাঠামোগত ও আচরণগত, পিক্সেল-স্তরের নয়।

---

## ১. মূল ডিজাইন দর্শন

প্রতিটি সিদ্ধান্তে নিচের নীতিগুলো মানতে হবে:

| # | নীতি | অর্থ |
|---|---|---|
| P1 | Progressive disclosure | আগে সংক্ষিপ্ত summary, চাইলে বিস্তারিত। কখনো সব তথ্য একসাথে ঢেলে দেবেন না |
| P2 | Non-blocking interaction | agent কাজ করার সময়ও ব্যবহারকারী পরের ইনপুট লিখতে পারবে |
| P3 | Honest feedback | যা ঘটছে তার সঠিক অবস্থা দেখাতে হবে। অপেক্ষার সময় আর কাজের সময় আলাদা রাখতে হবে |
| P4 | Graceful degradation | টার্মিনাল কম সক্ষম হলে UI ভাঙবে না, সরল রূপে নেমে আসবে |
| P5 | Accidental action প্রতিরোধ | ধ্বংসাত্মক বা ঝুঁকিপূর্ণ কাজে নিশ্চিতকরণ ধাপ থাকবে |
| P6 | Scoped trust | অনুমতি সবসময় সবচেয়ে সংকীর্ণ পরিসরে দেওয়ার সুযোগ থাকবে |
| P7 | Transparency | agent কী করছে, কোন মডেল উত্তর দিল, টুলে কোন parameter গেল, সবই দৃশ্যমান হবে |
| P8 | Discoverability + Power-user দক্ষতা | নতুনদের জন্য searchable help ও picker, অভিজ্ঞদের জন্য shortcut ও history search |
| P9 | Environment-aware | টার্মিনালের ক্ষমতা, রঙ প্যালেট ও ব্যবহারকারীর পছন্দ (NO_COLOR) মেনে চলা |
| P10 | Context ও token দক্ষতা | বড় আউটপুট সংরক্ষণ করে মডেলকে শুধু preview দেওয়া |

---

## ২. প্রজেক্টের মডুলার কাঠামো (বাধ্যতামূলক)

কোনো ফাইল monolithic হবে না। প্রতিটি ফিচার, কম্পোনেন্ট, স্টাইল ও লজিক আলাদা ফাইলে থাকবে। প্রস্তাবিত লেআউট (নাম বদলানো যাবে, বিভাজনের নীতি বদলানো যাবে না):

```text
src/
  core/                  # UI-নিরপেক্ষ harness লজিক
    session/             # session তৈরি, resume, scoping, persistence
    agent/               # agent loop, turn lifecycle, event emitter
    models/              # model registry, availability, fallback chain
    tools/               # tool registry, executor, result store
    permissions/         # trust scope, approval queue
    context/             # token হিসাব, compaction
    workflow/            # workflow run, step tree, pause/resume/stop
    settings/            # settings store, precedence resolver
  ui/
    app/                 # root, mode resolver, lifecycle
    capabilities/        # terminal capability detection
    theme/               # theme tokens, detector, loader
    render/
      markdown/          # markdown parser to render nodes
      code/              # syntax highlighting
      diagram/           # diagram parser, layout, painter
      stream/            # incremental stream buffer, sync-output
    components/
      conversation/      # message list, scroll
      thinking/          # thinking block
      tool-card/         # per-tool-type card components
      approval-bar/
      input/             # editor, paste chip, queue
      status/            # busy indicator, program status
      tray/              # activity tray
      panels/            # overlay panel framework + প্রতিটি panel আলাদা ফাইল
      monitors/          # crew monitor, workflow monitor
      review/            # document review screen
    keybindings/         # default map, resolver, user override
    commands/            # slash command registry (প্রতিটি কমান্ড আলাদা ফাইল)
    platform/            # OS ও terminal পার্থক্য (macOS, Linux, Windows)
    config/              # default values, env var নাম, constants
```

### নিয়ম:
- `core/` কখনো `ui/` import করবে না। UI শুধু core-এর event ও state সাবস্ক্রাইব করবে। এতে headless মোড বিনা খরচে পাওয়া যায়।
- প্রতিটি slash command, প্রতিটি panel, প্রতিটি tool card আলাদা ফাইল এবং registry-তে নিবন্ধিত।
- কোনো কম্পোনেন্টে hardcoded রঙ থাকবে না। সব রঙ theme token থেকে আসবে।

### Acceptance Criteria:
- [ ] core/ থেকে ui/-এ কোনো import নেই (লিন্টে যাচাই)।
- [ ] নতুন slash command যোগ করতে শুধু একটি নতুন ফাইল ও একটি registry লাইন লাগে।
- [ ] কোনো একক ফাইল একাধিক ফিচারের দায়িত্ব বহন করে না।

---

## ৩. UI মোড ও Harness নির্বাচন

### ৩.১ UI মোডের অগ্রাধিকার (উচ্চ থেকে নিম্ন)
1. CLI flag
2. Environment variable
3. Settings ফাইলের মান
4. ডিফল্ট মান

Resolver একটি একক ফাংশনে থাকবে, যা চূড়ান্ত মোড ও কোন উৎস থেকে এসেছে তা দুটোই ফেরত দেবে।
অবৈধ মান এলে ডিফল্টে ফিরতে হবে এবং কারণ সহ একটি notice দেখাতে হবে।

### ৩.২ বাতিল (retired) মোডের আচরণ
কোনো পুরনো ইন্টারফেস বাতিল করলে:
- সেটি নির্বাচন করা launch নীরবে ভাঙবে না। ব্যবহারকারীকে "নতুন ইন্টারফেসে চালিয়ে যান" অপশন দিন।
- Headless রানে একটি notice ছাপিয়ে ডিফল্ট headless আচরণ অনুসরণ করুন।
- notice-এ বলতে হবে কোন flag, env বা setting পুরনো মোড নির্বাচন করেছে।

### ৩.৩ Platform সমর্থন
- macOS, Linux ও Windows সমর্থন করতে হবে।
- কোনো harness সংস্করণ নির্দিষ্ট সিস্টেম লাইব্রেরি (যেমন glibc সংস্করণ) দাবি করলে, পূরণ না হলে স্বয়ংক্রিয়ভাবে সরল harness-এ নামতে হবে। ব্যবহারকারী স্পষ্টভাবে নতুন harness চাইলে চুপচাপ ফল না করে থেমে গিয়ে কারণ জানাতে হবে।

### Acceptance Criteria:
- [ ] প্রতিটি মোড সিদ্ধান্তের পেছনের উৎস লগ বা notice-এ দেখা যায়।
- [ ] বাতিল মোড নির্বাচনে crash হয় না।

---

## ৪. চ্যাট রেন্ডারিং

### ৪.১ Streaming
- উত্তর ধাপে ধাপে stream হবে। সম্পূর্ণ উত্তরের জন্য অপেক্ষা করা যাবে না।
- টার্মিনাল synchronized output সমর্থন করলে প্রতিটি ফ্রেম সেই মোডে লিখতে হবে, যাতে flicker না হয়।
- Stream buffer আলাদা মডিউলে থাকবে। অসম্পূর্ণ markdown (খোলা code fence, আধখানা টেবিল) নিরাপদে আংশিক রেন্ডার করতে হবে।

### ৪.২ Markdown সমর্থন (সব বাধ্যতামূলক)
| উপাদান | প্রয়োজনীয়তা |
|---|---|
| Code block | ভাষা অনুযায়ী syntax highlighting |
| Table | কলাম প্রস্থ টার্মিনালের প্রস্থে মানিয়ে নেওয়া |
| List | nested সহ |
| Blockquote | দৃশ্যমান বাম বর্ডার বা indent |
| Nested formatting | bold, italic, inline code একসাথে |
| Link | সমর্থিত টার্মিনালে ক্লিকযোগ্য hyperlink; অন্যথায় URL দৃশ্যমান |

### ৪.৩ Scroll
- Arrow key দিয়ে লাইন ধরে স্ক্রল।
- দীর্ঘ উত্তরে স্ক্রল অবস্থান ধরে রাখতে হবে। নতুন stream আসার সময় ব্যবহারকারী উপরে স্ক্রল করে থাকলে জোর করে নিচে টানা যাবে না।

### ৪.৪ Busy Indicator
- agent কাজ করার সময় সক্রিয় কাজের সময় (active elapsed time) দেখাতে হবে।
- turn যখন ব্যবহারকারীর অনুমোদন বা প্রশ্নের উত্তরের অপেক্ষায়, টাইমার থামাতে হবে।
- ব্যবহারকারী সাড়া দিলে টাইমার আবার চলবে।
- এটি একটি state machine হিসেবে লিখতে হবে:
  `idle -> working -> (waiting_for_user -> working)* -> done | error | cancelled`
- `waiting_for_user` অবস্থায় টাইমার ফ্রিজ।

### Acceptance Criteria:
- [ ] অসম্পূর্ণ code fence stream চলাকালে UI ভাঙে না।
- [ ] অনুমোদনের অপেক্ষায় থাকা সময় কাজের সময়ে যোগ হয় না।
- [ ] নতুন আউটপুট আসার সময় ব্যবহারকারীর স্ক্রল অবস্থান জোর করে বদলায় না।

---

## ৫. Diagram রেন্ডারিং (Mermaid-ধাঁচের টার্মিনাল আর্ট)

### ৫.১ সমর্থিত ধরন
| উৎস header | ডায়াগ্রাম |
|---|---|
| graph, flowchart | Flowchart |
| sequenceDiagram | Sequence |
| stateDiagram, stateDiagram-v2 | State |
| erDiagram | Entity-relationship |

### ৫.২ Flowchart আচরণ
- `subgraph ... end` শিরোনামসহ ফ্রেম হিসেবে আঁকতে হবে। nested subgraph হলে nested frame এবং ভেতরের node-এ group marker।
- `<br/>` থেকে নতুন label লাইন।
- node-এর আকৃতি সংরক্ষণ: decision diamond, stadium, rounded corner, double border।
- node-এর প্রথম style class অনুযায়ী border রঙ, যদি theme সেই class চেনে। প্রস্তাবিত theme-স্বীকৃত class: `function`, `class`, `file`, `directory`, `external`, `focal`।
- label সর্বোচ্চ চার সারিতে wrap; বেশি হলে ellipsis।
- সরু টার্মিনালে label fit করানোর জন্য wrap।
- `classDef`, `style`, `linkStyle` উপেক্ষা করতে হবে। রঙ আসবে theme থেকে, ডায়াগ্রামের উৎস থেকে নয়। (এতে dark/light/safe সব থিমে ডায়াগ্রাম পাঠযোগ্য থাকে।)

### ৫.৩ Fallback নিয়ম
| অবস্থা | আচরণ |
|---|---|
| ব্লক stream হচ্ছে, অসম্পূর্ণ | "Drawing diagram" অবস্থা দেখান |
| অতি চওড়া / অতি বড় | source ও কারণ দেখান |
| unsupported syntax | source ও কারণ দেখান |
| ASCII mode চালু | সবসময় source দেখান |

**নীতি:** ডায়াগ্রাম আঁকতে না পারলে ব্যবহারকারীকে খালি জায়গা বা ভাঙা আর্ট দেওয়া যাবে না। সবসময় পাঠযোগ্য source ও কারণ দিতে হবে।

### Acceptance Criteria:
- [ ] প্রতিটি fallback পথে source ও কারণ দৃশ্যমান।
- [ ] উৎসের style স্টেটমেন্ট রেন্ডারে প্রভাব ফেলে না।
- [ ] diagram parser ও painter আলাদা মডিউল।

---

## ৬. Tool Display (টুল প্রদর্শন)

### ৬.১ কম্পোনেন্ট নীতি
- প্রতিটি tool টাইপের জন্য আলাদা dedicated কম্পোনেন্ট (shell, file operation, grep, glob, code intelligence, MCP, sub-agent ইত্যাদি)। একটি জেনেরিক কার্ড সব টুলের জন্য ব্যবহার করবেন না।
- নতুন টুল যোগ করলে registry-তে কম্পোনেন্ট নিবন্ধন করতে হবে। কম্পোনেন্ট না থাকলে একটি সরল fallback কার্ড ব্যবহার হবে।

### ৬.২ কার্ডের জীবনচক্র
`pending -> awaiting_approval -> running -> success | error | denied`

কার্ডে দেখাতে হবে:
- বর্ণনামূলক শিরোনাম
- চলমান অবস্থায় spinner
- শেষে status icon: সফল, ত্রুটি, অনুমোদনের অপেক্ষা, তিনটি আলাদা দৃশ্যমান চিহ্ন
- Collapsible output: ডিফল্টে summary, একটি কী-তে পূর্ণ আউটপুট (সংযুক্তি: কীবোর্ড সেকশন)
- দীর্ঘ চলমান MCP অপারেশনে progress bar

### ৬.৩ MCP ও Sub-agent কার্ড
- MCP tool call-এর summary-তে টুলকে পাঠানো সব parameter দেখাতে হবে, expand না করেই।
- Sub-agent কার্ডে এক লাইনের prompt preview; expand করলে পূর্ণ prompt।

### ৬.৪ Real-time shell আউটপুট
- Shell আউটপুট লাইন ধরে ধরে stream হবে, কমান্ড শেষ হওয়ার অপেক্ষায় নয়।
- দীর্ঘ আউটপুট head + tail ভিউতে সংকুচিত; কী চাপলে সম্পূর্ণ।
- Interactive কমান্ড (ইনপুট চায় এমন) সমর্থন না করলে সেটি স্পষ্টভাবে ডকুমেন্ট করুন এবং ব্যবহারকারীকে non-interactive বিকল্প বলুন (যেমন নিশ্চিতকরণ ফ্ল্যাগসহ কমান্ড)। তাৎক্ষণিক exit হলে কারণ জানাতে হবে।

### ৬.৫ বড় Tool Result (context দক্ষতা)
- সম্পূর্ণ ফলাফল সেশনের সাথে সংরক্ষণ করুন।
- মডেলকে শুধু একটি ছোট preview দিন।
- ব্যবহারকারী UI থেকে সম্পূর্ণ আউটপুট দেখতে পারবে।

### ৬.৬ Thinking (reasoning) প্রদর্শন
- reasoning ব্লক উত্তরের উপরে inline stream হবে।
- দীর্ঘ trace tail view-তে সংকুচিত, expand/collapse করা যাবে।
- ডিফল্টে চালু; একটি সেটিং দিয়ে বন্ধ করা যাবে।
- সেটিংটি startup-only হলে ব্যবহারকারীকে স্পষ্ট জানাতে হবে যে পরিবর্তন পরের সেশনে কার্যকর হবে।

### Acceptance Criteria:
- [ ] প্রতিটি টুল টাইপের নিজস্ব কম্পোনেন্ট আছে এবং registry-তে নিবন্ধিত।
- [ ] MCP কার্ডে সব parameter দৃশ্যমান।
- [ ] বড় result সংরক্ষিত হয় এবং মডেল context-এ শুধু preview যায়।
- [ ] Interactive কমান্ড ব্যর্থ হলে ব্যবহারকারী কারণ ও বিকল্প দেখে।

---

## ৭. Approval ও Permission UX

### ৭.১ Approval Bar
- অনুমতি দরকার হলে ইনপুটের উপরে একটি notification bar, তিনটি অপশন: Yes (এই একবার), Trust (স্থায়ী বা সেশন-ব্যাপী অনুমতি), No।
- একাধিক অনুমোদন একসাথে এলে queue, একটি একটি করে দেখানো।
- শুধু হ্যাঁ/না নয়, drill-in করে feedback দেওয়ার পথ থাকতে হবে (ব্যবহারকারী agent-কে বলতে পারবে কেন না, বা কী বদলাতে হবে)।

### ৭.২ Shell কমান্ডের Trust Scope (তিন স্তর)
| স্তর | অর্থ |
|---|---|
| Exact command | হুবহু এই কমান্ড |
| Command prefix | নির্দিষ্ট prefix দিয়ে শুরু হওয়া কমান্ড |
| Base command | কমান্ডের মূল নাম (সব আর্গুমেন্টসহ) |

ডিফল্টে সবচেয়ে সংকীর্ণ স্তর পূর্বনির্বাচিত থাকবে।

### ৭.৩ সব-অনুমতি মোড
- "সব টুল trust" ধরনের মোড চালু করার আগে একটি নিশ্চিতকরণ সতর্কবার্তা দেখাতে হবে। ঝুঁকি স্বীকার না করে এগোনো যাবে না।
- এই মোড সক্রিয় থাকলে UI-তে স্থায়ী দৃশ্যমান নির্দেশক থাকবে (SHOULD)।

### Acceptance Criteria:
- [ ] একাধিক অনুমোদন queue হয়, একসাথে দেখানো হয় না।
- [ ] Trust স্তর বাছাই করা যায় এবং সংকীর্ণ স্তর ডিফল্ট।
- [ ] সব-অনুমতি মোডে সতর্কবার্তা ছাড়া প্রবেশ করা যায় না।

---

## ৮. Model Fallback ও Availability নোটিশ

### ৮.১ Turn-level fallback
- কোনো মডেল turn প্রত্যাখ্যান করলে বা unavailable হলে, কনফিগার করা (বা সার্ভিস-প্রদত্ত) fallback-এ turn পুনরায় চেষ্টা করা যাবে।
- Subagent মূল সেশনের fallback কনফিগারেশন অনুসরণ করবে।
- ব্যবহারকারীকে সবসময় জানাতে হবে:
  - কোন মডেল প্রত্যাখ্যান করল বা unavailable ছিল
  - কোন মডেল এই turn-এ উত্তর দিল
  - কোনো মডেল কথোপকথনের স্থায়ী মডেল হলো কি না (প্রত্যাখ্যানের পর হতে পারে; unavailability-জনিত বদল শুধু ওই turn-এর)
  - কোনো মডেলই উত্তর না দিলে সেটি স্পষ্ট বলা এবং মডেল বদলাতে বলা
- Fallback chain শেষে চেষ্টা করা মডেলগুলোর তালিকা ও ফলাফল দেখাতে হবে।
- Fallback কনফিগারেশন `/model` ধরনের প্যানেলের একটি নির্দিষ্ট সারি ও একটি কমান্ড (যেমন `model fallback`) থেকে দেখা ও বদলানো যাবে; সংরক্ষিত পছন্দ বর্তমান ও ভবিষ্যৎ সেশনে প্রযোজ্য।

### ৮.২ সেশন শুরুর Availability পরীক্ষা
| পরিস্থিতি | আচরণ |
|---|---|
| model list জানা, সংরক্ষিত ডিফল্ট unavailable | সার্ভিসের ডিফল্ট ব্যবহার করুন, ব্যবহারকারীকে মডেল-বাছাইয়ে পাঠান, ব্যবহারকারীর সংরক্ষিত সেটিং নিজে থেকে পুনরায় লিখবেন না |
| model list এখনো আসেনি | বর্তমান নির্বাচন রাখুন, notice নয় |
| agent কনফিগ বা resume করা সেশনের মডেল unavailable | নির্বাচিত রাখুন, রিকোয়েস্ট ব্যর্থ হবে বলে স্পষ্ট জানান |
| ব্যবহারকারী স্পষ্ট `--model` দিয়েছে, unavailable | নির্বাচিত রাখুন, ব্যর্থ হবে বলে জানান। নিজে থেকে বদলাবেন না |
| নতুন সেশন বা history মোছার পর | একই পরীক্ষা আবার চালান |
| headless রান | session-start notice দেখাবেন না |

**মূল নীতি:** ব্যবহারকারীর স্পষ্ট পছন্দ (flag, agent কনফিগ) কখনো নীরবে ওভাররাইড করা যাবে না। অসঙ্গতি হলে জানাতে হবে।

### Acceptance Criteria:
- [ ] প্রতিটি fallback ঘটনায় transcript-এ কারণসহ notice আছে।
- [ ] ব্যবহারকারীর সংরক্ষিত ডিফল্ট মডেল সেটিং স্বয়ংক্রিয়ভাবে বদলায় না।
- [ ] কোনো মডেলই উত্তর না দিলে ব্যবহারকারী স্পষ্ট বার্তা ও করণীয় পায়।

---

## ৯. ইনপুট সিস্টেম

| ফিচার | প্রয়োজনীয় আচরণ |
|---|---|
| নতুন লাইন | একাধিক বিকল্প কী (টার্মিনালভেদে পার্থক্য সামলাতে) |
| টার্মিনাল কী কনফিগারেশন | একটি সেটিংস কমান্ড টার্মিনাল অ্যাপের মাল্টি-লাইন কী স্বয়ংক্রিয়ভাবে কনফিগার করবে |
| ফাইল/ডিরেক্টরি রেফারেন্স | `@path` সিনট্যাক্স + tab-complete picker |
| ছবি পেস্ট | কমান্ড বা clipboard থেকে সরাসরি পেস্ট |
| দীর্ঘ পেস্ট | chip-এ সংকুচিত; chip-এ Tab চাপলে inline সম্পাদনাযোগ্য টেক্সটে প্রসারিত |
| Input queuing | agent চলাকালে পরের বার্তা লেখা ও পাঠানোর আগে queued বার্তা সম্পাদনা |
| History | Up/Down; ডিফল্ট per-session, সেটিং দিয়ে global (সব সেশনে শেয়ার্ড) |
| Reverse history search | incremental search কী |
| বাহ্যিক editor | `$EDITOR` খুলে মাল্টি-লাইন prompt (ডিফল্ট vi) |
| Shell escape | `!` উপসর্গে agent এড়িয়ে সরাসরি shell কমান্ড, আউটপুট real-time stream |

### টেক্সট এডিটিং (power-user)
Emacs-ধাঁচের kill ring সম্পূর্ণ সমর্থন (SHOULD): আগের শব্দ মোছা, লাইনের শুরু/শেষ পর্যন্ত kill, yank, undo, স্ক্রিন পরিষ্কার (আগের আউটপুট scrollback বা পেজ-আপে রক্ষিত)।

### Acceptance Criteria:
- [ ] agent চলাকালে টাইপ করা ও queued বার্তা সম্পাদনা সম্ভব।
- [ ] দীর্ঘ পেস্ট UI ভাঙে না এবং chip expand করা যায়।
- [ ] History মোড (session/global) সেটিংয়ে বদলানো যায়।

---

## ১০. Overlay Panel Framework

একটি সাধারণ panel framework বানান, যার ওপর প্রতিটি panel (help, context, tools, mcp, knowledge, code, hooks ইত্যাদি) আলাদা ফাইলে বসবে।

প্রতিটি panel-এ MUST:
- Searchable (fuzzy search)
- Scrollable
- Esc দিয়ে বন্ধযোগ্য
- খোলার সময় কথোপকথনের স্ক্রল অবস্থান নষ্ট না করা

### প্রস্তাবিত panel তালিকা:
| Panel | বিষয়বস্তু |
|---|---|
| help | সব কমান্ড |
| context | ফাইলভিত্তিক token শতাংশসহ context বিশ্লেষণ; add/remove/show/clear |
| usage | সীমা, progress bar, credit ব্যালেন্স, বর্তমান সেশনে ব্যবহৃত credit |
| tools | উপলব্ধ টুল ও trust অবস্থা |
| mcp | সার্ভার ও registry অবস্থা |
| knowledge | knowledge base ব্যবস্থাপনা |
| prompts | selection menu + detail drill-in |
| model | মডেল, thinking/effort, fallback সারি |
| settings | theme, keybinding, terminal input, display preference |
| code | code intelligence |
| hooks | কনফিগার করা hook |

### Acceptance Criteria:
- [ ] নতুন panel যোগ করতে শুধু panel ফাইল + registry লাইন।
- [ ] সব panel-এ search, scroll ও Esc একই আচরণ করে।

---

## ১১. Activity Tray ও Monitor

### ১১.১ Activity Tray
একটি কী-তে task progress ও queued বার্তা এক নজরে দেখা যাবে, কথোপকথনের ইতিহাস স্ক্রল না করেই।

### ১১.২ Crew (Subagent) Monitor
- multi-agent workflow-তে subagent ও spawn করা সেশনের কার্যকলাপ real-time।
- সেশনের মধ্যে চলাচলের জন্য নির্দিষ্ট কী জোড়া; বন্ধ করার জন্য একটি কী।
- কমান্ড লাইন থেকে সমান্তরাল সেশন চালু করার কমান্ড (spawn)।

### ১১.৩ Workflow Monitor (full-screen)
দেখাতে হবে: step tree, সক্রিয় step-এর আউটপুট, run status, প্রসঙ্গভিত্তিক নিয়ন্ত্রণ, এবং (SHOULD) প্রতিটি step-এর credit ব্যবহার।

| কাজ | আচরণ |
|---|---|
| Pause | সহযোগিতামূলক (cooperative) অনুরোধ। চলমান কাজ নিরাপদ বিন্দুতে থামে |
| Resume / Retry | paused run চালু বা ব্যর্থ/বাতিল কাজ পুনরায় চেষ্টা (শুধু সুযোগ থাকলে দেখান) |
| Reply | নির্বাচিত paused step-এ টেক্সট উত্তর পাঠানো |
| Stop | দ্বি-ধাপ: প্রথম চাপে "arm", নিশ্চিত করতে আবার একই কী; Esc দিলে বাতিল |
| Esc | ফর্ম বন্ধ বা আগের ভিউতে ফেরা |

Pause ও Stop-এর পার্থক্য UI-তে স্পষ্ট হতে হবে। Workflow কমান্ড স্পষ্ট run ID-ও গ্রহণ করবে।

### Acceptance Criteria:
- [ ] Stop ভুলে এক চাপে কার্যকর হয় না।
- [ ] শুধু প্রযোজ্য ক্রিয়া (resume/retry) দেখানো হয়, অপ্রযোজ্য নয়।
- [ ] Monitor খোলা অবস্থায় কথোপকথন ভিউ নষ্ট হয় না।

---

## ১২. Document Review Screen

agent কোনো ধাপের শেষে checkpoint-এ document পর্যালোচনার প্রস্তাব দিলে:
- ব্যবহারকারী নথিটি জায়গায় বসেই পড়ে লাইন ধরে comment stage করতে পারবে।
- checkpoint-এ ফিরলেও comment staged থাকবে।
- checkpoint-এর প্রশ্নের উত্তর দিলে সব comment একটি revision অনুরোধ হিসেবে agent-এর কাছে যাবে।
- মাউস সমর্থন (স্ক্রল ও ক্লিকে কার্সার) টগলযোগ্য।

### প্রয়োজনীয় নেভিগেশন:
| কাজ | প্রস্তাবিত কী |
|---|---|
| এক লাইন সরা | তীর কী এবং vim-ধাঁচের j k |
| অর্ধ পৃষ্ঠা সরা | PgUp/PgDn এবং Ctrl+U/Ctrl+D |
| পরের/আগের section | n / N |
| পরের/আগের comment | ] / [ |
| উপরে/নিচে যাওয়া | Home/End এবং g / G |
| comment করা বা সম্পাদনা | Enter / e |
| comment মোছা | Del |
| mouse টগল | m |
| সব shortcut তালিকা | ? |
| ফিরে যাওয়া | Esc / q |

**নীতি:** এই স্ক্রিন কীবোর্ডের নিয়ন্ত্রণ নেয়। তাই এখানে সাধারণ প্যানেলের কী (tray টগল, subagent বদল) ভিন্ন কাজ করবে। এই দ্বৈত ব্যবহার সেকশন ১৬-এর "প্রসঙ্গভিত্তিক কী-ম্যাপ" অনুযায়ী ডকুমেন্ট করতে হবে।

### Acceptance Criteria:
- [ ] Staged comment checkpoint-এ ফেরা ও আবার ঢোকার পরেও থাকে।
- [ ] সব comment একটি অনুরোধে পাঠানো হয়।
- [ ] ? চাপলে সব বর্তমান shortcut দেখা যায়।

---

## ১৩. Theme সিস্টেম

### ১৩.১ বাধ্যতামূলক থিম
| থিম | ব্যবহার |
|---|---|
| dark | গাঢ় ব্যাকগ্রাউন্ড |
| light | হালকা ব্যাকগ্রাউন্ড |
| safe | ANSI fallback, SSH বা সীমিত টার্মিনালের জন্য |

### ১৩.২ নিয়ম
- টার্মিনালের ব্যাকগ্রাউন্ড থেকে স্বয়ংক্রিয়ভাবে dark/light শনাক্ত করে থিম বাছতে হবে।
- থিমে নামযুক্ত ANSI রঙ ব্যবহার করুন, hardcoded hex নয়। এতে remapped palette-এর টার্মিনালেও সঠিক রেন্ডার হয়।
- `NO_COLOR` environment variable সম্মান করতে হবে: সেট থাকলে সব রঙ বন্ধ।
- ব্যবহারকারী live preview সহ prompt ও response টেক্সটের রঙ override করতে পারবে এবং base theme বদলাতে পারবে।
- Truecolor না থাকলে 256-color-এ নেমে আসবে।
- রঙ ছাড়াও অর্থ বোঝা যায় এমনভাবে ডিজাইন করুন (যেমন status icon-এ আকৃতি আলাদা, শুধু রঙে নয়)।

### ১৩.৩ Theme token কাঠামো (প্রস্তাবিত)
প্রতিটি থিম একই token সেট সংজ্ঞায়িত করবে (মান থিমভেদে আলাদা):
```text
text.primary, text.muted, text.error, text.success, text.warning
surface.default, surface.raised, border.default, border.focus
prompt.accent, response.accent
status.success, status.error, status.waiting, status.running
diagram.function, diagram.class, diagram.file, diagram.directory, diagram.external, diagram.focal
code.* (syntax highlight token সেট)
```

### Acceptance Criteria:
- [ ] NO_COLOR সেট করলে কোনো ANSI রঙ কোড বের হয় না।
- [ ] তিনটি থিমে এবং NO_COLOR-এ সব কম্পোনেন্ট পাঠযোগ্য।
- [ ] কোনো কম্পোনেন্টে raw hex বা raw রঙ নেই (লিন্টে যাচাই)।

---

## ১৪. Terminal Capability Detection ও Graceful Degradation

একটি আলাদা capabilities মডিউল শুরুতেই টার্মিনালের ক্ষমতা শনাক্ত করবে এবং ফলাফল একটি অবজেক্টে রাখবে। UI কখনো সরাসরি টার্মিনাল ধরে নিয়ে কাজ করবে না।

| ক্ষমতা | সমর্থিত হলে | না হলে |
|---|---|---|
| Synchronized output | flicker-free ফ্রেম | সাধারণ লেখা |
| Hyperlink | ক্লিকযোগ্য লিংক | URL দৃশ্যমান টেক্সট |
| Progress indicator (title bar) | অ্যানিমেটেড অবস্থা | বন্ধ |
| Truecolor | পূর্ণ রঙ | 256-color, তারপর safe থিম |
| Theme detection | স্বয়ংক্রিয় dark/light | ডিফল্ট থিম + ম্যানুয়াল theme কমান্ড |
| Non-ASCII (CJK, emoji, accented) | সঠিক প্রস্থ গণনায় রেন্ডার | কমপক্ষে ভাঙবে না |

### Program status (সমর্থিত টার্মিনালের জন্য)
harness তার অবস্থা (idle, working, done, ব্যবহারকারীর অপেক্ষায়, error) একটি escape sequence-এর মাধ্যমে টার্মিনালকে জানাবে, যাতে টার্মিনাল ট্যাব বা শিরোনাম সেই অবস্থা দেখাতে পারে। এটি env চলক দিয়ে বন্ধযোগ্য।

### Terminal title
ঐচ্ছিক সেটিং: কাস্টম নাম দেখানো এবং কাজের সময় অ্যানিমেট করা।

### প্রতিটি ফিচারের জন্য opt-out env চলক (বাধ্যতামূলক):
| ফিচার | প্রস্তাবিত চলকের ধরন |
|---|---|
| Hyperlink বন্ধ | `TENDRIL_NO_HYPERLINKS` |
| Progress indicator বন্ধ | `TENDRIL_NO_PROGRESS` |
| Synchronized output বন্ধ | `TENDRIL_NO_SYNCHRONIZED` |
| Program status বন্ধ | `TENDRIL_NO_PROGRAM_STATUS` |
| ডায়াগ্রাম সবসময় source | `TENDRIL_ASCII_MODE` |
| সব রঙ বন্ধ | `NO_COLOR` (মান্য স্ট্যান্ডার্ড) |

### Acceptance Criteria:
- [ ] সবচেয়ে সীমিত টার্মিনালেও (safe থিম, রঙহীন) UI ব্যবহারযোগ্য।
- [ ] প্রতিটি optional ফিচার একটি env চলকে বন্ধ করা যায়।
- [ ] Rendering সমস্যায় ব্যবহারকারীকে প্রথমে "কোন ফিচার বন্ধ করে দেখুন" এই ধরনের নির্দেশনা দেওয়া যায় (সেকশন ২০)।

---

## ১৫. Slash Command রেজিস্ট্রি

### ১৫.১ নীতি
- সব কমান্ড একটি registry থেকে আসবে। help panel, autocomplete ও fuzzy picker সবই এই registry পড়বে।
- প্রতিটি কমান্ড: নাম, alias, সংক্ষিপ্ত বিবরণ, আর্গুমেন্ট স্কিমা, প্রযোজ্য harness সংস্করণ।
- নির্দিষ্ট সংস্করণে অনুপলব্ধ কমান্ড help-এ দেখাবে না, বা দেখালে স্পষ্ট চিহ্নিত করবে।
- ব্যবহারকারীর তৈরি skill নাম ধরে সরাসরি কমান্ড হিসেবে চালানো যাবে।

### ১৫.২ প্রস্তাবিত কমান্ড সেট
| বিভাগ | কমান্ড | কাজ |
|---|---|---|
| সাহায্য | `help` | সব কমান্ড |
| সেশন | `chat` (picker), `clear`, `compact`, `rewind`, `exit` | সেশন বদল, ইতিহাস মোছা, context সংকোচন, আগের turn-এ fork, বের হওয়া |
| Context | `context`, `usage` | token ও credit |
| মডেল | `model`, `effort` | মডেল, thinking ও effort |
| Agent | `agent`, `plan`, `goal`, `spawn`, `reply` | agent বদল, plan মোড, লক্ষ্যভিত্তিক loop, সমান্তরাল সেশন |
| Tool/Integration | `tools`, `mcp`, `code`, `hooks`, `knowledge`, `prompts` |
| UI | `theme`, `settings`, `fullscreen`, `transcript`, `title`, `verbosity` |
| Input | `editor`, `paste` |
| Workflow | `workflow` |
| ইউটিলিটি | `copy` (SSH-তেও কাজ করা চাই), `feedback` |

### ১৫.৩ বিশেষ আচরণ
- `rewind`: আগের কোনো turn-এ কথোপকথন fork করে ভিন্ন পথ অন্বেষণ। মূল ইতিহাস নষ্ট করা যাবে না।
- `compact`: context জায়গা খালি করতে সারসংক্ষেপ। কী সংক্ষেপ হলো তা ব্যবহারকারীকে জানাতে হবে।
- `copy`: clipboard অ্যাক্সেস না থাকলেও (যেমন SSH) কাজ করার একটি পথ থাকতে হবে।
- `fullscreen`: পূর্ণ টার্মিনাল কথোপকথন ভিউ, মাউস স্ক্রল সহ।

### Acceptance Criteria:
- [ ] help, autocomplete ও picker একই registry থেকে তথ্য পায়।
- [ ] rewind মূল সেশনের ইতিহাস অক্ষত রাখে।
- [ ] copy কমান্ড SSH সেশনে কাজ করে।

---

## ১৬. কীবোর্ড শর্টকাট নীতি

### ১৬.১ বেসলাইন কী-ম্যাপ
| গ্রুপ | কী | কাজ |
|---|---|---|
| নতুন লাইন | Shift+Enter, Ctrl+J, Alt+Enter | লাইন যোগ |
| Output | Ctrl+O | tool আউটপুট ও thinking trace expand/collapse |
| Tray | Ctrl+X | activity tray টগল |
| Crew monitor | Ctrl+G; Ctrl+D / Ctrl+U চলাচল; q বন্ধ |
| Transcript | Ctrl+T | pager-এ transcript |
| History | Up/Down; Ctrl+R | নেভিগেশন; reverse search |
| Plan mode | Shift+Tab |
| বাতিল / বন্ধ | Esc | প্যানেল বন্ধ, agent বাতিল, queue পরিষ্কার |
| Exit | Ctrl+C; Ctrl+D (ইনপুট খালি থাকলে) |
| Suspend | Ctrl+Z দুইবার |

### ১৬.২ নিয়ম
- Suspend দুইবার চাপা আবশ্যক, যাতে agent stream করার সময় ভুলে সেশন suspend না হয়।
- Cancel, close-menu ও quit কী ব্যবহারকারী বদলাতে পারবে। মান `ctrl+`, `shift+`, `alt+/meta+` মডিফায়ারসহ একটি কী। অবৈধ মান ডিফল্টে ফিরবে, crash করবে না।

### ১৬.৩ প্রসঙ্গভিত্তিক কী-ম্যাপ (context-aware key reuse)
একই কী ভিন্ন প্রসঙ্গে ভিন্ন কাজ করতে পারে, তবে:
- প্রতিটি প্রসঙ্গের জন্য একটি আলাদা keymap স্তর থাকবে (`global`, `panel`, `monitor`, `review`)।
- সক্রিয় প্রসঙ্গের keymap আগে মূল্যায়ন হবে।
- প্রসঙ্গ-নির্দিষ্ট বদল ডকুমেন্টেড থাকবে এবং screen-এ (footer বা ?) দৃশ্যমান হবে।

| কী | সাধারণ | বিশেষ প্রসঙ্গ |
|---|---|---|
| Ctrl+X | activity tray | review-তে নথি পড়া, workflow monitor-এ stop arm, verbosity-তে preview চক্র |
| Ctrl+D / Ctrl+U | crew monitor-এ subagent বদল | review-তে অর্ধ পৃষ্ঠা স্ক্রল; ইনপুটে exit / লাইনের শুরু পর্যন্ত kill |
| Esc | প্যানেল বন্ধ/বাতিল | মনিটর/ফর্মে আগের ভিউতে ফেরা |

### Acceptance Criteria:
- [ ] প্রতিটি প্রসঙ্গে বর্তমান কী-বাইন্ডিং দেখার পথ আছে।
- [ ] ব্যবহারকারীর অবৈধ keybinding মান crash ঘটায় না।
- [ ] দুটি প্রসঙ্গের কী সংঘাত অটোমেটেড টেস্টে ধরা পড়ে।

---

## ১৭. Session ব্যবস্থাপনা
- সেশন বর্তমান working directory-তে scoped।
- আগের সেশন fuzzy picker দিয়ে timestamp সহ দেখানো ও বেছে নেওয়া।
- নির্দিষ্ট session ID দিয়ে resume করা যাবে (CLI flag)।
- পুরনো ফরম্যাটের সেশন নতুন UI-তে সমস্যা ছাড়া লোড হতে হবে (backward compatibility)।
- বড় tool result সেশনের সাথে সংরক্ষিত থাকবে (সেকশন ৬.৫)।

### Acceptance Criteria:
- [ ] একই ডিরেক্টরির বাইরের সেশন picker-এ আসে না (ডিফল্টে)।
- [ ] পুরনো ফরম্যাটের সেশন লোড হয়।

---

## ১৮. Headless মোড সামঞ্জস্য
- `core/` UI ছাড়া চলতে পারবে (সেকশন ২-এর নিয়ম)।
- Headless রানে session-start notice (মডেল availability ইত্যাদি) দেখাবেন না।
- সব UI-নির্দিষ্ট ফিচার (panel, monitor, approval bar) headless-এ নিষ্ক্রিয়; অনুমতির জন্য আলাদা অ-ইন্টারেক্টিভ নীতি লাগবে (flag বা কনফিগ)।
- Exit code স্পষ্ট ও ডকুমেন্টেড হবে।

---

## ১৯. সীমাবদ্ধতা যা স্পষ্ট ডকুমেন্ট করতে হবে
প্রতিটি সীমাবদ্ধতা ব্যবহারকারীর কাছে লুকাবেন না। ডকুমেন্টেশন ও রানটাইম notice দুই জায়গাতেই জানাবেন:
- Interactive শেল কমান্ড (ইনপুট চায়) সমর্থিত নয়, বিকল্প সহ।
- বাহ্যিক diff টুল না থাকলে সব diff বিল্ট-ইন ভিউয়ারে।
- সব টার্মিনাল সব ফিচার সমর্থন করে না। opt-out env চলক ডকুমেন্ট করুন।
- Embedded asset বিল্টে না থাকলে: পুরনো ইন্টারফেসে নীরবে না নেমে reinstall বার্তা দিন।

---

## ২০. সমস্যা সমাধান (ইন-প্যাকেজ নির্দেশনা)

### UI লোড হচ্ছে না:
- বর্তমান UI মোড সেটিং যাচাইয়ের কমান্ড দিন।
- সর্বশেষ সংস্করণে আপডেট করতে বলুন।
- Asset অনুপস্থিত থাকলে reinstall নির্দেশ দিন।

### Rendering সমস্যা:
- ভিন্ন, ভালো সমর্থিত টার্মিনাল চেষ্টা করুন।
- Synchronized output বন্ধ করুন।
- Truecolor সমর্থন যাচাই করুন।
- তারপর safe থিম বা `NO_COLOR` চেষ্টা করুন।
- এই নির্দেশনা একটি `doctor` ধরনের কমান্ডে স্বয়ংক্রিয় করা SHOULD, যা টার্মিনালের ক্ষমতা শনাক্ত করে কোন ফিচার ঝুঁকিপূর্ণ তা জানায়।

---

## ২১. কম্পোনেন্ট-ভিত্তিক বাস্তবায়ন চেকলিস্ট

### পর্যায় ১: ভিত্তি
- [ ] settings store + precedence resolver
- [ ] terminal capabilities detector
- [ ] theme tokens + dark/light/safe + NO_COLOR
- [ ] keybinding resolver (স্তরভিত্তিক keymap)

### পর্যায় ২: মূল চ্যাট
- [ ] stream buffer + synchronized output
- [ ] markdown ও code highlighting
- [ ] conversation list + স্ক্রল সংরক্ষণ
- [ ] busy indicator state machine
- [ ] input editor (নতুন লাইন, @path, paste chip, queue, history, reverse search)
- [ ] shell escape ও real-time shell stream

### পর্যায় ৩: Tool ও অনুমতি
- [ ] tool registry ও dedicated কার্ড
- [ ] collapsible আউটপুট + head/tail
- [ ] MCP কার্ড (সব parameter) ও sub-agent কার্ড
- [ ] বড় result সংরক্ষণ + preview
- [ ] thinking ব্লক
- [ ] approval bar + queue + drill-in feedback
- [ ] shell trust scope (তিন স্তর)
- [ ] সব-অনুমতি মোডের নিশ্চিতকরণ

### পর্যায় ৪: কমান্ড ও প্যানেল
- [ ] slash command registry
- [ ] overlay panel framework + প্রতিটি panel
- [ ] session picker + resume by ID
- [ ] model panel + fallback কনফিগ

### পর্যায় ৫: উন্নত
- [ ] model fallback লজিক + transcript notice
- [ ] availability notice নিয়ম
- [ ] diagram parser + layout + painter + fallback
- [ ] activity tray
- [ ] crew monitor
- [ ] workflow monitor (দ্বি-ধাপ stop)
- [ ] document review screen
- [ ] fullscreen ভিউ
- [ ] program status ও terminal title
- [ ] doctor কমান্ড

### পর্যায় ৬: গুণমান
- [ ] সবচেয়ে সীমিত টার্মিনালে ম্যানুয়াল টেস্ট (safe থিম, কোনো রঙ নেই)
- [ ] keymap সংঘাত টেস্ট
- [ ] lint: core/-এ ui/ import নিষেধ, raw রঙ নিষেধ
- [ ] স্ট্রিম চলাকালে স্ক্রল ও resize টেস্ট

---

## ২২. সামগ্রিক Acceptance Criteria (চূড়ান্ত যাচাই)
- [ ] প্রতিটি ফিচার ও কম্পোনেন্ট আলাদা ফাইলে, কোনো monolithic ফাইল নেই।
- [ ] `core/` UI-নিরপেক্ষ, headless চলে।
- [ ] কোনো ফিচারে placeholder বা নকল ডেটা নেই। সব তথ্য বাস্তব state থেকে আসে (সেশন, মডেল তালিকা, usage ইত্যাদি)।
- [ ] কোড ও UI-তে কোনো emoji নেই। status চিহ্ন প্রকৃত টেক্সট/ANSI চিহ্ন বা থিম-নিয়ন্ত্রিত আইকন।
- [ ] তিনটি থিমে এবং `NO_COLOR`-এ সব কম্পোনেন্ট পাঠযোগ্য।
- [ ] প্রতিটি অনুমোদন-সংবেদনশীল ক্রিয়ায় নিশ্চিতকরণ ও সংকীর্ণ scope।
- [ ] প্রতিটি fallback ও ব্যর্থতায় ব্যবহারকারী কারণ ও করণীয় জানে।
- [ ] সব keybinding প্রসঙ্গভিত্তিক, ডকুমেন্টেড ও পরিবর্তনযোগ্য, অবৈধ মানে crash নেই।
- [ ] টার্মিনাল resize ও দীর্ঘ stream চলাকালে UI ভাঙে না।
