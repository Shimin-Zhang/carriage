# Core Agent Loops — Codex vs. OpenHarness vs. Pi vs. OpenCode

> A code-grounded comparison of the **core agent loop** in four terminal coding agents:
> **Codex CLI** (Rust), **OpenHarness** (Python), **Pi** (TypeScript), and **OpenCode**
> (TypeScript on Bun). All file:line references are against the checkouts under `reference/`. For the
> broader architecture of each project, see `codex_codebase.md`, `open_harness_codebase.md`,
> `pi_codebase.md`, and `opencode_codebase.md`.

---

## 0. The shared skeleton

All four harnesses implement the same fundamental loop:

```
stream a model response
  → if it requested tool calls: execute them
  → feed the results back into the conversation
  → repeat until the model stops asking for tools
```

What differs is everything *around* that break condition — how "the model stopped" is decided,
how tools are parallelized, where compaction sits, and how mid-flight input is handled. Those
differences are what this doc is about.

| | **Codex** | **OpenHarness** | **Pi** | **OpenCode** |
|---|---|---|---|---|
| Language | Rust | Python | TypeScript | TypeScript (on Bun) |
| Loop shape | 1 loop, heavy continuation logic | 1 `while`, async generator | 2 loops (inner + outer) | 1 server-side `while`; SDK runs the tools |
| One iteration = | one model sampling request | one model call + tool batch | one turn (inner loop) | one model streaming call + its tool batch |
| Tool parallelism | per-tool `RwLock` (read = parallel) | `asyncio.gather` if >1 | parallel default, opt-out per tool | delegated to the Vercel AI SDK (concurrent) |
| Tools start… | **while the stream is still running** | after the full message arrives | after the full message arrives | as tool-call parts arrive inside `streamText` |
| Compaction sits | mid-loop (token limit) + pre-turn | **top of every turn** | inside the `transformContext` hook | overflow check during the turn → outer loop |
| Mid-turn input | input queue, drained each iteration | none (turn-atomic) | steering queue, polled each turn | `"steer"` delivery, merged into the running session |
| Stop condition | no follow-up + no input + no stop-hook | no tool calls / max_turns | no tools + no steering + no follow-up | finish ≠ tool-calls + no pending tools |
| Entry style | async SQ/EQ (submission → events) | async generator yielding UI events | event-emitting dual loop | **client/server**: HTTP prompt → SSE events |

---

## 1. Codex — `run_turn()`

**File:** `reference/codex/codex-rs/core/src/session/turn.rs:204` (loop), `turn.rs:1815` (sampling).

**One loop with unusually rich continuation logic.** Each iteration is *one sampling request*
(one model call plus the handling of its streamed response) — **not** one tool call.

Per iteration:

1. **Drain pending input** that was submitted while the model was running —
   `sess.input_queue.get_pending_input()` (`turn.rs:208`). Input is run through hooks
   (`run_hooks_and_record_inputs`, `turn.rs:214`).
2. **Stream the model** via `run_sampling_request()` → `try_run_sampling_request()` (`turn.rs:1815`),
   which calls `ModelClientSession::stream()` (`client.rs:1619`). Transport is the Responses API over
   **WebSocket** (`stream_responses_websocket`), with an **HTTP/SSE fallback** (`stream_responses_api`).
   The inner event loop (`turn.rs:1873`) consumes a `ResponseEvent` stream: `OutputTextDelta`,
   `ToolCallInputDelta`, `OutputItemAdded`, `OutputItemDone`, `RateLimits`, `Completed`.
3. **Dispatch tools as they finalize.** When an `OutputItemDone` is a tool call
   (`stream_events_utils.rs:413`), it is pushed onto an `in_flight: FuturesOrdered` queue
   (`turn.rs:1854`) — so tools begin executing **while the model is still streaming**. After the
   stream completes, `drain_in_flight()` (`turn.rs:1781`) collects results and records them into
   conversation history via `sess.record_conversation_items()`.
4. **Decide whether to continue** (`turn.rs:251–366`). This is where Codex is distinctive — "the model
   stopped" is treated as a *question*, not a final answer. The loop continues instead of breaking if:
   - pending user input arrived (`turn.rs:263`);
   - the **token limit** was hit and follow-up is needed → run `run_auto_compact()` (`turn.rs:303`),
     then continue;
   - the **context window** overflowed → start a new window and continue (`turn.rs:296`);
   - a **stop hook** returns a continuation prompt (`turn.rs:324`).

   Otherwise it breaks (`turn.rs:322`), runs after-turn hooks, and returns the last agent message
   (`turn.rs:410`).

