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
  await tracker.setStatus("search", "escalated")

  expect(await tracker.getStatus("move-gen")).toBe("converged")
  expect(await tracker.getStatus("board-rep")).toBe("converged")
  expect(await tracker.getStatus("search")).toBe("escalated")
  expect(await tracker.getStatus("absent")).toBeUndefined()
  expect(await tracker.openComponents()).toEqual([])

  const text = await Bun.file(path).text()
  expect(text).toContain("- move-gen: converged")
  expect(text).toContain("- board-rep: converged")
  expect(text).toContain("- search: escalated")

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

test("open() on a missing file returns an empty tracker", async () => {
  const tracker = await MarkdownTracker.open(ledgerPath())
  expect(await tracker.openComponents()).toEqual([])
  expect(await tracker.getStatus("anything")).toBeUndefined()
})
