export interface OracleSignal {
  name: string
  pass: boolean
  detail?: string
}

export interface OracleResult {
  /** True only if every gating signal passes. */
  pass: boolean
  signals: OracleSignal[]
}

/**
 * Deterministic measurement node. A real Oracle (e.g. chess perft, Plan 1c)
 * measures a target; if it cannot measure (harness broken), `measure()` rejects —
 * which the convergence loop treats as "unmeasurable → escalate" (never "converged").
 */
export interface Oracle {
  measure(): Promise<OracleResult>
}

/** A fixed/scripted Oracle for tests and the offline demo. */
export class StubOracle implements Oracle {
  constructor(private readonly outcome: OracleResult | (() => Promise<OracleResult>)) {}

  measure(): Promise<OracleResult> {
    return typeof this.outcome === "function" ? this.outcome() : Promise.resolve(this.outcome)
  }
}
