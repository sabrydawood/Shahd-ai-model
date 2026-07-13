// Sandboxed code execution for eval + RL verifiable reward (Phase 5). Runs candidate code in a
// FRESH subprocess in a throwaway temp dir with a hard timeout, so model output can be checked
// against tests (pass/fail) without hanging the host on infinite loops.
//
// ⚠️ SECURITY (Sabry's absolute priority, dedicated place): this provides PROCESS ISOLATION +
// TIMEOUT only. It does NOT restrict filesystem or network access. Executing untrusted model
// output at scale (real RL) MUST run inside a container/VM/gVisor sandbox with no network and a
// read-only fs. Treat this as the controllable seam where that stronger isolation is plugged in.

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

export function RunCode(Code: string, TimeoutMs = 5000): ExecResult {
  const Dir = mkdtempSync(join(tmpdir(), "shahd-exec-"));
  const File = join(Dir, "Candidate.ts");
  writeFileSync(File, Code);
  const Start = Date.now();
  try {
    const Proc = Bun.spawnSync(["bun", "run", File], {
      timeout: TimeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      Passed: Proc.exitCode === 0,
      ExitCode: Proc.exitCode,
      Stdout: Proc.stdout.toString(),
      Stderr: Proc.stderr.toString(),
      DurationMs: Date.now() - Start,
    };
  } finally {
    rmSync(Dir, { recursive: true, force: true });
  }
}
