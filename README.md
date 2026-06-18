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
| Plan 1a — **walking skeleton** | ✅ **Implemented & passing** (9 tests, offline) |
| Plan 1b — convergence loop (`verify` / `convergence` / `MarkdownTracker` / run-isolation) | ⬜ Planned (next) |
| Plan 1c — chess Oracle (perft / test-pass / fixtures) | ⬜ Planned |
| Phase 2+ — real VSDD workflow, decomposition, compare | ⬜ Designed, not planned-out |

### What works right now (Plan 1a)

A fully **offline, zero-token** vertical slice that proves the core seam end-to-end:

- **`runAgentNode`** (`carriage/src/node/agent-node.ts`) — the Agent-node adapter: runs one Pi agent
  loop and captures every event. This is Carriage's **only** Pi-touching module, behind its own
  `AgentNodeSpec → AgentNodeResult` contract — so Pi is a swappable implementation detail
  (the "depend on an interface, not a library" hedge from the spec).
- **`TraceStore`** (`carriage/src/trace/trace-store.ts`) — append-only JSONL log of every loop event,
  resumable and round-trippable.
- **CLI** (`carriage/src/cli/`) — `run --faux` runs a real agent loop through Pi's **faux** (scripted,
  in-memory) provider and writes a trace; `trace <file>` pretty-prints it.

Tested with the faux provider (model determinism) + the real filesystem — no API keys, no network.

---

## Running it

Requires [Bun](https://bun.sh). From `carriage/`:

```bash
bun install                          # installs @earendil-works/pi-agent-core + pi-ai (0.79.6)
bun test                             # 9 tests, all offline
bun run typecheck                    # tsc --noEmit, clean

bun run src/cli/index.ts run --faux  # runs a faux agent loop, writes a JSONL trace, prints the path
bun run src/cli/index.ts trace <path># pretty-prints that trace: "seq  role  type" per event
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
├── README.md                  # this file
├── carriage/                  # the Carriage tool (Bun + TypeScript)
│   ├── src/{trace,node,cli}/  # TraceStore · Agent-node adapter · CLI
│   └── test/{trace,node,cli}/ # offline, faux-provider + filesystem tests
├── docs/
│   ├── superpowers/specs/     # the approved Carriage design spec
│   ├── superpowers/plans/     # implementation plans (1a done; 1b/1c next)
│   ├── core_loops.md          # core agent-loop comparison (Codex/OpenHarness/Pi/OpenCode)
│   ├── loop_engineering_gaps.md  # the L1–L4 framing this project builds on
│   └── *_codebase.md          # codebase analyses of the four reference harnesses
└── reference/                 # external harness checkouts (gitignored): codex, opencode, pi, OpenHarness
```

---

## Design, in one breath

A `Workflow` is a **graph** of typed nodes. Only two kinds *compute*: **Agent** nodes (stochastic LLM
loops; `verify` is an Agent in a checker role) and **Oracle** nodes (deterministic measurement — perft,
tests). `convergence`, `decompose`, and edges are graph *structure*; `TraceStore` + the markdown ledger
are *substrate*. The governing correctness rule — **every convergence cycle's evidence path must include
a gating Oracle** — is what keeps "done" from being stochastic self-certification, and is the fixed
point self-improvement (D) may never weaken. See the spec for the full treatment.

---

*Reference harnesses under `reference/` are third-party checkouts (each its own git repo) kept for
study; they are gitignored and not part of this project.*
