# ABAP MCP for VS Code

Brings [**abap-mcp**](https://github.com/palimkarakshay/abap-mcp) — offline SAP ABAP static
analysis (abaplint), ABAP Cloud / Clean Core readiness checks, and RAP managed-BO scaffolding —
directly into Visual Studio Code. **No SAP system, credentials, or network required.**

Two integrations in one extension:

1. **MCP server registration** — registers abap-mcp as a stdio MCP server with VS Code's Language
   Model API. Once installed, abap-mcp's 12 tools and 3 guided-workflow prompts appear
   automatically in **Copilot agent mode** — nothing to configure.
2. **Native editor commands** — analyze the file in front of you with the Command Palette or the
   editor context menu; findings land in the **Problems panel** and an **ABAP MCP output channel**.

## Install

- **From VSIX (today):** download `abap-mcp-vscode-<version>.vsix` from the
  [releases page](https://github.com/palimkarakshay/abap-mcp-vscode/releases), then in VS Code:
  Extensions view → `…` menu → **Install from VSIX…** (or `code --install-extension <file>.vsix`).
- **Marketplace:** publication pending.
- **Just want the MCP server, no extension?** One command registers it for Copilot agent mode:
  `code --add-mcp '{"name":"abap-mcp","command":"npx","args":["-y","abap-mcp"]}'`.

## Commands

| Command | What it does | Result surface |
| --- | --- | --- |
| **ABAP: Lint** | abaplint over the active file (`lint --json`) | Problems panel (rule + line + docs link) |
| **ABAP: Cloud Readiness** | ABAP Cloud / Clean Core readiness diff (`readiness --json`) | Output channel (verdict, score, blocker categories, released-API notes) + diagnostics |
| **ABAP: Format** | abap-mcp's `formatAbap` over the buffer | rewrites the editor buffer |
| **ABAP: Scaffold RAP BO** | generates a RAP managed BO (`scaffold`) | new editor doc, or written to a folder you pick |
| **ABAP: Outline** | classes / methods / interfaces / forms (`outline --json`) | Output channel |
| **ABAP: Register abap-mcp in .vscode/mcp.json** | writes an explicit stdio MCP config | `.vscode/mcp.json` |

## Requirements

- **VS Code 1.101+** (June 2025) for the automatic MCP server registration. Older builds still get
  all native commands plus the `.vscode/mcp.json` writer.
- **Node.js 20+** on your PATH.
- **abap-mcp** reachable. The extension resolves it in this order:
  1. the `abapMcp.cliPath` setting (absolute path to `abap-mcp/dist/cli.js`),
  2. an `abap-mcp` dependency in the extension's own `node_modules`,
  3. a globally installed `abap-mcp` (`npm i -g abap-mcp`).

  For local development against the source repo, point `abapMcp.cliPath` at
  `~/projects/abap-mcp/dist/cli.js` (after `npm install && npm run build` in abap-mcp).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `abapMcp.cliPath` | `""` | Absolute path to `abap-mcp/dist/cli.js`. Overrides auto-resolution. |
| `abapMcp.nodePath` | `node` | Node.js executable used to run the CLI. |
| `abapMcp.abapVersion` | `v758` | ABAP version for lint / readiness baseline (`Cloud` lints against ABAP Cloud scope). |
| `abapMcp.lintPreset` | `style` | abaplint preset: `syntax-only` \| `style` \| `full`. |
| `abapMcp.lintOnSave` | `false` | Lint ABAP files automatically on save. |

## abapGit filenames

abap-mcp infers the ABAP object type from the **filename** and silently skips files that are not
abapGit-style. Name your files accordingly (the extension warns if they aren't):

`zcl_foo.clas.abap` · `zif_foo.intf.abap` · `zprog.prog.abap` · `zfoo.fugr.abap` ·
`zfoo.ddls.asddls` · `zfoo.bdef.asbdef` · `zfoo.srvd.srvdsrv`

## Develop

```bash
npm install
npm run compile        # tsc → dist/  (build/verify gate)
```

Then open this folder in VS Code and press **F5** ("Run Extension") to launch the Extension
Development Host with the extension loaded. Set `abapMcp.cliPath` in the dev host's settings to your
local `abap-mcp/dist/cli.js`, open an `*.clas.abap` file, and run the commands from the palette.

Package a `.vsix` (no publish):

```bash
npm run package        # vsce package --no-dependencies
```

## License

MIT © Akshay Palimkar. Built on [abap-mcp](https://github.com/palimkarakshay/abap-mcp) and
[abaplint](https://abaplint.org).
