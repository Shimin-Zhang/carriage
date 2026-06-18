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
  expect(result.verdict.findings[0]!.message).toBe("missing edge case")
  expect(result.trace.map((e) => e.type)).toContain("agent_end")
})

test("runVerify throws when the checker never calls submit_verdict", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([fauxAssistantMessage("no tool call here", { stopReason: "stop" })])

  const path = join(tmpdir(), `carriage-verify-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)

  await expect(
    runVerify({ role: "checker", model: reg.getModel(), systemPrompt: "Review.", input: "review" }, trace),
  ).rejects.toThrow("checker did not submit a verdict")
})

test("runVerify rejects when the checker submits more than one verdict", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  // pi executes all tool calls in a turn before honoring terminate, so both submit_verdict calls fire.
  reg.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("submit_verdict", { findings: [] }),
        fauxToolCall("submit_verdict", { findings: [{ severity: "blocker", dimension: "spec", message: "x" }] }),
      ],
      { stopReason: "toolUse" },
    ),
  ])
  const path = join(tmpdir(), `carriage-verify-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)
  await expect(
    runVerify({ role: "checker", model: reg.getModel(), systemPrompt: "Review.", input: "review" }, trace),
  ).rejects.toThrow("submitted 2 verdicts")
})

test("runVerify strips extra fields from the submitted verdict", async () => {
  const reg = registerFauxProvider()
  cleanups.push(() => reg.unregister())
  reg.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("submit_verdict", { findings: [{ severity: "blocker", dimension: "spec", message: "x", note: "leak" }] })],
      { stopReason: "toolUse" },
    ),
  ])
  const path = join(tmpdir(), `carriage-verify-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  cleanups.push(() => rm(path, { force: true }))
  const trace = await TraceStore.open(path)
  const result = await runVerify({ role: "checker", model: reg.getModel(), systemPrompt: "Review.", input: "review" }, trace)
  expect(result.verdict.findings[0]).toEqual({ severity: "blocker", dimension: "spec", message: "x" })
  expect((result.verdict.findings[0] as unknown as Record<string, unknown>).note).toBeUndefined()
})
