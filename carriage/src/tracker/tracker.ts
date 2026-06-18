export type ComponentStatus = "open" | "converged" | "escalated"

/** Curated component-status memory (spec §5.1). Markdown now; beads/SQLite later, same seam. */
export interface Tracker {
  setStatus(component: string, status: ComponentStatus): Promise<void>
  getStatus(component: string): Promise<ComponentStatus | undefined>
  openComponents(): Promise<string[]>
}
