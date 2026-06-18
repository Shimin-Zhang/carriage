import { Type, type Static } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { TraceStore, TraceEvent } from "../trace/trace-store.ts"
import type { AgentNodeSpec } from "./types.ts"
import type { Verdict } from "./verdict.ts"
import { runAgentNode } from "./agent-node.ts"

const VerdictSchema = Type.Object({
  findings: Type.Array(
    Type.Object({
      severity: Type.Union([
        Type.Literal("blocker"),
        Type.Literal("major"),
        Type.Literal("minor"),
        Type.Literal("nitpick"),
      ]),
      dimension: Type.Union([Type.Literal("spec"), Type.Literal("test"), Type.Literal("impl")]),
      message: Type.String(),
    }),
  ),
})

// Compile-time guard: VerdictSchema must stay structurally in sync with the Verdict type.
true satisfies Static<typeof VerdictSchema> extends Verdict ? true : false
true satisfies Verdict extends Static<typeof VerdictSchema> ? true : false

/** A single-purpose tool the checker calls to submit its structured verdict. */
export function makeVerdictTool(onCapture: (verdict: Verdict) => void): AgentTool<typeof VerdictSchema, Verdict> {
  return {
    name: "submit_verdict",
    description:
      "Submit your review verdict by calling this exactly once with all findings. Use severity 'nitpick' only for trivial wording; anything substantive is 'minor', 'major', or 'blocker'.",
    parameters: VerdictSchema,
    label: "submit verdict",
    execute: async (_toolCallId, params) => {
      const verdict = params as Verdict
      onCapture(verdict)
      return { content: [{ type: "text", text: "verdict recorded" }], details: verdict, terminate: true }
    },
  }
}

/** The spec for a checker run is an Agent-node spec with its tools fixed to the verdict tool. */
export type VerifySpec = Omit<AgentNodeSpec, "tools">

export interface VerifyResult {
  verdict: Verdict
  trace: TraceEvent[]
}

export async function runVerify(spec: VerifySpec, trace: TraceStore): Promise<VerifyResult> {
  let captured: Verdict | undefined
  const tool = makeVerdictTool((verdict) => {
    if (captured !== undefined) throw new Error("checker submitted a verdict more than once")
    captured = verdict
  })

  const result = await runAgentNode({ ...spec, tools: [tool] }, trace)

  if (captured === undefined) {
    throw new Error("checker did not submit a verdict (no submit_verdict tool call)")
  }
  return { verdict: captured, trace: result.trace }
}
