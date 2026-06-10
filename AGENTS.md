# abap-mcp-vscode

VS Code extension that brings **abap-mcp** into the editor. Two angles: (1) registers abap-mcp as
a stdio **MCP server** for Copilot agent mode via `vscode.lm.registerMcpServerDefinitionProvider`
(VS Code 1.101+); (2) native **editor commands** (Lint, Cloud Readiness, Format, Scaffold RAP BO,
Outline) that shell out to the abap-mcp CLI / `formatAbap` library and render diagnostics + output.
Lumivara product line: **SAP**. **Public MIT** (personal GitHub `palimkarakshay/abap-mcp-vscode`).

## Package manager: npm — Node >= 20, VS Code ^1.101.0

## Commands (authoritative)
- `npm install`
- `npm run compile`   — `tsc -p ./` → `dist/` = **the build/verify gate** (must pass clean)
- `npm run watch`     — tsc watch for the Extension Development Host
- `npm run lint`      — `tsc --noEmit` typecheck only
- `npm run package`   — `vsce package --no-dependencies` → `.vsix` (don't publish; owner-run)
- Run it: open this folder in VS Code, press **F5** ("Run Extension") → Extension Development Host.

## Layout
- `src/extension.ts`   — activation + the 6 commands (abapMcp.lint/readiness/format/scaffold/
  outline/writeMcpJson), lint-on-save, diagnostics + output channel wiring.
- `src/mcpProvider.ts` — angle 1: `registerMcpServerDefinitionProvider` → `McpStdioServerDefinition`
  (`node <abap-mcp>/dist/cli.js`, bare = stdio server). Feature-detected for < 1.101.
- `src/cli.ts`         — resolves abap-mcp (`abapMcp.cliPath` → node_modules → global `abap-mcp`
  bin) and spawns it; `runCliJson` parses `--json` stdout.
- `src/format.ts`      — Format via a node `-e` shim importing abap-mcp's `formatAbap` (no `format`
  CLI subcommand exists).
- `src/diagnostics.ts` — Finding → vscode.Diagnostic (1-based→0-based, severity, rule + docsUrl).
- `src/abapgit.ts`     — abapGit-style filename detection + warning.
- `src/types.ts`       — local mirror of abap-mcp's CLI JSON shapes (decoupled from its internals).

## Deploy: none — ships as a `.vsix` / Marketplace extension (owner-run `vsce publish`)

## Gotchas / invariants
- abap-mcp infers object type from the **abapGit filename**; non-abapGit names are silently skipped
  — `ensureSavedAbapGit` warns before each command. Always save the buffer first (commands do).
- abap-mcp invariant honored: the MCP **server never touches fs/network**; only the CLI does (and
  only Scaffold→folder uses `--out`). Format reads stdin, never a path.
- Readiness `releasedApiFindings` are informational, NOT scored — keep them out of blocker counts.
- `engines.vscode` must stay `^1.101.0` (when the MCP provider API was finalized). Don't import
  abap-mcp into the extension host — always shell out, so it tracks the user's installed version.
