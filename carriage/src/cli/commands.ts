import { join } from "node:path"
import { registerFauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai"
import { TraceStore, type TraceEvent } from "../trace/trace-store.ts"
import { runAgentNode } from "../node/agent-node.ts"

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
