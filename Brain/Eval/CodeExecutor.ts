// Sandboxed code execution for eval + RL verifiable reward (Phase 5). Runs candidate code in a
// FRESH subprocess in a throwaway temp dir with a hard timeout, so model output can be checked
// against tests (pass/fail) without hanging the host on infinite loops.
//
// ⚠️ SECURITY (Sabry's absolute priority, dedicated place): this provides PROCESS ISOLATION + a HARD
// TIMEOUT CAP + a SECRET-SCRUBBED ENV (below). It still does NOT restrict filesystem or network access —
// executing untrusted model output at scale (real RL, or the `run_code` tool with ExecEnabled=true) MUST
// additionally run inside a container/VM/gVisor sandbox with no network and a read-only fs. Treat this
// as the controllable seam where that stronger isolation is plugged in. Do NOT enable ExecEnabled in a
// deployment reachable by untrusted input without that OS-level isolation.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type ExecResult = {
  Passed: boolean; // exit code 0 and not killed
  ExitCode: number | null;
  Stdout: string;
  Stderr: string;
  DurationMs: number;
};

// A hard ceiling on the (possibly model-supplied) timeout: a caller/model can shorten it but never make
// one execution block the host for an unbounded window. The whole call is synchronous, so an uncapped
// timeout on `while(true){}` would freeze the single-threaded process for that entire duration.
const HardMaxTimeoutMs = 10000;

// A hard ceiling on captured stdout+stderr: HardMaxTimeoutMs bounds wall-clock only — a candidate that
// prints in a tight loop can still grow host memory unbounded within that window. node:child_process's
// spawnSync `maxBuffer` kills the process and returns (rather than buffering without limit) once this
// many bytes of combined output have been produced.
const MaxOutputBytes = 1024 * 1024; // 1 MB

// Run with an ALLOWLISTED environment: model-authored code inherits the process env otherwise, so DB
// URLs / API tokens would be readable (and exfiltratable via network). Pass through ONLY the handful of
// vars the bun runtime needs to start (PATH resolution, temp dir, Windows shell plumbing) — everything
// else, secrets included, is dropped by default instead of pattern-matched out.
const AllowedEnvVars = new Set([
  "PATH", "Path", "SystemRoot", "windir", "TEMP", "TMP", "HOME", "USERPROFILE",
  "ProgramFiles", "ProgramData", "PATHEXT", "COMSPEC",
]);

function ScrubbedEnv(): Record<string, string> {
  const Out: Record<string, string> = {};
  for (const [Name, Value] of Object.entries(process.env)) {
    if (Value !== undefined && AllowedEnvVars.has(Name)) Out[Name] = Value;
  }
  return Out;
}

export function RunCode(Code: string, TimeoutMs = 5000): ExecResult {
  const Timeout = Math.min(Math.max(1, Math.floor(TimeoutMs)), HardMaxTimeoutMs);
  const Dir = mkdtempSync(join(tmpdir(), "shahd-exec-"));
  const File = join(Dir, "Candidate.ts");
  writeFileSync(File, Code);
  const Start = Date.now();
  try {
    // node:child_process's spawnSync (not Bun.spawnSync) so a `maxBuffer` overflow terminates the
    // process and returns synchronously, capping memory, while staying fully synchronous — no signature
    // change, so every existing caller (sync `.Passed` access) keeps working unchanged.
    const Proc = spawnSync("bun", ["run", File], {
      timeout: Timeout,
      maxBuffer: MaxOutputBytes,
      env: ScrubbedEnv(),
    });
    return {
      Passed: Proc.status === 0,
      ExitCode: Proc.status,
      Stdout: Proc.stdout ? Proc.stdout.toString() : "",
      Stderr: Proc.stderr ? Proc.stderr.toString() : "",
      DurationMs: Date.now() - Start,
    };
  } finally {
    rmSync(Dir, { recursive: true, force: true });
  }
}
