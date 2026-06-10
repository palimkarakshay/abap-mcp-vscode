/**
 * Registers abap-mcp as a stdio MCP server with VS Code's Language Model API
 * (`vscode.lm.registerMcpServerDefinitionProvider`, finalized in VS Code 1.101,
 * June 2025). When this extension is installed, abap-mcp's 8 tools appear in
 * Copilot agent mode automatically — no .vscode/mcp.json required.
 *
 * abap-mcp run with NO subcommand starts the stdio MCP server (see cli.ts:
 * `case undefined: case "serve": return null` → starts the server). So the
 * server definition is simply `node <abap-mcp>/dist/cli.js`.
 */
import * as vscode from "vscode";

import { resolveCli } from "./cli";

export const MCP_PROVIDER_ID = "abapMcpProvider";

/**
 * The VS Code MCP types (McpServerDefinitionProvider, McpStdioServerDefinition)
 * are part of the finalized `vscode.lm` API in 1.101+. We feature-detect at
 * runtime so the extension still loads (commands work) on older builds.
 */
interface LmWithMcp {
  registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable;
}

export function registerMcpProvider(context: vscode.ExtensionContext): vscode.Disposable | undefined {
  const lm = vscode.lm as unknown as LmWithMcp;
  const McpStdioServerDefinition = (vscode as unknown as {
    McpStdioServerDefinition?: new (init: {
      label: string;
      command: string;
      args?: string[];
      cwd?: vscode.Uri;
      env?: Record<string, string | number | null>;
      version?: string;
    }) => unknown;
  }).McpStdioServerDefinition;

  if (typeof lm.registerMcpServerDefinitionProvider !== "function" || !McpStdioServerDefinition) {
    // Older VS Code (< 1.101) — MCP provider API not available. Native commands
    // and the "write mcp.json" fallback command still work.
    return undefined;
  }

  const didChange = new vscode.EventEmitter<void>();
  context.subscriptions.push(didChange);

  // Re-publish the definition when the user changes how the CLI is resolved.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("abapMcp.cliPath") || e.affectsConfiguration("abapMcp.nodePath")) {
        didChange.fire();
      }
    }),
  );

  const provider = {
    onDidChangeMcpServerDefinitions: didChange.event,
    provideMcpServerDefinitions: async () => {
      const { node, cli, bin } = resolveCli(context.extensionPath);
      const command = bin ?? node;
      const args = bin ? [] : [cli as string];
      return [
        new McpStdioServerDefinition({
          label: "abap-mcp",
          command,
          args,
          version: "0.3.0",
        }),
      ];
    },
    // No extra setup needed (offline, no auth) — return the definition as-is.
    resolveMcpServerDefinition: async (server: unknown) => server,
  };

  const disposable = lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider);
  context.subscriptions.push(disposable);
  return disposable;
}
