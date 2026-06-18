# Carriage 1b — Convergence Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Carriage's per-component **convergence loop** — the VSDD-shaped cycle that runs a builder, a structured-output **checker** (`verify`), and a gating **Oracle**, deciding *converged / route-back / escalate* — plus **run-isolation** (each run on an isolated git worktree of a target). All offline-testable with the faux provider, a stub Oracle, and a throwaway fixture repo.

**Architecture:** On top of 1a's kernel (Agent-node adapter + `TraceStore` + CLI), add: a `verify` checker node (an Agent node returning a structured `Verdict` via a forced `submit_verdict` tool), a pure `convergence()` decision enforcing the **Oracle invariant** (a gating Oracle term is required), an `Oracle` interface + deterministic `StubOracle`, a `MarkdownTracker` (component-status ledger), a `Workspace` (an isolated git worktree of a target at a pinned rev, where carriage artifacts live under a run-owned root), and the `convergeComponent` loop wiring them. **The loop is dependency-injected (builder/verify/oracle/tracker) and therefore location-agnostic — it bakes in no notion of "where"; the `Workspace` is wired at the orchestration layer** (the demo here, the real runner in Phase 2).

**Tech Stack:** Bun (incl. `Bun.$` shell + `git worktree`), TypeScript, `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` (`0.79.6`), TypeBox (`Type` re-exported from pi-ai).

**Spec:** `docs/superpowers/specs/2026-06-17-carriage-design.md` — implements §4.2 (`verify`/`convergence` nodes & operators), §4.3 #2 (the Oracle invariant), §5.1 (`MarkdownTracker`), §6.3 (the per-component convergence loop), and **§8.2 (run-isolation): each run operates on an isolated git worktree of a target at a pinned rev.** In 1b the target is a **throwaway git fixture**; the *real chess-engine target* and a *file-mutating builder* arrive in Plan 1c.

**Conventions:** All paths relative to the bridle repo root; Carriage source under `carriage/`. Run `bun` from `/home/shimin/agents/bridle/carriage`. End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. The current `master` HEAD is `3305c76` (1a merged).

---

## File Structure

| File | Responsibility |
|---|---|
| `carriage/src/node/verdict.ts` | `Severity`/`Dimension`/`Finding`/`Verdict` types (pure; shared by verify + convergence) |
| `carriage/src/eval/oracle.ts` | `Oracle` interface, `OracleResult`, deterministic `StubOracle` |
| `carriage/src/loop/convergence.ts` | pure `convergence()` decision (enforces the Oracle invariant) |
| `carriage/src/node/verify.ts` | `makeVerdictTool` + `runVerify` (checker Agent node → structured `Verdict`) |
| `carriage/src/tracker/tracker.ts` | `Tracker` interface + `ComponentStatus` |
| `carriage/src/tracker/markdown-tracker.ts` | `MarkdownTracker` — the `ledger.md` status store |
| `carriage/src/loop/converge-component.ts` | `convergeComponent` — the per-component loop (location-agnostic) |
| `carriage/src/run/workspace.ts` | `Workspace` — isolated git-worktree run-isolation (§8.2) |
| `carriage/src/cli/commands.ts` (modify) | add `runConvergeDemo` (creates a fixture target + Workspace) |
| `carriage/src/cli/index.ts` (modify) | add the `converge --faux` branch |
| tests under `carriage/test/{node,eval,loop,tracker,run,cli}/` | one test file per unit |

---

## Task 1: Verdict types + Oracle + `convergence()` (pure foundation)

**Files:**
- Create: `carriage/src/node/verdict.ts`
- Create: `carriage/src/eval/oracle.ts`
- Create: `carriage/src/loop/convergence.ts`
- Test: `carriage/test/loop/convergence.test.ts`

- [ ] **Step 1: Write the verdict + oracle types**

`carriage/src/node/verdict.ts`:
```ts
export type Severity = "blocker" | "major" | "minor" | "nitpick"
export type Dimension = "spec" | "test" | "impl"

export interface Finding {
  severity: Severity
  dimension: Dimension
  message: string
}

export interface Verdict {
  findings: Finding[]
}
```

`carriage/src/eval/oracle.ts`:
```ts
export interface OracleSignal {
  name: string
  pass: boolean
  detail?: string
}

export interface OracleResult {
  /** True only if every gating signal passes. */
  pass: boolean
  signals: OracleSignal[]
}

/**
 * Deterministic measurement node. A real Oracle (e.g. chess perft, Plan 1c)
 * measures a target; if it cannot measure (harness broken), `measure()` rejects —
 * which the convergence loop treats as "unmeasurable → escalate" (never "converged").
 */
export interface Oracle {
  measure(): Promise<OracleResult>
}

/** A fixed/scripted Oracle for tests and the offline demo. */
export class StubOracle implements Oracle {
  constructor(private readonly outcome: OracleResult | (() => Promise<OracleResult>)) {}

  measure(): Promise<OracleResult> {
    return typeof this.outcome === "function" ? this.outcome() : Promise.resolve(this.outcome)
  }
}
```

