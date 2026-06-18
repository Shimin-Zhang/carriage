# Carriage 1c — Chess Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **chess perft Oracle** — a real, deterministic `Oracle` that measures a chess engine by comparing its perft node counts against known-correct reference values — and prove it **gates convergence** (a correct engine converges; a buggy one escalates), all fully offline.

**Architecture:** A `ChessOracle` implements 1b's `Oracle` interface (`measure(): Promise<OracleResult>`). It is decoupled from any engine protocol by an `EngineAdapter` seam (`perft(depth, fen) → Promise<number>`); the `ChessOracle` just compares adapter output to the reference battery and produces gating signals. A `CommandEngineAdapter` shells out (via `Bun.$`) to a configured perft command in a workspace. Tested offline with injected fake adapters (oracle logic) and tiny fixture-engine scripts (the command adapter). A `converge --chess` demo wires the `ChessOracle` into 1b's `convergeComponent` to show real perft gating the loop.

**Tech Stack:** Bun (incl. `Bun.$`), TypeScript. Builds on 1a (TraceStore, agent-node) + 1b (Oracle/StubOracle, convergeComponent, verify, MarkdownTracker, Workspace, the `converge --faux` demo).

**Spec:** `docs/superpowers/specs/2026-06-17-carriage-design.md` §7 (the chess `EvalHarness`) and §3.3 (perft) and §4.3 #2 (the Oracle invariant). **Scope:** 1c builds the **perft Oracle only**, validated against fixture engines, fully offline. *Deferred:* test-pass-rate as an additional signal (trivial follow-on); the **real file-mutating builder** and the full VSDD workflow (need real models → Phase 2); recursion/decompose (later). The current `master` HEAD is `c36a047` (1b merged).

---

## File Structure

| File | Responsibility |
|---|---|
| `carriage/src/eval/chess/perft-reference.ts` | `PerftPosition` type + `PERFT_POSITIONS` (standard positions + known-correct counts) |
| `carriage/src/eval/chess/engine-adapter.ts` | `EngineAdapter` interface (`perft(depth, fen)`) — the engine-protocol seam |
| `carriage/src/eval/chess/chess-oracle.ts` | `ChessOracle implements Oracle` — compares adapter perft to the reference, gates |
| `carriage/src/eval/chess/command-engine-adapter.ts` | `CommandEngineAdapter` — shells out to a configured perft command in a cwd |
| `carriage/src/cli/commands.ts` (modify) | `runChessConvergeDemo` (chess Oracle gating the loop over a fixture engine) |
| `carriage/src/cli/index.ts` (modify) | the `converge --chess` branch |
| tests under `carriage/test/eval/chess/` + `carriage/test/cli/cli.test.ts` | one test file per unit |

---

## Task 1: `ChessOracle` + perft reference + `EngineAdapter` seam

**Files:**
- Create: `carriage/src/eval/chess/perft-reference.ts`
- Create: `carriage/src/eval/chess/engine-adapter.ts`
- Create: `carriage/src/eval/chess/chess-oracle.ts`
- Test: `carriage/test/eval/chess/chess-oracle.test.ts`

**Context:** `ChessOracle` implements 1b's `Oracle` (`measure(): Promise<OracleResult>`, `OracleResult = { pass, signals }`, `OracleSignal = { name, pass, detail? }`). It runs perft for each (position, depth) in the reference battery via the injected `EngineAdapter`, makes a signal per check (`pass = actual === expected`), and returns `pass = every signal passes`. A perft check that *can't run* (adapter rejects) propagates out of `measure()` — which 1b's loop treats as "unmeasurable → escalate." A *wrong* count is a failing-but-measurable signal (→ loop routes back). This is the Oracle invariant in action.

- [ ] **Step 1: Write the reference + interface**

`carriage/src/eval/chess/perft-reference.ts`:
```ts
export interface PerftPosition {
  name: string
  fen: string
  /** depth → known-correct perft node count */
  counts: Record<number, number>
}

/** Standard perft positions with community-verified node counts (Chess Programming Wiki). */
export const PERFT_POSITIONS: PerftPosition[] = [
  {
    name: "startpos",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    counts: { 1: 20, 2: 400, 3: 8902, 4: 197281, 5: 4865609 },
  },
  {
    name: "kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: { 1: 48, 2: 2039, 3: 97862 },
  },
]
```

