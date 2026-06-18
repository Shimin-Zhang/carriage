# OpenHarness — Codebase Overview

> A high-level run-down of the **OpenHarness** repository (`HKUDS/OpenHarness`), checked out under
> `reference/OpenHarness`. Written as orientation for anyone who needs to understand what the project
> is, what it does, and how its pieces fit together — without reading all ~50k lines first.

---

## 1. What it is

**OpenHarness** is an open-source **Python port of Claude Code** — an AI-powered, terminal-based coding
assistant. It packages the full "agent harness" that wraps a large language model and turns it into a
functional agent: tool-use, skills/knowledge, memory, permissions, and multi-agent coordination.

The project's framing is that the *model* supplies intelligence, while the *harness* supplies the
**hands, eyes, memory, and safety boundaries**:

```
Harness = Tools + Knowledge + Observation + Action + Permissions
```

It ships as two installable apps from one package (`openharness-ai`, MIT licensed, Python ≥3.10):

| Binary | What it is |
|--------|------------|
| **`oh`** / `openharness` / `openh` | The interactive CLI agent (the Claude Code-style coding assistant). |
| **`ohmo`** | A **personal AI agent** built on the OpenHarness core that lives inside chat apps (Feishu / Slack / Telegram / Discord) and autonomously writes code, runs tests, and opens PRs. |

A key selling point: both can run on an **existing Claude Code or Codex subscription** (via local
credential bridges) — no separate API key required — and it speaks to a wide range of providers
(Anthropic, OpenAI, GitHub Copilot, Moonshot/Kimi, GLM, MiniMax, NVIDIA NIM, Ollama, and any
Anthropic- or OpenAI-compatible endpoint).

**Who it's for:** researchers and builders who want to (1) understand how a production agent works
under the hood, (2) experiment with tools/skills/coordination patterns, and (3) extend or build
specialized agents on a proven architecture.

### Rough scale

| Metric | Approx. |
|--------|---------|
| Python files (`src/` + `ohmo/`) | ~249 |
| Python LOC | ~50,000 |
| Built-in tools | ~41 modules (README markets "43+") |
| Slash commands | ~54+ |
| Chat-channel integrations | 10 (Feishu, Slack, Telegram, Discord, Matrix, DingTalk, MoChat, QQ, WhatsApp, Email) |
| React/Ink frontend (TS/TSX) | 27 files |
| Test files | 103 across 29 dirs (pytest + pexpect E2E) |

---

## 2. Repository layout

```
OpenHarness/
├── src/openharness/        # The core harness library + `oh` CLI (~30 subpackages)
├── ohmo/                   # The `ohmo` personal-agent app + chat gateway daemon
├── frontend/terminal/      # React + Ink TypeScript TUI (the interactive terminal UI)
├── autopilot-dashboard/    # React + Vite web dashboard for the self-evolution kanban
├── docs/                   # Showcase + the published autopilot dashboard (GitHub Pages)
├── tests/                  # pytest suites (unit / integration), 29 dirs
├── scripts/                # install scripts + pexpect-based E2E harnesses
├── .agents/skills/         # Bundled skills shipped with the repo
├── pyproject.toml          # Package metadata; entry points: oh, ohmo, openharness
└── README.md               # Extensive product + architecture documentation
```

---

## 3. The central idea: the Agent Loop

Everything orbits one loop. The model decides **what** to do; the harness decides **how** to do it
safely and observably:

```python
while True:
    response = await api.stream(messages, tools)      # 1. ask the model (streaming)
    if response.stop_reason != "tool_use":
        break                                          # 2. no tool calls → model is done
    for tool_call in response.tool_uses:
        # permission check → PreToolUse hook → execute → PostToolUse hook → result
        result = await harness.execute_tool(tool_call) # 3. run tools (parallel if many)
    messages.append(tool_results)                      # 4. feed results back, loop again
```

In code this lives in `src/openharness/engine/`:

- **`engine/query.py`** (~1,000 lines) — `run_query()`, the actual async generator loop:
  streams the model call, preprocesses images for non-multimodal models, runs tools (sequential for
  one, `asyncio.gather` for many), checks permissions per call, aggregates tool results back into the
  message list, and handles **auto-compaction** (a cheap in-process "microcompact" plus an LLM-based
  summarization fallback) so sessions can run for a long time without blowing the context window.
- **`engine/query_engine.py`** — `QueryEngine`, the stateful owner of conversation history and the
  entry point (`submit_message()` → stream of events). Wires in the permission checker, hook executor,
  memory, and cost tracking.
- **`engine/messages.py` / `stream_events.py` / `cost_tracker.py`** — content-block models
  (`TextBlock`, `ImageBlock`, `ToolUseBlock`, `ToolResultBlock`), the streamed UI event types, and
  token/cost accounting.

