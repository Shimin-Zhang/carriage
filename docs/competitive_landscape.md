# Carriage — Competitive Landscape & the Bets

> Status: **research-backed analysis**, 2026-06-17. Companion docs: `superpowers/specs/2026-06-17-carriage-design.md`,
> `core_loops.md`, `loop_engineering_gaps.md`.
> Framing: a design is a portfolio of bets. This doc names Carriage's, places each against the current
> (2025–2026) landscape, and says — for each — what would confirm it and what would kill it. Dated facts
> are sourced; fast-moving ones (valuations, acquisitions) are flagged in §8 and should be re-checked
> before they're leaned on.

---

## 0. The reframe — Carriage competes with almost none of the "obvious" tools

The tools usually named in the same breath (LangChain, LangGraph, CrewAI, OpenAI Agents SDK, n8n, Dify,
Langflow) are **agent/workflow *construction* platforms** — their job is "help you build an agent/app
that does a task and ship it." Carriage's job is different: **run a methodology over a target, measure it
against a pluggable (ideally ground-truth) eval, and eventually improve the methodology automatically.**
A lab bench, not a production runtime.

That splits the field into three relationships:

| Relationship | Tools | Why |
|---|---|---|
| **Carriage is *meta* to these** | LangGraph, CrewAI, OpenAI Agents SDK, AutoGen/AG2 | A Carriage `Workflow` could be *implemented with* one of them and raced against another on the same `EvalHarness`. They're candidate *contents* of a workflow, not rivals to the substrate. |
| **Carriage is *orthogonal* to these** | n8n, Dify, Langflow, Flowise, LangChain-the-library | Different job/audience: integration & automation, LLMOps app-shipping, visual prototyping. None races whole methodologies against an oracle. |
| **Carriage *actually competes* with these** | DSPy/GEPA, Inspect, the SWE-bench / terminal-bench / METR family, eval platforms (LangSmith/Braintrust/Langfuse) | They occupy the (eval × optimizer × coding-harness) corner Carriage targets. **None of these were on the original list.** |

The single most useful finding: **Carriage's real peer group is eval harnesses and program-optimizers,
not agent frameworks** — and the specific quadrant it occupies (§2) is currently unoccupied.

---

## 1. The landscape, by category

### 1.1 Code-first orchestration frameworks — *Carriage is meta to these*

- **LangGraph / LangChain / LangSmith** (LangChain, Inc.; $1.25B valuation, Oct 2025; ~90M monthly
  downloads). LangChain 1.0 (Oct 22 2025) re-centered on `create_agent` built **on the LangGraph
  runtime**. LangGraph 1.0 (Oct 2025) is the serious peer: `StateGraph`, checkpointers, durable
  execution, time-travel, HITL, streaming — deeper orchestration than Carriage's primitives. **LangGraph
  Platform → renamed "LangSmith Deployment" (Oct 2025)** adds cron + webhooks (a real L3). **LangSmith**
  is the eval/observability product Carriage partly reinvents as `TraceStore` + `compare` — but its
  comparison unit is *outputs scored on a shared dataset, usually by an LLM judge* (pairwise eval is
  explicitly LLM-as-judge), not whole methodologies on a ground-truth oracle. Self-improvement is
  **shipping, not roadmap**: Promptim (OSS prompt-opt), **Polly** (auto-improves prompts from traces,
  beta ~Dec 2025; Studio write-back ~Apr 2026), **Align Evals** (Jul 2025 — but it optimizes the
  *judge*, the opposite of a non-LLM oracle). *Closest named peer; its eval philosophy is LLM-judge-first.*
- **CrewAI** (MIT, Python; v1.0 Oct 20 2025; ~$18M raised). **Crews** (emergent role-agents) + **Flows**
  (deterministic, `@start`/`@listen`/`@router`, `@persist` durable). Verification is hand-assembled
  guardrails, not a primitive; `crew.train()` is human-in-the-loop prompt-distillation, not hill-climbing.
  Strong event-driven via the AMP platform (webhooks, cron). No compare-runner, no maker≠checker-on-
  different-providers.
