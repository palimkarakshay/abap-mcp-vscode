/**
 * abap-mcp-vscode — brings abap-mcp's offline ABAP analysis into the editor.
 *
 * Two integration angles:
 *  1. MCP server registration (mcpProvider.ts): abap-mcp's 8 tools surface in
 *     Copilot agent mode via vscode.lm.registerMcpServerDefinitionProvider.
 *  2. Native editor commands (this file): Lint / Cloud Readiness / Format /
 *     Scaffold RAP BO / Outline, each shelling out to the abap-mcp CLI (or its
 *     formatAbap library export) and rendering results as Problems-panel
 *     diagnostics or an output channel.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import * as vscode from "vscode";

import { isAbapGitName, suggestAbapGitName } from "./abapgit";
import { CliNotFoundError, resolveCli, runCli, runCliJson } from "./cli";
import { findingsToDiagnostics } from "./diagnostics";
import { formatAbapBuffer } from "./format";
import { registerMcpProvider } from "./mcpProvider";
import type { FileOutline, LintResult, ReadinessResult } from "./types";

let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("abap-mcp");
  output = vscode.window.createOutputChannel("ABAP MCP");
  context.subscriptions.push(diagnostics, output);

  // Angle 1: register abap-mcp as an MCP server for Copilot agent mode.
  registerMcpProvider(context);

  // Angle 2: native editor commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("abapMcp.lint", () => withActiveAbap(context, runLint)),
    vscode.commands.registerCommand("abapMcp.readiness", () => withActiveAbap(context, runReadiness)),
    vscode.commands.registerCommand("abapMcp.format", () => withActiveAbap(context, runFormat)),
    vscode.commands.registerCommand("abapMcp.outline", () => withActiveAbap(context, runOutline)),
    vscode.commands.registerCommand("abapMcp.scaffold", () => runScaffold(context)),
    vscode.commands.registerCommand("abapMcp.writeMcpJson", () => writeMcpJson(context)),
  );

  // Optional lint-on-save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const cfg = vscode.workspace.getConfiguration("abapMcp");
      if (cfg.get<boolean>("lintOnSave") && doc.languageId === "abap") {
        void runLint(context, doc).catch(reportError);
      }
    }),
    // Clear stale diagnostics when an ABAP doc closes.
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
  );
}

export function deactivate(): void {
  diagnostics?.clear();
}

// ---------------------------------------------------------------------------
// Command helpers
// ---------------------------------------------------------------------------

type AbapHandler = (context: vscode.ExtensionContext, document: vscode.TextDocument) => Promise<void>;

/** Resolve the active ABAP editor, warn on non-abapGit names, then run handler. */
async function withActiveAbap(context: vscode.ExtensionContext, handler: AbapHandler): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("ABAP MCP: open an ABAP file first.");
    return;
  }
  const doc = editor.document;
  await ensureSavedAbapGit(doc);
  try {
    await handler(context, doc);
  } catch (e) {
    reportError(e);
  }
}

/**
 * abap-mcp infers the object type from the filename and silently skips files
 * that are not abapGit-style. Warn (non-blocking) so empty results aren't
 * mistaken for "no findings".
 */
async function ensureSavedAbapGit(doc: vscode.TextDocument): Promise<void> {
  const name = doc.fileName.split(/[\\/]/).pop() ?? doc.fileName;
  if (!isAbapGitName(name)) {
    const firstLine = doc.lineCount > 0 ? doc.lineAt(0).text : "";
    const suggestion = suggestAbapGitName(name, firstLine);
    void vscode.window.showWarningMessage(
      `ABAP MCP: "${name}" is not an abapGit-style filename — abap-mcp may skip it. ` +
        `Rename to e.g. "${suggestion}" for analysis.`,
    );
  }
  if (doc.isDirty) {
    await doc.save();
  }
}

function reportError(e: unknown): void {
  const msg = e instanceof CliNotFoundError ? e.message : `ABAP MCP: ${(e as Error).message ?? String(e)}`;
  output.appendLine(`[error] ${msg}`);
  void vscode.window.showErrorMessage(msg);
}

// ---------------------------------------------------------------------------
// ABAP: Lint
// ---------------------------------------------------------------------------

