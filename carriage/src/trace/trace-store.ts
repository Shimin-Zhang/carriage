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
    const existing = await TraceStore.readParsed(filePath)
    const startSeq = existing.reduce((max, event) => (event.seq > max ? event.seq : max), -1) + 1
    return new TraceStore(filePath, startSeq)
  }

  async append(event: TraceInput): Promise<TraceEvent> {
    // seq and ts are always assigned by the store; any caller-supplied values are overwritten.
    const record: TraceEvent = { ...event, seq: this.seq++, ts: Date.now() }
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(record) + "\n")
    return record
  }

  async read(): Promise<TraceEvent[]> {
    return TraceStore.readParsed(this.filePath)
  }

  /** Reads + parses the trace, tolerating a partial *trailing* line (a crash mid-append). A malformed
   * non-trailing line is real corruption and throws, rather than silently dropping events. */
  private static async readParsed(filePath: string): Promise<TraceEvent[]> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return []
    const lines = (await file.text()).split("\n").filter((line) => line.trim().length > 0)
    const events: TraceEvent[] = []
    for (let i = 0; i < lines.length; i++) {
      try {
        events.push(JSON.parse(lines[i]!) as TraceEvent)
      } catch (error) {
        if (i === lines.length - 1) break // tolerate a partial trailing record from a crash
        throw error // a malformed non-trailing line is corruption — fail loudly, don't lose events
      }
    }
    return events
  }
}