**Parallelism mechanism.** There is no explicit "run these N in parallel" call. Every tool acquires a
shared `Arc<RwLock<()>>` (`parallel.rs:36`): parallel-safe tools take a **read** lock and run
concurrently; unsafe tools take a **write** lock and are forced serial (`parallel.rs:82`). Concurrency
falls out of the lock type. The **permission / sandbox gate** sits at dispatch, between the router and
execution.

**SQ/EQ framing.** The whole engine is an asynchronous Submission-Queue / Event-Queue machine:
submissions (`Op::UserTurn`, `Steer`, `Interrupt`, …) come in, `EventMsg` items stream out. Input is
drained at the top of each iteration; a `CancellationToken` (`turn.rs:143`) is threaded through model
streaming, tool execution, and input hooks so the turn is interruptible mid-flight.

**Compaction.** Two touch-points: a pre-turn check (`run_pre_sampling_compact`, `turn.rs:151`) and a
mid-loop `run_auto_compact()` (`turn.rs:303`) when the token limit is reached. Local compaction
rewrites history client-side (`compact.rs`); remote compaction summarizes via a separate LLM call
(`compact_remote.rs`).

---

## 2. OpenHarness — `run_query()`

**File:** `reference/OpenHarness/src/openharness/engine/query.py:633`.

**The simplest of the four: a single `while` loop, written as an async generator** that yields UI
events `(StreamEvent, UsageSnapshot | None)` as it goes.

```python
while context.max_turns is None or turn_count < context.max_turns:   # query.py:700
    ...  # compact → preprocess images → stream → execute tools → append results
    if not final_message.tool_uses:                                   # query.py:808
        return
```

Per iteration:

1. **Compact check first** — at the *top* of every turn (`query.py:712`), unlike the other two. It is
   a layered cascade (`compact/__init__.py`): cheap **microcompact** (drop old tool-result bodies) →
   **context collapse** (truncate huge text blocks) → **session-memory rollup** → and only as a last
   resort a full **LLM summarization**.
2. **Preprocess images** (`query.py:720`) — convert `ImageBlock`s to text for non-multimodal models,
   in parallel.
3. **Stream the model** via `context.api_client.stream_message(...)` (`query.py:728`; client at
   `api/client.py:165`). Text chunks are yielded immediately as `AssistantTextDelta` (`query.py:739`);
   the final message with tool calls is awaited via `stream.get_final_message()` (`client.py:248`).
   Built-in retry with exponential backoff emits `ApiRetryEvent` → `StatusEvent`.
4. **Execute tools.** If there is **one** (`query.py:821`), `await` it directly. If there are **many**
   (`query.py:841`), emit all `ToolExecutionStarted` events first, then run everything via
   `asyncio.gather(..., return_exceptions=True)` (`query.py:853`), then emit all
   `ToolExecutionCompleted`. `return_exceptions=True` is load-bearing: a single failing tool can't
   cancel its siblings or orphan a `tool_use` block. Each tool runs the pipeline
   `PRE_TOOL_USE hook → lookup/validate → permission check → execute → carryover metadata →
   POST_TOOL_USE hook` (`_execute_tool_call`, `query.py:887`).
5. **Append results** as a user message (`query.py:880`) and loop.

**Termination.** Model returns no tool calls → `return` (`query.py:808`); `max_turns` exceeded →
raise `MaxTurnsExceeded` (`query.py:882`). There is also a **reactive** path: if the API throws
"prompt too long," it forces a compaction (`trigger="reactive", force=True`), decrements `turn_count`,
and retries the same call (`query.py:768`).

**History ownership.** `QueryEngine` (`query_engine.py:227`, `submit_message()`) owns the canonical
message list, hands `run_query()` a **copy** (`query_engine.py:264`), and syncs it back only after an
`AssistantTurnComplete` event (`query_engine.py:271`) — so a crashed turn doesn't corrupt state. It
also accumulates cost and updates session memory in a `finally` block.

---

## 3. Pi — the dual loop

**File:** `reference/pi/packages/agent/src/agent-loop.ts:170` (`runLoop`), `agent.ts` (`Agent` class).

**The only one with two explicit loops**, and the split is the whole point.

### Inner loop — `while (hasMoreToolCalls || pendingMessages.length > 0)` (`agent-loop.ts:174`)

