import { test, expect } from "bun:test"
import { convergeComponent } from "../../src/loop/converge-component.ts"
import { StubOracle, type OracleResult } from "../../src/eval/oracle.ts"
import type { Verdict } from "../../src/node/verdict.ts"
import type { ComponentStatus, Tracker } from "../../src/tracker/tracker.ts"

const PASS: OracleResult = { pass: true, signals: [] }
const FAIL: OracleResult = { pass: false, signals: [] }
const clean: Verdict = { findings: [] }
const blocker: Verdict = { findings: [{ severity: "blocker", dimension: "impl", message: "bug" }] }
const twoBlockers: Verdict = {
  findings: [
    { severity: "blocker", dimension: "impl", message: "a" },
    { severity: "blocker", dimension: "spec", message: "b" },
  ],
}

// minimal in-memory Tracker fake
function fakeTracker() {
  const map = new Map<string, ComponentStatus>()
  const tracker: Tracker = {
    setStatus: (c, s) => { map.set(c, s); return Promise.resolve() },
    getStatus: (c) => Promise.resolve(map.get(c)),
    openComponents: () => Promise.resolve([...map].filter(([, s]) => s === "open").map(([c]) => c)),
  }
  return { tracker, map }
}

// verify fake that replays scripted verdicts by iteration (1-based)
function scriptedVerify(verdicts: Verdict[]) {
  return (iteration: number) => Promise.resolve(verdicts[iteration - 1] ?? verdicts[verdicts.length - 1]!)
}

const noopBuilder = () => Promise.resolve()

test("converges on the first iteration when the verdict is clean and the Oracle passes", async () => {
  const { tracker, map } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "converged", iterations: 1 })
  expect(map.get("move-gen")).toBe("converged")
})

test("routes back then converges (blocker on iter 1, clean on iter 2)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([blocker, clean]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "converged", iterations: 2 })
})

test("escalates on oscillation when non-nitpick findings do not strictly decrease", async () => {
  const { tracker, map } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([twoBlockers, twoBlockers]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome.status).toBe("escalated")
  expect(outcome).toMatchObject({ reason: "no progress (oscillation)" })
  expect(map.get("move-gen")).toBe("escalated")
})

test("escalates on budget exhaustion when the Oracle never passes (no findings to oscillate on)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(FAIL),
    tracker,
    maxIterations: 3,
  })
  expect(outcome).toEqual({ status: "escalated", iterations: 3, reason: "budget exhausted" })
})

test("escalates when the Oracle is unmeasurable (measure rejects), preserving the cause", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(() => Promise.reject(new Error("engine build failed"))),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toEqual({ status: "escalated", iterations: 1, reason: "oracle unmeasurable: engine build failed" })
})

test("escalates immediately when maxIterations is 0", async () => {
  const { tracker, map } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([clean]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 0,
  })
  expect(outcome).toEqual({ status: "escalated", iterations: 0, reason: "budget exhausted" })
  expect(map.get("move-gen")).toBe("escalated")
})

test("escalates when progress stalls after decreasing (2 unresolved -> 1 -> 1)", async () => {
  const { tracker } = fakeTracker()
  const outcome = await convergeComponent({
    component: "move-gen",
    builder: noopBuilder,
    verify: scriptedVerify([twoBlockers, blocker, blocker]),
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(outcome).toMatchObject({ status: "escalated", iterations: 3, reason: "no progress (oscillation)" })
})

test("calls builder and verify with the 1-based iteration number", async () => {
  const { tracker } = fakeTracker()
  const builderCalls: number[] = []
  const verifyCalls: number[] = []
  await convergeComponent({
    component: "move-gen",
    builder: (i) => { builderCalls.push(i); return Promise.resolve() },
    verify: (i) => { verifyCalls.push(i); return Promise.resolve(i === 1 ? blocker : clean) },
    oracle: new StubOracle(PASS),
    tracker,
    maxIterations: 5,
  })
  expect(builderCalls).toEqual([1, 2])
  expect(verifyCalls).toEqual([1, 2])
})
