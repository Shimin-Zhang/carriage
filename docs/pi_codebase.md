# Pi — Codebase Overview

> A high-level run-down of the **pi agent harness** (`earendil-works/pi-mono`, by badlogic /
> Mario Zechner et al.), checked out under `reference/pi`. Written as orientation for anyone who
> needs to understand what the project is, what it does, and how its four packages fit together —
> without reading all ~100k lines first.

---

## 1. What it is

**Pi** is a **minimal, self-extensible terminal coding agent** — a local CLI (`pi`) that wraps an
LLM, gives it tools (read / bash / edit / write / grep / find / ls), and lets it autonomously read,
modify, and run code on your machine. It is deliberately small at the core and pushes everything
else (custom tools, commands, UI, providers) into **TypeScript extensions, skills, prompt templates,
themes, and pi packages** loaded at runtime.

The whole project is **TypeScript**, shipped as an npm monorepo (`pi-monorepo`, MIT-licensed) of
**four published packages** plus the flagship CLI. It targets **Node ≥ 22.19** and also ships as a
**Bun single-file binary**. It authenticates either through subscription **OAuth** (Claude Pro/Max,
GitHub Copilot, ChatGPT/Codex) or plain **API keys**, and speaks to **30+ LLM providers** behind one
unified API.

Distinctive characteristics:

- **Tiny core, big edges.** The agent loop is a few hundred lines; capability lives in extensions
  loaded via `jiti` (a TypeScript runtime loader). Pi can extend *itself* — its own `.pi/` directory
  in this repo holds extensions, skills, and prompts that drive its development.
- **One engine, three front-ends.** The same `AgentSession` core drives an **interactive TUI**, a
  single-shot **print/JSON mode**, and a headless **RPC mode** (JSON over stdin/stdout) for embedding.
- **Provider-agnostic.** `pi-ai` normalizes OpenAI, Anthropic, Google, Bedrock, Mistral, xAI, Groq,
  and ~20 more into one message/tool/streaming format, with auto model discovery and cost tracking.
- **Sessions are trees.** Conversations persist as JSONL and form a navigable tree — you can fork,
  branch, resume, and the harness auto-summarizes both old context (compaction) and abandoned branches.
- **Supply-chain hardened.** Exact-pinned deps, lockfile-as-ground-truth, shrinkwrap with a
  lifecycle-script allowlist, and `min-release-age` gating to avoid same-day dependency releases.
- **No built-in permission system.** By default pi runs with the launching user's full privileges;
  isolation is opt-in via Gondolin (micro-VM), Docker, or OpenShell containerization.

### Rough scale

| Metric | Approx. |
|--------|---------|
| Published packages | 4 (`ai`, `agent`, `coding-agent`, `tui`) |
| TypeScript source LOC (`packages/*/src`) | ~101,500 |
| Biggest package | `coding-agent` ~49.9k LOC · `ai` ~31.6k · `tui` ~12k · `agent` ~8.1k |
| LLM providers supported | 30+ (OpenAI, Anthropic, Google, Bedrock, Mistral, …) |
| Built-in tools | 7 (read, bash, edit, write, grep, find, ls) |
| Node engine | ≥ 22.19; also ships a Bun single-file binary |
| Version (lockstep across all packages) | `0.79.5` (repo `0.0.3`) |

*(All four packages share one version and release in lockstep — `patch` = fixes + additions,
`minor` = breaking changes, no majors.)*

---

## 2. Repository layout

```
pi/
├── packages/
│   ├── ai/            # @earendil-works/pi-ai — unified multi-provider LLM API (bin: pi-ai)
│   ├── agent/         # @earendil-works/pi-agent-core — agent runtime: loop, tools, sessions
│   ├── coding-agent/  # @earendil-works/pi-coding-agent — THE PRODUCT: the `pi` CLI (~50k LOC)
│   │   ├── src/cli.ts · src/main.ts · src/config.ts      # entry + arg parsing + paths
│   │   ├── src/modes/                                    # interactive | print | rpc
│   │   ├── src/core/                                     # agent-session, tools, extensions, compaction
│   │   └── docs/                                         # ~30 user-facing markdown docs
│   └── tui/           # @earendil-works/pi-tui — terminal UI with differential rendering
├── .pi/               # pi dogfooding itself: extensions/, skills/, prompts/, git/, npm/
├── scripts/           # release, shrinkwrap, dep-pinning, profiling, stats tooling
├── AGENTS.md          # development rules for humans AND agents (the project's own pi config)
├── CONTRIBUTING.md    # contributor gate (auto-close workflow, lgtm/lgtmi)
├── SECURITY.md        # trust model + vuln reporting
└── test.sh / pi-test.sh   # run tests / run pi from source
```

