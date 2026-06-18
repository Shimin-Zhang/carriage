export type Severity = "blocker" | "major" | "minor" | "nitpick"
export type Dimension = "spec" | "test" | "impl"

export interface Finding {
  severity: Severity
  dimension: Dimension
  message: string
}

export interface Verdict {
  findings: Finding[]
}

/** Count of findings that block convergence — everything stricter than "nitpick". */
export function unresolvedCount(verdict: Verdict): number {
  return verdict.findings.filter((finding) => finding.severity !== "nitpick").length
}
