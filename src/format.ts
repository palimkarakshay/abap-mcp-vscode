/**
 * Format an ABAP buffer via abap-mcp's `formatAbap` library export.
 *
 * abap-mcp exposes `format_abap` as an MCP tool and `formatAbap` as a library
 * export, but it has NO `format` CLI subcommand — so we run a tiny node `-e`
 * shim that imports the resolved abap-mcp `dist/index.js`, reads the source on
 * stdin and writes the formatted source on stdout. This keeps formatting out of
 * the extension host process (no abap-mcp import into VS Code) while reusing the
 * exact same formatter the MCP tool uses.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as vscode from "vscode";

/** Locate abap-mcp's `dist/index.js` (library entry), mirroring resolveCli order. */
function resolveLibrary(extensionPath: string): string {
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const explicit = cfg.get<string>("cliPath");
  if (explicit && explicit.trim().length > 0) {
    // cliPath points at dist/cli.js — index.js sits beside it.
    const index = join(dirname(explicit), "index.js");
    if (existsSync(index)) return index;
  }
  const require = createRequire(join(extensionPath, "package.json"));
  const pkgJson = require.resolve("abap-mcp/package.json");
  return join(dirname(pkgJson), "dist", "index.js");
}

const SHIM = (libUrl: string, filename: string) => `
import(${JSON.stringify(libUrl)}).then(async (m) => {
  let src = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) src += chunk;
  process.stdout.write(m.formatAbap(src, ${JSON.stringify(filename)}));
}).catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(3); });
`;

export async function formatAbapBuffer(
  extensionPath: string,
  source: string,
  filename: string,
): Promise<string> {
  const lib = resolveLibrary(extensionPath);
  if (!existsSync(lib)) {
    throw new Error(`Could not find abap-mcp library at ${lib}. Run "npm run build" in abap-mcp or set abapMcp.cliPath.`);
  }
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const node = cfg.get<string>("nodePath") || "node";
  const shim = SHIM(pathToFileURL(lib).href, filename);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(node, ["--input-type=module", "-e", shim], { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => reject(new Error(`Failed to run formatter: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Formatter exited ${code}: ${stderr || "unknown error"}`));
    });
    child.stdin.write(source);
    child.stdin.end();
  });
}
