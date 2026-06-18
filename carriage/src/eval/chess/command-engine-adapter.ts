import { $ } from "bun"
import type { EngineAdapter } from "./engine-adapter.ts"

export interface CommandEngineAdapterOptions {
  /** Working directory to run the engine in (e.g. an isolated `Workspace.targetDir`). */
  cwd: string
  /** Builds the argv that prints the perft node count to stdout for a depth + FEN. */
  perftCommand: (depth: number, fen: string) => string[]
}

/** Runs a real chess engine's perft via a shell command and parses the node count. */
export class CommandEngineAdapter implements EngineAdapter {
  constructor(private readonly options: CommandEngineAdapterOptions) {}

  async perft(depth: number, fen: string): Promise<number> {
    const argv = this.options.perftCommand(depth, fen)
    // `Bun.$` throws on a non-zero exit, which becomes an "unmeasurable" rejection upstream.
    // No timeout here: a real engine that hangs would hang measure() — add an AbortSignal in Phase 2.
    const stdout = (await $`${argv}`.cwd(this.options.cwd).text()).trim()
    const count = Number(stdout)
    if (stdout === "" || !Number.isFinite(count)) {
      throw new Error(`engine perft did not return a number (got ${JSON.stringify(stdout)})`)
    }
    return count
  }
}
