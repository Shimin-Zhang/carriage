import { Agent } from "@earendil-works/pi-agent-core"
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core"
import type { TextContent } from "@earendil-works/pi-ai"
import type { TraceStore, TraceEvent } from "../trace/trace-store.ts"
import type { AgentNodeSpec, AgentNodeResult } from "./types.ts"

export async function runAgentNode(spec: AgentNodeSpec, trace: TraceStore): Promise<AgentNodeResult> {
  const captured: TraceEvent[] = []

  const agent = new Agent({
    initialState: {
      model: spec.model,
      systemPrompt: spec.systemPrompt,
      tools: spec.tools ?? [],
    },
    streamFn: spec.streamFn,
  })

  // pi-agent-core awaits listeners before resolving prompt(), so every append
  // is persisted by the time the run settles.
  const unsubscribe = agent.subscribe(async (event) => {
    captured.push(await trace.append({ role: spec.role, type: event.type, ...summarize(event) }))
  })

  try {
    await agent.prompt(spec.input)
  } finally {
    unsubscribe()
  }

  return { text: finalAssistantText(agent.state.messages), trace: captured }
}

function summarize(event: AgentEvent): Record<string, unknown> {
  switch (event.type) {
    case "tool_execution_start":
      return { toolName: event.toolName }
    case "tool_execution_end":
      return { toolName: event.toolName, isError: event.isError }
    default:
      return {}
  }
}

function finalAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if ("role" in message && message.role === "assistant" && Array.isArray(message.content)) {
      return message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("")
    }
  }
  return ""
}