- [ ] **Step 2: Write the failing test** — `carriage/test/loop/convergence.test.ts`:
```ts
import { test, expect } from "bun:test"
import { convergence } from "../../src/loop/convergence.ts"
import type { Verdict } from "../../src/node/verdict.ts"
import type { OracleResult } from "../../src/eval/oracle.ts"

const PASS: OracleResult = { pass: true, signals: [{ name: "stub", pass: true }] }
const FAIL: OracleResult = { pass: false, signals: [{ name: "stub", pass: false }] }
const NO_FINDINGS: Verdict = { findings: [] }
const NITPICK: Verdict = { findings: [{ severity: "nitpick", dimension: "spec", message: "wording" }] }
const BLOCKER: Verdict = { findings: [{ severity: "blocker", dimension: "impl", message: "bug" }] }

test("converges only when the Oracle passes AND no finding exceeds nitpick", () => {
  expect(convergence({ verdict: NO_FINDINGS, oracle: PASS })).toEqual({ converged: true })
  expect(convergence({ verdict: NITPICK, oracle: PASS })).toEqual({ converged: true })
})

test("the Oracle is a gating term: a failing Oracle blocks convergence even with no findings", () => {
  const result = convergence({ verdict: NO_FINDINGS, oracle: FAIL })
  expect(result.converged).toBe(false)
})

test("a non-nitpick finding blocks convergence even when the Oracle passes", () => {
  const result = convergence({ verdict: BLOCKER, oracle: PASS })
  expect(result.converged).toBe(false)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/loop/convergence.test.ts`
Expected: FAIL — cannot find module `../../src/loop/convergence.ts`.

- [ ] **Step 4: Write `carriage/src/loop/convergence.ts`**
```ts
import type { Verdict } from "../node/verdict.ts"
import type { OracleResult } from "../eval/oracle.ts"

export type ConvergenceVerdict = { converged: true } | { converged: false; reason: string }

/**
 * The convergence guard (spec §6.3). The Oracle invariant (§4.3 #2): the Oracle is a
 * GATING term — convergence requires `oracle.pass`. The stochastic adversary can only
 * withhold convergence (an unresolved non-nitpick finding), never grant it alone.
 */
export function convergence(input: { verdict: Verdict; oracle: OracleResult }): ConvergenceVerdict {
  if (!input.oracle.pass) return { converged: false, reason: "oracle not passing" }
  const unresolved = input.verdict.findings.filter((finding) => finding.severity !== "nitpick")
  if (unresolved.length > 0) return { converged: false, reason: `${unresolved.length} unresolved finding(s)` }
  return { converged: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/loop/convergence.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun run typecheck`
Expected: clean (exit 0, no output).

- [ ] **Step 7: Commit**
```bash
git add carriage/src/node/verdict.ts carriage/src/eval/oracle.ts carriage/src/loop/convergence.ts carriage/test/loop/convergence.test.ts
git commit -m "feat(carriage): Verdict/Oracle types and the convergence guard (Oracle invariant)"
```

---

## Task 2: `verify` — checker Agent node with structured output

**Files:**
- Create: `carriage/src/node/verify.ts`
- Test: `carriage/test/node/verify.test.ts`

**Context:** `verify` is an Agent node in a *checker role* (spec §4.2). It runs a Pi agent loop that must call a single `submit_verdict` tool; the tool captures the structured `Verdict` and returns `terminate: true` to end the loop. It reuses 1a's `runAgentNode` (passing the tool), so trace capture is shared. Tested offline by scripting the tool call with `fauxToolCall`.

- [ ] **Step 1: Write the failing test** — `carriage/test/node/verify.test.ts`:
```ts
import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { registerFauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai"
import { TraceStore } from "../../src/trace/trace-store.ts"
import { runVerify } from "../../src/node/verify.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

test("runVerify returns the structured verdict the checker submitted via the tool call", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("submit_verdict", {
          findings: [{ severity: "blocker", dimension: "spec", message: "missing edge case" }],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ])

  const path = join(tmpdir(), `carriage-verify-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)

  const result = await runVerify(
    { role: "checker", model: reg.getModel(), systemPrompt: "Review adversarially.", input: "review this" },
    trace,
  )

  expect(result.verdict.findings).toHaveLength(1)
  expect(result.verdict.findings[0]!.severity).toBe("blocker")
  expect(result.verdict.findings[0]!.dimension).toBe("spec")
  expect(result.trace.map((e) => e.type)).toContain("agent_end")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/node/verify.test.ts`
Expected: FAIL — cannot find module `../../src/node/verify.ts`.

- [ ] **Step 3: Write `carriage/src/node/verify.ts`**
```ts
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { TraceStore, TraceEvent } from "../trace/trace-store.ts"
import type { AgentNodeSpec } from "./types.ts"
import type { Verdict } from "./verdict.ts"
import { runAgentNode } from "./agent-node.ts"

