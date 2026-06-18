# OpenCode — Codebase Overview

> A high-level run-down of **OpenCode** (`anomalyco/opencode`, the open-source coding agent from the
> team behind SST), checked out under `reference/opencode`. Written as orientation for anyone who
> needs to understand what the project is, what it does, and how its ~26-package monorepo fits
> together — without reading all ~470k lines first.

---

## 1. What it is

**OpenCode** is an **open-source terminal AI coding agent** — a local program (`opencode`) that wraps
an LLM, gives it tools (shell, read/write/edit, grep/glob, web, LSP, …), and lets it autonomously
read, modify, and run code on your machine. It is **provider-agnostic by design** (Anthropic, OpenAI,
Google, GitHub Copilot, local models, and ~75 more via [models.dev](https://models.dev)) rather than
tied to one model vendor — that neutrality is its headline differentiator from Claude Code / Codex.

The whole project is **TypeScript running on Bun**, shipped as an MIT-licensed Bun-workspaces monorepo
of ~26 packages. The same engine powers an interactive **TUI**, a headless **HTTP server**, a **web
app**, an **Electron desktop app**, a **VS Code extension**, **SDKs**, and a cloud **sharing/console**
product. It authenticates via OAuth (Claude Pro/Max, GitHub Copilot, ChatGPT) or API keys.

Distinctive characteristics:

- **Client/server, not a monolith.** The agent runs as a local **HTTP + SSE server**; every
  surface — TUI, web, desktop, IDE, SDK — is just a client of that one API. Run it embedded (the
  default), headless (`opencode serve`), or attach a client to a remote instance.
- **Provider-neutral.** No house model. The model catalog comes from models.dev; auth, providers, and
  even new model APIs are pluggable.
- **TypeScript TUI.** The terminal UI is **SolidJS rendered through `opentui`** (a Solid-based terminal
  renderer) — the original Go/bubbletea TUI is gone; there is **zero Go** in the tree now.
- **Built on Effect.** The codebase is heavily [Effect](https://effect.website)-based (typed effects,
  layers, schema, streams) end to end — services, DI, error handling, and streaming all use it.
- **Mid-migration to "V2."** A current shipping product (`packages/opencode`, file-backed sessions)
  is being re-platformed onto an Effect/SQLite core (`packages/core` + `server` + `cli` + `llm`) that
  targets one instance running **many projects and worktrees** with durable, serialized sessions.
- **A real cloud product behind it.** Session sharing, a console/dashboard, an enterprise "Teams"
  offering, Slack/GitHub integrations, and download analytics, all deployed via SST to
  Cloudflare + AWS.

### Rough scale

| Metric | Approx. |
|--------|---------|
| Packages in the monorepo | ~26 (Bun workspaces) |
| TypeScript/TSX LOC (all `packages/*/src`) | ~470k |
| Biggest packages | `opencode` ~171k · `app` (web) ~73k · `core` ~65k · `console` ~41k · `ui` ~39k · `tui` ~32k |
| LLM providers | ~75+ via models.dev (Anthropic, OpenAI, Google, Copilot, local, …) |
| Built-in tools | ~14 (bash, read, write, edit, glob, grep, webfetch, websearch, task, todo, question, skill, lsp, patch) |
| Runtime | **Bun** (`bun@1.3.x`); single-file binaries per platform |
| Version (lockstep across published packages) | `1.17.8` |
| Default branch | `dev` |

*(npm package: `opencode-ai`. Source: `github.com/anomalyco/opencode`. LOC/counts approximate.)*

---

## 2. Repository layout

```
opencode/
├── packages/
│   ├── opencode/      # THE SHIPPING PRODUCT (~171k LOC): CLI + server + session + tools + providers
│   │   └── src/{cli,server,session,tool,provider,auth,mcp,lsp,plugin,acp,permission,skill,...}
│   ├── core/          # V2 engine (~65k, Effect): session runner, system-context, location, database
│   ├── llm/           # V2 provider layer: protocol adapters (Anthropic/OpenAI/Gemini/Bedrock) + routing
│   ├── server/        # V2 HTTP API (Effect HttpApi groups + handlers)
│   ├── cli/           # V2 CLI + daemon that launches the shared TUI
│   ├── tui/           # Shared terminal UI — SolidJS + opentui (used by both V1 binary and V2 cli)
│   ├── sdk/           # Generated JS SDK (OpenAPI → @hey-api), the client every surface uses
│   ├── plugin/        # @opencode-ai/plugin — the plugin developer API (hooks + tools + TUI slots)
│   ├── app/           # Web UI / session "share" viewer (SolidJS + Vite)
│   ├── ui/            # Shared SolidJS component library (used by app/console/desktop/web)
│   ├── desktop/       # Electron app wrapping packages/app
│   ├── web/           # opencode.ai marketing + docs site (Astro + Starlight)
│   ├── console/       # Cloud dashboard (SolidStart) + Cloudflare functions (auth, billing)
│   ├── enterprise/    # Hosted "Teams" product (SolidStart on Cloudflare)
│   ├── function/      # Cloudflare Worker API (GitHub app, webhooks, sync Durable Object)
│   ├── slack/ · stats/ · containers/      # Slack bot · download analytics · sandbox images
│   ├── effect-drizzle-sqlite/ · effect-sqlite-node/   # Effect ⇄ Drizzle/SQLite bindings (V2 storage)
│   └── http-recorder/ · script/ · storybook/          # test cassettes · build scripts · UI storybook
├── sdks/vscode/       # VS Code extension (spawns opencode, injects editor context)
├── specs/             # V2 design specs (project, session, storage, tui-package)
├── infra/ · sst.config.ts · nix/   # IaC (SST → Cloudflare + AWS) and reproducible builds
├── AGENTS.md · CONTEXT.md          # house style rules · the V2 "Session Runtime" design language
└── install · turbo.json · bunfig.toml
```

Two generations live side by side. **`packages/opencode` is what ships today**; **`packages/core` +
`server` + `cli` + `llm`** are the in-progress V2 re-platform. Everything under `app/ ui/ desktop/
web/ console/ enterprise/ function/ slack/ stats/` is the **web + cloud** layer that orbits the agent.

---

## 3. The central idea: the server is the brain, everything is a client

OpenCode's defining architectural choice is **local client/server**. The agent engine is exposed as a
**headless HTTP API with a Server-Sent-Events stream**, and *every* front-end drives it the same way:

```
                                ┌───────────────────────────────┐
  TUI (opentui/Solid) ───┐      │  opencode server              │
  Web app / Desktop  ────┼────▶ │  - Effect HttpApi (REST)      │
  VS Code / ACP / SDK ───┘      │  - /event SSE stream          │
                                │  - session · tool · provider  │
                                │    · pty · permission · mcp   │
                                └───────────────────────────────┘
```

The `opencode` binary runs that server **in-process** (in a worker thread) and points the TUI at it;
`opencode serve` runs it **headless** on `:4096`; `opencode attach <url>` points a TUI at a **remote**
one. Clients talk to it through the generated **`@opencode-ai/sdk`** and subscribe to `/event` for
live streaming. Because the SDK is generated from the server's OpenAPI spec, new clients are cheap and
behavior stays consistent across all of them.

Inside the engine, a **session** holds one conversation, and each model invocation is a **turn**. The
turn loop (V1: `packages/opencode/src/session/processor.ts`) is the heart:

```
prompt → SessionProcessor
  loop:
    1. assemble context (system prompt, AGENTS.md, history, compaction if near the window)
    2. stream a model response                         # Vercel AI SDK streamText() → delta events
    3. for each tool call → permission gate → execute  # bash/edit/read/grep/... (sequential)
    4. persist message + parts, stream events to clients over SSE
    5. assistant message with no tool calls → finalize the turn  ("stop" | "continue" | "compact")
  → snapshot files (git) so the turn can be reverted
```

Messages are modeled as **`Message` + typed `Part`s** (text, reasoning, tool call/result, file,
compaction, subtask). Sessions persist as **files on disk** with **git-based snapshots**, enabling
`revert`/`unrevert` and `share`.

---

## 4. Main components

### A. `packages/opencode` — the shipping product (~171k LOC)

The TypeScript monolith that *is* `opencode` today. Built on Bun + Effect.

- **CLI** (`src/index.ts`, `src/cli/cmd/`): a **yargs** multitool. With no subcommand it launches the
  **interactive TUI**; subcommands include `serve` (headless API), `attach`, `run` (one-shot/scripted),
  `web`, `mcp`, `acp`, `github`, `pr`, `session`, `db`, `export`/`import`, `agent`, `models`,
  `providers`, `auth`/`account`, `plugin`, `upgrade`, `stats`, `debug`.
- **Server** (`src/server/`): the central API, built on **Effect's `HttpApi`** (`@effect/platform`),
  served over `node:http` with a web-fetch handler and optional mDNS discovery. Routes are resolved
  per-request from an `x-opencode-directory` header (no ambient global instance), grouped into
  Session / File / Provider / Pty / Permission / Question / Mcp / Project / Config / Event APIs, plus
  a `/event` **SSE stream** (heartbeat + EventV2 payloads).
- **Session** (`src/session/`): the turn loop (`processor.ts`), LLM streaming bridge (`llm.ts`),
  **compaction** (token-aware summarization that preserves a recent tail), sharing, and **snapshots**
  (`src/snapshot/` — git-tracked file state for revert).
- **Tools** (`src/tool/`): `bash`/shell, `read`, `write`, `edit`, `glob`, `grep`, `webfetch`,
  `websearch`, `task` (subagents/background jobs), `todo`, `question`, `skill`, `lsp`, `patch`. Each is
  an Effect-based `Def { parameters (schema), execute(args, ctx) }`; output is size-capped per tool and
  per session.
- **Providers & auth** (`src/provider/`, `src/auth/`): wraps the **Vercel AI SDK** (`ai`) with the
  **models.dev** catalog; credentials live in `~/.config/opencode/auth.json` (OAuth + API key), with
  built-in flows for Copilot, ChatGPT/Codex, and others.
- **Permissions** (`src/permission/`): rule-based `allow | deny | ask` matched by glob pattern, merged
  from global config + per-agent rules; an `ask` publishes an event the client answers.

### B. Extensibility — MCP, plugins, LSP, skills, commands, agents, ACP

All inside `packages/opencode/src`:

- **MCP client** (`mcp/`): connects to external **Model Context Protocol** servers (stdio/HTTP-SSE),
  discovers their tools/resources/prompts (with OAuth), and bridges them in as opencode tools.
- **Plugins** (`plugin/`, and `@opencode-ai/plugin`): hook-based extension. A plugin exports `Hooks`
  (`event`, `config`, `auth`, `provider`, `chat.*`, `tool.*`, `permission.*`, `shell.env`, …) and can
  register **custom tools** (`tool({ description, args, execute })`) and **TUI surfaces** (dialogs,
  keybinds, routes, sounds) via the separate TUI plugin API.
- **LSP** (`lsp/`): launches language servers and exposes symbols/diagnostics to the model through the
  `lsp` tool, and for inline diagnostics after edits.
- **Skills** (`skill/`): Anthropic-style `SKILL.md` (frontmatter + body), discovered from the workspace
  and config dirs, invoked through the permission-checked `skill` tool / as slash commands.
- **Commands** (`command/`) and **Agents** (`agent/`): user-defined slash commands (templated prompts)
  and named agents. Two are built in — **build** (default, full access) and **plan** (read-only) — plus
  a **general** subagent invoked with `@general`; agents carry their own model, prompt, and permissions.
- **ACP** (`acp/`): an **Agent Client Protocol** server so editors (e.g. the VS Code extension under
  `sdks/vscode/`) can drive opencode with `initialize` / `newSession` / `prompt` / `cancel`.

### C. `packages/tui` — the terminal UI (~32k LOC, SolidJS + opentui)

The shared interactive client, consumed by both the V1 binary (in a worker thread) and the V2 `cli`.

- **Rendering**: **`@opentui/solid` + `@opentui/core`** — a SolidJS reconciler that renders reactive
  components to the terminal — with `@opentui/keymap` for keybindings. `src/app.tsx` mounts context
  providers; `src/component/` holds ~50 components; `src/routes/` has the home (session list) and
  session views.
- **State & transport**: `src/context/sdk.tsx` creates an SDK client and runs the `/event` SSE loop;
  `src/context/data.tsx` keeps a Solid store of sessions/messages/permissions that SSE events mutate,
  driving re-render. Config, themes, keymaps, and a **TUI plugin host** (`src/plugin/`) round it out.

### D. `packages/sdk` & `packages/plugin` — the developer surface

- **SDK** (`sdk/js`, ~27k LOC): the typed client. `script/build.ts` boots the server in OpenAPI mode,
  runs **`@hey-api/openapi-ts`** to generate `src/v2/gen/`, and wraps it in `createOpencodeClient(...)`
  (adds directory/workspace headers, SSE helpers). This is what the TUI, web app, and plugins import.
- **Plugin API** (`plugin/`): the published `@opencode-ai/plugin` types — server-side `Hooks`, the
  `tool()` DSL, and the `TuiPluginApi` (dialogs, keymap layers, routes, key-value store, attention).

### E. `packages/core` + `server` + `cli` + `llm` — the V2 engine (in progress)

The Effect/SQLite re-platform (see §5). `core` owns the session runner, system-context, location
scoping, and a **Drizzle/SQLite** database; `server` is the V2 Effect `HttpApi`; `cli` is the V2 entry
+ daemon that launches the shared TUI; `llm` is a new in-house provider-protocol layer.

### F. Web & cloud — `app`, `ui`, `desktop`, `web`, `console`, `enterprise`, `function`, …

- **`app`** (web IDE / **share viewer**) and **`ui`** (shared SolidJS component library), both
  Vite + SolidJS; **`desktop`** is an **Electron** shell wrapping `app`.
- **`web`** is the Astro + Starlight marketing/docs site (opencode.ai/docs).
- **Sharing**: `opencode share` syncs a session to a cloud backend (`function`, a Cloudflare Worker
  with a sync Durable Object) and yields a short `opncd.ai` link rendered by `app`. Gated by
  `OPENCODE_DISABLE_SHARE`.
- **`console`** (SolidStart dashboard + Cloudflare functions: OpenAuth SSO, Stripe), **`enterprise`**
  (hosted Teams), **`slack`** (bot), and **`stats`** (download analytics → AWS S3 Tables/Athena) make
  up the rest of the hosted offering. All deployed by **SST** (`sst.config.ts`, `infra/`) to
  Cloudflare + AWS.

---

## 5. The V1 → V2 migration (the most important context)

OpenCode is **mid-rewrite**, and you cannot read the tree without knowing this. The shipping V1
(`packages/opencode`) is a single-instance, single-directory, file-backed agent. **V2** (`core` +
`server` + `cli` + `llm`, plus `CONTEXT.md` and `specs/v2/`) re-platforms it onto Effect + SQLite with
a much more ambitious runtime. Its goals:

- **One instance, many projects & worktrees.** Sessions are *placed* at a **`Location`** (directory +
  optional workspace id). All directory-dependent services — config, tools, permissions, catalog, PTY,
  filesystem — are resolved lazily per Location via a **`LocationServiceMap`**, so sessions in
  different repos run concurrently and safely.
- **Durable, serialized session execution.** Sessions stop being in-memory. Prompts are admitted as
  **durable `session_input` rows** first; a **`SessionRunner`** drains work sequentially per session,
  coordinated by a process-global **`SessionExecution`** keyed by session id. This is the seam for a
  future **clustered** (multi-node) runtime — ownership and replay are deliberately separated.
- **System Context as an algebra.** Instead of one mutable "system prompt," V2 composes typed
  **Context Sources** (environment, date, AGENTS.md instructions, available skills, …), each with a
  stable key and pure renderers. A **Context Epoch** owns one immutable **Baseline System Context** and
  a hidden **Context Snapshot**; when a source changes, the runtime emits a durable **Mid-Conversation
  System Message** — but only at a **Safe Provider-Turn Boundary**, never pushed asynchronously.
  Compaction or a model/agent switch starts a fresh epoch (and a fresh provider-cache prefix).
  `CONTEXT.md` is the full design vocabulary for this.
- **SQLite persistence + EventV2.** State moves from JSON files to **Drizzle/SQLite** (via
  `effect-drizzle-sqlite`): sessions, inputs, messages, context epochs, and an append-only **EventV2**
  log that projectors turn into session state — giving audit, replay, and the foundation for clustering.
- **In-house LLM layer.** `packages/llm` replaces the Vercel-AI-SDK dependency with explicit
  **protocol adapters** (`anthropic-messages`, `openai-chat`/`responses`, `gemini`, `bedrock-converse`)
  behind a **route** system (endpoint + auth + protocol), exposing one `llm.stream(request)` per turn.

V1 remains the primary execution path; pieces of V2 are wired (session create/prompt/interrupt,
Location scoping, context epochs, one provider turn) while others are explicitly follow-ups (clustering,
crash recovery, plugin-defined context sources, MCP in V2). Bridges like `event-v2-bridge.ts` and a
`core/src/v1/` compat layer let the two coexist during the transition.

---

## 6. How a request flows end-to-end

```
You type a prompt
  → TUI (opentui) / web / desktop / VS Code / SDK
  → @opencode-ai/sdk  ──HTTP──▶  opencode server (Effect HttpApi)
  → SessionProcessor.process()                      # the turn loop
       → assemble context (+ compaction if near the window)
       → Vercel AI SDK streamText() ── model provider (via models.dev catalog + auth)
       ── tool call ──▶ permission gate (allow/deny/ask) ──▶ execute (bash/edit/grep/MCP/...)
       ◀── tool results fed back into the loop
  → messages/parts persisted to disk; git snapshot taken (revert-able)
  → events streamed to every client over /event (SSE)
  → (optional) `share` syncs the session to the cloud for a public opncd.ai link
```

Every front-end enters through the same server API, so a turn looks identical whether a human in the
TUI, the desktop app, an IDE over ACP, or a script over the SDK kicked it off.

---

## 7. Build, test & release

- **Runtime/build**: **Bun** (`bun@1.3.x`) with **Bun workspaces** + a shared dependency **catalog**;
  **Turborepo** (`turbo.json`) caches `typecheck`/`build`/`test`. Per-platform single-file binaries are
  produced by `packages/opencode/script/build.ts`.
- **Type-check & lint**: `bun typecheck` (run from a package dir, via `tsgo`/native TS preview, never
  bare `tsc`); **oxlint** for linting. Prettier (no semicolons, width 120).
- **Tests**: run **from a package directory** (a root guard blocks `bun test` at the repo root);
  mocks are discouraged in favor of real implementations, with **`http-recorder`** cassettes for
  deterministic HTTP replay.
- **Style** (`AGENTS.md`): keep logic in one function until it's genuinely reused; avoid `try/catch`,
  `any`, `else`, and unnecessary destructuring; prefer Bun APIs and Effect schema helpers; **no aliased
  or star imports** (use a module's exported namespace); snake_case Drizzle columns.
- **Supply chain**: `bunfig.toml` pins exact versions and enforces `minimumReleaseAge` (~3 days) to
  avoid same-day dependency releases; `trustedDependencies` and explicit `patchedDependencies` are
  enumerated.
- **Release & distribution**: GitHub Actions (`publish.yml`) bumps the lockstep version and publishes
  to **npm** (`opencode-ai`), GitHub Releases (per-platform binaries), the **VS Code marketplace**, and
  desktop installers; the `install` script and Homebrew/Scoop/Nix/AUR formulas pull from there.
  `deploy.yml` runs `sst deploy` for the cloud stack (Cloudflare + AWS). Default branch is **`dev`**.

---

## 8. Notable design decisions

1. **Local client/server.** Exposing the engine as an HTTP+SSE API (not a monolith) is the core bet —
   it makes the TUI, web, desktop, IDE, and SDK all thin, consistent clients of one surface, and makes
   "attach to a remote agent" a natural feature.
2. **Provider neutrality as the product.** No house model; the catalog is models.dev and providers/auth
   are pluggable. OpenCode's pitch is "use any model," and the architecture commits to it.
3. **TypeScript + Bun + Effect, all the way down.** A single language/runtime for engine, server, TUI,
   web, and cloud; Effect supplies the typed-effect, DI, schema, and streaming spine throughout.
4. **A SolidJS terminal UI.** Replacing the Go TUI with SolidJS-over-`opentui` means the terminal and
   web UIs share a component model and the whole product is one language.
5. **Sessions as revertable, shareable state.** File-backed history plus git snapshots give cheap
   `revert`/`unrevert`; the cloud sync turns any session into a shareable link.
6. **Re-platforming in the open.** Rather than a rewrite-in-a-corner, V2 lands incrementally beside V1
   (`core`/`server`/`cli`/`llm` + bridges), with the design language written down in `CONTEXT.md` and
   `specs/`.
7. **Format compatibility.** Reuses ecosystem conventions — `AGENTS.md` instructions, MCP servers,
   Anthropic-style `SKILL.md` skills, and ACP for editors — so existing tooling ports over.

---

## 9. Quick mental model

> **`opencode`** = an open-source, provider-agnostic coding agent that runs as a **local HTTP server**;
> the TUI, web app, desktop app, IDE extension, and SDK are all **clients** of that server.
> **`packages/opencode`** = the engine that ships today — a Bun/Effect monolith with a yargs CLI, an
> Effect `HttpApi`, a file-backed turn loop, ~14 tools, and MCP/plugin/LSP/skill extensibility.
> **`packages/core` + `server` + `cli` + `llm`** = the in-progress **V2** re-platform onto Effect +
> SQLite, aimed at one instance running **many projects/worktrees** with durable, serialized,
> cluster-ready sessions and a typed "System Context" model.
> **Everything else** (`app`, `ui`, `desktop`, `web`, `console`, `enterprise`, `function`, `stats`) =
> the web + cloud layer — the share viewer, docs, dashboard, Teams product, and analytics, deployed by
> SST to Cloudflare + AWS.

If you only remember one thing: OpenCode is a **provider-neutral coding agent built as a local
client/server in TypeScript/Bun/Effect**, with a SolidJS terminal UI and a half-finished V2 core that
turns one process into a multi-project, durable session runtime.

---

*Reference checkout: `reference/opencode` (`anomalyco/opencode`, branch `dev`, HEAD `8716c4309a`,
version `1.17.8`). This doc is orientation only — exact CLI/RPC surfaces and the V1↔V2 boundary move
quickly; treat tool, command, and route lists as representative, not exhaustive, and see `CONTEXT.md`,
`specs/`, `AGENTS.md`, and `CONTRIBUTING.md` for authoritative detail.*