1. **Inject steering messages** into context (`agent-loop.ts:182`).
2. **Stream the assistant response** (`streamAssistantResponse`, `agent-loop.ts:275`):
   `transformContext` (AgentMessage-level — **this is where compaction lives**, `agent-loop.ts:284`)
   → `convertToLlm` (`agent-loop.ts:289`) → a pluggable `StreamFn` (default `streamSimple` from
   `pi-ai`, `agent-loop.ts:298`). The streaming message is reconstructed in-place from
   `text_delta` / `thinking_delta` / `toolcall_delta` events on a mutable `partial`
   (`agent-loop.ts:313`).
3. **Execute tools** (`executeToolCalls`, `agent-loop.ts:373`): **parallel by default**, sequential if
   the global config says so *or any tool declares* `executionMode: "sequential"`. Clever ordering —
   `tool_execution_end` events fire in **completion** order (fast UI feedback) but result *messages*
   commit in **source** order (deterministic context). Per-tool pipeline:
   `prepareToolCall` (validate + `beforeToolCall` hook, can **block**, `agent-loop.ts:581`)
   → `executePreparedToolCall` (runs `tool.execute()` with an `onUpdate` streaming callback,
   `agent-loop.ts:628`) → `finalizeExecutedToolCall` (`afterToolCall` hook, can rewrite the result,
   `agent-loop.ts:671`).
4. **After the turn:** `prepareNextTurn` (swap model/thinking, `agent-loop.ts:226`) →
   `shouldStopAfterTurn` (graceful exit, `agent-loop.ts:241`) → re-poll **steering**
   (`agent-loop.ts:253`).

A `terminate` flag short-circuits the loop: if **all** tools in a batch set `terminate: true`
(`shouldTerminateToolBatch`, `agent-loop.ts:544`), the inner loop stops.

### Outer loop — `while (true)` (`agent-loop.ts:170`)

When the inner loop drains naturally, check `getFollowUpMessages()` (`agent-loop.ts:257`). If any,
re-enter the inner loop; otherwise emit `agent_end` (`agent-loop.ts:268`) and quit.

### Steering vs. follow-up — the key idea

- **Steering** arrives mid-flight and is injected before the **next** turn *inside* the inner loop
  ("correct me now").
- **Follow-up** is work queued for **after** the agent would otherwise stop, handled by the *outer*
  loop ("do this next").

The `Agent` class (`agent.ts`) wraps the loop with two queues (`steeringQueue`, `followUpQueue`) drained
by these hooks, plus `content` (sent to the model) vs `details` (UI/logs only) on every tool result.

### Hook injection points (per turn)

| Hook | Called at | Can block? |
|---|---|---|
| `transformContext` | before every LLM call | no |
| `convertToLlm` | before every LLM call | no |
| `getSteeringMessages` | start + after each turn | — |
| `beforeToolCall` | before tool execution | **yes** |
| `afterToolCall` | after tool execution | no (can rewrite result) |
| `prepareNextTurn` | after `turn_end` | no |
| `shouldStopAfterTurn` | after `turn_end` | **yes** (exit) |
| `getFollowUpMessages` | when inner loop drains | — |

---

## 4. OpenCode — `runLoop` (the loop runs server-side; the AI SDK runs the tools)

**File:** `reference/opencode/packages/opencode/src/session/prompt.ts:1134` (`runLoop`), `while (true)`
at `prompt.ts:1141`; per-step processing in `session/processor.ts:53` (`process`).

**The only loop here that delegates the model↔tool iteration to a third-party SDK, and the only one
that runs entirely server-side behind an HTTP API.** A prompt arrives over HTTP; the loop runs on the
server; every client (TUI, web, IDE) watches the result stream over **Server-Sent Events**.

Each iteration is one **step** = one model streaming call plus the execution of that call's tool batch.
Per iteration:

1. **Rebuild the projected history** (`MessageV2.filterCompactedEffect`, `prompt.ts:1145`) and find the
   latest user/assistant pair (`MessageV2.latest`, `prompt.ts:1149`).
2. **Check the stop condition first** (`prompt.ts:1164–1183`): if the last assistant message has a
   `finish` that is *not* `tool-calls`, has **no pending tool calls** (`hasToolCalls`, `prompt.ts:1159`),
   and is newer than the last user message, **break** — the model stopped without asking for tools.
