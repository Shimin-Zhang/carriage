import { test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { CommandEngineAdapter } from "../../../src/eval/chess/command-engine-adapter.ts"
import { ChessOracle } from "../../../src/eval/chess/chess-oracle.ts"
import { PERFT_POSITIONS } from "../../../src/eval/chess/perft-reference.ts"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

const STARTPOS = PERFT_POSITIONS.find((p) => p.name === "startpos")!.fen

// A throwaway "engine": prints a perft count for startpos depths 1-3 from a hardcoded table.
// `mode` selects correct / buggy (depth-3 off by two) / crash (always non-zero exit).
function engineScript(mode: "correct" | "buggy" | "crash" | "garbage" | "empty"): string {
  return `
const depth = process.argv[3]
if (${JSON.stringify(mode)} === "crash") process.exit(1)
if (${JSON.stringify(mode)} === "empty") process.exit(0)
if (${JSON.stringify(mode)} === "garbage") { console.log("8902 nodes searched"); process.exit(0) }
const table = { "1": 20, "2": 400, "3": ${mode === "buggy" ? 8900 : 8902} }
const n = table[depth]
if (n === undefined) process.exit(3)
console.log(n)
`
}

async function writeEngine(mode: "correct" | "buggy" | "crash" | "garbage" | "empty"): Promise<string> {
  const dir = join(tmpdir(), `carriage-engine-${process.pid}-${Math.floor(performance.now() * 1000)}`)
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "engine.ts"), engineScript(mode))
  return dir
}

function adapterFor(dir: string): CommandEngineAdapter {
  return new CommandEngineAdapter({
    cwd: dir,
    perftCommand: (depth, fen) => ["bun", "run", join(dir, "engine.ts"), "perft", String(depth), fen],
  })
}

test("perft() runs the engine command and parses the node count", async () => {
  const adapter = adapterFor(await writeEngine("correct"))
  expect(await adapter.perft(3, STARTPOS)).toBe(8902)
})

test("perft() rejects when the engine exits non-zero (unmeasurable)", async () => {
  const adapter = adapterFor(await writeEngine("crash"))
  await expect(adapter.perft(3, STARTPOS)).rejects.toThrow()
})

test("ChessOracle over a correct engine passes; over a buggy engine fails", async () => {
  const startposOnly = PERFT_POSITIONS.filter((p) => p.name === "startpos")

  const good = new ChessOracle({ adapter: adapterFor(await writeEngine("correct")), positions: startposOnly, maxDepth: 3 })
  expect((await good.measure()).pass).toBe(true)

  const bad = new ChessOracle({ adapter: adapterFor(await writeEngine("buggy")), positions: startposOnly, maxDepth: 3 })
  const badResult = await bad.measure()
  expect(badResult.pass).toBe(false)
  expect(badResult.signals.find((s) => !s.pass)!.name).toBe("perft startpos d3")
})

test("perft() rejects when the engine prints non-numeric (trailing-garbage) output", async () => {
  const adapter = adapterFor(await writeEngine("garbage"))
  await expect(adapter.perft(3, STARTPOS)).rejects.toThrow("did not return a number")
})

test("perft() rejects when the engine exits 0 with no output (unmeasurable, not a zero count)", async () => {
  const adapter = adapterFor(await writeEngine("empty"))
  await expect(adapter.perft(3, STARTPOS)).rejects.toThrow("did not return a number")
})
