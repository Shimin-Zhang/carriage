import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir, rm, writeFile, readFile, stat } from "node:fs/promises"
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
  expect(await readFile(join(ws2.targetDir, "file.txt"), "utf8")).toBe("original\n")
  await ws2.dispose()

  // dispose removes the isolated checkout but leaves the run artifacts root
  await ws.dispose()
  expect(await Bun.file(join(ws.targetDir, "file.txt")).exists()).toBe(false)
  // the run-artifacts root persists after the worktree is disposed
  expect((await stat(ws.runRoot)).isDirectory()).toBe(true)
})

test("Workspace pins the checkout to an explicit rev", async () => {
  const target = await fixtureRepo()
  const firstSha = (await $`git -C ${target} rev-parse HEAD`.text()).trim()
  await writeFile(join(target, "file.txt"), "second\n")
  await $`git -C ${target} commit -q -am second`.quiet()

  const runRoot = join(tmpdir(), `carriage-run-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(runRoot, { recursive: true, force: true }))

  const ws = await Workspace.create({ targetRepo: target, rev: firstSha, runRoot })
  expect(ws.targetRev).toBe(firstSha)
  expect(await readFile(join(ws.targetDir, "file.txt"), "utf8")).toBe("original\n")
  await ws.dispose()
})

test("tracePath rejects an unsafe runId and accepts a safe token", async () => {
  const target = await fixtureRepo()
  const runRoot = join(tmpdir(), `carriage-run-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(runRoot, { recursive: true, force: true }))

  const ws = await Workspace.create({ targetRepo: target, runRoot })
  expect(ws.tracePath("demo")).toBe(join(runRoot, "traces", "demo.jsonl"))
  expect(() => ws.tracePath("../escape")).toThrow("invalid runId")
  await ws.dispose()
})
