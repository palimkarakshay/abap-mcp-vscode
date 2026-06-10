/**
 * Resolves and runs the abap-mcp CLI (`dist/cli.js`) out-of-process.
 *
 * The extension shells out to the SAME CLI the abap-mcp package ships, rather
 * than importing the library, so it tracks the user's installed abap-mcp version
 * and stays decoupled from abap-mcp's ESM/internal layout. stdout carries the
 * JSON payload; stderr carries human-facing notes (the abap-mcp invariant).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import * as vscode from "vscode";

export interface CliResult {
  /** Process exit code: abap-mcp uses 0 ok · 1 findings/validation · 2 usage. */
  code: number;
  stdout: string;
  stderr: string;
}

export class CliNotFoundError extends Error {}

/**
 * Locate `abap-mcp/dist/cli.js`. Order:
 *  1. the `abapMcp.cliPath` setting (explicit override),
 *  2. the `abap-mcp` package resolved from this extension's node_modules,
 *  3. a global install on PATH (we just return "abap-mcp" and let the bin run).
 */
export function resolveCli(extensionPath: string): { node: string; cli: string | null; bin: string | null } {
  const cfg = vscode.workspace.getConfiguration("abapMcp");
  const node = cfg.get<string>("nodePath") || "node";
  const explicit = cfg.get<string>("cliPath");
  if (explicit && explicit.trim().length > 0) {
    if (!existsSync(explicit)) {
      throw new CliNotFoundError(`abapMcp.cliPath is set to "${explicit}" but that file does not exist.`);
    }
    return { node, cli: explicit, bin: null };
  }

  // Try to resolve the abap-mcp package from the extension's own dependencies.
  try {
    const require = createRequire(join(extensionPath, "package.json"));
    const pkgJson = require.resolve("abap-mcp/package.json");
    const cli = join(dirname(pkgJson), "dist", "cli.js");
    if (existsSync(cli)) return { node, cli, bin: null };
  } catch {
    /* not installed as a dependency — fall through to global */
  }

  // Fall back to a globally installed `abap-mcp` binary on PATH.
  return { node, cli: null, bin: "abap-mcp" };
}

/** Spawn the abap-mcp CLI with the given args; resolves with captured streams. */
export function runCli(
  extensionPath: string,
  args: string[],
  options: { cwd?: string; stdin?: string } = {},
): Promise<CliResult> {
  const { node, cli, bin } = resolveCli(extensionPath);
  const command = bin ?? node;
  const fullArgs = bin ? args : [cli as string, ...args];

  return new Promise<CliResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(command, fullArgs, {
        cwd: options.cwd,
        shell: false,
      });
    } catch (e) {
      reject(new CliNotFoundError(`Failed to launch abap-mcp (${command}): ${(e as Error).message}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) =>
      reject(
        new CliNotFoundError(
          `Could not run abap-mcp (${command}). Set "abapMcp.cliPath" to your abap-mcp/dist/cli.js. Cause: ${e.message}`,
        ),
      ),
    );
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

/** Run the CLI and JSON.parse stdout; throws with stderr context on failure. */
export async function runCliJson<T>(extensionPath: string, args: string[], cwd?: string): Promise<T> {
  const { stdout, stderr, code } = await runCli(extensionPath, args, { cwd });
  if (stdout.trim().length === 0) {
    throw new Error(
      `abap-mcp produced no output (exit ${code}). ${stderr.trim() || "Check that the file is an abapGit-style ABAP file."}`,
    );
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`abap-mcp returned non-JSON output (exit ${code}): ${stdout.slice(0, 400)}`);
  }
}