async function runLint(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const version = cfg.get<string>("abapVersion") || "v758";
  const preset = cfg.get<string>("lintPreset") || "style";
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "ABAP MCP: linting…" },
    () =>
      runCliJson<LintResult>(context.extensionPath, [
        "lint",
        doc.fileName,
        "--abap-version",
        version,
        "--preset",
        preset,
        "--json",
      ]),
  );
  diagnostics.set(doc.uri, findingsToDiagnostics(result.findings, doc));
  const n = result.findings.length;
  if (n === 0) {
    void vscode.window.showInformationMessage(`ABAP MCP: no findings (${preset} @ ${version}).`);
  } else {
    void vscode.window.showInformationMessage(
      `ABAP MCP: ${n} finding(s) — see the Problems panel (${preset} @ ${version}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// ABAP: Cloud Readiness
// ---------------------------------------------------------------------------

async function runReadiness(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const baseline = cfg.get<string>("abapVersion");
  const args = ["readiness", doc.fileName, "--json"];
  if (baseline && baseline !== "Cloud") args.push("--baseline", baseline);
  const r = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "ABAP MCP: checking ABAP Cloud readiness…" },
    () => runCliJson<ReadinessResult>(context.extensionPath, args),
  );

  output.clear();
  output.appendLine(`ABAP Cloud readiness — ${doc.fileName}`);
  output.appendLine(`Verdict: ${r.verdict.toUpperCase()}   Score: ${r.score}/100`);
  output.appendLine(`Cloud blockers: ${r.cloudBlockerCount} across ${r.files} file(s) (baseline ${r.baselineVersion})`);
  output.appendLine("");
  if (r.categories.length > 0) {
    output.appendLine("Blocker categories:");
    for (const c of r.categories) {
      output.appendLine(`  ${c.count.toString().padStart(4)}  ${c.category} — ${c.label}`);
    }
    output.appendLine("");
  }
  if (r.brokenAtBaseline.length > 0) {
    output.appendLine(`${r.brokenAtBaseline.length} finding(s) broken at the classic baseline (fix first; not migration work):`);
    for (const f of r.brokenAtBaseline) output.appendLine(`  ${f.file}:${f.line} [${f.severity}] ${f.rule}: ${f.message}`);
    output.appendLine("");
  }
  if (r.releasedApiFindings.length > 0) {
    output.appendLine(`Released-API notes (snapshot ${r.releasedApiSnapshotDate}; informational, NOT scored):`);
    for (const f of r.releasedApiFindings) {
      const succ = f.successor ? ` → ${f.successor}` : "";
      output.appendLine(`  ${f.file}:${f.line} [${f.state}] ${f.object} (${f.objectType})${succ}`);
    }
    output.appendLine("");
  }
  output.appendLine(`Note: ${r.scopeNote}`);
  output.show(true);

  // Also surface cloud blockers + baseline breaks as diagnostics.
  const allFindings = [...r.categories.flatMap((c) => c.findings), ...r.brokenAtBaseline];
  diagnostics.set(doc.uri, findingsToDiagnostics(allFindings, doc));

  void vscode.window.showInformationMessage(
    `ABAP Cloud readiness: ${r.verdict} (score ${r.score}, ${r.cloudBlockerCount} blocker(s)) — see Output.`,
  );
}

// ---------------------------------------------------------------------------
// ABAP: Format
// ---------------------------------------------------------------------------

async function runFormat(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  const name = doc.fileName.split(/[\\/]/).pop() ?? doc.fileName;
  const formatted = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "ABAP MCP: formatting…" },
    () => formatAbapBuffer(context.extensionPath, doc.getText(), name),
  );
  if (formatted === doc.getText()) {
    void vscode.window.showInformationMessage("ABAP MCP: already formatted.");
    return;
  }
  const full = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, full, formatted);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage("ABAP MCP: formatted.");
}

// ---------------------------------------------------------------------------
// ABAP: Outline
// ---------------------------------------------------------------------------

async function runOutline(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  const outlines = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "ABAP MCP: building outline…" },
    () => runCliJson<FileOutline[]>(context.extensionPath, ["outline", doc.fileName, "--json"]),
  );
  output.clear();
  output.appendLine(`ABAP outline — ${doc.fileName}`);
  output.appendLine("");
  for (const o of outlines) {
    if (!o.parseable) {
      output.appendLine(`${o.file}: (not parseable)`);
      continue;
    }
    for (const c of o.classes) {
      const ext = c.superClass ? ` extends ${c.superClass}` : "";
      const impl = c.interfaces.length ? ` implements ${c.interfaces.join(", ")}` : "";
      output.appendLine(`${o.file}: class ${c.name}${c.isGlobal ? "" : " (local)"}${ext}${impl}`);
      for (const m of c.methods) output.appendLine(`    ${m.visibility.padEnd(9)} ${m.name}()`);
      if (c.attributes.length) output.appendLine(`    data:      ${c.attributes.join(", ")}`);
      if (c.constants.length) output.appendLine(`    constants: ${c.constants.join(", ")}`);
    }
    for (const i of o.interfaces) output.appendLine(`${o.file}: interface ${i}`);
    for (const f of o.forms) output.appendLine(`${o.file}: form ${f}`);
  }
  output.show(true);
}

// ---------------------------------------------------------------------------
// ABAP: Scaffold RAP BO
// ---------------------------------------------------------------------------

async function runScaffold(context: vscode.ExtensionContext): Promise<void> {
  const entity = await vscode.window.showInputBox({
    prompt: "RAP entity name (e.g. Travel)",
    validateInput: (v) => (v.trim().length === 0 ? "Required" : null),
  });
  if (!entity) return;
  const table = await vscode.window.showInputBox({
    prompt: "Backing SQL table (e.g. ztravel)",
    value: `z${entity.toLowerCase()}`,
    validateInput: (v) => (v.trim().length === 0 ? "Required" : null),
  });
  if (!table) return;
  const key = await vscode.window.showInputBox({
    prompt: "Key field (e.g. travel_id)",
    value: `${entity.toLowerCase()}_id`,
    validateInput: (v) => (v.trim().length === 0 ? "Required" : null),
  });
  if (!key) return;
  const fields = await vscode.window.showInputBox({
    prompt: "Optional extra fields, comma-separated (name:type), e.g. description:abap.char(60),amount",
    placeHolder: "leave empty for none",
  });
  const draftPick = await vscode.window.showQuickPick(["draft-enabled", "no-draft"], {
    placeHolder: "Draft handling",
  });
  if (!draftPick) return;

  const args = ["scaffold", "--entity", entity, "--table", table, "--key", key];
  if (fields && fields.trim().length > 0) args.push("--fields", fields.trim());
  if (draftPick === "no-draft") args.push("--no-draft");

  // Run the CLI WITHOUT --out so it prints all artifacts to stdout (the abap-mcp
  // server never touches the user filesystem; the CLI only writes with --out).
  const { stdout, stderr, code } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "ABAP MCP: scaffolding RAP BO…" },
    () => runCli(context.extensionPath, args),
  );

  const placeOnDisk =
    code === 0 &&
    (await vscode.window.showQuickPick(["Show in editor", "Write files to a folder…"], {
      placeHolder: "Where should the generated RAP BO go?",
    }));

  if (placeOnDisk === "Write files to a folder…") {
    await writeScaffoldToFolder(context, args);
    return;
  }

  const out = await vscode.workspace.openTextDocument({ content: stdout, language: "abap" });
  await vscode.window.showTextDocument(out, { preview: false });
  if (stderr.trim()) {
    output.appendLine(`[scaffold] ${stderr.trim()}`);
    output.show(true);
  }
}

/** Re-run scaffold with --out into a user-picked folder. */
async function writeScaffoldToFolder(context: vscode.ExtensionContext, baseArgs: string[]): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Scaffold here",
  });
  if (!picked || picked.length === 0) return;
  const dir = picked[0].fsPath;
  const { stdout, stderr, code } = await runCli(context.extensionPath, [...baseArgs, "--out", dir, "--force"]);
  output.clear();
  output.appendLine(stdout.trim());
  if (stderr.trim()) output.appendLine(stderr.trim());
  output.show(true);
  if (code === 0 || code === 1) {
    void vscode.window.showInformationMessage(`ABAP MCP: RAP BO written to ${dir}.`);
  } else {
    void vscode.window.showErrorMessage(`ABAP MCP: scaffold failed (exit ${code}). See Output.`);
  }
}

// ---------------------------------------------------------------------------
// ABAP: Register abap-mcp in .vscode/mcp.json (fallback / explicit registration)
// ---------------------------------------------------------------------------

/**
 * Writes a workspace `.vscode/mcp.json` registering abap-mcp as a stdio server.
 * The provider-based registration (angle 1) is automatic on VS Code 1.101+;
 * this command gives an explicit, inspectable config and a fallback for older
 * builds or other MCP clients.
 */
async function writeMcpJson(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage("ABAP MCP: open a workspace folder first.");
    return;
  }
  const { node, cli, bin } = resolveCli(context.extensionPath);
  const command = bin ?? node;
  const args = bin ? [] : [cli as string];
  const config = {
    servers: {
      "abap-mcp": {
        type: "stdio",
        command,
        args,
      },
    },
  };
  const target = join(folder.uri.fsPath, ".vscode", "mcp.json");
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${target} already exists. Overwrite?`,
      "Overwrite",
      "Cancel",
    );
    if (overwrite !== "Overwrite") return;
  }
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n", "utf8");
  const opened = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(opened);
  void vscode.window.showInformationMessage("ABAP MCP: wrote .vscode/mcp.json registering abap-mcp.");
}