const VerdictSchema = Type.Object({
  findings: Type.Array(
    Type.Object({
      severity: Type.Union([
        Type.Literal("blocker"),
        Type.Literal("major"),
        Type.Literal("minor"),
        Type.Literal("nitpick"),
      ]),
      dimension: Type.Union([Type.Literal("spec"), Type.Literal("test"), Type.Literal("impl")]),
      message: Type.String(),
    }),
  ),
})

/** A single-purpose tool the checker calls to submit its structured verdict. */
export function makeVerdictTool(onCapture: (verdict: Verdict) => void): AgentTool<typeof VerdictSchema, Verdict> {
  return {
    name: "submit_verdict",
    description:
      "Submit your review verdict by calling this exactly once with all findings. Use severity 'nitpick' only for trivial wording; anything substantive is 'minor', 'major', or 'blocker'.",
    parameters: VerdictSchema,
    label: "submit verdict",
    execute: async (_toolCallId, params) => {
      const verdict = params as Verdict
      onCapture(verdict)
      return { content: [{ type: "text", text: "verdict recorded" }], details: verdict, terminate: true }
    },
  }
}

/** The spec for a checker run is an Agent-node spec with its tools fixed to the verdict tool. */
export type VerifySpec = Omit<AgentNodeSpec, "tools">

export interface VerifyResult {
  verdict: Verdict
  trace: TraceEvent[]
}

