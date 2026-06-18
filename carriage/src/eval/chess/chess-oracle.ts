import type { Oracle, OracleResult, OracleSignal } from "../oracle.ts"
import type { EngineAdapter } from "./engine-adapter.ts"
import { PERFT_POSITIONS, type PerftPosition } from "./perft-reference.ts"

export interface ChessOracleOptions {
  adapter: EngineAdapter
  /** Which positions to check (default: the full reference battery). */
  positions?: PerftPosition[]
  /** Skip any reference depth greater than this (default: no limit). */
  maxDepth?: number
}

/**
 * Real perft Oracle (spec §7). Each (position, depth) in the reference battery becomes a gating
 * signal: pass iff the engine's perft equals the community-verified count. `measure()` rejects if
 * the engine can't run (unmeasurable → the loop escalates, per the Oracle invariant §4.3 #2).
 */
export class ChessOracle implements Oracle {
  constructor(private readonly options: ChessOracleOptions) {}

  async measure(): Promise<OracleResult> {
    const positions = this.options.positions ?? PERFT_POSITIONS
    const signals: OracleSignal[] = []

    for (const position of positions) {
      for (const depth of depthsFor(position, this.options.maxDepth)) {
        const expected = position.counts[depth]!
        const actual = await this.options.adapter.perft(depth, position.fen)
        signals.push({
          name: `perft ${position.name} d${depth}`,
          pass: actual === expected,
          detail: actual === expected ? undefined : `expected ${expected}, got ${actual}`,
        })
      }
    }

    if (signals.length === 0) {
      throw new Error("ChessOracle: no perft checks to run (empty battery or maxDepth filtered everything out)")
    }
    return { pass: signals.every((signal) => signal.pass), signals }
  }
}

function depthsFor(position: PerftPosition, maxDepth: number | undefined): number[] {
  return Object.keys(position.counts)
    .map(Number)
    .filter((depth) => maxDepth === undefined || depth <= maxDepth)
    .sort((a, b) => a - b)
}
