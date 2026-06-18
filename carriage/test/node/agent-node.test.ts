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

  expect(result.trace.every((e) => e.role === "builder")).toBe(true)
  expect(result.trace.every((e, i) => e.seq === i)).toBe(true)

  expect((await trace.read()).length).toBe(result.trace.length)
})
