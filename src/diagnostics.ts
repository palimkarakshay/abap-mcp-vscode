/** Map abap-mcp/abaplint findings to vscode.Diagnostic entries. */
import * as vscode from "vscode";

import type { Finding } from "./types";

function toSeverity(severity: string): vscode.DiagnosticSeverity {
  switch (severity.toLowerCase()) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
    case "information":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

/**
 * abaplint reports 1-based line/column; VS Code ranges are 0-based. We anchor
 * the range at (line-1, column-1) and extend it to end-of-line so the squiggle
 * covers the offending statement, and stash the rule key + docs URL so they show
 * in the Problems panel and hover.
 */
export function findingToDiagnostic(f: Finding, document?: vscode.TextDocument): vscode.Diagnostic {
  const startLine = Math.max(0, f.line - 1);
  const startCol = Math.max(0, f.column - 1);
  let endCol = startCol + Math.max(1, f.excerpt.trim().length || 1);
  if (document && startLine < document.lineCount) {
    endCol = document.lineAt(startLine).range.end.character;
  }
  const range = new vscode.Range(startLine, startCol, startLine, Math.max(endCol, startCol + 1));
  const diag = new vscode.Diagnostic(range, f.message, toSeverity(f.severity));
  diag.source = "abap-mcp";
  diag.code = f.docsUrl
    ? { value: f.rule, target: vscode.Uri.parse(f.docsUrl) }
    : f.rule;
  return diag;
}

export function findingsToDiagnostics(findings: Finding[], document?: vscode.TextDocument): vscode.Diagnostic[] {
  return findings.map((f) => findingToDiagnostic(f, document));
}