The four packages form a clean dependency stack:

```
pi-coding-agent  (CLI, modes, built-in tools, extensions)
   ├── depends on → pi-agent-core   (agent loop, harness, sessions, compaction)
   │                   └── depends on → pi-ai   (models, streaming, providers, oauth)
   └── depends on → pi-tui          (terminal rendering, input, components)
```

`pi-ai` and `pi-tui` are leaf libraries with no internal deps; `pi-agent-core` builds the agent
runtime on top of `pi-ai`; `pi-coding-agent` assembles all three into the shipped product.

---

## 3. The central idea: one agent loop, layered

Pi is built in three conceptual rings, each adding capability over the one below:

1. **`pi-ai` — the model layer.** "Given a model, a context (system prompt + messages + tools),
   stream me an assistant response." It hides every provider's quirks behind one format.

2. **`pi-agent-core` — the agent layer.** "Run the loop: stream a response, execute the tool calls
   it asks for, feed results back, repeat until done." Adds tool execution, hooks, state, session
   persistence (JSONL trees), and context compaction.

3. **`pi-coding-agent` — the product layer.** "Be a coding agent." Supplies the 7 file/shell tools,
   the three run modes (TUI / print / RPC), the extension system, settings, project trust, auth
   migration, and slash commands.

`pi-tui` sits to the side as the rendering toolkit the interactive mode draws with.

A single turn flows like this:

```
user prompt
  → AgentSession.prompt()                       (coding-agent: state machine + persistence)
    → agent loop                                 (agent-core: orchestrates the turn)
      → streamSimple(model, context, opts)       (ai: picks provider, streams events)
      ← text / thinking / toolCall deltas
    → execute tool calls (read/bash/edit/...)    (coding-agent tools, sequential or parallel)
    → append tool results, persist JSONL entries
    → repeat until no more tool calls
  → render via pi-tui (interactive) / emit JSON (print) / stream over stdout (rpc)
```

Between turns the harness can **compact** (summarize old messages when context fills),
**summarize branches** (when you navigate to a forked path), inject **steering** messages
(mid-run corrections) or **follow-ups** (queued after the agent would stop) — all via hooks.

---

## 4. Main components

### A. `pi-ai` — unified multi-provider LLM API (~31.6k LOC)

**Purpose:** one API surface over 30+ providers, with automatic model discovery, cost tracking, and
OAuth. Also publishes a small `pi-ai` CLI (`login [provider]`, `list`).

- **Entry points** (`src/stream.ts`): `stream()` / `complete()` and their reasoning-aware variants
  `streamSimple()` / `completeSimple()`. Signature: `stream(model, context, options?) →
  AssistantMessageEventStream` — an async iterable of delta events that also resolves to a final
  `AssistantMessage`.
- **Unified format** (`src/types.ts`): a `Context` is `{ systemPrompt?, messages, tools? }`.
  Content normalizes to `TextContent | ImageContent | ThinkingContent | ToolCall`. Every
  `AssistantMessage` carries `api`, `provider`, `model`, `usage` (token counts + per-bucket cost),
  and `stopReason`. Tools are `{ name, description, parameters }` where `parameters` is a TypeBox
  schema.
- **Streaming events** (`utils/event-stream.ts`): `start`, `text_*`, `thinking_*`, `toolcall_*`,
  `done`, `error` — the same event vocabulary the agent loop reconstructs messages from.
- **Providers** (`src/providers/`): `anthropic`, `amazon-bedrock`, `google` + `google-vertex`,
  `openai-completions` + `openai-responses` + `openai-codex-responses`, `azure-openai-responses`,
  `mistral`, and a `faux` test provider. Registered lazily via `register-builtins.ts` so SDK imports
  are deferred (browser/Bun friendly). A **compatibility layer** (`OpenAICompletionsCompat`,
  `AnthropicMessagesCompat`, …) absorbs per-API variation in tool schemas, reasoning format, and
  cache control — which is how one `openai-completions` path serves OpenRouter, Groq, DeepSeek,
  Together, xAI, Cerebras, and friends.
- **Models** (`models.ts` + generated `models.generated.ts`): a registry keyed by provider→modelId
  carrying context window, max tokens, capabilities, per-million-token pricing (input/output/cache),
  and a `thinkingLevelMap` mapping pi's `minimal|low|medium|high|xhigh` levels to provider values.
  **Never edit `models.generated.ts` directly** — change `scripts/generate-models.ts` and regenerate.
