import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { registerFauxProvider, fauxAssistantMessage, fauxThinking } from "@earendil-works/pi-ai"
import { TraceStore, type TraceEvent } from "../../src/trace/trace-store.ts"
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

  expect(result.trace.every((e) => e.role === "builder")).toBe(true)
  expect(result.trace.every((e, i) => e.seq === i)).toBe(true)

  expect((await trace.read()).length).toBe(result.trace.length)
})

test("runAgentNode surfaces a trace-write failure instead of returning bogus empty success", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([fauxAssistantMessage("done", { stopReason: "stop" })])

  // Fails on the first append (simulating disk-full mid-run) but succeeds on
  // subsequent calls (pi's error-recovery events).  Without the fix, pi catches
  // the throw from our subscriber, emits synthetic failure events that our
  // subscriber appends successfully, and runAgentNode resolves with text: ""
  // instead of rejecting — a silent data-loss bug.
  let callCount = 0
  const failingTrace = {
    append: () => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error("disk full"))
      return Promise.resolve({ seq: callCount, role: "builder", type: "agent_start", ts: Date.now() } as TraceEvent)
    },
  } as unknown as TraceStore

  await expect(
    runAgentNode({ role: "builder", model: reg.getModel(), systemPrompt: "x", input: "hi" }, failingTrace),
  ).rejects.toThrow("disk full")
})

test("runAgentNode returns empty text when the assistant produces no text", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([fauxAssistantMessage([fauxThinking("thinking, no text")], { stopReason: "stop" })])

  const path = join(tmpdir(), `carriage-node-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)

  const result = await runAgentNode(
    { role: "builder", model: reg.getModel(), systemPrompt: "Be terse.", input: "hi" },
    trace,
  )

  expect(result.text).toBe("")
  expect(result.trace.map((e) => e.type)).toContain("agent_end")
})
