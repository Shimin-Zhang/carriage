import { test, expect } from "bun:test"
import { ChessOracle } from "../../../src/eval/chess/chess-oracle.ts"
import { PERFT_POSITIONS } from "../../../src/eval/chess/perft-reference.ts"
import type { EngineAdapter } from "../../../src/eval/chess/engine-adapter.ts"

// returns the exact reference count for any (depth, fen) it is asked about
const correctAdapter: EngineAdapter = {
  perft: (depth, fen) => {
    const position = PERFT_POSITIONS.find((p) => p.fen === fen)!
    return Promise.resolve(position.counts[depth]!)
  },
}

test("converged (pass) when every perft matches the reference", async () => {
  const result = await new ChessOracle({ adapter: correctAdapter }).measure()
  expect(result.pass).toBe(true)
  expect(result.signals.length).toBeGreaterThan(0)
  expect(result.signals.every((s) => s.pass)).toBe(true)
})

test("fails (measurable) when a perft count is wrong, with a detail explaining the mismatch", async () => {
  const buggyAdapter: EngineAdapter = {
    perft: (depth, fen) => {
      const position = PERFT_POSITIONS.find((p) => p.fen === fen)!
      const truth = position.counts[depth]!
      // corrupt exactly one check: kiwipete depth 2
      if (position.name === "kiwipete" && depth === 2) return Promise.resolve(truth + 1)
      return Promise.resolve(truth)
    },
  }
  const result = await new ChessOracle({ adapter: buggyAdapter }).measure()
  expect(result.pass).toBe(false)
  const bad = result.signals.find((s) => !s.pass)!
  expect(bad.name).toContain("kiwipete")
  expect(bad.detail).toContain("expected 2039")
})

test("measure() rejects (unmeasurable) when the adapter cannot run perft", async () => {
  const brokenAdapter: EngineAdapter = {
    perft: () => Promise.reject(new Error("engine build failed")),
  }
  await expect(new ChessOracle({ adapter: brokenAdapter }).measure()).rejects.toThrow("engine build failed")
})

test("maxDepth limits which depths are checked", async () => {
  const result = await new ChessOracle({ adapter: correctAdapter, maxDepth: 1 }).measure()
  expect(result.signals.every((s) => s.name.endsWith("d1"))).toBe(true)
})

test("positions option restricts the battery", async () => {
  const startpos = PERFT_POSITIONS.filter((p) => p.name === "startpos")
  const result = await new ChessOracle({ adapter: correctAdapter, positions: startpos, maxDepth: 2 }).measure()
  expect(result.signals.map((s) => s.name)).toEqual(["perft startpos d1", "perft startpos d2"])
})

test("measure() rejects when the battery is empty (no evidence is not convergence)", async () => {
  await expect(new ChessOracle({ adapter: correctAdapter, positions: [] }).measure()).rejects.toThrow("no perft checks")
})
