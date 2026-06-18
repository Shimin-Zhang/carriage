import type { Model } from "@earendil-works/pi-ai"
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core"
import type { TraceEvent } from "../trace/trace-store.ts"

/**
 * Carriage's own Agent-node contract. The workflow/graph layer depends ONLY on
 * this; `runAgentNode` is the single adapter binding it to pi-agent-core + pi-ai.
 * Swapping Pi later means swapping the adapter, not this contract.
 */
export interface AgentNodeSpec {
  /** e.g. "builder" | "checker" — recorded on every trace event for this node. */
  role: string
  /** A pi-ai Model (real provider model, or a faux model in tests). */
  model: Model<string>
  systemPrompt: string
  /** The user prompt that starts this node's single loop. */
  input: string
  tools?: AgentTool[]
  /** Optional stream-function override (unused in normal runs; the faux model routes via the api registry). */
  streamFn?: StreamFn
}

export interface AgentNodeResult {
  /** The final assistant text produced by the loop. */
  text: string
  /** The trace events captured (and persisted) during the run, in order. */
  trace: TraceEvent[]
}