`carriage/src/eval/chess/engine-adapter.ts`:
```ts
/**
 * The seam between the ChessOracle and a concrete chess engine. Decouples the Oracle from
 * any engine protocol (one-shot CLI, UCI, in-process, …). `perft` rejects if the engine
 * cannot be run/built (→ the convergence loop treats that as "unmeasurable → escalate").
 */
export interface EngineAdapter {
  perft(depth: number, fen: string): Promise<number>
}
```

- [ ] **Step 2: Write the failing test** — `carriage/test/eval/chess/chess-oracle.test.ts`:
```ts
import { test, expect } from "bun:test"
import { ChessOracle } from "../../../src/eval/chess/chess-oracle.ts"
import { PERFT_POSITIONS } from "../../../src/eval/chess/perft-reference.ts"
import type { EngineAdapter } from "../../../src/eval/chess/engine-adapter.ts"

// returns the exact reference count for any (depth, fen) it is asked about
const correctAdapter: EngineAdapter = {
  perft: (depth, fen) => {
    const position = PERFT_POSITIONS.find((p) => p.fen === fen)!
    return Promise.resolve(position.counts[depth]!)
  },
}

test("converged (pass) when every perft matches the reference", async () => {
  const result = await new ChessOracle({ adapter: correctAdapter }).measure()
  expect(result.pass).toBe(true)
  expect(result.signals.length).toBeGreaterThan(0)
  expect(result.signals.every((s) => s.pass)).toBe(true)
})

test("fails (measurable) when a perft count is wrong, with a detail explaining the mismatch", async () => {
  const buggyAdapter: EngineAdapter = {
    perft: (depth, fen) => {
      const position = PERFT_POSITIONS.find((p) => p.fen === fen)!
      const truth = position.counts[depth]!
      // corrupt exactly one check: kiwipete depth 2
      if (position.name === "kiwipete" && depth === 2) return Promise.resolve(truth + 1)
      return Promise.resolve(truth)
    },
  }
  const result = await new ChessOracle({ adapter: buggyAdapter }).measure()
  expect(result.pass).toBe(false)
  const bad = result.signals.find((s) => !s.pass)!
  expect(bad.name).toContain("kiwipete")
  expect(bad.detail).toContain("expected 2039")
})

test("measure() rejects (unmeasurable) when the adapter cannot run perft", async () => {
  const brokenAdapter: EngineAdapter = {
    perft: () => Promise.reject(new Error("engine build failed")),
  }
  await expect(new ChessOracle({ adapter: brokenAdapter }).measure()).rejects.toThrow("engine build failed")
})

test("maxDepth limits which depths are checked", async () => {
  const result = await new ChessOracle({ adapter: correctAdapter, maxDepth: 1 }).measure()
  expect(result.signals.every((s) => s.name.endsWith("d1"))).toBe(true)
})

test("positions option restricts the battery", async () => {
  const startpos = PERFT_POSITIONS.filter((p) => p.name === "startpos")
  const result = await new ChessOracle({ adapter: correctAdapter, positions: startpos, maxDepth: 2 }).measure()
  expect(result.signals.map((s) => s.name)).toEqual(["perft startpos d1", "perft startpos d2"])
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/eval/chess/chess-oracle.test.ts`
Expected: FAIL — cannot find module `../../../src/eval/chess/chess-oracle.ts`.

