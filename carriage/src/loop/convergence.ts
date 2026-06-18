import type { Verdict } from "../node/verdict.ts"
import type { OracleResult } from "../eval/oracle.ts"

export type ConvergenceVerdict = { converged: true } | { converged: false; reason: string }

/**
 * The convergence guard (spec §6.3). The Oracle invariant (§4.3 #2): the Oracle is a
 * GATING term — convergence requires `oracle.pass`. The stochastic adversary can only
 * withhold convergence (an unresolved non-nitpick finding), never grant it alone.
 */
export interface ConvergenceInput {
  verdict: Verdict
  oracle: OracleResult
}

export function convergence(input: ConvergenceInput): ConvergenceVerdict {
  if (!input.oracle.pass) return { converged: false, reason: "oracle not passing" }
  const unresolved = input.verdict.findings.filter((finding) => finding.severity !== "nitpick")
  if (unresolved.length > 0) return { converged: false, reason: `${unresolved.length} unresolved finding(s)` }
  return { converged: true }
}