3. **Assemble context** — environment, instructions (`AGENTS.md`), skills, and the converted model
   messages (`prompt.ts:1327–1333`) — then call **`handle.process(...)`** (`prompt.ts:1336`).
4. **Stream + run tools inside `process()`.** `processor.process()` consumes the **Vercel AI SDK**
   `streamText` `fullStream` (`session/llm.ts:280`). OpenCode hands the SDK its tools as
   `ai.tool({ inputSchema, execute })` (`session/tools.ts:80`), so the **SDK executes the step's tool
   calls** (concurrently) and the processor records each `tool-call`/`tool-result` part as it arrives.
   No `stopWhen`/`maxSteps` is set, so one `process()` = one model call + one tool batch; feeding the
   results back is the *outer* `runLoop`'s job. `process()` returns `Result = "continue" | "stop" |
   "compact"` (`processor.ts:36`).
5. **Branch on the result** (`prompt.ts:1380–1390`): `"stop"` → break; `"compact"` →
   `compaction.create(...)` then continue; otherwise continue.

**Parallelism mechanism.** OpenCode does not orchestrate tool concurrency itself — it is whatever the
**AI SDK** does for one step's tool calls (it awaits the `execute` promises concurrently). The
**permission gate sits inside each tool's `execute`**, via `ctx.ask(...)` (`tools.ts:63`), rather than
at a central dispatch point; a `doom_loop` guard in the processor (`processor.ts:538`) catches runaway
repetition.

**Step cap.** `maxSteps = agent.steps ?? Infinity` (`prompt.ts:1231`); on the final step OpenCode
appends a synthetic `MAX_STEPS` assistant message (`prompt.ts:1343`) to coax the model to wrap up
rather than hard-aborting mid-thought.

**Compaction.** An overflow check runs *during* the turn: `isOverflow()` compares usage against the
model's input limit minus reserved tokens (`session/overflow.ts`) and sets `ctx.needsCompaction`
(`processor.ts:752`), which surfaces as `Result === "compact"` and is handled by the outer loop
(`prompt.ts:1381`). Provider "prompt too long" errors trigger the same path reactively.

**Mid-turn input.** Prompts sent while the session is `busy` are admitted with **`delivery: "steer"`**
(`prompt.ts:1082`) and merged into the running session at a safe boundary (the V2 input plumbing);
abort is plain `AbortController` / Effect interruption.

**Two generations.** The above is V1 (the shipping path). The in-progress **V2** runner
(`reference/opencode/packages/core/src/session/runner/llm.ts`) drops the AI-SDK loop entirely: it makes
**one explicit `llm.stream(request)` per provider turn**, durably records each tool call/result, and
reloads projected history before continuing — a serialized, SQLite-backed loop that re-reads state from
disk between turns instead of holding it in memory.

---

## 5. Synthesis

The throughline is identical across all four: *stream → run the tools the model asked for → feed
results back → repeat until the model stops asking*. The interesting differences are architectural
expressions of each project's overall philosophy:

- **Codex** treats the stop condition as negotiable — input, token limits, and stop-hooks can all
  override "the model stopped" — and overlaps tool execution with streaming to cut latency. This fits
  its sandbox-first, production-grade posture: the loop is the place where safety gates, compaction,
  and steering all converge.
- **OpenHarness** keeps the loop dead simple and turn-atomic, pushing its cleverness into a layered
  compaction stack at the top of each turn. This matches its identity as a readable, faithful Claude
  Code port meant for people to study and extend.
- **Pi** splits the one concept into two loops so it can cleanly separate "correct me now" (steering)
  from "do this next" (follow-up), and makes nearly every step a typed, replaceable hook — the loop
  embodiment of its minimal-core / extend-everything thesis.
- **OpenCode** is the outlier in *where* the loop lives: server-side behind an HTTP/SSE API, with the
  model↔tool iteration handed to the Vercel AI SDK and the permission gate pushed down into each tool.
  The harness owns only the outer step loop, compaction branch, and steering merge — a thin loop that
  matches its client/server, provider-neutral thesis (and its V2 rewrite trades the SDK loop for an
  explicit, durable, SQLite-backed one).

---

*Source checkouts: `reference/codex`, `reference/OpenHarness`, `reference/pi`, `reference/opencode`
(`v1.17.8`). Line numbers reflect the code as read and may drift as these projects evolve quickly;
treat them as signposts, not contracts. OpenCode's V1 loop is the shipping path; its V2 loop
(`packages/core/src/session/runner/`) is mid-migration.*
