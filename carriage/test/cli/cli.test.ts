import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { TraceStore } from "../../src/trace/trace-store.ts"
import { runFauxDemo, formatTrace, runConvergeDemo, runChessConvergeDemo } from "../../src/cli/commands.ts"
import { MarkdownTracker } from "../../src/tracker/markdown-tracker.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

test("runFauxDemo writes a trace file and returns its path", async () => {
  const dir = join(tmpdir(), `carriage-demo-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))

  const result = await runFauxDemo(dir)

  expect(result.text).toBe("done")
  expect(result.tracePath).toStartWith(dir)
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

test("formatTrace falls back to '-' for events without a role", () => {
  expect(formatTrace([{ seq: 0, ts: 0, type: "ping" }])).toBe("0\t-\tping")
})

test("runConvergeDemo drives a faux component to convergence inside an isolated workspace and writes the ledger", async () => {
  const dir = join(tmpdir(), `carriage-converge-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))

  const result = await runConvergeDemo(dir)

  expect(result.outcome.status).toBe("converged")
  expect(result.targetRev).toMatch(/^[0-9a-f]{40}$/)

  // ledger persists after the isolated worktree is disposed
  const tracker = await MarkdownTracker.open(result.ledgerPath)
  expect(await tracker.getStatus("move-gen")).toBe("converged")

  const events = await (await TraceStore.open(result.tracePath)).read()
  expect(events.length).toBeGreaterThan(0)
  expect(events.map((e) => e.type)).toContain("agent_end")
})

test("runChessConvergeDemo: a correct engine converges (real perft gating)", async () => {
  const dir = join(tmpdir(), `carriage-chess-ok-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const result = await runChessConvergeDemo(dir, "correct")
  expect(result.outcome.status).toBe("converged")
  const events = await (await TraceStore.open(result.tracePath)).read()
  expect(events.length).toBeGreaterThan(0)
})

test("runChessConvergeDemo: a buggy engine does NOT converge (perft gates, loop escalates)", async () => {
  const dir = join(tmpdir(), `carriage-chess-bad-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const result = await runChessConvergeDemo(dir, "buggy")
  expect(result.outcome.status).toBe("escalated")
})
