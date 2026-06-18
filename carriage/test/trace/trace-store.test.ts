import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import { TraceStore } from "../../src/trace/trace-store.ts"

const scratchPaths: string[] = []
function scratchPath() {
  const path = join(tmpdir(), `carriage-trace-${process.pid}-${Math.floor(performance.now() * 1000)}.jsonl`)
  scratchPaths.push(path)
  return path
}

afterEach(async () => {
  for (const path of scratchPaths.splice(0)) await rm(path, { force: true })
})

test("read() on a new store returns an empty array", async () => {
  const store = await TraceStore.open(scratchPath())
  expect(await store.read()).toEqual([])
})

test("append assigns increasing seq and read returns the records in order", async () => {
  const store = await TraceStore.open(scratchPath())

  const a = await store.append({ role: "builder", type: "agent_start" })
  const b = await store.append({ role: "builder", type: "agent_end" })

  expect(a.seq).toBe(0)
  expect(b.seq).toBe(1)
  expect(typeof a.ts).toBe("number")

  const read = await store.read()
  expect(read.map((e) => e.type)).toEqual(["agent_start", "agent_end"])
  expect(read.map((e) => e.seq)).toEqual([0, 1])
})

test("open() resumes seq from an existing file", async () => {
  const path = scratchPath()
  const first = await TraceStore.open(path)
  await first.append({ type: "agent_start" })

  const second = await TraceStore.open(path)
  const next = await second.append({ type: "agent_end" })

  expect(next.seq).toBe(1)
  expect((await second.read()).length).toBe(2)
})