- **OAuth** (`oauth.ts`, `utils/oauth/`): built-in flows for Anthropic (Claude Pro/Max), GitHub
  Copilot, and OpenAI Codex/ChatGPT, with PKCE + device-code helpers; credentials persist to
  `auth.json` and auto-refresh. New providers register at runtime via `registerOAuthProvider()`.
- **Env keys** (`env-api-keys.ts`): resolves standard env vars plus special cases (Vertex ADC,
  Bedrock IAM/profile/bearer-token). **Images** (`images.ts`, `providers/images/`): a parallel,
  smaller registry for image generation (e.g. OpenRouter images).

### B. `pi-agent-core` — the agent runtime (~8.1k LOC)

**Purpose:** a general-purpose agent loop with transport abstraction, tool calling, state
management, and session persistence — the reusable engine, independent of the coding tools.

- **The loop** (`src/agent-loop.ts`, `src/agent.ts`): a dual loop. The inner loop streams an
  assistant response (via a pluggable `StreamFn`, default `streamSimple` from pi-ai), executes the
  tool calls it produced (sequential by default, `parallel` per-tool opt-in), appends results, and
  repeats while tool calls remain. The outer loop restarts when follow-up messages arrive after a
  natural stop. The `Agent` class wraps this with observable state.
- **Hooks** make the loop extensible without forking it: `beforeToolCall` (block/rewrite args),
  `afterToolCall` (patch results), `shouldStopAfterTurn`, `prepareNextTurn` (swap model/thinking),
  `getSteeringMessages`, `getFollowUpMessages`, `transformContext`, and `convertToLlm`
  (AgentMessage[] → pi-ai Message[]).
- **Tools** (`src/types.ts`): an `AgentTool` is a pi-ai `Tool` plus a `label`, optional
  `prepareArguments` shim, an `execute(toolCallId, params, signal?, onUpdate?)` returning
  `{ content, details?, terminate? }`, and an optional `executionMode`. `content` (text/images) goes
  back to the model; `details` is structured data for UI/logging only.
- **State** (`AgentState`): `systemPrompt`, `model`, `thinkingLevel`, `tools`, `messages` (with
  defensive-copy accessors), plus streaming state (`isStreaming`, `streamingMessage`,
  `pendingToolCalls`). `AgentMessage` extends pi-ai's message union with harness-only types
  (`custom`, `bashExecution`, `branchSummary`, `compactionSummary`) that apps add via declaration
  merging and filter/convert in `convertToLlm`.
