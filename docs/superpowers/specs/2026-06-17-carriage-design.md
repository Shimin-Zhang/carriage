# Carriage — Design Spec

> Status: **approved design**, pre-implementation. Author session: 2026-06-17.
> Companion docs: `docs/core_loops.md`, `docs/loop_engineering_gaps.md`, `docs/pi_codebase.md`.

---

## 1. Summary

**Carriage** is a code-first harness for *running and comparing loop-engineering workflows*, measured
by a pluggable evaluation. Workflows are first-class, swappable artifacts; an eval harness is the
common yardstick; every run is traced so workflows can be raced against each other and — eventually —
improved automatically.

Carriage is built on **Pi** (`pi-agent-core`, Pi's reusable agent-loop engine, independent of its
coding tools) and is designed to implement **all four levels** of the LangChain "loop engineering"
taxonomy *together*, growing through four form factors over time:

- **A — Code-first library + CLI** (this spec's build target)
- **B — Always-on runtime / daemon** (later)
- **C — Declarative DSL + engine** (later)
- **D — Self-authoring meta-tool** (later)

The driving workload that proves Carriage-A is: **recursively apply VSDD (Verified Spec-Driven
Development) to a vibe-coded chess engine, and measure the result.** VSDD is the *first* workflow, not
the point — Carriage is a general loop-engineering substrate that VSDD-on-chess validates because chess
offers **ground-truth eval** (perft node counts) that an LLM cannot fake.

### The loop-engineering levels, and how Carriage realizes them

| Level | LangChain definition | In Carriage |
|---|---|---|
| **L1** Agent loop | model + tools + context, iterate until done | `loop()` — one `pi-agent-core` session |
| **L2** Verification | grader/judge scores output, retry with feedback (maker ≠ checker) | an Agent node in *checker role* (different provider, fresh context) + the **Oracle** node (`EvalHarness`) |
| **L3** Event-driven | webhooks/schedules trigger runs; always-on | `trigger()` seam (inert in A; live in B) |
| **L4** Hill-climbing | traces → analysis → rewrite the harness's own prompts/tools/graders | `TraceStore` + `compare` + run-isolation + `Workflow`-as-artifact (substrate built in A; D is a capstone workflow) |

The central design insight: **the eval signal does double duty** — it is the convergence/stop condition
for L2 *and* the reward signal for L4. Making `EvalHarness` and `TraceStore` first-class from day one is
what makes the later levels additive layers rather than rewrites.

---

## 2. Goals & non-goals

### Goals (Carriage-A)
- A TypeScript library + thin CLI on `pi-agent-core` that runs **one workflow** over a **recursive
  component tree** of a **target repo**, measuring each component with an eval harness and persisting
  the full trace.
- Express **VSDD** as a workflow graph in Carriage's node model and run it on a chess engine's
  move-generation component to **perft-exact convergence**.
- Build with explicit, inert seams so A grows into B → C → D **without rewriting the kernel**.
- Be testable **offline-first**: the orchestration machinery against a scripted (faux) model, the eval
  harness against real perft ground truth — both with zero tokens and no network.

### Non-goals (deferred, but designed-for)
- The L3 daemon / live triggers (B).
- A declarative workflow DSL (C).
- The self-improvement loop (D) — though A deliberately builds its substrate.
- VSDD **Phase 5** (formal hardening: Kani/Dafny proofs, AFL++/libFuzzer fuzzing, mutation testing,
  Semgrep/Wycheproof security). Deferred *as a phase*; re-enters later as additional eval plugins.
- The full whole-engine decomposition tree at scale (A proves a 2-level split).
- Heavyweight tracking infra (`beads`, SQLite) — A uses markdown + JSONL behind a thin interface.

---

## 3. Background

### 3.1 VSDD (the first workflow)

VSDD is a six-phase, adversarial, verification-first methodology ([source gist](https://gist.github.com/dollspace-gay/d8d3bc3ecf4188df049d7a4726bb2a00)). Phases:

1. **Spec Crystallization** — 1a behavioral spec (pre/post, invariants, edge-case catalog); 1b
   verification architecture (Provable-Properties Catalog, Purity-Boundary Map, select formal tooling);
   1c adversarial spec-review gate.
2. **Test-First Implementation (TDD)** — 2a tests that all fail first (Red Gate); 2b minimal impl one
   failing test at a time; 2c refactor.
3. **Adversarial Refinement (VDD Roast)** — fresh-context adversary reviews spec/test/impl quality.
4. **Feedback Integration Loop** — route critiques back to the right phase; iterate until convergence.
5. **Formal Hardening** — proofs, fuzzing, mutation, security, purity audit.
6. **Convergence (Exit Signal)** — four-dimensional "Zero-Slop": spec, tests, implementation, and
   verification all survive independent adversarial review.

**Roles:** Architect (human — strategic authority), Builder (Claude — spec/test/impl), Adversary
(Sarcasmotron, a *different* model, fresh context per pass), Tracker (Chainlink/beads — hierarchical
decomposition + traceability).

**Traceability chain:** `spec requirement → verification property → bead → test → implementation →
adversarial review → formal proof`.

**Two gaps VSDD explicitly leaves open** (and Carriage fills): it does *not* specify how to apply VSDD
**recursively** or to **legacy code**.

**MVP scope of VSDD in Carriage-A: phases 1 → 2 → 3 → 4 → 6.** Phase 5 is deferred wholesale.
Convergence (Phase 6) is *kept* — it is the per-component stop condition. With Phase 5 gone, the four
convergence dimensions are satisfied as:

- **Spec / Tests / Implementation** → the Adversary (Phase 3) is quieted to nitpicks / can't name an
  untested scenario / is forced to invent problems.
- **Verification** → the **EvalHarness objective oracle** (for chess: **perft exact + tests green**)
  stands in for "formal proofs pass," until Phase-5 plugins arrive and feed *additional* signals.

Convergence is the **AND** of all four dimensions, with the human Architect as final arbiter.

### 3.2 "Recursive application" (the user's required extension)

Three senses of recursion, prioritized:

1. **Structural recursion (decomposition tree)** — *table stakes.* Decompose the engine into components
   (board-rep → move-gen → make/unmake → eval → search → UCI), run VSDD per component, recurse into
   sub-components. Convergence rolls up from leaves. Carriage orchestrates a *tree* of VSDD cycles.
2. **Iterative recursion (convergence loop)** — *necessary.* VSDD's Phase-4 feedback loop, run until the
   Phase-6 signal fires, *within* a component.
3. **Meta / self-recursion** — *eventual goal (the D phase).* Apply VSDD to Carriage's own
   workflows/prompts/graders.

A builds 1 and 2; 3 is deferred to D.

### 3.3 perft (the ground-truth oracle)

`perft(N)` exhaustively enumerates the legal-move game tree to depth N and **counts leaf nodes**. The
counts are exactly known and community-verified (startpos: 20 / 400 / 8,902 / 197,281 / 4,865,609 /
119,060,324 for depths 1–6; Kiwipete: 48 / 2,039 / 97,862 for 1–3). Any deviation is a bug — there is
no "close enough." It validates **move generation + make/unmake legality** exhaustively (and exactly),
and `perft divide` localizes a discrepancy to the offending first-move subtree, which makes Phase-4
feedback routing precise. It does **not** test evaluation quality, search, or playing strength — those
need the deferred Stockfish/ELO plugins. This is why **move-gen is the proving component**: its
correctness is objectively measurable to the node.

---

## 4. Architecture: the kernel

Carriage-A is a small kernel; VSDD and chess ride on top of it.

### 4.1 Substrate

Carriage embeds **`pi-agent-core`** (not pi-coding-agent, not Pi's RPC mode). Each agent loop is a Pi
`AgentSession`. Carriage uses Pi's hooks — `transformContext`, `beforeToolCall`, `afterToolCall`,
`shouldStopAfterTurn` — as its **instrumentation and safety seam**: every step is captured into the
trace there, graders/steering inject there, and the minimal permission layer (see §9) gates tool calls
there. Pi being provider-agnostic is what makes maker ≠ checker (Builder vs. Adversary on *different*
models) a config choice.

**System prompts and tools are entirely Carriage-authored — `pi-agent-core` ships neither a persona
nor concrete tools.** Two facts from the Pi source drive this:

- *No baked-in system prompt.* The agent state defaults `systemPrompt` to `""`
  (`packages/agent/src/agent.ts:73`); the only prompt code in core is an opt-in helper
  (`formatSkillsForSystemPrompt`). The coding-agent persona lives in `pi-coding-agent`, which we do not
  embed. So Carriage writes every system prompt — necessary anyway, since each VSDD role/phase needs a
  purpose-built prompt and the Adversary deliberately gets a different prompt + fresh context.
- *Tool execution lives in core; tool definitions do not.* The **call-execution machinery** —
  dispatch, sequential/parallel, arg validation, the `beforeToolCall`/`afterToolCall` hooks, streaming
  `onUpdate` — is in `pi-agent-core` (`agent-loop.ts`: `executeToolCalls`/`prepareToolCall`/
  `executePreparedToolCall`). The **`AgentTool` contract** is in `pi-agent-core` (`types.ts`) over a
  `pi-ai` `Tool`. But the **concrete tool definitions** (read/bash/edit/write/grep/…) live in
  `pi-coding-agent` (`src/core/tools/`). So agent-core gives us tool *execution + hooks for free*, and
  **Carriage supplies the tool *definitions*** — see the build-vs-borrow decision in §13 (current lean:
  build a minimal own set rather than depend on the coding-agent tool subtree and its TUI helpers).

**Dependency posture (fork vs. scratch vs. middle).** Three options were weighed:

- *Fork `pi-coding-agent`* (~50k LOC product) — **rejected.** Wrong grain (it's built around one
  human-driven interactive TUI session, not headless orchestration) and a permanent upstream-merge tax
  on Pi's frequent, "minor = breaking" releases.
- *Write everything from scratch* — **rejected.** The expensive part is `pi-ai`'s multi-provider + OAuth
  layer (the maker ≠ checker enabler), not the loop; from-scratch just means rebuilding it, or trading
  Pi for the Vercel AI SDK and losing Pi's hooks (our instrumentation seam).
- **The middle (chosen):** depend on `pi-agent-core` + `pi-ai` as *pinned* libraries; write only
  Carriage's thin layer.

The churn risk of that dependency is **hedged by wrapping Pi behind Carriage's own `Agent`-node
contract** (`{ role, model, context, tools, prompt, output } → { artifacts, structured, trace }`). The
workflow/graph layer depends only on that contract; a single **adapter** binds it to
`pi-agent-core` + `pi-ai`. If Pi ever becomes a liability, the adapter is swapped (vendor it, fork
*only* the ~8k-LOC agent-core, or reimplement on the Vercel AI SDK) **without touching the graph.** Pi
is an implementation detail behind the Agent node, not woven through Carriage — the same
"depend on an interface, not a library" discipline the graph model already affords.

### 4.2 The model: two node colors, graph operators, substrate

A `Workflow` is a **graph** of typed nodes wired by edges, cycles, and hierarchical expansion. Only two
things in that graph actually *compute*; the rest is structure or observation.

**Compute nodes — two colors:**

- **Agent node** (`loop`) — **L1.** A Pi agent loop, configured by `{ role, model, context-policy,
  tools, system-prompt, output-contract }`. **Stochastic** (LLM). Returns artifacts + an optional
  structured result + a turn trace. **`verify` is not a separate primitive — it is an Agent node in a
  *checker role*:** a different model, fresh/isolated context, and a structured-output contract
  (`{ findings: [{ severity, dimension, message }], perDimension }`). Maker ≠ checker is then a *graph
  property* (two Agent nodes, different models, checker's input edge = maker's output), not a function.
  Every VSDD Builder phase is likewise an Agent node with a role preset.
- **Oracle node** (`eval`) — the `EvalHarness`, interface `measure(target, component) → EvalResult`.
  **Deterministic** (not an LLM): perft, test-pass, type-check. The *only trustworthy verdicts in the
  graph*. Also enforces the Red Gate (§6). The chess plugin is one Oracle.

The **two colors — stochastic Agent vs. deterministic Oracle — are the most important distinction in
the model**, and the correctness invariant (§4.3) is built on it.

**Graph operators — structure, not compute:**

- **edges** — artifact flow + Phase-4 feedback routing (which node's output feeds which node).
- **`convergence(signals) → verdict`** — the **guard on a back-edge**; recursion sense 2 *is* this cycle.
  Subject to the Oracle invariant (§4.3, §6.3).
- **`decompose` / `recurse`** — **hierarchical expansion** (recursion sense 1): a node expands into a
  child subgraph; results roll up. **Only nodes the author marks as decomposition points may expand**
  (§4.3). The *decision how to split* is an Agent node's output; the *expansion* is structure.
- **`trigger`** — a **source node** (no inputs; injects the initial token). Inert in A; live in B (L3).

**Substrate — orthogonal to the graph:**

- **`TraceStore`** — append-only JSONL; records every node firing + edge traversal. Read by `compare`
  and (later) D.
- **`Tracker`** — a thin interface over curated memory (§5); the decomposition tree + VSDD traceability
  chain live here. `MarkdownTracker` now; `BeadsTracker`/`SqliteTracker` later, zero workflow changes.

**`Workflow` = a graph.** It is the first-class, swappable artifact; **VSDD is one graph.** Racing
patterns = running two graphs against the same Oracle.

**In A the graph stays *latent in code* — we do not build a graph engine.** A `Workflow` is a function
`(target, ctx) → Result` whose call structure *is* the graph: `convergence` is a `while`-guard,
`recurse` is code recursion. Getting the **node contract** and the **two colors** right is what lets C
serialize the same graph and D edit it. The graph *interpreter* is a **C concern**, not A's (§11).

### 4.3 Graph constraints (well-formedness lints)

Well-formed workflow graphs satisfy three constraints, each checkable **statically** (a lint over the
graph) and enforced **at runtime**. These are what make a workflow trustworthy *by construction*.

1. **Maker ≠ checker.** A checker (Agent-in-checker-role) node must use a *different model* than the
   maker node whose output it consumes, and run with fresh context. (L4 may deliberately *vary* this to
   test whether same-model checking converges worse — but only as an explicit experiment.)

2. **Oracle on every convergence cycle (the correctness invariant).** Every convergence cycle's
   *evidence path* — the nodes whose outputs feed its `convergence` guard — must contain at least one
   **gating Oracle**: a deterministic signal that is a required AND-term, so the cycle **cannot
   terminate while that oracle is failing or unmeasurable**. This forbids *stochastic
   self-certification* (a cycle that converges merely because the stochastic Adversary went quiet —
   gameable, because maker and checker LLMs share biases and their errors correlate). Full treatment in
   §6.3.

3. **Decomposition only at declared points.** `decompose` may expand a node into a subgraph *only* if
   the author marked that node as a **decomposition point**, carrying a policy `{ maxDepth, maxChildren }`.
   Two gates must both hold to fan out: (a) the node is a declared decomposition point, and (b) its
   Agent *proposes* a split at runtime. The *architectural shape* of the component tree is the
   Architect's to own, not a Builder loop's whim — and bounding it is what prevents runaway
   recursion/cost. A non-decomposition node whose Agent proposes splitting must **solve in place or
   escalate**, never silently recurse.

### 4.4 Data flow (one component)

```
Target(dir) ─▶ Workflow(VSDD)
   phase 1 spec    → loop(Builder)   ─┐
   phase 1c review → verify(Adversary)│  every step ─▶ TraceStore (JSONL)
   phase 2 TDD     → loop(Builder)    │              + Tracker (ledger.md)
   phase 3 roast   → verify(Adversary)│
   phase 4 feedback→ (route back)     │
   phase 6         → convergence(adversary + EvalHarness.measure(perft, tests))
        └─ not converged ─▶ loop again   └─ converged ─▶ roll up to parent
```

---

## 5. Memory: markdown ledger + JSONL trace

Two distinct persistence needs, deliberately separated. **No database in A.**

### 5.1 Tracker → markdown ledger (curated memory)

VSDD's own artifacts are already markdown (spec document, properties catalog, critique documents), so
markdown is the native medium, not a downgrade. Layout under the target:

```
carriage/<target>/
  ledger.md                  # component tree + status + traceability table
  move-gen/
    spec.md                  # Phase 1a/1b artifact (behavioral spec + properties catalog + purity map)
    critique-01.md           # Phase 1c / Phase 3 adversary output (fresh context each pass)
    ...
```

`ledger.md` holds the decomposition tree (nested headings) and, per component: convergence status
(`open` / `converged` / `escalated`), the spec requirements, and a traceability table
(`requirement → test → impl → last verdict`). That table *is* VSDD's traceability chain minus the
deferred formal-proof column.

### 5.2 TraceStore → JSONL (raw trace)

`carriage/<target>/traces/<runId>.jsonl`, append-only, machine-readable — the high-volume record the
compare runner and D mine. The markdown ledger is a **curated projection** of this; the JSONL is the
**source of truth for metrics**.

### 5.3 The `Tracker` seam

The workflow calls `Tracker.addComponent / linkArtifact / setStatus / openComponents()`. Only
`MarkdownTracker` exists in A. The limitation that signals graduating to beads/SQLite: convergence
roll-up makes `MarkdownTracker` *parse* the ledger to find open vs. converged components — fine for a
small tree, the bottleneck once the tree is large or D queries across many runs.

---

## 6. The VSDD workflow

### 6.1 Roles → models

- **Builder** — strong coding model (e.g., Claude). Drives all maker-role Agent nodes.
- **Adversary** — a *different* provider (e.g., Gemini/GPT), fresh context every pass. Drives all
  checker-role Agent nodes (`verify`). Independence + VSDD's "entropy resistance" fall out of a separate
  model + new context.
- **Architect** — the human, at CLI gates. HITL lives at L1 only (per `loop_engineering_gaps.md`),
  realized as approval points; `--unattended` auto-passes for batch runs.

### 6.2 Phases → nodes

| Phase | Node / operator | Role | Artifact |
|---|---|---|---|
| 1a Behavioral spec | Agent node | Builder | `spec.md` (pre/post, invariants, edge-case catalog) |
| 1b Verification arch | Agent node | Builder | Provable-Properties Catalog + Purity-Boundary Map in `spec.md` *(formal-tool binding deferred with Phase 5)* |
| 1c Spec review gate | Agent node (checker role) | Adversary | `critique-NN.md`; gate = blockers resolved |
| 2a Tests (Red) | Agent node + Oracle | Builder | failing suite; **Red Gate = Oracle confirms they fail first** |
| 2b Minimal impl | Agent node | Builder | code, one failing test at a time |
| 2c Refactor | Agent node | Builder | code, tests stay green |
| 3 Adversarial roast | Agent node (checker, fresh ctx) | Adversary | `critique-NN.md` over spec/test/impl |
| 4 Feedback routing | edges (control flow) | — | routes verdict → re-enter 1 / 2a / 2c |
| 6 Convergence | `convergence` guard | Architect arbiter | verdict from Adversary + gating Oracle |

`EvalHarness` does double duty: it **enforces the Red Gate** (2a — tests must fail before impl) *and*
supplies the Verification dimension of convergence (6).

### 6.3 The per-component convergence loop (recursion sense 2)

```
spec(1a,1b) ─▶ review(1c) ──not clean──▶ (Phase-4 route back)
     │ clean
tests(2a) ─▶ RedGate(must fail) ─▶ impl(2b) ─▶ refactor(2c)
     │
roast(3)  +  EvalHarness.measure(perft, tests)
     │
convergence? ──no──▶ Phase-4: route critique to spec/test/impl ──▶ loop
     │ yes → mark converged in ledger.md → roll up to parent
budget cap (max iters / tokens / $ / time) ──▶ escalate to Architect
```

The Adversary (an Agent-in-checker-role node) returns structured findings with severities
(`blocker / major / minor / nitpick`) and a per-dimension read, so `convergence()` thresholds it:
spec/test/impl dims = adversary quieted to nitpicks; verification dim = perft exact + tests green. AND
of all four → converged.

**The Oracle invariant governs this guard (§4.3 #2).** The verification dimension is a **gating Oracle
term**: convergence cannot fire while perft is non-exact, tests are red, or the oracle is *unmeasurable*
(harness broken). The spec/test/impl dimensions are stochastic (Adversary) and can only *withhold*
convergence, never *grant* it on their own — the Oracle is what makes "converged" mean something. Three
consequences:

- **"Can't measure ≠ converged" is now derived, not asserted.** A broken oracle yields an `unknown`
  gating term, so the cycle cannot terminate (see §9).
- **Oracle relevance.** The gating oracle must measure the *property the component claims to converge
  on*. perft is unimpeachable for **move-gen + make/unmake**, but **silent** for **eval/search** (a
  perft-perfect engine can still play badly). A component therefore **may not gate on an irrelevant
  oracle.** Components whose relevant oracle is deferred (eval/search → Stockfish/ELO plugins) **cannot
  machine-converge** their verification dimension in A; they **escalate to the Architect as a *human
  oracle*, recorded in the trace as human-certified** (so `compare`/L4 can weight it below
  perft-certified). This is the precise reason move-gen is the proving component: it owns an
  unimpeachable oracle.
- **Trust bottoms out in the oracle's spec.** Convergence means correct *relative to the oracle*, so
  oracle quality is where to invest — perft is precious because its spec (rules of chess +
  community-verified counts) is near-unimpeachable.

Parent (roll-up) convergence satisfies the invariant via an **integration-level oracle** — perft on the
assembled engine — in addition to all children being converged.

### 6.4 The two gaps Carriage fills

- **Legacy entry (vibe-coded code exists, no specs):** Phase 1a is **spec recovery *anchored to
  ground truth*** — the Builder writes the *correct* spec from the rules of chess, **not** from the
  existing impl. The vibe-coded code is then a *candidate to verify/fix under TDD*, never the source of
  truth. Code that is wrong simply fails the generated tests and gets rewritten.
- **Recursion:** the root's Phase 1 emits the component tree via `decompose()` into `ledger.md`.
  Carriage runs VSDD per component, recursing when a spec reveals sub-parts. A parent converges only
  when its children converge **and** its integration-level spec/tests/perft converge.

---

## 7. The chess `EvalHarness`

- **Signals (MVP):** `perft(depth 1..N)` exact vs. reference values on standard positions (startpos,
  Kiwipete, …); `test-pass-rate`; `red-gate` (tests fail pre-impl). Verification dimension = perft exact
  + tests green.
- **Target adapter:** how to *build + run + perft* this specific engine, supplied as config. The MVP
  assumes the engine exposes a perft entrypoint; if not, add a ~30-line perft driver.
- **Deferred (later eval plugins, same interface):** Stockfish ELO / self-play (eval & search quality),
  mutation kill-rate, fuzzing — these re-introduce the deferred Phase-5 signals as additional
  convergence dimensions.

---

## 8. Traces, run isolation, and the compare runner

### 8.1 Trace schema (`TraceStore`)

Every step is an event `{ runId, seq, ts, type, …payload }`:

| Event | Key payload |
|---|---|
| `run.started` | `workflow`, `workflowVersion`, `target`, **`targetRev` (git sha)**, `roles` (model per role), `budget` |
| `component.opened` | `componentId`, `parentId`, `path` |
| `phase.entered` | `componentId`, `iteration`, `phase` |
| `loop.completed` | `phase`, `role`, `model`, `tokensIn/out`, `cost`, `durationMs`, `sessionRef`, `artifactRefs` |
| `verify.completed` | `verdict { findings[{severity,dimension}], perDimension }` |
| `eval.measured` | `harness`, `signals[{name,value,pass,oracle}]`, `verificationConverged` |
| `convergence.evaluated` | `dims{spec,test,impl,verification}`, `converged` |
| `component.converged` / `component.escalated` | terminal per component |
| `run.finished` | `status`, `iterationsToConverge`, `totalCost`, `totalTokens`, `durationMs` |

Three field groups carry the weight: *what ran* (`workflow`+`version` on `target`+`targetRev`), *how
well* (eval signals + convergence), *how expensively* (iterations, tokens, cost, time).

### 8.2 Run isolation (the prerequisite for compare, B, and D)

Each `run` operates on its **own isolated checkout** of the target (git worktree or temp clone) so:
workflow A and B start byte-identical and cannot contaminate each other; runs are reproducible (pinned
`targetRev`); runs can go parallel without colliding. Pi already works in a directory, so Carriage hands
each run its own.

### 8.3 The compare runner (the reframe, made concrete)

`carriage compare vsdd other-wf --target ./chess --component move-gen` runs both workflows on the *same*
target rev, *same* eval harness, *same* budget, each in its own isolated checkout, then diffs their
trace-derived metrics on the common yardstick:

- **Converged?** (primary outcome) · **Quality at convergence:** perft depth-exact, test-pass-rate,
  residual adversary findings · **Cost to get there:** iterations-to-converge, tokens, $, wall-clock ·
  *(optional)* variance across seeds.

Because both runs emit the same schema against the same oracle, the comparison is apples-to-apples by
construction.

### 8.4 Human inspection (A) — no TUI

The human (Architect) needs to watch runs, inspect state, review escalations, and approve gates — but a
full TUI is a large subsystem (Pi's is ~12k LOC, opencode's ~32k) that would blow up A's scope and
contradict the "thin CLI" form factor (and the §13 decision to avoid coding-agent's TUI render helpers).
In A, the inspection need is met by three cheap surfaces instead:

- **Watch live** → **streaming structured progress to stdout** — a narrator/status line per transition
  (`component → phase → iteration → convergence dimensions`), styled like `turbo`/`cargo test` output,
  not a rendered app. Made deliberately rich (per-phase + per-convergence-dimension lines) because VSDD
  runs can be many minutes of model calls and must not be a black box.
- **Inspect state & artifacts** → **the markdown ledger (§5) + artifact files**, opened in the user's
  own editor and git-diffable. `ledger.md` (status tree + traceability) and `spec.md`/`critique-NN.md`
  *are* the curated human view — that's why they exist.
- **Interact** → **plain interactive CLI prompts** for the Architect's approval gates (`--unattended`
  to skip), `carriage trace [--follow]` to pretty-print/tail the JSONL, and the `carriage compare`
  table for results.

A real inspection UI (web dashboard or a TUI client) is deferred to **B**, where the daemon already
exposes the `TraceStore` over an API and concurrent runs make a dashboard worth its cost (see §11).

---

## 9. Error handling

Governing rule: **distinguish a *signal* from an *error*.**

- **Eval signals are not errors.** Failing tests / perft mismatch are the loop *working* — they feed
  Phase-4. Never logged as failures.
- **Eval *harness* breakage is an error.** Engine won't build, perft driver crashes/times out → we
  *cannot measure*, so we **cannot claim convergence** (verification dimension unknown). Retry with
  backoff; if persistent → escalate. **"Can't measure" must never collapse into "converged" or "tests
  failed."** This is not a special case — it *derives* from the Oracle invariant (§4.3 #2 / §6.3): an
  unmeasurable oracle is an `unknown` gating term, and a cycle cannot terminate on `unknown`.
- **Runaway decomposition is bounded by policy.** `decompose` fires only at declared decomposition
  points, each with `{ maxDepth, maxChildren }` (§4.3 #3). Hitting the bound — or an Agent proposing a
  split at a non-decomposition node — does **not** recurse; the node solves in place or escalates to the
  Architect.
- **Budgets everywhere → escalate, don't crash.** Per-component and per-run caps on
  iterations / tokens / $ / wall-clock. Hitting a cap marks the component `escalated` (records last
  verdict + best eval, surfaces to the Architect); the rest of the tree continues; a parent then cannot
  roll up to converged. Guards against the non-terminating agent loop.
- **Oscillation detection.** If adversary findings don't monotonically decrease in severity/count over
  K iterations, treat as stuck → escalate. (Structured verdicts make "blockers must strictly decrease"
  checkable.)
- **Isolation contains blast radius.** The Builder runs arbitrary code only inside the run's own
  checkout; on corruption, discard the checkout.
- **Safety at the seam.** Pi has *no* permission system, so Carriage adds a minimal `beforeToolCall`
  allowlist + directory-confinement — the L1 HITL gate.
- **Replayable.** Append-only trace ⇒ `carriage resume <runId>` rebuilds state and re-enters the
  in-progress component (component-granularity; Pi's session JSONL covers the in-flight loop). Also a B
  prerequisite.

---

## 10. Testing Carriage (offline-first)

A tool that tests code, so the test strategy is deliberately offline-first:

1. **Faux provider for the machinery.** Pi ships a `faux` provider (`packages/ai/src/providers/faux.ts`)
   — a scripted, in-memory fake LLM registered in place of a real provider, handed a queue of responses
   (`setResponses([...])` with `fauxAssistantMessage` / `fauxText` / `fauxThinking` / `fauxToolCall`),
   replayed through the same event stream the real providers emit (cost = 0, deterministic,
   `state.callCount` for assertions). Carriage's kernel tests script Builder/Adversary turns to drive
   convergence looping, Phase-4 routing, `decompose` roll-up, budget caps, escalation, and oscillation
   detection — deterministically and free.
2. **perft as a real, offline fixture.** Because perft is ground truth, `EvalHarness` is tested against
   tiny **fixture engines** — one correct, a few with seeded bugs (e.g., broken en-passant) — asserting
   perft passes/fails at the expected depth and that `divide` localizes the bug. No LLM.
3. **`convergence()` is pure** → table tests over dimension combinations.
4. **Trace round-trip** → write events, project to `ledger.md`, assert.
5. **One gated real end-to-end smoke test** → real Builder+Adversary on move-gen against a known-buggy
   fixture engine, assert convergence to perft-exact within budget. Expensive ⇒ gated/manual (like Pi's
   key-requiring e2e), not in the default suite.
6. **Real over mocked everywhere cheap** (Pi/opencode house style): real perft, real git isolation, real
   markdown/JSONL — only the *model* is faux in fast tests.

---

## 11. Growth seams: how A becomes B → C → D

Each evolution is an additive layer; the kernel does not change.

- **B (daemon):** A already treats `run` as a unit and ships an inert `trigger()`. B is a long-running
  process that makes `trigger()` live (cron/webhook/file-watch → fire runs), serves the existing
  `TraceStore`/ledger over an API, and queues isolated runs. **The real inspection UI (web dashboard or
  TUI client) lands here too** — A deliberately defers it (§8.4), since B's API + concurrent runs are
  what make a dashboard worth its cost.
- **C (DSL):** since a `Workflow` *is a graph* (§4.2), **C is just the serialized graph** — a YAML/JSON
  description of nodes + edges + guards + decomposition points that a graph *interpreter* executes. This
  is where the interpreter (deliberately not built in A) lands. VSDD-as-code and VSDD-as-YAML are the
  same graph at two surfaces, produce identical traces, and are directly comparable. The §4.3
  well-formedness lints run on the serialized graph at load time.
- **D (self-improvement):** **D is just a meta-`Workflow` that edits graphs.** It reads the `TraceStore`
  across runs (the reward signal), proposes **graph edits** (add a verify node, reroute an edge, swap a
  node's model, retune a decomposition policy), fires `compare` runs of the variant vs. baseline on a
  held-out target in isolation, and keeps the variant only if it dominates the yardstick. **The §4.3
  constraints are D's safety guardrails:** D may not produce a graph that violates the Oracle invariant
  — it **cannot weaken or remove a gating oracle to converge cheaper** (anti-reward-hacking). The oracle
  is the fixed point self-improvement is not allowed to move.

**A's four core pieces — `TraceStore`, `compare`, run-isolation, and `Workflow`-as-artifact — *are* the
L4 substrate.** Building A correctly means D is a capstone workflow rather than new infrastructure.

---

## 12. Implementation phasing

Front-load the deterministic, cheap, de-riskable parts; spend tokens only after the machinery and the
oracle are proven offline.

| Phase | Deliverable | Needs real LLM? |
|---|---|---|
| **0 — Kernel** | **Agent-node adapter over `pi-agent-core` + `pi-ai`** · `loop` / `verify` / `convergence` / `TraceStore` / `MarkdownTracker` (+`Tracker` iface) / run-isolation + CLI `run`, `trace` | No (faux) |
| **1 — Chess EvalHarness** | perft + test-pass + red-gate + target adapter, vs. fixture engines | No (ground truth) |
| **2 — VSDD workflow** | phases 1→2→3→4→6, maker≠checker, legacy spec-recovery + gated e2e | Yes |
| **3 — Recursion** | 2-level `decompose` + convergence roll-up | Yes |
| **4 — Minimal `compare`** | two workflows/variants, diff metrics | Yes |

**The first implementation plan takes Phases 0 + 1** — a coherent, fully-testable, de-risked first unit
(kernel + chess eval, both validated with zero tokens). Phase 2 (real VSDD) is the next plan.

---

## 13. Open questions (to resolve at implementation time)

- **Target engine language.** The chess engine's language determines the test-runner and perft adapter.
  The `EvalHarness` target adapter abstracts this; the first concrete target's language is TBD at plan
  time (perft is language-agnostic; only the adapter changes).
- **Concrete provider assignment** for Builder vs. Adversary (auth, cost ceilings) — config, decided at
  run time, not baked into the design.
- **Structured-output mechanism for `verify()`** — Pi's tool-forced structured output vs. a schema'd
  final message; pick during Phase 0.
- **Tool set: build vs. borrow.** `pi-agent-core` supplies tool *execution* + hooks but no concrete
  tools (those live in `pi-coding-agent`). *Borrow* = lift `coding-agent/src/core/tools/*` (reuses
  tested logic, drags helpers like `file-mutation-queue`/`truncate`/TUI `render-utils`); *build* = a
  thin own set of read/write/edit/bash/grep against the `AgentTool` contract (more code, self-contained,
  wrapped in our trace/permission hooks). **Current lean: build the handful we need**, cribbing logic
  from coding-agent where useful. Settle in Phase 0.
- **Decomposition-point declaration syntax** — how the author marks a node as a decomposition point and
  attaches `{ maxDepth, maxChildren }` (§4.3 #3). In A, a field on the node config; settle in Phase 0/3.
- **Oracle-strength / confidence scoring** — perft (exhaustive) vs. a sampled test suite vs. a
  human-oracle certification are not equally strong. How `EvalResult` records which oracle gated and how
  strongly, so `compare`/L4 can weight certifications. A records the *source* (perft / tests / human);
  a numeric strength score is deferred.
  - **LLM-judge as a `source`.** A stochastic LLM-judge is a new, weak point on this spectrum: it carries
    `source: llm-judge` + `deterministic: false`, may contribute *signals* to a `convergence` guard, but
    must **not** be the gating AND-term by itself (§4.3 #2) — a deterministic signal must remain among the
    gating terms. Allowing a judge to gate alone is a conscious, logged decision for a ground-truth-less
    domain, never a default; D may never make it (§11).
- **Resume granularity** — component-level is the A target; finer granularity deferred.

---

## 14. Glossary

- **Workflow** — a swappable loop-engineering pattern expressed as a **graph** of nodes + edges +
  guards (VSDD is the first). In A the graph is latent in code; in C it is serialized.
- **Agent node** — a compute node that is a Pi agent loop (LLM, *stochastic*). `verify` = an Agent node
  in *checker role*. Every VSDD Builder phase is an Agent node.
- **Oracle node** — a compute node that is a deterministic measurement (perft, tests, type-check). The
  only trustworthy verdicts in the graph.
- **Gating oracle** — an Oracle signal that is a required AND-term in a `convergence` guard, so the cycle
  cannot terminate while it fails or is unmeasurable.
- **Oracle invariant** — every convergence cycle's evidence path must contain a gating oracle (§4.3 #2);
  the constraint that keeps convergence from being stochastic self-certification.
- **Decomposition point** — a node the author marks as allowed to `decompose`, with a
  `{ maxDepth, maxChildren }` policy (§4.3 #3). Only such nodes may expand into a subgraph.
- **Component** — a node in the target's decomposition tree that one VSDD cycle operates on.
- **Convergence** — VSDD's four-dimensional Phase-6 stop condition; in A, spec/test/impl via the
  Adversary + verification via a gating Oracle (perft + tests).
- **EvalHarness** — the pluggable measurement interface; the common yardstick across workflows.
- **Run** — one execution of a workflow on an isolated checkout of a target at a pinned rev.
- **Maker ≠ checker** — Builder and Adversary on different models/contexts (L2).
- **Zero-Slop** — VSDD's terminal state: every artifact traces through the chain and survives the
  adversary at every gate.
