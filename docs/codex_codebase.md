# Codex CLI — Codebase Overview

> A high-level run-down of **OpenAI's Codex CLI** (`openai/codex`), checked out under
> `reference/codex`. Written as orientation for anyone who needs to understand what the project is,
> what it does, and how its ~100 crates fit together — without reading all ~1M lines first.

---

## 1. What it is

**Codex CLI** is OpenAI's **terminal-based coding agent** — a local program (`codex`) that wraps an
OpenAI model, gives it tools (shell, file edits, web search, MCP, …), and lets it autonomously read,
modify, and run code on your machine inside OS-level sandboxes. It is the same agent that powers the
**Codex IDE extensions** (VS Code / Cursor / Windsurf), the **Codex SDKs** (Python + TypeScript), the
**desktop app**, and — via the cloud-tasks bridge — connects to **Codex Web** (the cloud agent at
chatgpt.com/codex).

The product is overwhelmingly written in **Rust** (a Cargo workspace of ~100 crates), with thin
**npm** and **SDK** wrappers on top. It authenticates either through a **ChatGPT plan** ("Sign in with
ChatGPT", OAuth) or an **API key**, and can also drive **local models** via Ollama / LM Studio.

Distinctive characteristics:

- **Sandbox-first.** Every command the model runs is classified by a policy engine and executed under a
  native OS sandbox (macOS Seatbelt, Linux Landlock/seccomp + bubblewrap, Windows restricted token),
  with a layered approval model gating anything risky.
- **One agent, many front-ends.** The core engine is exposed through a single JSON-RPC protocol
  (the "app-server"), so the TUI, IDEs, SDKs, and `codex exec` automation mode all drive the same code.
- **Extensible** via MCP servers, plugins, skills (`SKILL.md`), hooks, and compile-time extensions.

### Rough scale

| Metric | Approx. |
|--------|---------|
| Rust crates in the workspace | ~100 |
| Rust source files | ~2,260 |
| Rust LOC (workspace) | ~1.02 million |
| Biggest crates | `core` ~250k LOC · `tui` ~209k · `app-server` ~106k |
| Public SDKs | Python + TypeScript |
| Build systems | Cargo (primary) + Bazel + `just` task runner |

*(Checkout is a dev snapshot; package versions read `0.0.0-dev`. npm package: `@openai/codex`.)*

---

## 2. Repository layout

```
codex/
├── codex-rs/              # THE PRODUCT — a Cargo workspace of ~100 Rust crates
│   ├── core/              #   codex-core: the agent engine (turn loop, tools, context) — biggest crate
│   ├── tui/               #   the interactive terminal UI (ratatui)
│   ├── cli/               #   the `codex` multitool binary (clap subcommands)
│   ├── exec/              #   `codex exec` — non-interactive / automation mode
│   ├── app-server/        #   JSON-RPC server embedding core (backs IDEs + SDKs)
│   ├── app-server-protocol/ # the wire protocol (v1 legacy, v2 active) + TS type generation
│   ├── protocol/          #   the core SQ/EQ Submission-Op / Event protocol types
│   ├── execpolicy/        #   command-classification policy engine (Starlark rules)
│   ├── linux-sandbox/ · windows-sandbox-rs/ · sandboxing/ · bwrap/   # OS sandboxes
│   ├── mcp-server/ · codex-mcp/ · rmcp-client/   # MCP (Codex as server; Codex as client)
│   ├── core-plugins/ · plugin/ · core-skills/ · skills/ · hooks/ · ext/  # extensibility
│   ├── login/ · chatgpt/ · keyring-store/ · secrets/   # auth + credential storage
│   ├── model-provider*/ · models-manager/ · ollama/ · lmstudio/ · codex-api/  # model backends
│   ├── cloud-tasks*/      #   Codex Web / cloud agent bridge
│   ├── rollout*/ · thread-store/ · message-history/ · memories/  # persistence & memory
│   └── …                  #   ~60 more focused crates (utils, otel, network-proxy, login, …)
├── codex-cli/             # npm package (@openai/codex): JS shim that spawns the Rust binary
├── sdk/                   # Public SDKs: python/ and typescript/ (+ a python-runtime)
├── docs/                  # User-facing docs (config, sandbox, auth, skills, slash commands…)
├── AGENTS.md              # Contributor/agent conventions for working IN this repo
├── justfile · MODULE.bazel · Cargo (per-crate)   # build & task tooling
└── README.md
```

The **`codex-rs/` workspace is the whole product**; `codex-cli/`, `sdk/`, and the IDE/desktop apps are
distribution wrappers around the binaries it produces.

---

## 3. The central idea: SQ/EQ protocol + the turn loop

At the bottom, Codex's engine speaks an **asynchronous Submission Queue / Event Queue (SQ/EQ)**
protocol (`codex-rs/protocol/src/protocol.rs`). A client sends `Submission{ op: Op }` items in and
receives `Event{ msg: EventMsg }` items out — fully decoupled, so the model's work streams back as it
happens:

```
client ──Submission{ Op::UserTurn / Steer / Interrupt / … }──▶  ┌──────────────┐
                                                                │  codex-core  │
client ◀──Event{ EventMsg::AgentMessage / ExecOutput / … }──── │  (the engine)│
                                                                └──────────────┘
```

Inside the engine, a **session** holds one conversation **thread**, and each model invocation is a
**turn**. The turn loop (`core/src/session/turn.rs`, `run_turn()`) is the heart of the system:

```
run_turn(session, input):
  1. compact history if the context window is near full        # compact.rs / compact_remote*.rs
  2. record context deltas (permissions, env, model changes)   # context_manager/
  3. assemble injections (skills, plugins, AGENTS.md, memory)  # context fragments
  4. run lifecycle hooks (session_start, input_record, …)      # hook_runtime.rs
  loop:
    5. build prompt from history + injections + pending input
    6. stream a model request (OpenAI Responses API)           # client.rs
    7. for each tool call → dispatch (parallel) via ToolRouter # tools/router.rs, tools/parallel.rs
       → permission/sandbox gate → execute → feed result back  # guardian/, sandboxing/
    8. assistant message with no tool calls → finalize turn
  9. persist the turn to the rollout (session log)             # rollout.rs
```

**Key engine types** (mostly in `codex-core`): `ThreadManager` (spawn/fork/resume threads),
`CodexThread` (per-thread public API, `submit(op)`), `Session` / `TurnContext` (per-turn state),
`ModelClient` (Responses API streaming), `ContextManager` (history + compaction), `ToolRouter`
(tool dispatch), and `GuardianReviewSession` (approval caching).

---

## 4. Main components

### A. The agent engine — `core/` (`codex-core`, ~250k LOC)

The largest crate and the brain. Owns the turn loop above, plus:

- **Tools** (`core/src/tools/`): the built-in capabilities exposed to the model — `shell` (sandboxed
  command exec), `apply_patch` (unified-diff file edits), `unified_exec` (parallel process
  orchestration), `web_search`, `view_image`, `plan` (plan mode), `request_user_input`,
  `request_permissions`, multi-agent tools (`agent_jobs`, `multi_agents`), MCP tool/resource calls, and
  context-window controls (`get_context_remaining`, `new_context_window`). A `spec_plan` decides which
  tools to expose per turn; `ToolRouter` + `ToolCallRuntime` dispatch and run them (in parallel).
- **Context management** (`core/src/context*`): the model-visible history is built up **incrementally**
  (never rewritten, to preserve prompt-cache hits). Everything injected must be a bounded
  `ContextualUserFragment`. **Compaction** (inline summarization via the model, or remote `/responses`
  compaction) keeps long sessions under the token budget.
- **Configuration** (`core/src/config/`): layered `config.toml` (project `.codex/` + global `~/.codex/`)
  → approval policy, sandbox/permissions, model provider & reasoning effort, tools/MCP/plugins, hooks,
  feature flags. (`just write-config-schema` regenerates the JSON schema.)
- **Session persistence** (`rollout.rs`, `thread-store`, `message-history`): turns are appended to JSONL
  "rollout" files so sessions can be resumed, forked, archived, or replayed.
- Plus sandboxing integration (`safety.rs`, `landlock.rs`, `sandboxing/`), shell handling, the guardian
  approval logic, hook runtime, and analytics/timing.

> Note: `AGENTS.md` explicitly warns contributors to **resist adding code to `codex-core`** — it's
> already bloated — and to prefer new crates. That tension explains the workshop of ~100 small crates.

### B. CLI & entry points — `cli/`, `exec/`, `arg0/`, `codex-cli/`

- **`cli/`** builds the `codex` multitool. Verified top-level subcommands include: `exec`, `review`,
  `login` / `logout`, `mcp` (manage MCP servers), `mcp-server` (run Codex as an MCP server), `plugin`,
  `app-server` / `remote-control` (experimental), `app` (desktop), `sandbox` (run a command in Codex's
  sandbox), `execpolicy`, `apply` (apply the agent's last diff via `git apply`), `resume` / `fork` /
  `archive` / `unarchive` / `delete` (session management), `cloud` (Codex Web tasks), `doctor`,
  `update`, `completion`, `features`, `debug`, plus internal helpers (`responses-api-proxy`,
  `stdio-to-uds`, `exec-server`). With **no subcommand**, it launches the interactive TUI.
- **`exec/`** is `codex exec` — the **non-interactive / scripting** mode (one-shot prompt, optional
  `--json` JSONL streaming). It drives core through an in-process app-server client. This is what the
  SDKs spawn under the hood.
- **`arg0/`** enables symlink/argv[0] dispatch (e.g. invoking the binary as `apply_patch` or
  `codex-linux-sandbox` routes to the right internal entry point).
- **`codex-cli/`** is the npm package `@openai/codex`: `bin/codex.js` resolves the platform-specific
  prebuilt binary and `spawn`s it with inherited stdio + signal forwarding.

### C. Interactive UI — `tui/` (~209k LOC)

A **ratatui** terminal app. `app.rs` runs a `tokio::select!` event loop over three event sources:
terminal input (`TuiEvent`), internal app events (`AppEvent`), and **app-server events** from the
engine. It talks to core via an in-process **`AppServerSession`** (typed wrapper over the app-server v2
protocol — `thread/start`, `turn/start`, `turn/steer`, config reads, etc.).

Main pieces: **`chatwidget.rs`** renders the conversation transcript and the live in-flight turn;
**`bottom_pane/`** holds the input **composer** (`chat_composer.rs` — slash-command popup, history
recall, paste handling), the **footer** (model, token usage, rate limits, mode), and a stack of modal
overlays. **Slash commands** are an enum (`slash_command.rs`, ~60 variants like `/model`, `/review`,
`/fork`, `/permissions`) with feature-gated visibility. **Approvals** surface as an `ApprovalOverlay`
(exec / apply-patch / permission-elevation / MCP-elicitation) rendered as a selectable list; the user's
decision is sent back to core. UI styling follows `tui/styles.md` and is locked down with `insta`
snapshot tests.

### D. App-server, protocol & SDKs — `app-server*/`, `mcp-server/`, `sdk/`

The **app-server** (`app-server/`, ~106k LOC) is a **stateful JSON-RPC 2.0 server that embeds
`codex-core`** and is the universal interface to the engine. It speaks over **stdio (JSONL)**, a unix
socket, or (experimentally) websocket, and is consumed by IDE integrations, the SDKs (as a subprocess),
and **in-process by the TUI and `codex exec`**.

- **Protocol** (`app-server-protocol/`): **v1 is legacy/frozen; all new development is v2.** v2 uses
  `<resource>/<method>` naming (`thread/read`, `turn/start`, `account/login`, `model/list`,
  `config/read`, `fs/readFile`, `command/exec`, `mcpServer/*`, `plugin/*`, …), camelCase on the wire,
  cursor pagination, and **generates the TypeScript types** for the SDK from the Rust definitions.
- **mcp-server** (`mcp-server/`): exposes **Codex itself as an MCP server**, so another agent can call
  Codex as a tool (e.g. `codex/exec`, thread creation), with approval callbacks.
- **SDKs** (`sdk/python`, `sdk/typescript`): the public programmatic API. Each **spawns the `codex`
  binary** (`codex exec --experimental-json`) and exchanges JSONL over stdio. They offer
  `startThread` / `resumeThread`, `thread.run()` / `runStreamed()`, structured output via JSON Schema,
  image inputs, and login helpers — reusing existing Codex auth.

### E. Sandboxing, execution & safety — `execpolicy/`, `*-sandbox*/`, `sandboxing/`, `exec*/`, `network-proxy/`

Codex's signature safety system (see §5 for the model). Components:

- **`execpolicy/`** — a **command-classification engine** using Starlark `prefix_rule(...)` rules that
  return `allow` / `prompt` / `forbidden` (with a legacy AST engine in `execpolicy-legacy/`). Unmatched
  commands fall through to safelist/dangerous-pattern heuristics.
- **OS sandboxes** — `sandboxing/` selects a `SandboxType` per platform: **macOS Seatbelt**
  (`/usr/bin/sandbox-exec` + `.sbpl` policy), **Linux** bubblewrap (`bwrap/`) + namespaces + seccomp,
  with a legacy **Landlock** fallback (`linux-sandbox/`), and **Windows** restricted token + ACLs +
  Windows Filtering Platform (`windows-sandbox-rs/`). All apply layered read-only/writable filesystem
  roots with protected subpaths (`.git`, `.codex`).
- **Network** — `network-proxy/` runs a local HTTP/SOCKS proxy enforcing domain + method allow/deny;
  inside sandboxes network is unshared and bridged through it. The `CODEX_SANDBOX_NETWORK_DISABLED` /
  `CODEX_SANDBOX` env vars signal sandbox state (and gate tests).
- **`exec/` vs `exec-server/`** — `codex exec` is a single-turn CLI wrapper; `exec-server/` is a
  long-lived JSON-RPC service managing multiple processes + filesystem RPC for IDEs/persistent agents.
  Both share the same approval + sandbox machinery.

### F. Extensibility — MCP, plugins, skills, hooks, extensions

- **MCP client** (`codex-mcp/`, `rmcp-client/`, `core/src/mcp*.rs`): connects to external MCP servers,
  discovers their tools/resources, and exposes them to the model (with an exposure threshold and OAuth
  flows). `codex-mcp/src/mcp_connection_manager.rs` is the canonical place for MCP tool mutation.
- **Plugins** (`core-plugins/`, `plugin/`): versioned, marketplace-managed packages declared by a TOML
  manifest that can contribute **MCP servers, skills, hooks, and apps/connectors**.
- **Skills** (`core-skills/`, `skills/`, `ext/skills/`): **Anthropic-compatible `SKILL.md`** markdown
  (YAML frontmatter + body), discovered from user/repo/system/plugin roots, optionally with
  tool-dependency and implicit-invocation metadata; user-invocable skills become slash commands.
- **Hooks** (`hooks/`, `core/src/hook_runtime.rs`): event handlers fired at lifecycle points
  (`SessionStart`, `UserPromptSubmit`, `TurnStart/Stop`, `PreToolUse`/`PostToolUse`,
  `PermissionRequest`, `PreCompact`/`PostCompact`, `SubagentStart/Stop`, …). Handler kinds: inject a
  **prompt**, run a **command**, or spawn an **agent**.
- **Extensions** (`ext/`): compile-time Rust modules implementing contributor traits
  (`McpServerContributor`, `ContextContributor`, `ToolContributor`, `ThreadLifecycleContributor`, …)
  wired into an `ExtensionRegistry`. Bundled ones: **goal** (objective tracking), **guardian** (defense
  subagents), **image-generation**, **memories**, **web-search**, **skills**.

### G. Auth, model providers & cloud — `login/`, `chatgpt/`, `model-provider*/`, `cloud-tasks*/`

- **Auth** (`login/`, `chatgpt/`): "**Sign in with ChatGPT**" runs a PKCE OAuth flow against
  `auth.openai.com` via a short-lived localhost callback server, extracting plan/email from the JWT and
  auto-refreshing tokens; **API-key** and **AWS Bedrock** auth are also supported. Credentials are
  stored in the **OS keyring** (`keyring-store/`, with a file `auth.json` fallback) and scoped secrets
  live in `secrets/`.
- **Model providers** (`model-provider*/`, `models-manager/`, `codex-api/`): the default backend is the
  **OpenAI Responses API**; **Bedrock**, **Ollama**, and **LM Studio** (local `gpt-oss` models) are
  also supported behind a `ModelProvider` trait. `responses-api-proxy/` is an internal local proxy that
  forwards `/v1/responses` (reading the auth header from stdin to avoid leaking it on the CLI).
- **Cloud tasks** (`cloud-tasks*/`): `codex cloud …` browses, inspects, and **applies diffs** from
  **Codex Web** (the cloud agent) against your local tree, talking to `chatgpt.com/backend-api` via the
  active auth. A mock backend exists for testing.

### H. Memory & context persistence — `memories/`, `rollout*/`, `core/src/agents_md.rs`

- **AGENTS.md**: discovered hierarchically from the project root down to cwd and concatenated into the
  model's instructions (with `AGENTS.override.md` taking precedence).
- **Memories** (`memories/`, `ext/memories/`): a two-phase pipeline that extracts structured learnings
  from past (idle) rollouts and consolidates them globally (git-tracked `raw_memories.md` +
  per-rollout summaries), refined by an internal consolidation subagent.
- **Rollouts** (`rollout/`, `rollout-trace/`, `thread-store/`): the durable session log enabling resume,
  fork, truncation, and trace replay (`codex debug trace-reduce`).

---

## 5. The approval & sandbox model

This is Codex's defining safety design — **two orthogonal axes** gating every command:

**Approval policy** (when to ask the human — `AskForApproval`):

| Mode | Behavior |
|------|----------|
| `untrusted` | Auto-run only known-safe read-only commands; ask for everything else. |
| `on-request` (default) | Model requests approval per command as needed. |
| `on-failure` (deprecated) | Run sandboxed; on sandbox failure, ask to retry unsandboxed. |
| `never` | No prompts — auto-run if safe/sandboxable, otherwise refuse (automation/CI). |
| `granular` (experimental) | Independent toggles for exec/rules/skills/permissions/MCP elicitation. |

**Sandbox mode** (what the filesystem allows — `SandboxMode`):

| Mode | Filesystem |
|------|-----------|
| `read-only` (default) | No writes. |
| `workspace-write` | Writes confined to the project root (protecting `.git`, `.codex`). |
| `danger-full-access` | No sandbox — explicit user opt-out. |

A command is first classified by **execpolicy** (allow/prompt/forbidden), then the approval policy
decides whether to prompt, and finally the OS sandbox enforces filesystem/network limits at runtime —
**defense in depth**. Organizations can pin allowed policies/modes via config requirements.

---

## 6. How a request flows end-to-end

```
You type a prompt
  → TUI / IDE / SDK / `codex exec`
  → app-server JSON-RPC (turn/start)            # app-server-protocol v2
  → codex-core: ThreadManager → Session         # SQ: Submission{ Op::UserTurn }
  → run_turn() loop:
       → ModelClient.stream() ── OpenAI Responses API
       ── tool_use ──▶ ToolRouter
             → execpolicy classify → approval gate (Guardian) → OS sandbox
             → shell / apply_patch / web_search / MCP / …
       ◀── tool results fed back into the loop ──┘
  → EventMsg stream (AgentMessage, ExecOutput, …)   # EQ
  → rendered live in the UI; turn appended to the rollout log
```

The same path serves every front-end because they all enter through the app-server protocol.

---

## 7. Build & tooling

- **Cargo workspace** (`codex-rs/Cargo.toml`, Rust edition 2024) is the primary build; crates are named
  `codex-*` (the `core/` folder is crate `codex-core`).
- **Bazel** (`MODULE.bazel`, `defs.bzl`) provides hermetic builds and custom lints (e.g.
  `just argument-comment-lint`); the Cargo and Bazel lockfiles are kept in sync.
- **`just`** is the task runner: `just fmt`, `just test -p <crate>`, `just fix -p <crate>`,
  `just write-config-schema`, `just write-app-server-schema`, `just bench`.
- **Testing**: heavy use of integration tests in `core/suite` (with a `test_codex` harness and
  `responses` SSE mocking), `insta` snapshot tests for the TUI, and `pretty_assertions` for diffs.
- `AGENTS.md` encodes the house rules: keep modules <500 LoC, keep changes <800 lines, prefer new
  crates over growing `codex-core`, never touch the `CODEX_SANDBOX_*` env vars, and use native RPITIT
  trait methods over `#[async_trait]`.

---

## 8. Notable design decisions

1. **Sandbox-first execution.** Safety isn't bolted on — execpolicy + per-OS sandboxes + a network
   proxy + a layered approval model gate every command, and sensitive controls can't be re-enabled
   from settings.
2. **One protocol, many front-ends.** TUI, IDEs, SDKs, and `codex exec` all drive core through the
   app-server protocol, so behavior stays consistent and new clients are cheap.
3. **Async SQ/EQ core.** A submission-queue/event-queue split makes the engine fully streaming and lets
   clients steer or interrupt a turn mid-flight.
4. **Incremental, bounded context.** History is built up (never rewritten) to protect prompt-cache
   hits; every injected fragment is a typed, size-capped `ContextualUserFragment`; two-tier compaction
   (inline + remote) sustains long sessions.
5. **Crate proliferation on purpose.** `codex-core` is deliberately kept from absorbing new features;
   ~100 focused crates keep build/compile/dependency surfaces small.
6. **Format compatibility as a feature.** Reuses ecosystem conventions — `AGENTS.md`, MCP, and
   Anthropic-compatible `SKILL.md` skills — so existing tooling ports over.
7. **Local + cloud + bring-your-own-model.** ChatGPT-plan auth, API keys, Bedrock, and local Ollama/LM
   Studio all sit behind one provider abstraction; the cloud-tasks bridge ties the CLI to Codex Web.

---

## 9. Quick mental model

> **`codex`** = an OpenAI coding agent that runs locally, in Rust, behind OS sandboxes.
> **`codex-core`** = the engine: a streaming SQ/EQ turn loop that calls the model, runs sandboxed tools,
> and manages context.
> **The app-server** = one JSON-RPC interface to that engine — the TUI, the IDE extensions, the
> Python/TS SDKs, and `codex exec` are all just clients of it.
> **The rest of the ~100 crates** = the safety layer (execpolicy + sandboxes + proxy), the
> extensibility layer (MCP, plugins, skills, hooks, extensions), auth/providers, and persistence/memory
> that turn a raw model into a safe, scriptable, extensible coding agent.

---

*Source: `reference/codex` @ branch `main` (HEAD `a376781a3c`). Structure and component descriptions
reflect the code as read across the `codex-rs/` workspace; LOC/crate counts are approximate. Exact
CLI/RPC surfaces evolve quickly — treat method and subcommand lists as representative, not exhaustive.*
