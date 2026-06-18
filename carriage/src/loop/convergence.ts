import { unresolvedCount, type Verdict } from "../node/verdict.ts"
import type { OracleResult } from "../eval/oracle.ts"

export interface ConvergenceInput {
  verdict: Verdict
  oracle: OracleResult
}

export type ConvergenceVerdict = { converged: true } | { converged: false; reason: string }

/**
 * The convergence guard (spec §6.3). The Oracle invariant (§4.3 #2): the Oracle is a
 * GATING term — convergence requires `oracle.pass`. The stochastic adversary can only
 * withhold convergence (an unresolved non-nitpick finding), never grant it alone.
 */
export function convergence(input: ConvergenceInput): ConvergenceVerdict {
  if (!input.oracle.pass) return { converged: false, reason: "oracle not passing" }
  if (input.oracle.signals.length === 0) return { converged: false, reason: "oracle reported no signals (unmeasurable)" }
  const unresolved = unresolvedCount(input.verdict)
  if (unresolved > 0) return { converged: false, reason: `${unresolved} unresolved finding(s)` }
  return { converged: true }
}