- [ ] **Step 4: Write `carriage/src/eval/chess/chess-oracle.ts`**
```ts
import type { Oracle, OracleResult, OracleSignal } from "../oracle.ts"
import type { EngineAdapter } from "./engine-adapter.ts"
import { PERFT_POSITIONS, type PerftPosition } from "./perft-reference.ts"

export interface ChessOracleOptions {
  adapter: EngineAdapter
  /** Which positions to check (default: the full reference battery). */
  positions?: PerftPosition[]
  /** Skip any reference depth greater than this (default: no limit). */
  maxDepth?: number
}

/**
 * Real perft Oracle (spec §7). Each (position, depth) in the reference battery becomes a gating
 * signal: pass iff the engine's perft equals the community-verified count. `measure()` rejects if
 * the engine can't run (unmeasurable → the loop escalates, per the Oracle invariant §4.3 #2).
 */
export class ChessOracle implements Oracle {
  constructor(private readonly options: ChessOracleOptions) {}

  async measure(): Promise<OracleResult> {
    const positions = this.options.positions ?? PERFT_POSITIONS
    const signals: OracleSignal[] = []

    for (const position of positions) {
      for (const depth of depthsFor(position, this.options.maxDepth)) {
        const expected = position.counts[depth]!
        const actual = await this.options.adapter.perft(depth, position.fen)
        signals.push({
          name: `perft ${position.name} d${depth}`,
          pass: actual === expected,
          detail: actual === expected ? undefined : `expected ${expected}, got ${actual}`,
        })
      }
    }

    return { pass: signals.every((signal) => signal.pass), signals }
  }
}

function depthsFor(position: PerftPosition, maxDepth: number | undefined): number[] {
  return Object.keys(position.counts)
    .map(Number)
    .filter((depth) => maxDepth === undefined || depth <= maxDepth)
    .sort((a, b) => a - b)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/eval/chess/chess-oracle.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun run typecheck`
Expected: clean (exit 0, no output).

- [ ] **Step 7: Commit**
```bash
git add carriage/src/eval/chess/perft-reference.ts carriage/src/eval/chess/engine-adapter.ts carriage/src/eval/chess/chess-oracle.ts carriage/test/eval/chess/chess-oracle.test.ts
git commit -m "feat(carriage): ChessOracle gating convergence on perft vs reference counts"
```

(End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.)

---

## Task 2: `CommandEngineAdapter` (shell out to a perft command)

**Files:**
- Create: `carriage/src/eval/chess/command-engine-adapter.ts`
- Test: `carriage/test/eval/chess/command-engine-adapter.test.ts`

**Context:** the concrete adapter that runs a real engine. It executes a configured perft command (argv) in a working directory via `Bun.$`, parses the node count from stdout, and rejects on a non-numeric result or a non-zero exit (engine crash → unmeasurable). Tested against tiny throwaway "engine" scripts (a correct one, a buggy one, a crashing one) — these stand in for a real engine for the purpose of validating *invocation + parsing + error propagation* (a genuine perft implementation is the Phase-2 target, not part of 1c).

- [ ] **Step 1: Write the failing test** — `carriage/test/eval/chess/command-engine-adapter.test.ts`:
```ts
import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { CommandEngineAdapter } from "../../../src/eval/chess/command-engine-adapter.ts"
import { ChessOracle } from "../../../src/eval/chess/chess-oracle.ts"
import { PERFT_POSITIONS } from "../../../src/eval/chess/perft-reference.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

const STARTPOS = PERFT_POSITIONS.find((p) => p.name === "startpos")!.fen

// A throwaway "engine": prints a perft count for startpos depths 1-3 from a hardcoded table.
// `mode` selects correct / buggy (depth-3 off by two) / crash (always non-zero exit).
function engineScript(mode: "correct" | "buggy" | "crash"): string {
  return `
const depth = process.argv[3]
if (${JSON.stringify(mode)} === "crash") process.exit(1)
const table = { "1": 20, "2": 400, "3": ${mode === "buggy" ? 8900 : 8902} }
const n = table[depth]
if (n === undefined) process.exit(3)
console.log(n)
`
}

async function writeEngine(mode: "correct" | "buggy" | "crash"): Promise<string> {
  const dir = join(tmpdir(), `carriage-engine-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "engine.ts"), engineScript(mode))
  return dir
}

function adapterFor(dir: string): CommandEngineAdapter {
  return new CommandEngineAdapter({
    cwd: dir,
    perftCommand: (depth, fen) => ["bun", "run", join(dir, "engine.ts"), "perft", String(depth), fen],
  })
}

test("perft() runs the engine command and parses the node count", async () => {
  const adapter = adapterFor(await writeEngine("correct"))
  expect(await adapter.perft(3, STARTPOS)).toBe(8902)
})

test("perft() rejects when the engine exits non-zero (unmeasurable)", async () => {
  const adapter = adapterFor(await writeEngine("crash"))
  await expect(adapter.perft(3, STARTPOS)).rejects.toThrow()
})

