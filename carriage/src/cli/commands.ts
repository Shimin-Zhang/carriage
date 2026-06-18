import { $ } from "bun"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registerFauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai"
import { TraceStore, type TraceEvent } from "../trace/trace-store.ts"
import { runAgentNode } from "../node/agent-node.ts"
import { runVerify } from "../node/verify.ts"
import { convergeComponent, type ConvergeOutcome } from "../loop/converge-component.ts"
import { StubOracle } from "../eval/oracle.ts"
import { MarkdownTracker } from "../tracker/markdown-tracker.ts"
import { Workspace } from "../run/workspace.ts"
import { ChessOracle } from "../eval/chess/chess-oracle.ts"
import { CommandEngineAdapter } from "../eval/chess/command-engine-adapter.ts"
import { PERFT_POSITIONS } from "../eval/chess/perft-reference.ts"

export interface FauxDemoResult {
  text: string
  tracePath: string
}

/** Runs one faux Agent node end-to-end and writes its trace. No provider/keys needed. */
export async function runFauxDemo(traceDir: string): Promise<FauxDemoResult> {
  const reg = registerFauxProvider()
  try {
    reg.setResponses([fauxAssistantMessage("done", { stopReason: "stop" })])
    const tracePath = join(traceDir, "faux-demo.jsonl")
    const trace = await TraceStore.open(tracePath)
    const result = await runAgentNode(
      { role: "builder", model: reg.getModel(), systemPrompt: "Be terse.", input: "say done" },
      trace,
    )
    return { text: result.text, tracePath }
  } finally {
    reg.unregister()
  }
}

/** Renders a trace as one tab-separated line per event: `seq  role  type`. */
export function formatTrace(events: TraceEvent[]): string {
  return events
    .map((event) => `${event.seq}\t${(event.role as string | undefined) ?? "-"}\t${event.type}`)
    .join("\n")
}

export interface ConvergeDemoResult {
  outcome: ConvergeOutcome
  ledgerPath: string
  targetRev: string
  tracePath: string
}

/** Creates a throwaway git fixture to act as the isolation target for the demo. */
async function createFixtureTarget(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email demo@example.com`.quiet()
  await $`git -C ${dir} config user.name Demo`.quiet()
  await writeFile(join(dir, "engine.txt"), "vibe-coded move generator\n")
  await $`git -C ${dir} add .`.quiet()
  await $`git -C ${dir} commit -q -m "initial vibe-coded engine"`.quiet()
  return dir
}

/**
 * Offline demo: isolate a fixture target in a worktree, then drive one component through the
 * convergence loop with a faux builder + faux checker (blocker -> clean) against a passing stub Oracle.
 */
export async function runConvergeDemo(workDir: string): Promise<ConvergeDemoResult> {
  const reg = registerFauxProvider()
  let workspace: Workspace | undefined
  try {
    // Call order across two iterations: builder(1), checker(1)=blocker, builder(2), checker(2)=clean.
    reg.setResponses([
      fauxAssistantMessage("drafting move-gen", { stopReason: "stop" }),
      fauxAssistantMessage(
        [fauxToolCall("submit_verdict", { findings: [{ severity: "blocker", dimension: "impl", message: "off-by-one" }] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("fixing off-by-one", { stopReason: "stop" }),
      fauxAssistantMessage([fauxToolCall("submit_verdict", { findings: [] })], { stopReason: "toolUse" }),
    ])

    const target = await createFixtureTarget(join(workDir, "target-src"))
    workspace = await Workspace.create({ targetRepo: target, runRoot: join(workDir, "run") })

    const model = reg.getModel()
    const tracePath = workspace.tracePath("demo")
    const tracker = await MarkdownTracker.open(workspace.ledgerPath)
    const trace = await TraceStore.open(tracePath)

    const outcome = await convergeComponent({
      component: "move-gen",
      builder: async (i) => {
        await runAgentNode({ role: "builder", model, systemPrompt: "Implement move-gen.", input: `iteration ${i}` }, trace)
      },
      verify: async (i) =>
        (await runVerify({ role: "checker", model, systemPrompt: "Review move-gen.", input: `review ${i}` }, trace)).verdict,
      oracle: new StubOracle({ pass: true, signals: [{ name: "stub-perft", pass: true }] }),
      tracker,
      maxIterations: 5,
    })

    return { outcome, ledgerPath: workspace.ledgerPath, targetRev: workspace.targetRev, tracePath }
  } finally {
    try {
      await workspace?.dispose()
    } finally {
      reg.unregister()
    }
  }
}

export interface ChessConvergeDemoResult {
  outcome: ConvergeOutcome
  ledgerPath: string
  targetRev: string
  tracePath: string
}

/** Writes a throwaway "chess engine" repo whose perft is correct or has a seeded bug. */
async function createChessEngineTarget(dir: string, mode: "correct" | "buggy"): Promise<string> {
  await mkdir(dir, { recursive: true })
  const table = `{ "1": 20, "2": 400, "3": ${mode === "buggy" ? 8900 : 8902} }`
  const engine = `const depth = process.argv[3]\nconst table = ${table}\nconst n = table[depth]\nif (n === undefined) process.exit(3)\nconsole.log(n)\n`
  await writeFile(join(dir, "engine.ts"), engine)
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email demo@example.com`.quiet()
  await $`git -C ${dir} config user.name Demo`.quiet()
  await $`git -C ${dir} add .`.quiet()
  await $`git -C ${dir} commit -q -m "initial engine"`.quiet()
  return dir
}

