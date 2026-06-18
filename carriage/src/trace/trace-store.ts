import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export interface TraceEvent {
  seq: number
  ts: number
  type: string
  [key: string]: unknown
}

export type TraceInput = { type: string } & Record<string, unknown>

export class TraceStore {
  private seq: number

  private constructor(
    private readonly filePath: string,
    startSeq: number,
  ) {
    this.seq = startSeq
  }

  static async open(filePath: string): Promise<TraceStore> {
    const existing = await TraceStore.readLines(filePath)
    return new TraceStore(filePath, existing.length)
  }

  async append(event: TraceInput): Promise<TraceEvent> {
    // seq and ts are always assigned by the store; any caller-supplied values are overwritten.
    const record: TraceEvent = { ...event, seq: this.seq++, ts: Date.now() }
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(record) + "\n")
    return record
  }

  async read(): Promise<TraceEvent[]> {
    const lines = await TraceStore.readLines(this.filePath)
    return lines.map((line) => JSON.parse(line) as TraceEvent)
  }

  private static async readLines(filePath: string): Promise<string[]> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return []
    const text = await file.text()
    return text.split("\n").filter((line) => line.trim().length > 0)
  }
}
