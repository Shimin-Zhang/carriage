import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { ComponentStatus, Tracker } from "./tracker.ts"

export class MarkdownTracker implements Tracker {
  private constructor(
    private readonly filePath: string,
    private readonly entries: Map<string, ComponentStatus>,
  ) {}

  static async open(filePath: string): Promise<MarkdownTracker> {
    await mkdir(dirname(filePath), { recursive: true })
    return new MarkdownTracker(filePath, await MarkdownTracker.read(filePath))
  }

  async setStatus(component: string, status: ComponentStatus): Promise<void> {
    if (component.includes("\n")) {
      throw new Error(`component name must not contain a newline: ${JSON.stringify(component)}`)
    }
    this.entries.set(component, status)
    await this.write()
  }

  getStatus(component: string): Promise<ComponentStatus | undefined> {
    return Promise.resolve(this.entries.get(component))
  }

  openComponents(): Promise<string[]> {
    return Promise.resolve([...this.entries].filter(([, status]) => status === "open").map(([component]) => component))
  }

  // Ledger format: one "- <component>: <status>" row per entry (component names must not contain newlines).
  private async write(): Promise<void> {
    const rows = [...this.entries].map(([component, status]) => `- ${component}: ${status}`)
    await writeFile(this.filePath, ["# Carriage Ledger", "", ...rows, ""].join("\n"))
  }

  private static async read(filePath: string): Promise<Map<string, ComponentStatus>> {
    const entries = new Map<string, ComponentStatus>()
    const file = Bun.file(filePath)
    if (!(await file.exists())) return entries
    for (const line of (await file.text()).split("\n")) {
      const match = line.match(/^- (.+): (open|converged|escalated)$/)
      if (match) entries.set(match[1]!, match[2] as ComponentStatus)
    }
    return entries
  }
}