- **Harness** (`src/harness/`): the `AgentHarness` wraps the loop with the production concerns:
  - **session/** — JSONL-backed session storage as a **tree** (entries with `id`/`parentId`,
    UUIDv7 ids, v3 format), plus an in-memory repo for tests. Entry types cover messages, custom
    messages, model/thinking/tool changes, compaction summaries, branch summaries, labels, and the
    active leaf. State is rebuilt from the leaf-to-root path on open.
  - **compaction/** — token-aware summarization. When estimated context approaches
    `contextWindow − reserveTokens`, it picks a cut point (keeping recent tokens), asks the LLM for a
    summary, and stores a `CompactionEntry`. **branch-summarization.ts** does the analogous thing when
    you navigate away from a diverged branch.
  - **env/** — `NodeExecutionEnv` (filesystem + shell), the Node binding exported from `src/node.ts`.
  - skills, prompt-templates, and system-prompt composition helpers.
- **Transport / proxy** (`src/proxy.ts`): `streamProxy` lets you route LLM calls through a server
  (it holds provider secrets/auth) while the client reconstructs partial messages from delta events —
  the basis for the RPC story and for hosted deployments.

### C. `pi-coding-agent` — the `pi` CLI (~49.9k LOC, the flagship)

**Purpose:** assemble the runtime + tools + UI into the shipped coding agent. `bin: pi → dist/cli.js`.

- **Entry & startup** (`src/cli.ts` → `src/main.ts`): parses args (`src/cli/args.ts`), resolves the
  run mode, migrates legacy auth into `~/.pi/agent/auth.json`, builds services, creates an
  `AgentSession`, and runs the chosen mode. `src/config.ts` owns all paths
  (`~/.pi/agent/...`, sessions dir, models path) and env vars (`PI_CODING_AGENT_DIR`,
  `PI_OFFLINE`, …).
- **Three modes** (`src/modes/`):
  - **Interactive TUI** (`modes/interactive/`) — the default; a full keyboard-driven chat UI built on
    pi-tui with streaming tool rendering, slash-command + file autocomplete, session-tree navigation,
    live themes, and dialog overlays.
  - **Print** (`modes/print-mode.ts`) — single-shot: `pi -p "…"` or piped stdin; emits either the
    final text or a JSONL event stream (`--mode json`).
  - **RPC** (`modes/rpc/`) — headless JSON-RPC over stdin/stdout for embedding pi as a subprocess;
    commands like `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `export`; a TS `rpc-client`
    is provided. Extension UI requests (dialogs) are marshaled back over the protocol.
- **Core** (`src/core/`):
  - **agent-session** — the central state machine wrapping `pi-agent-core`'s harness with
    session ownership/switching (`/new`, `/fork`, `/resume`), event emission, and tool orchestration.
  - **tools/** — the 7 built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`), each a
    TypeBox-validated `ToolDefinition` with optional custom TUI rendering of calls/results.
  - **extensions/** — the self-extensibility engine. Extensions are `.ts` modules loaded with `jiti`
    (with virtual modules bundling typebox/pi-ai/pi-tui/pi-agent-core for the Bun binary). An
    extension's default-export factory receives a `pi` API to subscribe to events (`session_start`,
    `tool_call`, `turn_end`, …), register tools, slash commands, keyboard shortcuts, custom UI
    components and dialogs, **custom model providers**, and to drive the session.
  - **compaction/** — coding-agent-side compaction hooks (`session_before_compact` / `session_compact`).
  - **session-manager** — JSONL session persistence/migration (v3), branching, list/continue/fork.
  - **export-html** — render a session to HTML.
- **Resources & trust**: a `ResourceLoader` discovers extensions, skills, prompt templates, themes,
  and context files from **global** (`~/.pi/agent/...`) and **project-local** (`.pi/...`) locations;
  project-local resources are gated behind a per-project **trust** prompt (`project-trust.ts`).
  Settings layer global + project (`settings.json`). `migrations.ts` handles legacy auth/session/dir
  moves.

### D. `pi-tui` — terminal UI with differential rendering (~12k LOC)

**Purpose:** an efficient, flicker-free terminal UI toolkit; the canvas the interactive mode draws on.

- **Rendering model** (`tui.ts`, `terminal.ts`): components implement a minimal interface —
  `render(width) → string[]`, optional `handleInput(data)`, `invalidate()`. The `TUI` diffs new lines
  against the previous frame and rewrites **only the changed range**, wrapped in synchronized-output
  escapes (CSI 2026) for atomic, flicker-free updates. It falls back to full redraw on resize/shrink
  and is **Kitty-image aware** (expands the dirty range to cover multi-row image blocks). Renders are
  batched (~60fps) and a `CURSOR_MARKER` lets it place the hardware cursor for IME support.
- **Components** (`src/components/`): `Editor` (the big one — multiline editing, autocomplete, paste,
  scrolling), `Markdown` (syntax-highlighted, themed), `Input`, `SelectList`, `SettingsList`, `Box`,
  `Text`/`TruncatedText`, `Loader`/`CancellableLoader`, `Image`. An **overlay** system provides
  anchored modals with a focus stack.
- **Input** (`keys.ts`, `keybindings.ts`, `stdin-buffer.ts`, …): full **Kitty keyboard protocol**
  support with legacy fallback, typed key IDs + `matchesKey()`, a configurable `KeybindingsManager`,
  bracketed-paste/escape-sequence buffering, Emacs-style **kill-ring**, **undo stack**, Unicode-aware
  **word navigation** (`Intl.Segmenter`), and optional native macOS modifier detection.
- **Terminal features**: image protocols (`terminal-image.ts` — Kitty + iTerm2 with text fallback,
  capability auto-detection) and background/true-color queries (`terminal-colors.ts`).

---

## 5. Self-extensibility — the defining feature

Pi's thesis is "small core, extend everything else." Five layers of customization, all discovered at
startup from global (`~/.pi/agent/`) and project (`.pi/`) directories and hot-reloadable via `/reload`:

| Layer | What it is | Loaded as |
|-------|-----------|-----------|
| **Extensions** | TypeScript modules adding tools, commands, shortcuts, UI, event handlers, **custom providers** | `.ts` via `jiti` |
| **Skills** | Agent Skills — reusable on-demand capabilities described in markdown | text files |
| **Prompt templates** | Reusable prompts that expand from a slash command (e.g. `/cl`, `/pr`) | text files |
| **Themes** | Terminal color themes | JSON |
| **Pi packages** | Bundles that ship the above together for sharing | npm-style |

This repo **dogfoods the mechanism on itself**: `.pi/extensions/` (e.g. `tps.ts`, `redraws.ts`),
`.pi/skills/add-llm-provider.md`, and `.pi/prompts/` (`cl.md`, `pr.md`, `wr.md`, …) are the project's
own pi configuration, and `AGENTS.md` is the standing instruction set for agents working in the repo.

Custom **providers** and **OAuth flows** plug into `pi-ai`'s runtime registries, so you can add a new
model API or auth method without touching the published packages.

---

## 6. Sessions, compaction & branching

- **Storage**: JSONL files under `~/.pi/agent/sessions/--<encoded-cwd>--/<ts>_<uuid>.jsonl`, one
  entry per line, format **v3** (auto-migrated from older versions).
- **Tree, not list**: every entry has `parentId`; the session is a tree with an active **leaf**. You
  can `fork` from any point, navigate branches (`/tree`), resume (`-r`), or continue the latest (`-c`).
- **Compaction**: when context approaches the window limit, old messages are replaced by an
  LLM-generated summary (`CompactionEntry`) while recent tokens are kept verbatim; file-read/modify
  lists are tracked so the model keeps situational awareness.
- **Branch summaries**: navigating to a diverged branch inserts a summary of the path you left, so the
  model is oriented on what was abandoned.

---

## 7. Build, test & release

- **Build**: per-package `tsc`/esbuild; root `npm run build` builds in dependency order
  (tui → ai → agent → coding-agent). Ships both a Node package and a **Bun single-file binary**.
- **Check**: `npm run check` runs Biome (lint+format, warnings are errors), pinned-deps check,
  TS-import check, shrinkwrap check, `tsgo --noEmit`, and a browser smoke test. Run after code changes.
- **Tests**: `./test.sh` from the root skips LLM/e2e tests that need real keys. The coding-agent test
  suite uses a **faux provider** harness (`test/suite/harness.ts`) — no real API calls or paid tokens.
  Interactive mode is testable headlessly via tmux (see `AGENTS.md`).
- **TypeScript constraints**: erasable-only syntax (Node strip-only mode) in checked code — no
  `enum`/`namespace`/parameter-properties; no `any` without cause; **no inline/dynamic imports**.
- **Supply-chain**: exact-pinned direct deps, `save-exact` + `min-release-age=2` in `.npmrc`,
  lockfile is ground truth (pre-commit blocks stray lockfile commits), a generated coding-agent
  **shrinkwrap** with an explicit lifecycle-script allowlist, and `npm ci --ignore-scripts` in CI.
- **Releasing**: lockstep versioning — all packages bump together; `patch` = fixes+additions,
  `minor` = breaking, no majors. A tag push triggers CI to publish to npm via OIDC trusted publishing.

---

## 8. Notable design decisions

- **Minimal core, runtime extensions.** Rather than a plugin API bolted on later, extensibility is the
  architecture: the shipped tool set is small and everything richer is a loaded `.ts` module.
- **One model API, many providers.** A compatibility layer over a couple of base protocols
  (OpenAI-completions, OpenAI-responses, Anthropic-messages, Google) covers dozens of vendors without
  bespoke clients each.
- **Same engine, three faces.** Interactive/print/RPC are thin shells over one `AgentSession`, so
  behavior stays consistent whether a human or another program is driving.
- **Sessions as immutable trees.** Append-only JSONL with parent pointers makes forking, branching,
  resume, and summarization natural and crash-safe.
- **Security is explicit, not assumed.** No built-in sandbox — pi documents containerization patterns
  (Gondolin micro-VM, Docker, OpenShell) and treats dependency changes as reviewed code.
- **Lockstep, no-major versioning.** All four packages move together; breaking changes are "minor."

---

## 9. Quick mental model

> **pi-ai** answers *"stream me a response from any model."*
> **pi-agent-core** answers *"run the tool-calling loop and remember the conversation."*
> **pi-tui** answers *"draw it in the terminal, fast."*
> **pi-coding-agent** answers *"be a coding agent"* — wiring the three together, adding the file/shell
> tools and three ways to run, and making the whole thing extensible in TypeScript at runtime.

If you only remember one thing: pi is a **thin, provider-agnostic agent loop with a tree-shaped
session log, wrapped in a minimal-core / extend-everything CLI**.

---

*Reference checkout: `reference/pi` (`earendil-works/pi-mono`). Package version `0.79.5`. This doc is
orientation only — for authoritative detail see `packages/coding-agent/docs/` and the package
`README.md`/`CHANGELOG.md` files.*
