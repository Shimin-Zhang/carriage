import { $ } from "bun"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

export interface WorkspaceOptions {
  /** Path to the target git repository to isolate. */
  targetRepo: string
  /** Commit-ish to check out (default "HEAD"). Pinned to a full SHA on creation. */
  rev?: string
  /** Run-owned directory for this run's persistent carriage artifacts (ledger, traces). */
  runRoot: string
}

/**
 * One run's isolated workspace: a detached git worktree of `targetRepo` at a pinned rev
 * (where a builder edits and an Oracle measures), plus a persistent `runRoot` for carriage
 * artifacts. `dispose()` removes the worktree only; `runRoot` (ledger/traces) survives.
 */
export class Workspace {
  private constructor(
    private readonly targetRepo: string,
    readonly targetDir: string,
    readonly targetRev: string,
    readonly runRoot: string,
  ) {}

  get ledgerPath(): string {
    return join(this.runRoot, "ledger.md")
  }

  /** Path for a run's JSONL trace under runRoot. `runId` must be a safe filename token (no path separators). */
  tracePath(runId: string): string {
    return join(this.runRoot, "traces", `${runId}.jsonl`)
  }

  /** Creates the isolated worktree. `<runRoot>/target` must not already exist (use a fresh runRoot per run). */
  static async create(options: WorkspaceOptions): Promise<Workspace> {
    const targetRev = (await $`git -C ${options.targetRepo} rev-parse ${options.rev ?? "HEAD"}`.text()).trim()
    const targetDir = join(options.runRoot, "target")
    await mkdir(options.runRoot, { recursive: true })
    await $`git -C ${options.targetRepo} worktree add --detach ${targetDir} ${targetRev}`.quiet()
    return new Workspace(options.targetRepo, targetDir, targetRev, options.runRoot)
  }

  async dispose(): Promise<void> {
    await $`git -C ${this.targetRepo} worktree remove ${this.targetDir} --force`.quiet()
    await $`git -C ${this.targetRepo} worktree prune`.quiet()
  }
}