- **OpenAI Agents SDK** (MIT, Python+JS; launched Mar 11 2025 as Swarm's successor; still pre-1.0). The
  most eval-adjacent. Agents/handoffs/**guardrails** (LLM-judge supported)/sessions/**built-in tracing**;
  Temporal durable execution (Sept 2025). **AgentKit** (Oct 6 2025) added Agent Builder + automated
  prompt optimization; the **Agent Improvement Loop** cookbook already does trace-capture → eval-gate →
  ranked harness-change proposals → **auto-PR via Codex**. But it's a recipe, not a primitive; eval is a
  regression gate, not a convergence oracle; comparison lives in the separate Evals product. *The
  framework most likely to converge toward Carriage's space — watch it.*
- **Microsoft AutoGen / AG2** — `microsoft/autogen` v0.4 is now in **maintenance mode**; the live
  successor is **Microsoft Agent Framework (1.0 GA Apr 3 2026)**, unifying AutoGen + Semantic Kernel.
  AG2 (community fork) stays active. Native idiom is **emergent conversation** (least code-first of the
  group), though the two-agent generator–critic (maker≠checker shape) is most idiomatic here. Its one
  true trace→tools optimizer, **AgentOptimizer**, is AG2-only and **deprecating**.

**Common to all four:** none treats **ground-truth-eval as a stop/convergence condition**; none has a
**whole-workflow compare runner**; none **enforces** maker≠checker on different providers. Each could be
wrapped as a single Carriage `Workflow` and raced — Carriage is meta to them.

### 1.2 Visual / low-code / automation — *orthogonal; the inverse of the DSL thesis*

- **n8n** (TypeScript, Sustainable-Use license; $180M Series C, $2.5B, Oct 2025). The reference for
  **event-driven** (cron/webhooks + 400+ integrations) — strong exactly where Carriage-A is empty (an
  inert `trigger()`). **Evaluations** GA'd Jun 6 2025 (LLM-judge + deterministic), but explicitly a
  *testing tool* that "doesn't optimize itself." Not a methodology-comparison harness.
- **Dify** (Python/TS; Apache-2.0 + conditions; LangGenius; ~140k stars). The best **compare** primitive
  of this group — "Debug as Multiple Models" runs **up to 4 side-by-side** — and the only adjacent
  **self-improvement** (a manual auto-prompt-optimizer). 2026 added Workflow Triggers (cron/webhook/plugin
  events). Still compares *models/prompts inside one app*, not competing methodologies.
- **Langflow** (Python, MIT) — **now owned by IBM** (DataStax acquired Langflow ~Apr 2024; IBM closed the
  DataStax acquisition May 28 2025), kept standalone/OSS under watsonx. Visual JSON graph is the
  canonical artifact; **no native eval/compare**, weakest event-driven (webhook only).
- **Flowise** (TypeScript; hybrid Apache-2.0 + commercial; YC S2023) — **acquired by Workday, announced
  Aug 14 2025**. **Evaluations** (Cloud/Enterprise) run one dataset across **multiple flows × multiple
  LLMs** — the nearest visual analog to racing variants, but against a fixed test set with LLM-judge
  scoring, not a ground-truth oracle.

**The architectural contrast:** for all four the **visual graph (JSON/YAML) *is* the program**. That is
the inverse of Carriage's phase-C thesis — **code is primary; the DSL compiles to the same kernel and
emits identical, comparable traces**, making the declarative form a derived view. None races whole
methodologies against a shared oracle. The real overlap is event-driven, where n8n leads.

### 1.3 Claude Code — *the closest shipping analog, and a substrate fork*

In 2026 Claude Code ships more of Carriage's surface than anything else here:

- **Dynamic Workflows** + the orchestration tool = the closest shipping "Workflow-as-artifact":
  deterministic JS orchestration, fan-out/pipeline/parallel, adversarial-verify and judge-panel patterns,
  budgets, structured output — **but generated and ephemeral, not user-authored, persisted, re-runnable**
  (the inverse of `Workflow`-as-first-class-object).
- **Subagents** (`.claude/agents/*.md`) = persisted, **vibe-codeable**, model/tools/prompt per role →
  the maker≠checker shape. Plus experimental **Agent Teams** (peer-to-peer multi-session) — the "swarm."
- **Self-improving Skills** (`eval.json` binary assertions + overnight prompt-improvement) = a shipping
  *micro-L4*, but skill-prompt-level only.
- **Routines** (cron/GitHub/API triggers, cloud-hosted) = a real L3. **Agent SDK** (Python+TS) = headless
  embedding. **CLAUDE.md** + auto-memory = cross-session context (recall, not optimization).
- **Stops short exactly at Carriage's work:** no ground-truth-oracle primitive, no compare-runner, no
  workflow-level trace→self-optimization, workflows not first-class.

**The fork:** Carriage builds on **Pi** (a minimal cousin of Claude Code), not Claude Code's batteries-
included Agent SDK. Defensible — Pi's provider-agnosticism is load-bearing for maker≠checker-on-different-
providers (Claude Code is Anthropic-first), and owning the loop is required for eval-as-convergence — but
it means rebuilding orchestration that Claude Code's stack already ships, to own the eval/compare/trace
layer. **Claude Code is both Carriage's closest competitor and its most natural fallback substrate.**

### 1.4 The real peer group — *eval harnesses + program-optimizers*

- **DSPy** (Stanford/Databricks; MIT, Python; DSPy 3.0 ~Jun 2025) — "programs over prompts": Signatures +
  Modules, compiled by **optimizers** against a metric that can be a **ground-truth oracle** or an
  LLM-judge. **MIPROv2** (Bayesian search over instructions + demos); **GEPA** (§5). Optimizes
  prompts/demos **within a fixed program** — does not author control flow, invent tools, or change the
  grader.
- **GEPA** — reflective prompt evolution (arXiv:2507.19457, Jul 2025; **ICLR 2026 oral**). The inner loop
  Carriage's convergence wants; see §5.
- **Inspect** (UK AISI; Python, MIT) — `task = dataset + solver + scorer`, both deterministic and
  LLM-judge scorers; ReAct **`attempts`** folds the score back into the loop (retry until scorer = 1.0);
  **agent-bridge** runs whole CLI agents (Claude Code, Codex) as the agent-under-test. The eval harness to
  study; mostly post-hoc, single-agent.
- **Agentic-coding harnesses/benchmarks** — **SWE-bench/Verified** (real tests, **post-hoc**;
  leaderboard = scaffold+model pairs), **SWE-agent** (swappable scaffold via YAML), **OpenHands**
  (scaffold-pluggable; experimental in-loop critic, learned not ground-truth), **terminal-bench**
  (`BaseAgent` abstraction races whole harnesses on oracle-solution tasks; post-hoc; now on "Harbor"),
  **METR Task Standard / Vivaria** (in-loop `score` hook vs. held-out tests, used to vary the *scaffold*
  — **but being sunset → Inspect**), **Aider polyglot** (model leaderboard, fixed scaffold).
- **Eval/experiment platforms** — Braintrust ($80M Series B, Feb 2026), **Langfuse** (→ acquired by
  ClickHouse, Jan 2026; MIT), **promptfoo** (→ acquired by OpenAI, Mar 2026; TypeScript), Arize Phoenix,
  OpenAI Evals (legacy). **All score outputs post-hoc; none folds eval into the agent loop as a
  convergence signal; none races whole agent workflows as a first-class primitive.**

---

## 2. The empty quadrant (the dev-substrate bet)

Carriage's design rests on **four load-bearing properties**. The research confirms **no single system
combines all four**:

1. racing **whole workflows** apples-to-apples;
2. eval folded **into the loop** as a convergence signal (not post-hoc);
3. maker≠checker against an **uncheatable ground-truth oracle**;
4. framed as a **dev / self-improvement substrate** (not a leaderboard or safety-eval platform).

The pieces exist, scattered:

| Closest analog | Has | Missing |
|---|---|---|
| **terminal-bench** | races whole harnesses on shared oracle-solution tasks | post-hoc; it's a leaderboard |
| **METR Task Standard / Vivaria** | in-loop ground-truth scoring; varies the scaffold | being sunset; safety-framed, not a dev tool |
| **Inspect** `attempts` | in-loop score → retry; agent-bridge wraps any CLI agent | single-agent, not a workflow race; mostly post-hoc |
| **DSPy / GEPA** | the optimizer machinery (trace→reflect→propose→keep) | prompt-layer only; Python; no workflow racing |

So the quadrant is genuinely under-served. **Convergence threats:** Inspect's `attempts` + agent-bridge
could grow into workflow-racing; terminal-bench/Harbor could add in-loop scoring. The defensible wedge is
the **combination**, with perft (the uncheatable oracle) as the hardest piece to copy — everyone else
runs on human-authored test suites, which erode (UTBoost, Jun 2025, showed SWE-bench tests admit false
positives; SWE-bench Pro already dilutes to hybrid LLM-judge grading).

---

## 3. The reframe — Carriage is two stacked products

The stated **end goal** — ordinary users **author (vibe-code), modify, and over weeks/months
self-optimize** a personal agent workflow, with **the user's own results/feedback as the optimization
target** (the "learn vocabulary" example) — relocates Carriage from **dev lab-bench → consumer/prosumer
self-optimizing-agent platform.** That opens a competitive set the spec doesn't touch.

The research finding is sharp: **the union of {non-expert can author it} × {self-optimizes against *your
own* longitudinal outcomes} × {consumer} is empty white space.** The two halves exist only apart:

- **Authoring is commoditized.** Custom GPTs, Google Gems, Poe, Character.AI, Claude Skills, plus the
  vibe-coding tier (Lovable ~$6.6B / ~$200M ARR, Dec 2025; Cursor; Replit Agent; Bolt; v0) prove
  non-experts will build agents by describing them. Carriage inherits this as settled, not to prove.
- **Outcome-self-optimization ships only inside dense-signal verticals.** **Anki/FSRS** is the textbook
  case — it fits ~17–21 *personal* weights by gradient descent on *your own* daily card grades (FSRS-6
  in Anki v25.07+). Duolingo's Birdbrain is population-trained + cheap per-user estimation. Both depend
  on dense, objective, daily, trivially-credit-assigned feedback.
- **The "memory" wave is the dangerous look-alike.** ChatGPT memory, Mem0 ("not behavior-optimization"
  per its own framing), Letta/MemGPT, Zep — all personalize *what the agent recalls about you*, none
  close a "did this achieve your goal → change behavior" loop. The market *will* conflate the two.
- **The closest real loops are adjacent and mis-aimed.** **Cursor BugBot** genuinely learns from
  accept/dismiss signals (reportedly tens of thousands of learned rules) — but targets team code-review
  prefs, not a personal end-user outcome. Gumloop/Lindy "self-improving skills" = human-flagged
  corrections logged to prompts, not measured optimization.

So the end goal is genuinely under-served. Large, if real.

---

## 4. The central tension — the oracle is exactly what the end goal lacks

The spec's elegance is **perft as an uncheatable oracle doing double duty as stop-condition *and*
reward.** But the vocabulary workflow has **no perft.** Personal-learning feedback is **sparse, noisy,
slow, cold-start, ambiguous in credit assignment, and has no cheap automatable verifier** ("did I
actually learn more vocabulary?" has no unit test).

What survives the jump from chess to personal pedagogy:

- **Transfers:** orchestration, the trace store, the compare runner, vibe-code authoring — the *machinery*.
- **Does not transfer:** the convergence/reward mechanism. Perft is dense and uncheatable; personal
  feedback is the opposite. **Every shipping self-improver dodges precisely this problem with a dense or
  test-based reward** — FSRS's daily grades, DSPy/GEPA's dataset metric, BugBot's accept/dismiss, RLVR's
  verifiable answer.

**Implication: "prove it on perft" de-risks the *machinery*, not the *reward problem* the end goal hinges
on.** The most elegant part of the spec is the part that doesn't carry to where the product wants to live;
the part that *does* carry (orchestration, traces, compare, authoring) is the part commoditizing fastest
(Claude Code Dynamic Workflows, the vibe-coding tier, DSPy/GEPA). **So the moat is not the perft elegance —
it's the unglamorous engineering of manufacturing a trustworthy reward out of sparse personal feedback:**
population priors → personalization (the FSRS pattern generalized past one vertical), proxy metrics,
calibrated LLM-judge-of-outcomes, explicit reward elicitation from the user. *Whoever solves the
personal-reward problem owns the category, and no incumbent has.*

---

## 5. The self-improvement endgame — reflective evolution

The L4 / self-improvement **inner loop is already built, peer-reviewed, and in production** — be
clear-eyed about this.

**Reflective evolution** (GEPA): an evolutionary algorithm where **the mutation operator is an LLM
reflecting in natural language**, and fitness is the eval metric. The contrast with RL is the point — RL
collapses a whole trajectory into **one scalar reward**; reflective evolution **reads the trajectory
(reasoning, tool calls, test output), writes a natural-language diagnosis, and edits the prompt to fix
that specific failure.** One rollout teaches a paragraph, not a number → GEPA reports beating GRPO by ~6%
avg (up to 20%) with **up to 35× fewer rollouts**, and MIPROv2 by >10% (e.g. +12% on AIME-2025).

Two ingredients make it *evolution*, not iterative refinement:

1. **Natural-language gradient** (same move as TextGrad's "textual gradients"; *Nature*, Mar 2025).
2. **Pareto-frontier selection** — keep a **population**; parents are every candidate that's best on *at
   least one* eval instance, so diverse partial solutions survive instead of collapsing to a local
   optimum; **GEPA+Merge** recombines complementary lineages.

The lineage: PromptBreeder (2023) → EvoPrompt → Reflexion / Self-Refine → **GEPA** (2025). The cousin most
relevant to Carriage is **DeepMind's AlphaEvolve** (2025): the same structure applied to **whole
code/algorithms** against an **automated evaluator** — closer to "evolve the whole workflow" than GEPA's
prompts-only surface, and a reminder that **no evaluator → no evolution.**

**How it maps onto Carriage** (this is why it's central, not a footnote):

- `verify()` returning `{ findings: [{ severity, dimension, message }], perDimension }` **is GEPA's
  "actionable side information"** — structured NL feedback, not a scalar. The right signal is already
  designed.
- The four convergence **dimensions** (spec/test/impl/verification) are a natural **Pareto front**: a
  variant best on `verification` but weak on `spec` is a parent worth merging. Today `convergence()` is an
  AND-gate; the evolutionary version keeps the frontier.
- `compare` + `TraceStore` are the population manager and fitness archive GEPA needs.

**Carriage's genuine deltas** over DSPy/GEPA: (a) a **broader surface** — evolving the whole workflow
incl. graders/tools/control-flow (AlphaEvolve-like), not just prompts/demos — *but optimizing the grader
is reward-hacking-adjacent, which is exactly why the field clings to oracles*; (b) **integration into a
vibe-codeable consumer substrate**; (c) **personal/longitudinal reward**, which DSPy/GEPA don't touch
(they assume a dataset metric). **"Eval = reward" is the standard premise of this line (RLVR), not a
novelty.** The cost of these deltas is **TypeScript**: DSPy, GEPA, TextGrad, ART, verifiers, prime-rl are
all Python; in TS, Carriage imports none of it and must re-implement reflective evolution or shell out to
a Python service. That tax bites hardest at exactly the endgame.

---

## 6. The bets (the decision-oriented core)

| # | The bet | Could win because | Would be killed by |
|---|---|---|---|
| **B1** | **Ground-truth oracle** as the organizing principle (eval = stop = reward, uncheatable) | uncheatable convergence + reward; validates the machinery offline for free; "can't fake convergence" should beat LLM-judge noise | the oracle doesn't generalize past chess-like domains — and the end goal (personal pedagogy) has none, so the foundational elegance evaporates where the product must live (§4) |
| **B2** | **Workflow-as-artifact + `compare`** — racing whole methodologies on a shared oracle is a valuable object | genuinely empty quadrant (§2); apples-to-apples by construction | infra awaiting content (one workflow today); Inspect / terminal-bench converge toward it before Carriage gets traction |
| **B3** | **Built on Pi / TypeScript** (minimal provider-agnostic substrate) | provider-agnosticism enables maker≠checker; owning the loop enables eval-as-convergence; fits the TS agent world (Pi/OpenCode/Mastra) | cut off from the entire Python optimizer/RL ecosystem the L4 endgame needs; rebuilds what Claude Code's stack ships; young single-vendor dependency (Pi has no permission system — Carriage adds its own) |
| **B4** | **Self-improvement endgame** (reflective evolution over the whole workflow) | AlphaEvolve-style whole-workflow evolution is a bigger surface than GEPA's prompts-only; the prize is large | the inner loop already shipped (GEPA/DSPy, Python); "eval=reward" isn't novel; the broad surface includes optimizing the grader (reward-hacking-adjacent); inherits the fitness-function problem (§4) |
| **B5** | **Consumer end goal** — vibe-coded personal workflows that self-optimize on the user's own outcomes | the union {authorable × self-optimizes on your outcomes × consumer} is empty white space; authoring is commoditized so it's inheritable; solving personal-reward owns the category | the hard part — a trustworthy reward from sparse/noisy/slow personal feedback — is unsolved by anyone and perft-validation doesn't help; a vibe-coding builder + BugBot-style loop could enter from the other side |

**The throughline across the bets:** B1–B3 are well-hedged and largely de-risked by the spec's offline-
first plan; the quadrant in B2 is real. **B4 and B5 are where the value and the risk both concentrate, and
they share one failure mode — the fitness/reward signal.** Reflective evolution solves the *mutation
operator*; it does not solve the *fitness function* for personal pedagogy. That is the bet to stare at.

---

## 7. Bottom line

Carriage is **two stacked bets joined by one assumption.** A defensible, under-served **dev workflow-eval
substrate** (validated by perft, occupying an empty quadrant) and a genuinely empty **consumer
self-optimizing-agent platform** — joined by the assumption that *the perft-proven machinery generalizes
to personal pedagogy.* The machinery does generalize; the **convergence/reward mechanism that makes perft
elegant is exactly what the end goal lacks.** So the real moat is not the oracle elegance the spec leads
with — it's the personal-reward-signal problem that no one, incumbent or competitor, has solved. Chess
proves Phases 0–1 and tells you almost nothing about the phase that matters most for the end goal. Bet
accordingly.

---

## 8. Verification notes & staleness flags

Checked against 2025–2026 sources during the 2026-06-17 research pass. Treat the matrix as a snapshot —
this field moves monthly.

- **Solid / primary-sourced:** GEPA (arXiv:2507.19457, Jul 2025, ICLR 2026 oral — figures verified
  against the abstract: 6% avg / up to 20% over GRPO, 35× fewer rollouts, >10% / +12% AIME-2025 over
  MIPROv2); TextGrad (*Nature* 639:609-616, Mar 19 2025); DSPy 3.0 (~Jun 2025); CoreWeave→OpenPipe
  (Sept 3 2025); Langflow→IBM (DataStax close May 28 2025); Flowise→Workday (Aug 14 2025, Workday
  newsroom + PR Newswire); RLVR origin (Tülu 3, arXiv:2411.15124, Nov 2024); FSRS mechanism/versions;
  n8n Evaluations GA (Jun 6 2025).
- **Corroborated but secondary / approximate (re-check before quoting):** LangChain $1.25B valuation and
  ~90M downloads (Oct 2025 press); "LangGraph Platform → LangSmith Deployment" rename (naming still in
  flux across docs); Polly's ~Apr 2026 Studio write-back; Align Evals exact GA (~Jul 2025); CrewAI star
  count (sources span 38k–54k) and exact current version; OpenAI prompt-optimizer deprecation dates
  (single secondary source); Braintrust $80M Series B (Feb 2026); Langfuse→ClickHouse (Jan 2026);
  promptfoo→OpenAI (Mar 2026); Lovable ~$6.6B / ~$200M ARR (Dec 2025); Gumloop $50M Series B (early
  2026); GPT Store counts; BugBot learned-rule counts; Microsoft Agent Framework 1.0 GA (Apr 3 2026).
- **Do not trust without primary confirmation:** any "Lindy ~$5B valuation" (appears cross-wired with
  Clay; verified figure is ~$50M raised); single-source 2026 reports of large acquisitions/valuations in
  the vibe-coding tier (e.g. Cursor mega-valuation rumors, n8n/SAP) — omitted from the body above for
  that reason.
- **Confident absences (harder to prove than presence):** no system found that races whole agentic
  *methodologies* against a shared **non-LLM ground-truth oracle** with eval **in the loop**; no
  **consumer** product found that is both non-expert-authorable **and** self-optimizes against an
  individual's **longitudinal outcomes**. These are the two empty quadrants the bets rest on; revisit if
  Inspect/terminal-bench (dev side) or a vibe-coding builder + outcome-loop (consumer side) move.

*Source checkouts for the harness comparisons: `reference/` (codex, OpenHarness, pi, opencode). Landscape
facts are from a 2026-06-17 web pass (official docs, blogs, arXiv, GitHub, leaderboards). Article framing
(L1–L4 loop engineering) per `loop_engineering_gaps.md`.*