End-to-end flow:

```
User prompt
  → CLI (oh) or React TUI
  → RuntimeBundle (assembles client + tools + hooks + MCP + state)
  → QueryEngine.submit_message()
  → run_query() loop
       → API client (.stream_message)  ──tool_use──▶  Tool Registry
                                                      → Permissions + Hooks
                                                      → Files / Shell / Web / MCP / Tasks
       ◀── results fed back into the loop ───────────┘
  → stream events rendered in the UI
```

---

## 4. Main components

The README describes the harness as ~10 cooperating subsystems. Grouped by role:

### A. Model integration (`api/`, `auth/`, `config/`)

- **`api/`** — A unified, streaming, provider-agnostic client layer behind one protocol
  (`SupportsStreamingMessages`). `client.py` implements the Anthropic backend; `openai_client.py`
  handles every OpenAI-compatible endpoint (converting Anthropic-style tools/messages to OpenAI
  function-calling format); `copilot_client.py` / `copilot_auth.py` handle GitHub Copilot's OAuth
  device flow; `codex_client.py` bridges a local Codex subscription. `registry.py` holds a
  ~50-entry **provider registry** that auto-detects the backend from API-key prefix or base URL.
  Built in: retry with exponential backoff, usage snapshots, multimodal-capability detection.
- **`auth/`** — Multi-provider credential management. Profiles map provider → auth source →
  stored credential (`~/.openharness/credentials/`), with support for API keys, OAuth tokens, and
  "external" bindings to existing Claude/Codex CLI credentials.
- **`config/`** — Layered settings (CLI flags → env vars → config file → defaults), provider
  **profiles** (each can carry its own key/model/base-url), permission settings, memory thresholds,
  sandbox/web/MCP/hook config, and channel schemas. Providers are modeled as named **workflows**
  (Anthropic-Compatible, OpenAI-Compatible, Claude Subscription, Codex Subscription, GitHub Copilot).

### B. The harness capabilities (`tools/`, `skills/`, `plugins/`, `hooks/`, `mcp/`, `commands/`, `memory/`)

- **`tools/`** — ~41 built-in tools, each a `BaseTool` subclass with a Pydantic input schema (so the
  model gets self-describing JSON Schema) registered in a `ToolRegistry`. Categories: file I/O
  (`read`/`write`/`edit`/`glob`/`grep`/`bash`), web (`web_fetch`, `web_search` — DuckDuckGo by
  default, SSRF-hardened), code (`lsp`, `notebook_edit`), images, plan-mode and git-worktree
  switching, background **tasks** and **cron**, **agent/team** spawning, user interaction
  (`ask_user_question`, `send_message`), and MCP adapters.
- **`skills/`** — **On-demand knowledge** as Markdown (`SKILL.md`) files with YAML frontmatter.
  Loaded lazily from bundled, user (`~/.openharness|.claude|.agents/skills/`), project, and plugin
  locations. User-invocable skills become slash commands (`/deploy staging`). **Compatible with
  `anthropics/skills`.**
- **`plugins/`** — Packaged extensions that contribute skills, slash commands, agents, Python tools,
  hooks, and MCP servers via a `plugin.json` manifest. **Compatible with Claude Code plugins**
  (tested against official ones like `commit-commands`, `code-review`, `security-guidance`).
- **`hooks/`** — Lifecycle event system: `SESSION_START/END`, `PRE_TOOL_USE`, `POST_TOOL_USE`,
  `USER_PROMPT_SUBMIT`, `PRE/POST_COMPACT`, `STOP`, etc. Four hook types — shell **command**, **HTTP**
  POST, model **prompt**, and **agent** — each with glob `matcher`, priority, and block-on-failure.
- **`mcp/`** — Model Context Protocol client. Connects to stdio, **HTTP**, and WebSocket servers,
  auto-reconnects, discovers tools/resources, and wraps each MCP tool as a normal tool
  (`mcp__<server>__<tool>`) with a Pydantic model generated on the fly from its JSON Schema.
- **`commands/`** — The slash-command registry (`/help`, `/commit`, `/plan`, `/resume`, `/compact`,
  `/memory`, `/dream`, `/cost`, `/effort`, …) — ~54+ built-ins plus dynamically generated skill
  commands.
- **`memory/`** — Persistent, structured cross-session knowledge as Markdown files with frontmatter
  (type, scope private/project/team, tags, TTL, dedup signatures), indexed by a `MEMORY.md`
  entrypoint, with search/relevance ranking and an LLM-based extraction service.

### C. Safety & governance (`permissions/`, `sandbox/`)

