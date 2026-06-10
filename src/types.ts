/**
 * Structural mirrors of abap-mcp's CLI JSON output. Kept as a local copy (not
 * imported from abap-mcp) so the extension does not depend on abap-mcp's
 * internal module layout — only on its stable `--json` contract.
 */

export interface Finding {
  rule: string;
  message: string;
  /** abaplint severity: "Error" | "Warning" | "Info". */
  severity: string;
  file: string;
  line: number;
  column: number;
  excerpt: string;
  docsUrl: string;
}

/** Shape of `abap-mcp lint --json`. */
export interface LintResult {
  files: number;
  findings: Finding[];
}

export interface ReadinessCategory {
  category: string;
  label: string;
  count: number;
  findings: Finding[];
}

export interface ReleasedApiFinding {
  object: string;
  objectType: string;
  state: "deprecated" | "not-released";
  successor?: string;
  file: string;
  line: number;
  note: string;
}

/** Shape of `abap-mcp readiness --json` (a merged ReadinessReport + `files`). */
export interface ReadinessResult {
  files: number;
  verdict: "ready" | "minor-rework" | "moderate-rework" | "significant-rework";
  score: number;
  cloudBlockerCount: number;
  categories: ReadinessCategory[];
  brokenAtBaseline: Finding[];
  releasedApiFindings: ReleasedApiFinding[];
  releasedApiSnapshotDate: string;
  baselineVersion: string;
  scopeNote: string;
}

export interface MethodOutline {
  name: string;
  visibility: "public" | "protected" | "private";
}

export interface ClassOutline {
  name: string;
  isGlobal: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  isForTesting: boolean;
  superClass: string | null;
  interfaces: string[];
  methods: MethodOutline[];
  attributes: string[];
  constants: string[];
}

/** One element of `abap-mcp outline --json` (an array of FileOutline). */
export interface FileOutline {
  file: string;
  classes: ClassOutline[];
  interfaces: string[];
  forms: string[];
  parseable: boolean;
}
