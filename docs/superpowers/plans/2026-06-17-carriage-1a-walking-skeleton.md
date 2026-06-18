# Carriage 1a — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Carriage project and prove the core seam end-to-end: an **Agent-node adapter** over `pi-agent-core` + `pi-ai` runs one agent loop, every step is captured into a **JSONL `TraceStore`**, and a thin CLI can run a faux demo and pretty-print the trace — all offline, with zero tokens.

**Architecture:** Carriage is a code-first TypeScript/Bun library (form factor A). This slice builds three units behind clean boundaries: `TraceStore` (append-only JSONL), the `AgentNode` adapter (Pi behind Carriage's own node contract — the swappable dependency boundary from the spec's §4.1 "Dependency posture"), and a thin CLI. The model layer is exercised with Pi's **faux provider** (a scripted, in-memory fake LLM), so the whole slice is deterministic and free.

**Tech Stack:** Bun (runtime + `bun test`), TypeScript, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`.

**Spec:** `docs/superpowers/specs/2026-06-17-carriage-design.md` (this implements the Phase-0 kernel seam: Agent-node adapter + `TraceStore` + CLI `run`/`trace`).

**Conventions for this plan:**
- All paths are relative to the bridle repo root. Carriage source lives under `carriage/`.
- All `bun` commands run **from the `carriage/` directory** (shown in each command).
- Pi packages are pinned to `0.79.5` (the version in `reference/pi`); the executor may bump to the current published version if `bun install` reports a newer one.

---

## File Structure

| File | Responsibility |
|---|---|
| `carriage/package.json` | Bun project manifest, pinned deps, scripts, `carriage` bin |
| `carriage/tsconfig.json` | TypeScript config (Bun, strict, no-emit) |
| `carriage/.gitignore` | ignore `node_modules`, trace scratch |
| `carriage/src/trace/trace-store.ts` | `TraceStore`: append-only JSONL of trace events |
| `carriage/src/node/types.ts` | `AgentNodeSpec` / `AgentNodeResult` — Carriage's node contract |
| `carriage/src/node/agent-node.ts` | `runAgentNode()` — the adapter binding the contract to Pi |
| `carriage/src/cli/commands.ts` | `runFauxDemo()` + `formatTrace()` — testable CLI logic |
| `carriage/src/cli/index.ts` | thin arg dispatcher for `carriage run --faux` / `carriage trace <file>` |
| `carriage/test/trace/trace-store.test.ts` | TraceStore round-trip tests |
| `carriage/test/node/agent-node.test.ts` | adapter faux-scripted test |
| `carriage/test/cli/cli.test.ts` | CLI command-logic tests |

---

## Task 0: Project scaffold

**Files:**
- Create: `carriage/package.json`
- Create: `carriage/tsconfig.json`
- Create: `carriage/.gitignore`
- Create: `carriage/test/smoke.test.ts`

- [ ] **Step 1: Create `carriage/package.json`**

```json
{
  "name": "carriage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "carriage": "./src/cli/index.ts" },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "carriage": "bun run src/cli/index.ts"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.79.5",
    "@earendil-works/pi-ai": "0.79.5"
  },
  "devDependencies": {
    "@types/bun": "1.3.13",
    "typescript": "5.8.2"
  }
}
```

- [ ] **Step 2: Create `carriage/tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `carriage/.gitignore`**

```
node_modules
*.tsbuildinfo
.carriage-scratch
```

- [ ] **Step 4: Install dependencies**

Run: `cd carriage && bun install`
Expected: resolves and installs `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, dev deps; creates `bun.lock`. If install reports a newer published Pi version, update both pins to match and re-run.

- [ ] **Step 5: Create a smoke test `carriage/test/smoke.test.ts`**

```ts
import { test, expect } from "bun:test"

test("test runner works", () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 6: Run the smoke test**

Run: `cd carriage && bun test`
Expected: PASS — 1 test passing.

- [ ] **Step 7: Commit**

```bash
git add carriage/package.json carriage/tsconfig.json carriage/.gitignore carriage/test/smoke.test.ts carriage/bun.lock
git commit -m "chore(carriage): scaffold bun project with pi deps"
```

---

## Task 1: TraceStore (append-only JSONL)

**Files:**
- Create: `carriage/src/trace/trace-store.ts`
- Test: `carriage/test/trace/trace-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// carriage/test/trace/trace-store.test.ts
import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { TraceStore } from "../../src/trace/trace-store.ts"

function scratchPath() {
  return join(tmpdir(), `carriage-trace-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
}

