# Carriage

> A code-first harness for **running and comparing loop-engineering workflows**, measured by a
> pluggable evaluation. Workflows are first-class, swappable artifacts; an eval is the common yardstick;
> every run is traced so workflows can be raced against each other — and, eventually, improved
> automatically. Built on **[Pi](https://github.com/earendil-works/pi-mono)** (`pi-agent-core` +
> `pi-ai`).

Carriage aims to implement all four levels of the LangChain "loop engineering" taxonomy *together*,
growing through four form factors over time:

- **A — Code-first library + CLI** ← *we are here*
- **B — Always-on runtime / daemon** (event-driven triggers, hosted traces)
- **C — Declarative DSL + graph interpreter** (a workflow *is* a graph; the DSL serializes it)
- **D — Self-authoring meta-tool** (read traces → edit the workflow graph → re-race)

The driving workload that proves the design: **recursively apply VSDD (Verified Spec-Driven
Development) to a vibe-coded chess engine, and measure the result** — chess gives ground-truth eval via
**perft** node counts that an LLM can't fake. VSDD is the *first* workflow, not the point.

---

## Status

| Stage | State |
|---|---|
| Design spec | ✅ Approved — `docs/superpowers/specs/2026-06-17-carriage-design.md` |
| Plan 1a — **walking skeleton** (Agent-node adapter / `TraceStore` / CLI) | ✅ **Done** |
| Plan 1b — convergence loop (`verify` / `convergence` / `MarkdownTracker` / run-isolation) | ✅ **Done** |
| Plan 1c — chess Oracle (perft node counts / command engine adapter / `converge --chess`) | ✅ **Done** |
| Correctness pass (T1–T5: Oracle invariant, verify, trace integrity, guards) | ✅ **Done** |
| Phase 2+ — real multi-phase VSDD workflow, decomposition, workflow-vs-workflow compare | ⬜ Designed, not planned-out |

**56 tests, fully offline, typecheck clean.**

### What works right now

A fully **offline, zero-token** vertical slice — an Agent loop converging against a real,
unfakeable measurement:

- **`runAgentNode`** (`carriage/src/node/agent-node.ts`) — the Agent-node adapter: runs one Pi agent
  loop and captures every event. Carriage's **only** Pi-touching module, behind its own
  `AgentNodeSpec → AgentNodeResult` contract — so Pi is a swappable implementation detail
  (the "depend on an interface, not a library" hedge from the spec).
- **`verify`** (`carriage/src/node/verify.ts`) — an Agent in a checker role, emitting a structured
  `Verdict` via a `submit_verdict` tool (exactly-one-verdict enforced).
- **`convergence` + `convergeComponent`** (`carriage/src/loop/`) — the loop: a pure `convergence()`
  that enforces the **Oracle invariant** (no "converged" without a passing *and measurable* Oracle),
  driving an iteration loop with budget, escalation, and oscillation handling.
- **`Oracle` + `ChessOracle`** (`carriage/src/eval/`) — deterministic measurement; the chess oracle
  gates convergence on **perft** node counts vs community-verified references, shelling out to an
  engine via `CommandEngineAdapter`. An LLM can't fake a perft count.
- **`TraceStore`** (`carriage/src/trace/trace-store.ts`) — append-only JSONL log of every loop event,
  resumable and round-trippable (tolerant of a partial trailing line).
- **`MarkdownTracker`** (`carriage/src/tracker/`) — a markdown ledger of per-component status.
- **`Workspace`** (`carriage/src/run/workspace.ts`) — run-isolation: each run gets a detached git
  worktree of the target at a pinned rev; dispose removes only the worktree.
- **CLI** (`carriage/src/cli/`) — `run --faux`, `converge --faux`, `converge --chess[-buggy]`,
  `trace <file>`.

Tested with Pi's **faux** (scripted, in-memory) provider + a real perft command engine + a throwaway
git fixture — no API keys, no network.

---

## Running it

Requires [Bun](https://bun.sh). From `carriage/`:

```bash
bun install                              # installs @earendil-works/pi-agent-core + pi-ai (0.79.6)
bun test                                 # 56 tests, all offline
bun run typecheck                        # tsc --noEmit, clean

bun run src/cli/index.ts run --faux      # runs a faux agent loop, writes a JSONL trace, prints the path
bun run src/cli/index.ts converge --faux # runs the full convergence loop against a stub Oracle
bun run src/cli/index.ts converge --chess        # converges a target gated by the real perft Oracle
bun run src/cli/index.ts converge --chess-buggy  # same, but the engine is wrong → escalates, never converges
bun run src/cli/index.ts trace <path>    # pretty-prints a trace: "seq  role  type" per event
```

Example trace from `run --faux` (the faux loop emits the full event sequence):

```
0   builder   agent_start
1   builder   turn_start
...
10  builder   agent_end
```

---

## Repository layout

```
.
├── README.md                   # this file
├── carriage/                   # the Carriage tool (Bun + TypeScript)
│   ├── src/
│   │   ├── node/               # Agent-node adapter · verify checker · Verdict
│   │   ├── loop/               # convergence() (Oracle invariant) · convergeComponent
│   │   ├── eval/               # Oracle interface · chess perft Oracle + engine adapters
│   │   ├── trace/              # append-only JSONL TraceStore
│   │   ├── tracker/            # markdown status ledger
│   │   ├── run/                # Workspace (git-worktree run-isolation)
│   │   └── cli/                # run / converge / trace commands
│   └── test/                   # offline tests mirroring src/ (faux provider + real fs + git fixture)
├── docs/
│   ├── superpowers/specs/      # the approved Carriage design spec
│   ├── superpowers/plans/      # implementation plans (1a / 1b / 1c — all done)
│   ├── core_loops.md           # core agent-loop comparison (Codex/OpenHarness/Pi/OpenCode)
│   ├── loop_engineering_gaps.md   # the L1–L4 framing this project builds on
│   └── *_codebase.md           # codebase analyses of the four reference harnesses
└── reference/                  # external harness checkouts (gitignored): codex, opencode, pi, OpenHarness
```

---

## Design, in one breath

A `Workflow` is a **graph** of typed nodes. Only two kinds *compute*: **Agent** nodes (stochastic LLM
loops; `verify` is an Agent in a checker role) and **Oracle** nodes (deterministic measurement — perft,
tests). `convergence`, `decompose`, and edges are graph *structure*; `TraceStore` + the markdown ledger
are *substrate*. The governing correctness rule — **every convergence cycle's evidence path must include
a gating Oracle** — is what keeps "done" from being stochastic self-certification, and is the fixed
point self-improvement (D) may never weaken. See the spec for the full treatment.

## Conventions

**Cut an interface (seam) only where a second implementation is concretely planned** — otherwise keep
it a concrete class. Carriage's tests run offline against the *real* implementations (temp files, faux
provider, fixture git repos), so testability is **not** what justifies a seam; a committed second
implementation is.

| Interface | Why it's a seam | Implementations (now → planned) |
|---|---|---|
| `Oracle` | deterministic vs. (later) stochastic measurement | `StubOracle`, `ChessOracle` → LLM-judge |
| `EngineAdapter` | one-shot CLI now; UCI / in-process later | `CommandEngineAdapter` |
| `Tracker` | markdown now; beads / SQLite later | `MarkdownTracker` |

**Concrete by design (one implementation, no committed second):** `TraceStore`, `Workspace`. Promote to
an interface only when the second backend is actually on the roadmap, not pre-emptively.

---

*Reference harnesses under `reference/` are third-party checkouts (each its own git repo) kept for
study; they are gitignored and not part of this project.*