- **`permissions/`** — Layered, defense-in-depth checks evaluated before every tool call:
  hard-coded **sensitive-path blocks** (`.ssh`, `.aws/credentials`, `.kube/config`, the credential
  store, …) → explicit tool allow/deny → glob path rules → command-deny patterns → fall through to
  the **permission mode** (`DEFAULT` confirms mutations, `PLAN` blocks them, `FULL_AUTO`/accept-edits
  allows them).
- **`sandbox/`** — Optional Docker-based process isolation via the `srt` (sandbox-runtime) CLI,
  with computed availability checks and filesystem/network allow rules.

### D. Multi-agent coordination (`swarm/`, `coordinator/`, `tasks/`, `bridge/`)

- **`swarm/`** — The teammate-execution engine. Spawns agents across four backends —
  **subprocess**, **in-process** (asyncio tasks isolated via `ContextVar`), **tmux**, and **iTerm2** —
  with a file-based **mailbox** for async messaging, a leader↔worker **permission-sync** protocol,
  persistent **team** state, and per-agent **git worktree** isolation so parallel edits don't collide.
- **`coordinator/`** — Loads/validates **agent definitions** (from YAML: name, system prompt, allowed
  tools, model, effort, color, permission mode, isolation) and keeps an in-memory team registry with
  end-of-task notifications.
- **`tasks/`** — `BackgroundTaskManager`: spawns/monitors background shell commands and agent
  processes, captures output to log files, supports sending follow-up messages to a running task, and
  fires completion callbacks.
- **`bridge/`** — Lightweight "bridge" sessions that run OpenHarness in a child process with output
  captured to a log (used by the TUI/gateway).

### E. Autopilot / self-evolution (`autopilot/`, `autopilot-dashboard/`)

- **`autopilot/`** — A repository-automation engine: it ingests task "cards" from multiple sources
  (ohmo requests, manual ideas, GitHub issues/PRs, Claude-Code candidates), de-duplicates and scores
  them, runs them under an execution policy (model, worktree isolation, max attempts), and **verifies**
  results through gates (fast/syntax → repo-specific → full test suite) with a bounded repair loop.
- **`autopilot-dashboard/`** — A static **React 19 + Vite** web kanban that visualizes the autopilot
  pipeline (To Do / In Progress / In Review / Done) from a generated `snapshot.json`, published to
  GitHub Pages via CI.

### F. User interface (`ui/`, `frontend/`, plus `themes/`, `keybindings/`, `output_styles/`, `vim/`, `voice/`)

- **`frontend/terminal/`** — The primary interactive UI: a **React 18 + Ink** TypeScript app (run via
  `tsx`) rendering the terminal — prompt input, conversation view, tool-call display, permission
  modals, status bar, side panels (MCP/swarm/todos), full Markdown rendering.
- **`ui/`** (Python) — The backend half. `react_launcher.py` spawns the React app, which in turn
  spawns a Python **backend host** (`backend_host.py`); the two talk over a **JSON-lines protocol**
  (`OHJSON:`-prefixed events) defined in `protocol.py`. `runtime.py` assembles the `RuntimeBundle`
  (API client + engine + tools + hooks + MCP + state) shared by interactive, headless
  (`run_task_worker`), and non-interactive print modes (`app.py`). A legacy **Textual** TUI
  (`textual_app.py`) also exists as a pure-Python alternative.
- **Supporting UI modules** — `themes/` (color/border/icon schemes), `keybindings/` (configurable
  shortcuts), `output_styles/` (default/minimal/codex verbosity), `vim/` (minimal vi toggle), and
  `voice/` (speech-to-text capability detection via sox/ffmpeg/arecord).

### G. Other support (`prompts/`, `state/`, `services/`, `personalization/`)

- **`prompts/`** — Assembles the runtime system prompt from the base prompt + environment info (OS,
  shell, cwd, git status) + memory + available skills + permission-mode guidance + coordination context
  (e.g. when running as a subagent), including `CLAUDE.md` discovery/injection.
- **`state/`** — Reactive `AppState` (active model, permission mode, theme, auth status, MCP
  connection state, …).
- **`services/`** — Background infrastructure: session persistence (save/restore snapshots), a
  persistent **cron scheduler**, the **autodream**/memory-consolidation service, the compaction
  service, LSP, OAuth, and token estimation.
- **`personalization/`** — Extracts user preferences (style, testing, language/library choices) from
  sessions and injects them at session start.

---

## 5. The `ohmo` personal agent

`ohmo/` is a standalone app built on the core. Where `oh` is a terminal session you drive,
**`ohmo` is a long-lived agent you chat with**. Setup is three commands:

```bash
ohmo init             # create the ~/.ohmo workspace (soul.md, user.md, memory/)
ohmo config           # pick channels + provider
ohmo gateway start    # launch the daemon — ohmo is now live in your chat app
```

Key pieces (`ohmo/` + `ohmo/gateway/`):

