/**
 * abapGit-style filename detection. abap-mcp's engine infers the ABAP object
 * type from the filename and SILENTLY SKIPS files that are not abapGit-style
 * (e.g. `foo.abap` instead of `zcl_foo.clas.abap`). We surface that to the user
 * before invoking the CLI so empty results are never mistaken for "clean".
 */

/** The abapGit suffixes abap-mcp recognises (must match cli-commands ABAP_FILE_RE). */
export const ABAPGIT_SUFFIXES = [
  ".clas.abap",
  ".clas.locals_imp.abap",
  ".clas.locals_def.abap",
  ".clas.testclasses.abap",
  ".prog.abap",
  ".intf.abap",
  ".fugr.abap",
  ".ddls.asddls",
  ".bdef.asbdef",
  ".srvd.srvdsrv",
  ".ddlx.asddlx",
];

export function isAbapGitName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ABAPGIT_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * Suggest a corrected abapGit name for a bare `.abap` file so the warning is
 * actionable. Heuristic only — based on the leading source keyword.
 */
export function suggestAbapGitName(fileName: string, firstLine: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const head = firstLine.trim().toUpperCase();
  if (head.startsWith("INTERFACE")) return `${base}.intf.abap`;
  if (head.startsWith("CLASS")) return `${base}.clas.abap`;
  if (head.startsWith("REPORT") || head.startsWith("PROGRAM")) return `${base}.prog.abap`;
  if (head.startsWith("FUNCTION")) return `${base}.fugr.abap`;
  return `${base}.clas.abap`;
}