export async function runVerify(spec: VerifySpec, trace: TraceStore): Promise<VerifyResult> {
  let captured: Verdict | undefined
  const tool = makeVerdictTool((verdict) => {
    captured = verdict
  })

  const result = await runAgentNode({ ...spec, tools: [tool] }, trace)

  if (captured === undefined) {
    throw new Error("checker did not submit a verdict (no submit_verdict tool call)")
  }
  return { verdict: captured, trace: result.trace }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/node/verify.test.ts`
Expected: PASS — 1 test passing.

**KNOWN RISK — read this if Step 4 fails with "No more faux responses queued":** that means pi-agent-core requested another model turn *after* the tool executed (i.e. `terminate: true` did not stop the loop as expected). If so, append a trailing stop response so the loop has something to finish on (the verdict is still captured from the tool call):
```ts
reg.setResponses([
  fauxAssistantMessage([fauxToolCall("submit_verdict", { findings: [/* ... */] })], { stopReason: "toolUse" }),
  fauxAssistantMessage("done", { stopReason: "stop" }),
])
```
Re-run; the assertions on `result.verdict` are unchanged. **Document in your report whether the trailing response was needed** — Task 6's faux scripting depends on it.

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 6: Commit**
```bash
git add carriage/src/node/verify.ts carriage/test/node/verify.test.ts
git commit -m "feat(carriage): verify checker node with structured verdict via submit_verdict tool"
```

---

## Task 3: `Tracker` + `MarkdownTracker`

**Files:**
- Create: `carriage/src/tracker/tracker.ts`
- Create: `carriage/src/tracker/markdown-tracker.ts`
- Test: `carriage/test/tracker/markdown-tracker.test.ts`

- [ ] **Step 1: Write the interface** — `carriage/src/tracker/tracker.ts`:
```ts
export type ComponentStatus = "open" | "converged" | "escalated"

/** Curated component-status memory (spec §5.1). Markdown now; beads/SQLite later, same seam. */
export interface Tracker {
  setStatus(component: string, status: ComponentStatus): Promise<void>
  getStatus(component: string): Promise<ComponentStatus | undefined>
  openComponents(): Promise<string[]>
}
```

- [ ] **Step 2: Write the failing test** — `carriage/test/tracker/markdown-tracker.test.ts`:
```ts
import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { MarkdownTracker } from "../../src/tracker/markdown-tracker.ts"

function ledgerPath() {
  return join(tmpdir(), `carriage-ledger-${process.pid}-${Math.floor(performance.now() * 1000)}.md`)
}

test("setStatus / getStatus / openComponents round-trip and the ledger is human-readable", async () => {
  const path = ledgerPath()
  const tracker = await MarkdownTracker.open(path)

  await tracker.setStatus("move-gen", "open")
  await tracker.setStatus("board-rep", "converged")
  await tracker.setStatus("move-gen", "converged") // update in place

  expect(await tracker.getStatus("move-gen")).toBe("converged")
  expect(await tracker.getStatus("board-rep")).toBe("converged")
  expect(await tracker.getStatus("absent")).toBeUndefined()
  expect(await tracker.openComponents()).toEqual([])

  const text = await Bun.file(path).text()
  expect(text).toContain("- move-gen: converged")
  expect(text).toContain("- board-rep: converged")

  await rm(path, { force: true })
})

test("open() reloads status from an existing ledger", async () => {
  const path = ledgerPath()
  const first = await MarkdownTracker.open(path)
  await first.setStatus("search", "open")

  const second = await MarkdownTracker.open(path)
  expect(await second.getStatus("search")).toBe("open")
  expect(await second.openComponents()).toEqual(["search"])

  await rm(path, { force: true })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/tracker/markdown-tracker.test.ts`
Expected: FAIL — cannot find module `../../src/tracker/markdown-tracker.ts`.

- [ ] **Step 4: Write `carriage/src/tracker/markdown-tracker.ts`**
```ts
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { ComponentStatus, Tracker } from "./tracker.ts"

export class MarkdownTracker implements Tracker {
  private constructor(
    private readonly filePath: string,
    private readonly entries: Map<string, ComponentStatus>,
  ) {}

  static async open(filePath: string): Promise<MarkdownTracker> {
    return new MarkdownTracker(filePath, await MarkdownTracker.read(filePath))
  }

  async setStatus(component: string, status: ComponentStatus): Promise<void> {
    this.entries.set(component, status)
    await this.write()
  }

  getStatus(component: string): Promise<ComponentStatus | undefined> {
    return Promise.resolve(this.entries.get(component))
  }

  openComponents(): Promise<string[]> {
    return Promise.resolve([...this.entries].filter(([, status]) => status === "open").map(([component]) => component))
  }

  private async write(): Promise<void> {
    const rows = [...this.entries].map(([component, status]) => `- ${component}: ${status}`)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, ["# Carriage Ledger", "", ...rows, ""].join("\n"))
  }

  private static async read(filePath: string): Promise<Map<string, ComponentStatus>> {
    const entries = new Map<string, ComponentStatus>()
    const file = Bun.file(filePath)
    if (!(await file.exists())) return entries
    for (const line of (await file.text()).split("\n")) {
      const match = line.match(/^- (.+): (open|converged|escalated)$/)
      if (match) entries.set(match[1]!, match[2] as ComponentStatus)
    }
    return entries
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/tracker/markdown-tracker.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 6: Typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**
```bash
git add carriage/src/tracker/tracker.ts carriage/src/tracker/markdown-tracker.ts carriage/test/tracker/markdown-tracker.test.ts
git commit -m "feat(carriage): Tracker interface and MarkdownTracker ledger"
```

---

## Task 4: `convergeComponent` — the per-component loop (location-agnostic)

**Files:**
- Create: `carriage/src/loop/converge-component.ts`
- Test: `carriage/test/loop/converge-component.test.ts`

**Context:** the spine-2 loop (spec §6.3). It takes `builder`/`verify`/`oracle`/`tracker` as injected dependencies — so it has **no notion of "where" work happens** (the `Workspace` from Task 5 is bound into these deps by the caller). Each iteration: run the builder, get the checker's verdict, measure the Oracle (a thrown Oracle = unmeasurable → escalate), then `convergence()`. Not converged → check for **oscillation** (non-nitpick findings stalled) and continue, or hit the **budget** cap → escalate.

- [ ] **Step 1: Write the failing test** — `carriage/test/loop/converge-component.test.ts`:
```ts
import { test, expect } from "bun:test"
import { convergeComponent } from "../../src/loop/converge-component.ts"
import { StubOracle, type OracleResult } from "../../src/eval/oracle.ts"
import type { Verdict } from "../../src/node/verdict.ts"
import type { ComponentStatus, Tracker } from "../../src/tracker/tracker.ts"

const PASS: OracleResult = { pass: true, signals: [] }
const FAIL: OracleResult = { pass: false, signals: [] }
const clean: Verdict = { findings: [] }
const blocker: Verdict = { findings: [{ severity: "blocker", dimension: "impl", message: "bug" }] }
const twoBlockers: Verdict = {
  findings: [
    { severity: "blocker", dimension: "impl", message: "a" },
    { severity: "blocker", dimension: "spec", message: "b" },
  ],
}

// minimal in-memory Tracker fake
function fakeTracker() {
  const map = new Map<string, ComponentStatus>()
  const tracker: Tracker = {
    setStatus: (c, s) => { map.set(c, s); return Promise.resolve() },
    getStatus: (c) => Promise.resolve(map.get(c)),
    openComponents: () => Promise.resolve([...map].filter(([, s]) => s === "open").map(([c]) => c)),
  }
  return { tracker, map }
}

// verify fake that replays scripted verdicts by iteration (1-based)
function scriptedVerify(verdicts: Verdict[]) {
  return (iteration: number) => Promise.resolve(verdicts[iteration - 1] ?? verdicts[verdicts.length - 1]!)
}

const noopBuilder = () => Promise.resolve()

test("converges on the first iteration when the verdict is clean and the Oracle passes", async () => {
  const { tracker, map } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "converged", iterations: 1 })
  expect(map.get("move-gen")).toBe("converged")
})

test("routes back then converges (blocker on iter 1, clean on iter 2)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([blocker, clean]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "converged", iterations: 2 })
})

test("escalates on oscillation when non-nitpick findings do not strictly decrease", async () => {
  const { tracker, map } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([twoBlockers, twoBlockers]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome.status).toBe("escalated")
  expect(outcome).toMatchObject({ reason: "no progress (oscillation)" })
  expect(map.get("move-gen")).toBe("escalated")
})

test("escalates on budget exhaustion when the Oracle never passes (no findings to oscillate on)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(FAIL),
    tracker,
    maxIterations: 3,
  })
  expect(outcome).toEqual({ status: "escalated", iterations: 3, reason: "budget exhausted" })
})

test("escalates when the Oracle is unmeasurable (measure rejects)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(() => Promise.reject(new Error("engine build failed"))),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "escalated", iterations: 1, reason: "oracle unmeasurable" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/loop/converge-component.test.ts`
Expected: FAIL — cannot find module `../../src/loop/converge-component.ts`.

- [ ] **Step 3: Write `carriage/src/loop/converge-component.ts`**
```ts
import { convergence } from "./convergence.ts"
import type { Verdict } from "../node/verdict.ts"
import type { Oracle } from "../eval/oracle.ts"
import type { Tracker } from "../tracker/tracker.ts"

export interface ConvergeComponentOptions {
  component: string
  builder: (iteration: number) => Promise<void>
  verify: (iteration: number) => Promise<Verdict>
  oracle: Oracle
  tracker: Tracker
  maxIterations: number
}

export type ConvergeOutcome =
  | { status: "converged"; iterations: number }
  | { status: "escalated"; iterations: number; reason: string }

export async function convergeComponent(opts: ConvergeComponentOptions): Promise<ConvergeOutcome> {
  await opts.tracker.setStatus(opts.component, "open")
  let previousUnresolved = Number.POSITIVE_INFINITY

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    await opts.builder(iteration)
    const verdict = await opts.verify(iteration)

    const oracle = await opts.oracle.measure().catch(() => undefined)
    if (oracle === undefined) {
      return escalate(opts, iteration, "oracle unmeasurable")
    }

    if (convergence({ verdict, oracle }).converged) {
      await opts.tracker.setStatus(opts.component, "converged")
      return { status: "converged", iterations: iteration }
    }

    const unresolved = verdict.findings.filter((finding) => finding.severity !== "nitpick").length
    if (unresolved > 0 && unresolved >= previousUnresolved) {
      return escalate(opts, iteration, "no progress (oscillation)")
    }
    previousUnresolved = unresolved
  }

  return escalate(opts, opts.maxIterations, "budget exhausted")
}

async function escalate(opts: ConvergeComponentOptions, iterations: number, reason: string): Promise<ConvergeOutcome> {
  await opts.tracker.setStatus(opts.component, "escalated")
  return { status: "escalated", iterations, reason }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/loop/converge-component.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**
```bash
git add carriage/src/loop/converge-component.ts carriage/test/loop/converge-component.test.ts
git commit -m "feat(carriage): convergeComponent loop with budget, escalation, oscillation detection"
```

---

## Task 5: `Workspace` — isolated git-worktree run-isolation

**Files:**
- Create: `carriage/src/run/workspace.ts`
- Test: `carriage/test/run/workspace.test.ts`

**Context (spec §8.2):** every run operates on its own **isolated git worktree** of a target repo at a **pinned rev**, so runs start byte-identical, can't contaminate the target or each other, and are reproducible. Carriage's run artifacts (ledger, traces) live under a run-owned `runRoot` that **persists** after the isolated checkout is disposed (the trace is the durable record `compare`/D mine). `dispose()` removes only the worktree, not the artifacts. Uses Bun's `$` shell to drive `git worktree`.

- [ ] **Step 1: Write the failing test** — `carriage/test/run/workspace.test.ts`:
```ts
import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { $ } from "bun"
import { Workspace } from "../../src/run/workspace.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

async function fixtureRepo(): Promise<string> {
  const dir = join(tmpdir(), `carriage-fixture-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  await mkdir(dir, { recursive: true })
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email test@example.com`.quiet()
  await $`git -C ${dir} config user.name Test`.quiet()
  await writeFile(join(dir, "file.txt"), "original\n")
  await $`git -C ${dir} add .`.quiet()
  await $`git -C ${dir} commit -q -m initial`.quiet()
  return dir
}

test("Workspace makes an isolated worktree at the pinned rev; edits don't leak; dispose cleans up", async () => {
  const target = await fixtureRepo()
  const runRoot = join(tmpdir(), `carriage-run-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(runRoot, { recursive: true, force: true }))

  const ws = await Workspace.create({ targetRepo: target, runRoot })

  // checked out at HEAD; content matches; rev is a full SHA; artifact paths under runRoot
  expect(await readFile(join(ws.targetDir, "file.txt"), "utf8")).toBe("original\n")
  expect(ws.targetRev).toMatch(/^[0-9a-f]{40}$/)
  expect(ws.ledgerPath).toBe(join(runRoot, "ledger.md"))

  // mutating inside the worktree does not touch the original repo's working tree
  await writeFile(join(ws.targetDir, "file.txt"), "changed\n")
  expect(await readFile(join(target, "file.txt"), "utf8")).toBe("original\n")

  // a second workspace on the same target is independent (no contamination)
  const ws2 = await Workspace.create({ targetRepo: target, runRoot: join(runRoot, "b") })
  cleanups.push(() => ws2.dispose())
  expect(await readFile(join(ws2.targetDir, "file.txt"), "utf8")).toBe("original\n")

  // dispose removes the isolated checkout but leaves the run artifacts root
  await ws.dispose()
  expect(await Bun.file(join(ws.targetDir, "file.txt")).exists()).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/run/workspace.test.ts`
Expected: FAIL — cannot find module `../../src/run/workspace.ts`.

- [ ] **Step 3: Write `carriage/src/run/workspace.ts`**
```ts
import { $ } from "bun"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

export interface WorkspaceOptions {
  /** Path to the target git repository to isolate. */
  targetRepo: string
  /** Commit-ish to check out (default "HEAD"). Pinned to a full SHA on creation. */
  rev?: string
  /** Run-owned directory for this run's persistent carriage artifacts (ledger, traces). */
  runRoot: string
}

/**
 * One run's isolated workspace: a detached git worktree of `targetRepo` at a pinned rev
 * (where a builder edits and an Oracle measures), plus a persistent `runRoot` for carriage
 * artifacts. `dispose()` removes the worktree only; `runRoot` (ledger/traces) survives.
 */
export class Workspace {
  private constructor(
    private readonly targetRepo: string,
    readonly targetDir: string,
    readonly targetRev: string,
    readonly runRoot: string,
  ) {}

  get ledgerPath(): string {
    return join(this.runRoot, "ledger.md")
  }

  tracePath(runId: string): string {
    return join(this.runRoot, "traces", `${runId}.jsonl`)
  }

  static async create(options: WorkspaceOptions): Promise<Workspace> {
    const targetRev = (await $`git -C ${options.targetRepo} rev-parse ${options.rev ?? "HEAD"}`.text()).trim()
    const targetDir = join(options.runRoot, "target")
    await mkdir(options.runRoot, { recursive: true })
    await $`git -C ${options.targetRepo} worktree add --detach ${targetDir} ${targetRev}`.quiet()
    return new Workspace(options.targetRepo, targetDir, targetRev, options.runRoot)
  }

  async dispose(): Promise<void> {
    await $`git -C ${this.targetRepo} worktree remove ${this.targetDir} --force`.quiet()
    await $`git -C ${this.targetRepo} worktree prune`.quiet()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/run/workspace.test.ts`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**
```bash
git add carriage/src/run/workspace.ts carriage/test/run/workspace.test.ts
git commit -m "feat(carriage): Workspace run-isolation via detached git worktree"
```

---

## Task 6: CLI `converge --faux` demo (over an isolated Workspace)

**Files:**
- Modify: `carriage/src/cli/commands.ts`
- Modify: `carriage/src/cli/index.ts`
- Test: `carriage/test/cli/cli.test.ts` (add a test)

**Context:** an end-to-end offline demo proving the whole loop **inside an isolated worktree**: it creates a throwaway git fixture as the target, opens a `Workspace` on it, runs `convergeComponent` with a real faux **builder** (`runAgentNode`) and faux **checker** (`runVerify`) over two iterations (blocker → clean) against a passing `StubOracle`, writes the ledger under the run root, then disposes the worktree (ledger persists). This is where the `Workspace` is wired to the location-agnostic loop.

- [ ] **Step 1: Write the failing test** — append to `carriage/test/cli/cli.test.ts`:
```ts
import { runConvergeDemo } from "../../src/cli/commands.ts"
import { MarkdownTracker } from "../../src/tracker/markdown-tracker.ts"

test("runConvergeDemo drives a faux component to convergence inside an isolated workspace and writes the ledger", async () => {
  const dir = join(tmpdir(), `carriage-converge-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))

  const result = await runConvergeDemo(dir)

  expect(result.outcome.status).toBe("converged")
  expect(result.targetRev).toMatch(/^[0-9a-f]{40}$/)

  // ledger persists after the isolated worktree is disposed
  const tracker = await MarkdownTracker.open(result.ledgerPath)
  expect(await tracker.getStatus("move-gen")).toBe("converged")
})
```
(`import { runConvergeDemo }` and `MarkdownTracker` are new imports for this test file; keep the existing `runFauxDemo`/`formatTrace`/`TraceStore` imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/cli/cli.test.ts`
Expected: FAIL — `runConvergeDemo` is not exported by `commands.ts`.

- [ ] **Step 3: Add `runConvergeDemo` to `carriage/src/cli/commands.ts`**

Add these imports at the top (merge `fauxToolCall` into the existing pi-ai import; add the rest; do not duplicate `runAgentNode` if already imported):
```ts
import { $ } from "bun"
import { mkdir, writeFile } from "node:fs/promises"
import { registerFauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai"
import { runAgentNode } from "../node/agent-node.ts"
import { runVerify } from "../node/verify.ts"
import { convergeComponent, type ConvergeOutcome } from "../loop/converge-component.ts"
import { StubOracle } from "../eval/oracle.ts"
import { MarkdownTracker } from "../tracker/markdown-tracker.ts"
import { Workspace } from "../run/workspace.ts"
```

Add these exported items:
```ts
export interface ConvergeDemoResult {
  outcome: ConvergeOutcome
  ledgerPath: string
  targetRev: string
}

/** Creates a throwaway git fixture to act as the isolation target for the demo. */
async function createFixtureTarget(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email demo@example.com`.quiet()
  await $`git -C ${dir} config user.name Demo`.quiet()
  await writeFile(join(dir, "engine.txt"), "vibe-coded move generator\n")
  await $`git -C ${dir} add .`.quiet()
  await $`git -C ${dir} commit -q -m "initial vibe-coded engine"`.quiet()
  return dir
}

/**
 * Offline demo: isolate a fixture target in a worktree, then drive one component through the
 * convergence loop with a faux builder + faux checker (blocker → clean) against a passing stub Oracle.
 */
export async function runConvergeDemo(workDir: string): Promise<ConvergeDemoResult> {
  const reg = registerFauxProvider()
  let workspace: Workspace | undefined
  try {
    // Call order across two iterations: builder(1), checker(1)=blocker, builder(2), checker(2)=clean.
    reg.setResponses([
      fauxAssistantMessage("drafting move-gen", { stopReason: "stop" }),
      fauxAssistantMessage(
        [fauxToolCall("submit_verdict", { findings: [{ severity: "blocker", dimension: "impl", message: "off-by-one" }] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("fixing off-by-one", { stopReason: "stop" }),
      fauxAssistantMessage([fauxToolCall("submit_verdict", { findings: [] })], { stopReason: "toolUse" }),
    ])

    const target = await createFixtureTarget(join(workDir, "target-src"))
    workspace = await Workspace.create({ targetRepo: target, runRoot: join(workDir, "run") })

    const model = reg.getModel()
    const tracker = await MarkdownTracker.open(workspace.ledgerPath)
    const trace = await TraceStore.open(workspace.tracePath("demo"))

    const outcome = await convergeComponent({
      component: "move-gen",
      builder: (i) =>
        runAgentNode({ role: "builder", model, systemPrompt: "Implement move-gen.", input: `iteration ${i}` }, trace).then(
          () => undefined,
        ),
      verify: (i) =>
        runVerify({ role: "checker", model, systemPrompt: "Review move-gen.", input: `review ${i}` }, trace).then(
          (r) => r.verdict,
        ),
      oracle: new StubOracle({ pass: true, signals: [{ name: "stub-perft", pass: true }] }),
      tracker,
      maxIterations: 5,
    })

    return { outcome, ledgerPath: workspace.ledgerPath, targetRev: workspace.targetRev }
  } finally {
    await workspace?.dispose()
    reg.unregister()
  }
}
```

**KNOWN RISK:** if Task 2 found that `terminate: true` did NOT stop the loop (a trailing stop response was needed), each `runVerify` consumes TWO faux responses. In that case insert a `fauxAssistantMessage("ok", { stopReason: "stop" })` after EACH `submit_verdict` entry in `setResponses` (order: builder, verdict, stop, builder, verdict, stop). Match whatever Task 2 confirmed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/shimin/agents/bridle/carriage && bun test test/cli/cli.test.ts`
Expected: PASS — the converge-demo test passes (plus the existing CLI tests).

- [ ] **Step 5: Add the `converge --faux` branch to `carriage/src/cli/index.ts`**

Add `runConvergeDemo` to the existing `./commands.ts` import line (alongside `runFauxDemo, formatTrace`). Add this branch inside `main`, before the final usage/error block:
```ts
  if (command === "converge" && rest[0] === "--faux") {
    const dir = join(tmpdir(), `carriage-converge-${Date.now()}`)
    const result = await runConvergeDemo(dir)
    console.log(`outcome: ${result.outcome.status} (${result.outcome.iterations} iteration(s))`)
    console.log(`target rev: ${result.targetRev}`)
    console.log(`ledger: ${result.ledgerPath}`)
    return 0
  }
```
Update the usage string to include the new command:
```ts
  console.error("usage:\n  carriage run --faux\n  carriage converge --faux\n  carriage trace <file.jsonl>")
```

- [ ] **Step 6: Manually verify the CLI**

Run: `cd /home/shimin/agents/bridle/carriage && bun run src/cli/index.ts converge --faux`
Expected: prints `outcome: converged (2 iteration(s))`, a `target rev:` SHA, and a `ledger:` path.
Then: `cat <ledger-path-from-above>`
Expected: a markdown ledger containing `- move-gen: converged`.

- [ ] **Step 7: Run the whole suite + typecheck**

Run: `cd /home/shimin/agents/bridle/carriage && bun test && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 8: Commit**
```bash
git add carriage/src/cli/commands.ts carriage/src/cli/index.ts carriage/test/cli/cli.test.ts
git commit -m "feat(carriage): converge --faux demo over an isolated Workspace"
```

---

## Self-Review

**Spec coverage (1b = the convergence engine + run-isolation):**
- `verify` checker node + structured output (§4.2) → Task 2. ✓
- `convergence()` + the Oracle invariant (§4.3 #2, §6.3) → Task 1. ✓
- Oracle interface + stub (the gating term; chess Oracle is 1c) → Task 1. ✓
- `Tracker` + `MarkdownTracker` ledger (§5.1) → Task 3. ✓
- per-component loop with budget / escalation / oscillation (§6.3, §9) → Task 4. ✓
- **run-isolation via isolated git worktree (§8.2)** → Task 5; wired through the demo in Task 6. ✓
- end-to-end offline proof inside an isolated workspace → Task 6 (`converge --faux`). ✓
- **Deferred (stated):** the *real chess-engine target* + a *file-mutating builder* (1b's target is a throwaway fixture) → 1c; `decompose`/recursion (§4.2) → a later plan; real maker≠checker model assignment → Phase 2 (the loop is model-agnostic; demo uses one faux model).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The two "KNOWN RISK" notes (Tasks 2 & 6) give a concrete, code-level adaptation for the one behavior I could not verify offline (`terminate`).

**Type consistency:** `Verdict`/`Finding`/`Severity`/`Dimension` (verdict.ts), `Oracle`/`OracleResult`/`StubOracle` (oracle.ts), `convergence({verdict,oracle}) → ConvergenceVerdict`, `runVerify(VerifySpec, TraceStore) → {verdict, trace}`, `Tracker`/`ComponentStatus`/`MarkdownTracker.open`, `convergeComponent(ConvergeComponentOptions) → ConvergeOutcome`, `Workspace.create({targetRepo, rev?, runRoot}) → {targetDir, targetRev, runRoot, ledgerPath, tracePath()}`, `runConvergeDemo(dir) → {outcome, ledgerPath, targetRev}` are used identically across tasks. `runVerify` reuses 1a's `runAgentNode` + `AgentNodeSpec`/`TraceStore`/`TraceEvent`. ✓

**Known risks to watch at execution:** (1) Pi's `terminate: true` loop-stop behavior (Task 2 verifies it; Task 6 depends on the confirmed ordering). (2) `git worktree` + `Bun.$` — verified working in this environment (`worktree add --detach` / `remove --force` and `$\`...\`.text()/.quiet()`). The loop, oracle, tracker, and convergence are pure TS tested with fakes; verify + Workspace are the two integration points.
