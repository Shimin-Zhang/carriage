import { test, expect } from "bun:test"
import { StubOracle, type OracleResult } from "../../src/eval/oracle.ts"

const RESULT: OracleResult = { pass: true, signals: [{ name: "stub", pass: true }] }

test("StubOracle returns a fixed result (value path)", async () => {
  expect(await new StubOracle(RESULT).measure()).toEqual(RESULT)
})

test("StubOracle calls the thunk on measure (function path)", async () => {
  expect(await new StubOracle(() => Promise.resolve(RESULT)).measure()).toEqual(RESULT)
})
