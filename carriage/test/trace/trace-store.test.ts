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

test("append round-trips arbitrary payload fields", async () => {
  const store = await TraceStore.open(scratchPath())
  await store.append({ type: "tool_execution_end", role: "builder", toolName: "bash", isError: false })
  const [event] = await store.read()
  expect(event.type).toBe("tool_execution_end")
  expect(event.role).toBe("builder")
  expect(event.toolName).toBe("bash")
  expect(event.isError).toBe(false)
})

test("read() skips a malformed trailing line (crash mid-append) instead of throwing", async () => {
  const path = scratchPath()
  await Bun.write(
    path,
    '{"seq":0,"ts":1,"type":"a"}\n{"seq":1,"ts":2,"type":"b"}\n{"seq":2,"ts":3,"ty',
  )
  const store = await TraceStore.open(path)
  const events = await store.read()
  expect(events.map((e) => e.type)).toEqual(["a", "b"])
  await rm(path, { force: true })
})

test("open() resumes seq from the max valid record after a partial trailing line", async () => {
  const path = scratchPath()
  await Bun.write(
    path,
    '{"seq":0,"ts":1,"type":"a"}\n{"seq":1,"ts":2,"type":"b"}\n{"seq":2,"ts":3,"ty',
  )
  const store = await TraceStore.open(path)
  const next = await store.append({ type: "c" })
  expect(next.seq).toBe(2) // max parsed seq is 1 (the partial seq:2 line was skipped) → resume = 1 + 1 = 2
  await rm(path, { force: true })
})

test("open() throws on a malformed non-trailing line (real corruption, not a crash artifact)", async () => {
  const path = scratchPath()
  await Bun.write(path, '{"seq":0,"ts":1,"type":"a"}\nGARBAGE NOT JSON\n{"seq":2,"ts":3,"type":"c"}\n')
  await expect(TraceStore.open(path)).rejects.toThrow()
  await rm(path, { force: true })
})
