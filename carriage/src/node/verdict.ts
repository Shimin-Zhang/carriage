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
