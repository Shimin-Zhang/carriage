# Loop Engineering — What These Harnesses Are Missing

> An assessment of **Codex CLI**, **OpenHarness**, **Pi**, and **OpenCode** against the "loop
> engineering" framing from two articles:
> - Addy Osmani, [*Loop Engineering*](https://addyosmani.com/blog/loop-engineering/)
> - LangChain, [*The Art of Loop Engineering*](https://www.langchain.com/blog/the-art-of-loop-engineering)
>
> Companion to `core_loops.md` (which documents the inner agent loop of each) and the four
> `*_codebase.md` overviews. Coverage claims below were spot-checked against the `reference/` checkouts;
> see "Verification notes" at the end.

---

## 0. The reframe

`core_loops.md` documented exactly one thing: **Loop 1, the agent loop**. Both articles argue that is
the *table-stakes, already-solved* part — the leverage is in the loops you wrap *around* it. The real
question is not "is the loop good," but "how far up the stack does each harness go."

Merging the two articles' taxonomies into one stack:

| Layer | What it is | Source |
|---|---|---|
| **L1 — Agent loop** | model + tools + context, iterate until done | both (the part `core_loops.md` covers) |
| **L2 — Verification loop** | grader / rubric / LLM-as-judge scores output, retries with feedback (maker ≠ checker) | both |
| **L3 — Event-driven loop** | webhooks / schedules / messages trigger runs; "always-on" | both (Addy's "Automations") |
| **L4 — Hill-climbing loop** | production traces → analysis → auto-rewrite the harness's own prompts/tools/graders | LangChain |
| **Components** | Skills, Plugins/MCP, Worktrees, Sub-agents, on-disk State/Memory | Addy |

LangChain's explicit thesis: most teams have built L1–L2; the compounding value is in **L3–L4**, where
agents are embedded into an ecosystem and continuously improve. Addy's parallel point: the leverage
moved from prompt quality to *loop architecture* — but the engineer remains the limiting factor through
verification and comprehension.

---

## 1. Coverage matrix

Legend: ✓ built-in · ◐ partial / adjacent · ✗ absent · 🔧 buildable via the extension API

| | **Codex** | **OpenHarness** | **Pi** | **OpenCode** |
|---|---|---|---|---|
| **L1** Agent loop | ✓ | ✓ | ✓ | ✓ |
| **L2** Verification (rubric / judge + retry) | ◐ `review` cmd + guardian ext | ◐ autopilot test-gates + repair loop | ✗ (sub-agent verify = example only) | ◐ plan/build agent split + PR-review prompting |
| **L3** Event-driven (cron / triggers) | ✗ in CLI (cloud app only) | ✓✓ cron tools + scheduler + `remote_trigger` + ohmo daemon | ✗ (🔧 via RPC mode) | ✓ GitHub Action (webhooks + `schedule` cron + dispatch) + Slack bot |
| **L4** Hill-climbing (self-improving harness) | ✗ | ◐ autopilot evolves the *repo*, not itself | ✗ | ✗ |
| Skills / Plugins / MCP | ✓ | ✓ | ✓ | ✓ |
| Worktrees | ✓ | ✓ | ◐ | ✓ (V1 + V2 multi-worktree goal) |
| Sub-agents | ✓ agent tools + guardian | ✓ swarm (4 backends) | ✗ (🔧 example extension) | ✓ `task` tool + `@general` + agent modes |
| On-disk cross-session memory | ✓ memories pipeline | ✓ `MEMORY.md` + autodream | ✗ session-tree only | ◐ `AGENTS.md` (manual / `/init`), no pipeline |

---

## 2. What all four are missing

1. **L4 — the self-improving harness. The universal gap, and the frontier both articles point at.**
   Nothing in any of the four reads its own production traces and rewrites its prompts, tool set, or
   graders. Some accumulate *learnings* (Codex `memories`, OpenHarness `autodream`; OpenCode doesn't
   even do that — it relies on a hand-maintained `AGENTS.md`) — but that feeds the *model's context*,
   never the harness configuration. LangChain's "return arrow that reaches inside and updates the loop"
   does not exist anywhere here. OpenHarness's autopilot is closest in spirit, but it evolves the
   *target repository*, not itself.

2. **A first-class verification primitive (L2).** None ships a generic "wrap the agent in a grader,
   score against a rubric, retry with feedback" middleware. The maker/checker split is *achievable*
   via sub-agents in Codex and OpenHarness, and OpenCode's read-only **plan** agent vs. full-access
   **build** agent is a maker/checker-shaped split — but in every case it is a pattern you assemble by
   hand, not a composable quality gate around every run. Pi has nothing even adjacent in core.

3. **Nothing consumes the traces.** All four are excellent at *emitting* observability (Codex
   OpenTelemetry + rollouts, OpenHarness cost tracking, Pi JSONL session trees, OpenCode an EventV2 log
   + OpenTelemetry + SSE stream) and do nothing with it afterward. There is no eval harness and no
   trace → improvement path — the substrate L4 requires. (Telling detail: this repo, `bridle`, carries
   a `harness-eval` skill being built *around* OpenHarness — the eval layer is bolted on externally
   precisely because the harness lacks it.)

4. **The `/goal` "run-until-verified" pattern.** All four stop on *no-more-tool-calls* or *max_turns*
   (OpenCode: `agent.steps`). None can "loop until a separate model confirms the goal condition is met"
   — Addy's headline automation. It is a structural consequence of missing L2: with no grader, there is
   no verifiable stop condition to loop toward.

5. **Human-in-the-loop only exists at L1.** All approval / permission gating is at the tool-call level
   (OpenCode's rule-based `allow/deny/ask`, evaluated inside each tool's `execute`, included).
   LangChain's point — HITL checkpoints at the *verification, event, and improvement* layers — has
   nowhere to attach because those layers are mostly not there. (Pi has no permission system at all.)

---

## 3. Per-harness read

- **OpenHarness climbs highest.** The only one with a real **L3** (cron tools + a `cron_scheduler`
  service + `remote_trigger` + the ohmo chat-daemon) and a genuine **L2-flavored** gate (autopilot's
  syntax → repo-specific → full-suite gates with a bounded repair loop). Gaps: L4-proper (it improves
  repos, not itself) and a *generic* rubric/judge verifier rather than test-only gates.

- **Codex** is L1 + strong memory + sub-agents + a `review`/guardian flavor of L2 — but **its L3 lives
  in the cloud product, not the OSS CLI** (the "Automations tab" Addy credits is server-side; the
  checked-out `codex-rs/` has no scheduler). No L4.

- **Pi is deliberately L1-only.** Sub-agents, scheduling, cross-session memory, and verification are
  absent from core *on purpose*; its thesis is "ship a tiny loop, build the outer loops yourself in
  TypeScript." It exposes `transformContext`, RPC mode, and the extension API as the *mounting points*
  for L2–L4 and expects you to supply them. The flip side: out of the box it is furthest from the
  articles' vision.

- **OpenCode reaches L3 by outsourcing it to CI.** It is the second harness here with a real,
  shipped **L3** — but instead of an in-process scheduler (OpenHarness's approach) it ships a **GitHub
  Action** (`github/action.yml`; `opencode github install` writes `.github/workflows/opencode.yml`)
  driven by `issue_comment` / `issues` / `pull_request` webhooks **and `schedule` cron + `workflow_dispatch`**
  (`github.handler.ts:148`), plus a Slack bot and a webhook cloud function. This fits its client/server,
  integration-heavy posture: the agent is a server, so "trigger it on an event" becomes someone else's
  event system. It has strong **components** (skills, MCP, plugins, `task` sub-agents + `@general`,
  worktrees), an **L2-shaped** plan/build agent split, but no grader (true L2), no memory pipeline
  (just `AGENTS.md`), and no L4. Its V2 rewrite is about scaling the loop (multi-project, durable,
  cluster-ready), not climbing the loop stack.

---

## 4. Bottom line

All four are mature **Loop-1 engines** with solid skills / MCP / sub-agent / memory plumbing (Addy's
component checklist is largely satisfied, especially by Codex, OpenHarness, and OpenCode). But the
*outer* loops the articles say actually compound value are thin to absent:

- **L3 (event-driven)** exists in two of the four — OpenHarness (in-process scheduler + tools) and
  OpenCode (outsourced to a GitHub Action: webhooks + `schedule` cron + Slack) — in opposite flavors,
  and is absent from Codex's CLI and Pi.
- **L2 (verification)** is everywhere a manual pattern (sub-agents, plan/build splits, test-gates) and
  nowhere a grader/rubric/judge primitive.
- **L4 (self-improving harness)** is missing from all four.

That last one — closing the trace → analysis → harness-update loop — is the gap the next generation of
harness work has to fill.

---

## 5. Verification notes

Claims here were checked against `reference/` (not just the overview docs), which corrected several
first-guess assumptions:

- **Pi "subagents"** appear only under `packages/coding-agent/examples/extensions/subagent/` — an
  example, not a core feature.
- **OpenHarness** genuinely ships `cron_{create,delete,list,toggle}_tool`, `task_*` tools, a
  `services/cron_scheduler.py`, and a `remote_trigger_tool` — a real L3.
- **Codex** `codex-rs/*/src` has **no** cron/scheduler (grep: 0); scheduling is a cloud-app feature.
- **Grader / rubric / LLM-as-judge**: zero matches across all four codebases (OpenCode's hits for
  "verify" are prompt text and an unrelated xAI plugin, not a grader).
- **Trace-analysis / self-improvement / hill-climbing**: zero matches across all four.
- **OpenHarness autopilot** (`autopilot/service.py`) gates on tests (`harness_gate`) and selects an
  `execution_model`, but does not modify the harness's own prompts/skills/tools.
- **OpenCode L3** is real and shipped: `github/action.yml` + `opencode github install` (writes
  `.github/workflows/opencode.yml`); `github.handler.ts:148–149` registers `issue_comment`,
  `pull_request_review_comment`, `issues`, `pull_request` *and* `schedule` + `workflow_dispatch`. A
  Slack bot (`packages/slack`) and a webhook cloud function (`packages/function`) add more triggers.
- **OpenCode L2/L4**: zero matches for grader/rubric/judge in `packages/opencode/src`; no
  cron/scheduler *inside* the CLI itself (scheduling rides on GitHub Actions); no memory-extraction
  pipeline — cross-session continuity is just `AGENTS.md` (generated/edited via `/init`). The
  read-only **plan** vs full-access **build** agents (`README`, `agent/agent.ts`) are a maker/checker
  *shape*, not a verifier.

*Source checkouts: `reference/codex`, `reference/OpenHarness`, `reference/pi`, `reference/opencode`
(`v1.17.8`). Article substance as of the June 2026 fetch. Treat the matrix as a snapshot — these
projects move quickly.*