/**
 * Offline demo: isolate a chess-engine fixture, then run the convergence loop with a faux builder
 * + faux clean checker, gated by the REAL ChessOracle (perft). A correct engine converges; a buggy
 * one fails perft so the Oracle gates and the loop escalates.
 */
export async function runChessConvergeDemo(workDir: string, mode: "correct" | "buggy"): Promise<ChessConvergeDemoResult> {
  const reg = registerFauxProvider()
  let workspace: Workspace | undefined
  try {
    // The faux builder does nothing each iteration; the checker always submits a clean verdict.
    // With maxIterations 3, a buggy engine (perft fails) burns the budget and escalates.
    reg.setResponses(
      Array.from({ length: 3 }).flatMap(() => [
        fauxAssistantMessage("working on the engine", { stopReason: "stop" }),
        fauxAssistantMessage([fauxToolCall("submit_verdict", { findings: [] })], { stopReason: "toolUse" }),
      ]),
    )

    const target = await createChessEngineTarget(join(workDir, "target-src"), mode)
    workspace = await Workspace.create({ targetRepo: target, runRoot: join(workDir, "run") })

    const model = reg.getModel()
    const tracePath = workspace.tracePath("chess")
    const tracker = await MarkdownTracker.open(workspace.ledgerPath)
    const trace = await TraceStore.open(tracePath)
    const startposOnly = PERFT_POSITIONS.filter((position) => position.name === "startpos")
    const oracle = new ChessOracle({
      adapter: new CommandEngineAdapter({
        cwd: workspace.targetDir,
        perftCommand: (depth, fen) => ["bun", "run", "engine.ts", "perft", String(depth), fen],
      }),
      positions: startposOnly,
      maxDepth: 3,
    })

    const outcome = await convergeComponent({
      component: "move-gen",
      builder: async (i) => {
        await runAgentNode({ role: "builder", model, systemPrompt: "Work on move-gen.", input: `iteration ${i}` }, trace)
      },
      verify: async (i) =>
        (await runVerify({ role: "checker", model, systemPrompt: "Review move-gen.", input: `review ${i}` }, trace)).verdict,
      oracle,
      tracker,
      maxIterations: 3,
    })

    return { outcome, ledgerPath: workspace.ledgerPath, targetRev: workspace.targetRev, tracePath }
  } finally {
    try {
      await workspace?.dispose()
    } finally {
      reg.unregister()
    }
  }
}
