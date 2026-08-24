/**
 * Deterministic auto-fix via abap-mcp's `fixAbap` library export (0.9.0+).
 *
 * Same out-of-process shim pattern as format.ts: a node `-e` script imports the
 * resolved abap-mcp `dist/index.js`, reads the source on stdin, applies
 * abaplint's machine fixes and writes a JSON result on stdout. Only abaplint's
 * own parser-guaranteed edits are applied — nothing is invented.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as vscode from "vscode";

export interface AutofixOutcome {
  source: string;
  fixedCount: number;
  remainingCount: number;
  /** rule → number of fixes it supplied. */
  rules: Record<string, number>;
  stoppedEarly?: string;
}

function resolveLibrary(extensionPath: string): string {
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const explicit = cfg.get<string>("cliPath");
  if (explicit && explicit.trim().length > 0) {
    const index = join(dirname(explicit), "index.js");
    if (existsSync(index)) return index;
  }
  const require = createRequire(join(extensionPath, "package.json"));
  const pkgJson = require.resolve("abap-mcp/package.json");
  return join(dirname(pkgJson), "dist", "index.js");
}

const SHIM = (libUrl: string, filename: string, version: string) => `
import(${JSON.stringify(libUrl)}).then(async (m) => {
  if (typeof m.fixAbap !== "function") {
    process.stderr.write("Installed abap-mcp is older than 0.9.0 — update it to get Auto-fix.");
    process.exit(4);
  }
  let src = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) src += chunk;
  const r = m.fixAbap([{ filename: ${JSON.stringify(filename)}, source: src }], { version: ${JSON.stringify(version)}, preset: "style" });
  const rules = {};
  for (const f of r.fixed) rules[f.rule] = (rules[f.rule] ?? 0) + 1;
  process.stdout.write(JSON.stringify({
    source: r.files[0].source,
    fixedCount: r.fixedCount,
    remainingCount: r.remaining.length,
    rules,
    stoppedEarly: r.stoppedEarly,
  }));
}).catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(3); });
`;

export async function autofixAbap(
  extensionPath: string,
  source: string,
  filename: string,
): Promise<AutofixOutcome> {
  const lib = resolveLibrary(extensionPath);
  if (!existsSync(lib)) {
    throw new Error(
      `Could not find abap-mcp library at ${lib}. Run "npm run build" in abap-mcp or set abapMcp.cliPath.`,
    );
  }
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const node = cfg.get<string>("nodePath") || "node";
  const version = cfg.get<string>("abapVersion") || "v758";
  const shim = SHIM(pathToFileURL(lib).href, filename, version);

  return new Promise<AutofixOutcome>((resolve, reject) => {
    const child = spawn(node, ["--input-type=module", "-e", shim], { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => reject(new Error(`Failed to run auto-fix: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as AutofixOutcome);
        } catch {
          reject(new Error(`Auto-fix returned non-JSON output: ${stdout.slice(0, 200)}`));
        }
      } else reject(new Error(`Auto-fix exited ${code}: ${stderr || "unknown error"}`));
    });
    child.stdin.write(source);
    child.stdin.end();
  });
}
