import { test, expect } from "bun:test"
import { convergence } from "../../src/loop/convergence.ts"
import type { Verdict } from "../../src/node/verdict.ts"
import type { OracleResult } from "../../src/eval/oracle.ts"

const PASS: OracleResult = { pass: true, signals: [{ name: "stub", pass: true }] }
const FAIL: OracleResult = { pass: false, signals: [{ name: "stub", pass: false }] }
const NO_FINDINGS: Verdict = { findings: [] }
const NITPICK: Verdict = { findings: [{ severity: "nitpick", dimension: "spec", message: "wording" }] }
const BLOCKER: Verdict = { findings: [{ severity: "blocker", dimension: "impl", message: "bug" }] }

test("converges only when the Oracle passes AND no finding exceeds nitpick", () => {
  expect(convergence({ verdict: NO_FINDINGS, oracle: PASS })).toEqual({ converged: true })
  expect(convergence({ verdict: NITPICK, oracle: PASS })).toEqual({ converged: true })
})

test("the Oracle is a gating term: a failing Oracle blocks convergence even with no findings", () => {
  expect(convergence({ verdict: NO_FINDINGS, oracle: FAIL })).toEqual({ converged: false, reason: "oracle not passing" })
})

test("a non-nitpick finding blocks convergence even when the Oracle passes", () => {
  expect(convergence({ verdict: BLOCKER, oracle: PASS })).toEqual({ converged: false, reason: "1 unresolved finding(s)" })
})