- **Gateway daemon** (`gateway/service.py`) — a persistent process that wires the `ChannelManager`
  (the 10 chat platforms from `src/openharness/channels/`) to a pool of per-session runtimes, and
  persists its own state.
- **Session routing** (`gateway/router.py`) — `session_key_for_message()` isolates context by
  chat + thread + sender, so a private DM is one resumable session while a shared group keeps each
  person separate.
- **Per-session runtime** (`gateway/runtime.py`) — builds each session's system prompt from the
  workspace identity (`soul.md` = who the agent is, `user.md` = who you are) plus memory, recent work
  log, and compaction checkpoints; downloads media attachments; streams replies.
- **Workspace & memory** (`ohmo/workspace.py`, `ohmo/memory.py`, `ohmo/session_storage.py`) — an
  isolated `~/.ohmo` workspace with its own memory store and session snapshots, so the agent keeps
  long-term continuity across days.

Because the runtime ships the same tools, swarm, and worktree machinery as `oh`, an ohmo session
chatting in Feishu can **fork a git worktree, edit code, run tests via the bash tool, commit/push, and
open a PR** — all triggered from a chat message — and report back in the channel.

---

## 6. Provider & subscription support

OpenHarness treats providers as **named profiles backed by workflows** (`oh setup`,
`oh provider list/use/add`):

| Workflow | Backend examples |
|----------|------------------|
| **Anthropic-Compatible API** | Claude official, Moonshot/Kimi, Zhipu/GLM, MiniMax, internal gateways |
| **OpenAI-Compatible API** | OpenAI, OpenRouter, DashScope, DeepSeek, SiliconFlow, Groq, Gemini (compat), NVIDIA NIM, GitHub Models, **Ollama** (local) |
| **Claude Subscription** | bridges local `~/.claude/.credentials.json` |
| **Codex Subscription** | bridges local `~/.codex/auth.json` |
| **GitHub Copilot** | OAuth device-flow login, auto-refreshed tokens |

Auto-detection keys off API-key prefixes and base URLs; per-profile credentials mean
Anthropic-compatible and OpenAI-compatible endpoints don't have to share one key.

---

## 7. Testing & CI

- **Tests** — 103 pytest files across 29 directories (`pytest` + `pytest-asyncio`), covering engine,
  tools, commands, swarm, API clients, UI protocol, services, and ohmo (the largest single suite).
- **E2E** — `scripts/` holds `pexpect`-based harnesses that drive the real `oh` CLI and React TUI,
  plus Docker-sandbox and headless-rendering smoke tests.
- **CI** (`.github/workflows/ci.yml`) — runs pytest on Python 3.10 + 3.11, `ruff` lint, and a
  TypeScript `tsc --noEmit` typecheck of the frontend. A second workflow builds and deploys the
  autopilot dashboard to GitHub Pages.

---

## 8. Notable design decisions

1. **Streaming-first, async throughout** — every model call and tool execution is an async generator
   yielding UI events, keeping the interface responsive during long operations.
2. **One provider protocol, many backends** — adding a provider is a registry entry + client, not a
   change to the agent loop.
3. **Format compatibility as a feature** — deliberately reuses Claude Code conventions: `SKILL.md`
   skills, Claude-Code plugins, `CLAUDE.md`/`MEMORY.md`, and `~/.claude` / `~/.agents` discovery
   paths, so existing ecosystems port over.
4. **Defense-in-depth permissions** — sensitive paths are blocked in code and cannot be re-enabled via
   settings; everything else flows through allow/deny → path rules → command rules → mode.
5. **Graceful degradation** — tool errors and permission denials return error results rather than
   aborting the turn; the model sees the failure and adapts.
6. **Memory-aware long sessions** — two-tier auto-compaction (cheap microcompact + LLM summarization)
   plus persistent memory let sessions run for days.
7. **Isolation for parallelism** — multi-agent work uses `ContextVar`-isolated in-process tasks or
   subprocesses, file-based mailboxes, and per-agent git worktrees to avoid shared-state conflicts.

---

## 9. Quick mental model

> **`oh`** = Claude Code, re-implemented in Python, provider-agnostic, with a React/Ink TUI.
> **`ohmo`** = that same engine running as a daemon inside your chat apps, with its own memory and the
> ability to ship code (worktree → tests → PR) on your behalf.
> **The harness** = the loop in `engine/` plus the ten subsystems (tools, skills, plugins, hooks,
> permissions, MCP, memory, tasks, coordinator/swarm, prompts/config) that make a raw LLM into a safe,
> observable, extensible agent.

---

*Source: `reference/OpenHarness` @ branch `main` (package `openharness-ai` v0.1.9). Component
descriptions reflect the code as read; tool/command counts follow the README's marketing figures and
may differ by a few from the exact module count.*
