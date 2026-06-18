import { convergence } from "./convergence.ts"
import { unresolvedCount, type Verdict } from "../node/verdict.ts"
import type { Oracle, OracleResult } from "../eval/oracle.ts"
import type { Tracker } from "../tracker/tracker.ts"

export interface ConvergeComponentOptions {
  component: string
  builder: (iteration: number) => Promise<void>
  verify: (iteration: number) => Promise<Verdict>
  oracle: Oracle
  tracker: Tracker
  maxIterations: number
}

export type ConvergeOutcome =
  | { status: "converged"; iterations: number }
  | { status: "escalated"; iterations: number; reason: string }

export async function convergeComponent(opts: ConvergeComponentOptions): Promise<ConvergeOutcome> {
  await opts.tracker.setStatus(opts.component, "open")
  let previousUnresolved = Number.POSITIVE_INFINITY

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    await opts.builder(iteration)
    const verdict = await opts.verify(iteration)

    let oracle: OracleResult
    try {
      oracle = await opts.oracle.measure()
    } catch (error) {
      // "Can't measure" never means "converged" (spec §9). Preserve the cause for the Architect.
      const detail = error instanceof Error ? error.message : String(error)
      return escalate(opts, iteration, `oracle unmeasurable: ${detail}`)
    }

    if (oracle.signals.length === 0) {
      return escalate(opts, iteration, "oracle reported no signals (unmeasurable)")
    }

    if (convergence({ verdict, oracle }).converged) {
      await opts.tracker.setStatus(opts.component, "converged")
      return { status: "converged", iterations: iteration }
    }

    const unresolved = unresolvedCount(verdict)
    if (unresolved > 0 && unresolved >= previousUnresolved) {
      return escalate(opts, iteration, "no progress (oscillation)")
    }
    previousUnresolved = unresolved
  }

  // clamp: a negative maxIterations never enters the loop; report 0, not a negative count
  return escalate(opts, Math.max(0, opts.maxIterations), "budget exhausted")
}

async function escalate(opts: ConvergeComponentOptions, iterations: number, reason: string): Promise<ConvergeOutcome> {
  await opts.tracker.setStatus(opts.component, "escalated")
  return { status: "escalated", iterations, reason }
}