test("ChessOracle over a correct engine passes; over a buggy engine fails", async () => {
  const startposOnly = PERFT_POSITIONS.filter((p) => p.name === "startpos")

  const good = new ChessOracle({ adapter: adapterFor(await writeEngine("correct")), positions: startposOnly, maxDepth: 3 })
  expect((await good.measure()).pass).toBe(true)

  const bad = new ChessOracle({ adapter: adapterFor(await writeEngine("buggy")), positions: startposOnly, maxDepth: 3 })
  const badResult = await bad.measure()
  expect(badResult.pass).toBe(false)
  expect(badResult.signals.find((s) => !s.pass)!.name).toBe("perft startpos d3")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/eval/chess/command-engine-adapter.test.ts`
Expected: FAIL — cannot find module `../../../src/eval/chess/command-engine-adapter.ts`.

- [ ] **Step 3: Write `carriage/src/eval/chess/command-engine-adapter.ts`**
```ts
import { $ } from "bun"
import type { EngineAdapter } from "./engine-adapter.ts"

export interface CommandEngineAdapterOptions {
  /** Working directory to run the engine in (e.g. an isolated `Workspace.targetDir`). */
  cwd: string
  /** Builds the argv that prints the perft node count to stdout for a depth + FEN. */
  perftCommand: (depth: number, fen: string) => string[]
}

/** Runs a real chess engine's perft via a shell command and parses the node count. */
export class CommandEngineAdapter implements EngineAdapter {
  constructor(private readonly options: CommandEngineAdapterOptions) {}

  async perft(depth: number, fen: string): Promise<number> {
    const argv = this.options.perftCommand(depth, fen)
    // `Bun.$` throws on a non-zero exit, which becomes an "unmeasurable" rejection upstream.
    const stdout = (await $`${argv}`.cwd(this.options.cwd).text()).trim()
    const count = Number.parseInt(stdout, 10)
    if (!Number.isFinite(count)) {
      throw new Error(`engine perft did not return a number (got ${JSON.stringify(stdout)})`)
    }
    return count
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/eval/chess/command-engine-adapter.test.ts`
Expected: PASS — 3 tests passing.

**Note:** `Bun.$`'s `.cwd(path)` and array-argv interpolation (`$\`${argv}\``) were **verified working in this environment** (Bun 1.3.14), so the code above is correct as written. (Only if a future Bun version drops `.cwd()`: make `perftCommand` return absolute paths and drop `.cwd(...)` — the fixture already uses `join(dir, "engine.ts")`, so cwd isn't strictly required for it.)

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 6: Commit**
```bash
git add carriage/src/eval/chess/command-engine-adapter.ts carriage/test/eval/chess/command-engine-adapter.test.ts
git commit -m "feat(carriage): CommandEngineAdapter runs an engine perft command and parses the count"
```

---

## Task 3: `converge --chess` demo (real perft gates the loop)

**Files:**
- Modify: `carriage/src/cli/commands.ts`
- Modify: `carriage/src/cli/index.ts`
- Test: `carriage/test/cli/cli.test.ts` (add tests)

**Context:** the capstone — wire the `ChessOracle` (over a `CommandEngineAdapter` pointed at an engine inside an isolated `Workspace`) into 1b's `convergeComponent`, with a faux no-op builder + faux clean checker. A **correct** engine → perft passes → converges; a **buggy** engine → perft fails → the Oracle gates → the loop runs to budget and **escalates**. This demonstrates that *real perft*, not a stub, decides convergence. (The faux builder doesn't change the engine — a real file-mutating builder that fixes a buggy engine is Phase 2.)

- [ ] **Step 1: Write the failing test** — append to `carriage/test/cli/cli.test.ts`:
```ts
import { runChessConvergeDemo } from "../../src/cli/commands.ts"

test("runChessConvergeDemo: a correct engine converges (real perft gating)", async () => {
  const dir = join(tmpdir(), `carriage-chess-ok-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const result = await runChessConvergeDemo(dir, "correct")
  expect(result.outcome.status).toBe("converged")
})

test("runChessConvergeDemo: a buggy engine does NOT converge (perft gates, loop escalates)", async () => {
  const dir = join(tmpdir(), `carriage-chess-bad-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const result = await runChessConvergeDemo(dir, "buggy")
  expect(result.outcome.status).toBe("escalated")
})
```
(Add `import { runChessConvergeDemo } from "../../src/cli/commands.ts"` to the top of the test file with the other imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/cli/cli.test.ts`
Expected: FAIL — `runChessConvergeDemo` is not exported by `commands.ts`.

- [ ] **Step 3: Add `runChessConvergeDemo` to `carriage/src/cli/commands.ts`**

Add these imports at the top (do NOT duplicate ones already present — `$`, `mkdir`, `writeFile`, `join`, `registerFauxProvider`, `fauxAssistantMessage`, `fauxToolCall`, `runVerify`, `convergeComponent`, `Workspace`, `MarkdownTracker`, `TraceStore` already exist from 1a/1b; add only the chess ones):
```ts
import { ChessOracle } from "../eval/chess/chess-oracle.ts"
import { CommandEngineAdapter } from "../eval/chess/command-engine-adapter.ts"
import { PERFT_POSITIONS } from "../eval/chess/perft-reference.ts"
```

Add these exported items:
```ts
export interface ChessConvergeDemoResult {
  outcome: ConvergeOutcome
  ledgerPath: string
  targetRev: string
}

/** Writes a throwaway "chess engine" repo whose perft is correct or has a seeded bug. */
async function createChessEngineTarget(dir: string, mode: "correct" | "buggy"): Promise<string> {
  await mkdir(dir, { recursive: true })
  const table = `{ "1": 20, "2": 400, "3": ${mode === "buggy" ? 8900 : 8902} }`
  const engine = `const depth = process.argv[3]\nconst table = ${table}\nconst n = table[depth]\nif (n === undefined) process.exit(3)\nconsole.log(n)\n`
  await writeFile(join(dir, "engine.ts"), engine)
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email demo@example.com`.quiet()
  await $`git -C ${dir} config user.name Demo`.quiet()
  await $`git -C ${dir} add .`.quiet()
  await $`git -C ${dir} commit -q -m "initial engine"`.quiet()
  return dir
}

/**
 * Offline demo: isolate a chess-engine fixture, then run the convergence loop with a faux builder
 * + faux clean checker, gated by the REAL ChessOracle (perft). A correct engine converges; a buggy
 * one fails perft so the Oracle gates and the loop escalates.
 */
export async function runChessConvergeDemo(workDir: string, mode: "correct" | "buggy"): Promise<ChessConvergeDemoResult> {
  const reg = registerFauxProvider()
  let workspace: Workspace | undefined
  try {
    // The faux builder does nothing each iteration; the checker always submits a clean verdict.
    // With maxIterations 3, a buggy engine (perft fails) burns the budget and escalates.
    reg.setResponses(
      Array.from({ length: 3 }).flatMap(() => [
        fauxAssistantMessage("working on the engine", { stopReason: "stop" }),
        fauxAssistantMessage([fauxToolCall("submit_verdict", { findings: [] })], { stopReason: "toolUse" }),
      ]),
    )

    const target = await createChessEngineTarget(join(workDir, "target-src"), mode)
    workspace = await Workspace.create({ targetRepo: target, runRoot: join(workDir, "run") })

    const model = reg.getModel()
    const tracker = await MarkdownTracker.open(workspace.ledgerPath)
    const trace = await TraceStore.open(workspace.tracePath("chess"))
    const startposOnly = PERFT_POSITIONS.filter((position) => position.name === "startpos")
    const oracle = new ChessOracle({
      adapter: new CommandEngineAdapter({
        cwd: workspace.targetDir,
        perftCommand: (depth, fen) => ["bun", "run", "engine.ts", "perft", String(depth), fen],
      }),
      positions: startposOnly,
      maxDepth: 3,
    })

    const outcome = await convergeComponent({
      component: "move-gen",
      builder: async (i) => {
        await runAgentNode({ role: "builder", model, systemPrompt: "Work on move-gen.", input: `iteration ${i}` }, trace)
      },
      verify: async (i) =>
        (await runVerify({ role: "checker", model, systemPrompt: "Review move-gen.", input: `review ${i}` }, trace)).verdict,
      oracle,
      tracker,
      maxIterations: 3,
    })

    return { outcome, ledgerPath: workspace.ledgerPath, targetRev: workspace.targetRev }
  } finally {
    await workspace?.dispose()
    reg.unregister()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/cli/cli.test.ts`
Expected: PASS — both chess-demo tests pass (correct → converged, buggy → escalated), plus the existing CLI tests.

- [ ] **Step 5: Add the `converge --chess` branch to `carriage/src/cli/index.ts`**

Add `runChessConvergeDemo` to the existing `./commands.ts` import line. Add this branch inside `main`, before the final usage/error block:
```ts
  if (command === "converge" && (rest[0] === "--chess" || rest[0] === "--chess-buggy")) {
    const dir = join(tmpdir(), `carriage-chess-${Date.now()}`)
    const result = await runChessConvergeDemo(dir, rest[0] === "--chess-buggy" ? "buggy" : "correct")
    console.log(`outcome: ${result.outcome.status} (${result.outcome.iterations} iteration(s))`)
    console.log(`target rev: ${result.targetRev}`)
    console.log(`ledger: ${result.ledgerPath}`)
    return 0
  }
```
Update the usage string to list the new commands:
```ts
  console.error(
    "usage:\n  carriage run --faux\n  carriage converge --faux\n  carriage converge --chess [--chess-buggy]\n  carriage trace <file.jsonl>",
  )
```

- [ ] **Step 6: Manually verify the CLI**

Run: `cd /home/shimin/agents/bridle/carriage && bun run src/cli/index.ts converge --chess`
Expected: prints `outcome: converged (...)` (real perft passed). Paste the output.
Run: `cd /home/shimin/agents/bridle/carriage && bun run src/cli/index.ts converge --chess-buggy`
Expected: prints `outcome: escalated (...)` (perft failed → the Oracle gated). Paste the output.

- [ ] **Step 7: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 8: Commit**
```bash
git add carriage/src/cli/commands.ts carriage/src/cli/index.ts carriage/test/cli/cli.test.ts
git commit -m "feat(carriage): converge --chess demo gated by the real perft Oracle"
```

---

## Self-Review

**Spec coverage (1c = the chess perft Oracle):**
- `ChessOracle` implementing the `Oracle` seam, gating on perft vs. reference counts (§7, §4.3 #2) → Task 1. ✓
- perft reference battery (§3.3) → Task 1 (`perft-reference.ts`). ✓
- `EngineAdapter` seam + a `CommandEngineAdapter` that runs a real engine's perft (the §7 "target adapter") → Tasks 1 + 2. ✓
- Unmeasurable-engine → reject → escalate (the invariant's safety case) → Task 1 (broken adapter) + Task 2 (crash exit). ✓
- End-to-end proof that **real perft gates convergence** (correct converges, buggy escalates) → Task 3. ✓
- **Deferred (stated):** test-pass-rate as an extra signal (same pattern, one more signal); the **real file-mutating builder** + full VSDD workflow (real models → Phase 2); recursion/decompose (later).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The perft reference values are concrete, community-verified constants. The one "KNOWN RISK" (Task 2) gives a code-level fallback for the single Bun API (`$.cwd`) I could not pre-verify in this plan.

**Type consistency:** `PerftPosition`/`PERFT_POSITIONS` (perft-reference.ts), `EngineAdapter.perft(depth, fen)` (engine-adapter.ts), `ChessOracle({ adapter, positions?, maxDepth? }).measure() → OracleResult` (chess-oracle.ts, implementing 1b's `Oracle`/`OracleResult`/`OracleSignal`), `CommandEngineAdapter({ cwd, perftCommand })` (command-engine-adapter.ts), `runChessConvergeDemo(workDir, mode) → { outcome, ledgerPath, targetRev }` (commands.ts) are used identically across tasks. `ConvergeOutcome`, `convergeComponent`, `runVerify`, `runAgentNode`, `Workspace`, `MarkdownTracker`, `TraceStore`, `registerFauxProvider`/`fauxAssistantMessage`/`fauxToolCall` are reused from 1a/1b. ✓

**Known risk to watch at execution:** `Bun.$`'s `.cwd()` (Task 2 has the probe + fallback). Everything else is pure comparison logic (Task 1, fake adapters) and the already-proven faux/Workspace/loop machinery (Task 3).