test("append assigns increasing seq and read returns the records in order", async () => {
  const path = scratchPath()
  const store = await TraceStore.open(path)

  const a = await store.append({ role: "builder", type: "agent_start" })
  const b = await store.append({ role: "builder", type: "agent_end" })

  expect(a.seq).toBe(0)
  expect(b.seq).toBe(1)
  expect(typeof a.ts).toBe("number")

  const read = await store.read()
  expect(read.map((e) => e.type)).toEqual(["agent_start", "agent_end"])
  expect(read.map((e) => e.seq)).toEqual([0, 1])

  await rm(path, { force: true })
})

test("open() resumes seq from an existing file", async () => {
  const path = scratchPath()
  const first = await TraceStore.open(path)
  await first.append({ type: "agent_start" })

  const second = await TraceStore.open(path)
  const next = await second.append({ type: "agent_end" })

  expect(next.seq).toBe(1)
  expect((await second.read()).length).toBe(2)

  await rm(path, { force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd carriage && bun test test/trace/trace-store.test.ts`
Expected: FAIL — cannot find module `../../src/trace/trace-store.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// carriage/src/trace/trace-store.ts
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"

export interface TraceEvent {
  seq: number
  ts: number
  type: string
  [key: string]: unknown
}

export type TraceInput = { type: string } & Record<string, unknown>

export class TraceStore {
  private seq: number

  private constructor(
    private readonly filePath: string,
    startSeq: number,
  ) {
    this.seq = startSeq
  }

  static async open(filePath: string): Promise<TraceStore> {
    const existing = await TraceStore.readLines(filePath)
    return new TraceStore(filePath, existing.length)
  }

  async append(event: TraceInput): Promise<TraceEvent> {
    const record: TraceEvent = { ...event, seq: this.seq++, ts: Date.now() }
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(record) + "\n")
    return record
  }

  async read(): Promise<TraceEvent[]> {
    const lines = await TraceStore.readLines(this.filePath)
    return lines.map((line) => JSON.parse(line) as TraceEvent)
  }

  private static async readLines(filePath: string): Promise<string[]> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return []
    const text = await file.text()
    return text.split("\n").filter((line) => line.trim().length > 0)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd carriage && bun test test/trace/trace-store.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add carriage/src/trace/trace-store.ts carriage/test/trace/trace-store.test.ts
git commit -m "feat(carriage): append-only JSONL TraceStore"
```

---

## Task 2: Agent-node adapter (Pi behind the node contract)

**Files:**
- Create: `carriage/src/node/types.ts`
- Create: `carriage/src/node/agent-node.ts`
- Test: `carriage/test/node/agent-node.test.ts`

- [ ] **Step 1: Define the node contract `carriage/src/node/types.ts`**

```ts
// carriage/src/node/types.ts
import type { Model, StreamFn } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { TraceEvent } from "../trace/trace-store.ts"

/**
 * Carriage's own Agent-node contract. The workflow/graph layer depends ONLY on
 * this; `runAgentNode` is the single adapter binding it to pi-agent-core + pi-ai.
 * Swapping Pi later means swapping the adapter, not this contract.
 */
export interface AgentNodeSpec {
  /** e.g. "builder" | "checker" — recorded on every trace event for this node. */
  role: string
  /** A pi-ai Model (real provider model, or a faux model in tests). */
  model: Model
  systemPrompt: string
  /** The user prompt that starts this node's single loop. */
  input: string
  tools?: AgentTool[]
  /** Optional stream-function override (unused in normal runs; the faux model routes via the api registry). */
  streamFn?: StreamFn
}

export interface AgentNodeResult {
  /** The final assistant text produced by the loop. */
  text: string
  /** The trace events captured (and persisted) during the run, in order. */
  trace: TraceEvent[]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// carriage/test/node/agent-node.test.ts
import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { registerFauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai"
import { TraceStore } from "../../src/trace/trace-store.ts"
import { runAgentNode } from "../../src/node/agent-node.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

test("runAgentNode runs a faux loop, returns final text, and persists the trace", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([fauxAssistantMessage("done", { stopReason: "stop" })])

  const path = join(tmpdir(), `carriage-node-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)

  const result = await runAgentNode(
    { role: "builder", model: reg.getModel(), systemPrompt: "Be terse.", input: "hi" },
    trace,
  )

  expect(result.text).toBe("done")

  const types = result.trace.map((e) => e.type)
  expect(types).toContain("agent_start")
  expect(types).toContain("agent_end")

  // every captured event carries the node's role and a monotonic seq
  expect(result.trace.every((e) => e.role === "builder")).toBe(true)
  expect(result.trace.every((e, i) => e.seq === i)).toBe(true)

  // the persisted file matches the returned trace
  expect((await trace.read()).length).toBe(result.trace.length)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd carriage && bun test test/node/agent-node.test.ts`
Expected: FAIL — cannot find module `../../src/node/agent-node.ts`.

- [ ] **Step 4: Write the adapter `carriage/src/node/agent-node.ts`**

```ts
// carriage/src/node/agent-node.ts
import { Agent } from "@earendil-works/pi-agent-core"
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core"
import type { TextContent } from "@earendil-works/pi-ai"
import type { TraceStore, TraceEvent } from "../trace/trace-store.ts"
import type { AgentNodeSpec, AgentNodeResult } from "./types.ts"

export async function runAgentNode(spec: AgentNodeSpec, trace: TraceStore): Promise<AgentNodeResult> {
  const captured: TraceEvent[] = []

  const agent = new Agent({
    initialState: {
      model: spec.model,
      systemPrompt: spec.systemPrompt,
      tools: spec.tools ?? [],
    },
    streamFn: spec.streamFn,
  })

  // pi-agent-core awaits listeners before resolving prompt(), so every append
  // is persisted by the time the run settles.
  const unsubscribe = agent.subscribe(async (event) => {
    captured.push(await trace.append({ role: spec.role, type: event.type, ...summarize(event) }))
  })

  await agent.prompt(spec.input)
  unsubscribe()

  return { text: finalAssistantText(agent.state.messages), trace: captured }
}

function summarize(event: AgentEvent): Record<string, unknown> {
  switch (event.type) {
    case "tool_execution_start":
      return { toolName: event.toolName }
    case "tool_execution_end":
      return { toolName: event.toolName, isError: event.isError }
    default:
      return {}
  }
}

function finalAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if ("role" in message && message.role === "assistant" && Array.isArray(message.content)) {
      return message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("")
    }
  }
  return ""
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd carriage && bun test test/node/agent-node.test.ts`
Expected: PASS — 1 test passing.

- [ ] **Step 6: Run the whole suite + typecheck**

Run: `cd carriage && bun test && bun run typecheck`
Expected: all tests PASS; `tsc --noEmit` prints nothing (exit 0).

- [ ] **Step 7: Commit**

```bash
git add carriage/src/node/types.ts carriage/src/node/agent-node.ts carriage/test/node/agent-node.test.ts
git commit -m "feat(carriage): Agent-node adapter over pi-agent-core with trace capture"
```

---

## Task 3: CLI (`carriage run --faux`, `carriage trace <file>`)

**Files:**
- Create: `carriage/src/cli/commands.ts`
- Create: `carriage/src/cli/index.ts`
- Test: `carriage/test/cli/cli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// carriage/test/cli/cli.test.ts
import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { TraceStore } from "../../src/trace/trace-store.ts"
import { runFauxDemo, formatTrace } from "../../src/cli/commands.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

test("runFauxDemo writes a trace file and returns its path", async () => {
  const dir = join(tmpdir(), `carriage-demo-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))

  const result = await runFauxDemo(dir)

  expect(result.text).toBe("done")
  const events = await (await TraceStore.open(result.tracePath)).read()
  expect(events.map((e) => e.type)).toContain("agent_end")
})

test("formatTrace renders one line per event as 'seq role type'", () => {
  const text = formatTrace([
    { seq: 0, ts: 1, role: "builder", type: "agent_start" },
    { seq: 1, ts: 2, role: "builder", type: "agent_end" },
  ])
  expect(text).toBe("0\tbuilder\tagent_start\n1\tbuilder\tagent_end")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd carriage && bun test test/cli/cli.test.ts`
Expected: FAIL — cannot find module `../../src/cli/commands.ts`.

- [ ] **Step 3: Write `carriage/src/cli/commands.ts`**

```ts
// carriage/src/cli/commands.ts
import { join } from "node:path"
import { registerFauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai"
import { TraceStore, type TraceEvent } from "../trace/trace-store.ts"
import { runAgentNode } from "../node/agent-node.ts"

export interface FauxDemoResult {
  text: string
  tracePath: string
}

/** Runs one faux Agent node end-to-end and writes its trace. No provider/keys needed. */
export async function runFauxDemo(traceDir: string): Promise<FauxDemoResult> {
  const reg = registerFauxProvider()
  try {
    reg.setResponses([fauxAssistantMessage("done", { stopReason: "stop" })])
    const tracePath = join(traceDir, "faux-demo.jsonl")
    const trace = await TraceStore.open(tracePath)
    const result = await runAgentNode(
      { role: "builder", model: reg.getModel(), systemPrompt: "Be terse.", input: "say done" },
      trace,
    )
    return { text: result.text, tracePath }
  } finally {
    reg.unregister()
  }
}

/** Renders a trace as one tab-separated line per event: `seq  role  type`. */
export function formatTrace(events: TraceEvent[]): string {
  return events
    .map((event) => `${event.seq}\t${event.role ?? "-"}\t${event.type}`)
    .join("\n")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd carriage && bun test test/cli/cli.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Write the thin dispatcher `carriage/src/cli/index.ts`**

```ts
// carriage/src/cli/index.ts
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TraceStore } from "../trace/trace-store.ts"
import { runFauxDemo, formatTrace } from "./commands.ts"

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (command === "run" && rest[0] === "--faux") {
    const dir = join(tmpdir(), `carriage-run-${Date.now()}`)
    const result = await runFauxDemo(dir)
    console.log(`text: ${result.text}`)
    console.log(`trace: ${result.tracePath}`)
    return 0
  }

  if (command === "trace" && rest[0]) {
    const events = await (await TraceStore.open(rest[0])).read()
    console.log(formatTrace(events))
    return 0
  }

  console.error("usage:\n  carriage run --faux\n  carriage trace <file.jsonl>")
  return 1
}

main(process.argv.slice(2)).then((code) => process.exit(code))
```

- [ ] **Step 6: Manually verify the CLI end-to-end**

Run: `cd carriage && bun run src/cli/index.ts run --faux`
Expected: prints `text: done` and `trace: <path>`.

Then run: `cd carriage && bun run src/cli/index.ts trace <path-from-above>`
Expected: prints `0\tbuilder\tagent_start` … through `…\tbuilder\tagent_end`.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `cd carriage && bun test && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add carriage/src/cli/commands.ts carriage/src/cli/index.ts carriage/test/cli/cli.test.ts
git commit -m "feat(carriage): CLI run --faux and trace pretty-printer"
```

---

## Self-Review

**Spec coverage (this slice = the Phase-0 adapter + TraceStore + CLI seam):**
- Agent-node adapter over `pi-agent-core` + `pi-ai` behind Carriage's own contract → Task 2 (`src/node/types.ts` is the contract; `agent-node.ts` is the only Pi-touching file). ✓
- `TraceStore` (append-only JSONL, queryable) → Task 1. ✓
- CLI `run` / `trace` → Task 3 (`run --faux` is the offline-testable form; real-provider `run` arrives in Plan 1b with the workflow). ✓
- Offline-first testing via Pi's faux provider → Tasks 2–3. ✓
- *Deferred to 1b/1c (intentionally not here):* `verify`, `convergence`, `MarkdownTracker`, run-isolation, decompose, the chess Oracle. Not a gap — see the plan decomposition.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `TraceStore.open()/append()/read()`, `TraceEvent { seq, ts, type, role?, … }`, `TraceInput { type, … }`, `runAgentNode(spec, trace)`, `AgentNodeSpec { role, model, systemPrompt, input, tools?, streamFn? }`, `AgentNodeResult { text, trace }`, `runFauxDemo(dir) → { text, tracePath }`, `formatTrace(events) → string` are used identically across all tasks. ✓

**Known risk to watch at execution:** the exact published version/export names of the Pi packages (`registerFauxProvider`, `fauxAssistantMessage`, `Agent`, `Model`, `StreamFn`, `TextContent`, `AgentEvent`, `AgentMessage`). These match `reference/pi` at `0.79.5`; if `bun install` pulls a different version and an import fails, reconcile against the installed package's `index.d.ts` (the names are exported from each package root).
