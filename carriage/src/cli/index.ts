import { tmpdir } from "node:os"
import { join } from "node:path"
import { TraceStore } from "../trace/trace-store.ts"
import { runFauxDemo, formatTrace } from "./commands.ts"

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (command === "run" && rest[0] === "--faux") {
    const dir = join(tmpdir(), `carriage-run-${Date.now()}`)
    const result = await runFauxDemo(dir)
    console.log(`text: ${result.text}`)
    console.log(`trace: ${result.tracePath}`)
    return 0
  }

  if (command === "trace" && rest[0]) {
    const store = await TraceStore.open(rest[0])
    const events = await store.read()
    console.log(formatTrace(events))
    return 0
  }

  console.error("usage:\n  carriage run --faux\n  carriage trace <file.jsonl>")
  return 1
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
