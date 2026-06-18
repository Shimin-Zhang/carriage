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
