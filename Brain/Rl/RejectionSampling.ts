// RLVR via rejection sampling / STaR (Phase 5). The most stable verifiable-reward method at small
// scale: sample many candidate solutions, KEEP the ones whose code passes the tests, and SFT on
// those. Avoids the instability of full policy-gradient RL on a tiny model while still learning
// from an EXTERNAL ground-truth reward (execution) — the discriminator CAPABILITIES.md says
// actually works at this scale.

import { RunCode } from "../Eval/CodeExecutor.ts";
import type { EvalProblem } from "../Eval/EvalHarness.ts";

/** Keep the candidates whose (candidate + tests) run passes — the SFT training set for this round. */
export function CollectPassing(Problem: EvalProblem, Candidates: string[], TimeoutMs = 5000): string[] {
  return Candidates.filter((Candidate) => RunCode(`${Candidate}\n${Problem.Tests}`, TimeoutMs).Passed);
}

export type RejectionRound = { Problem: string; Sampled: number; Kept: number; Passing: string[] };

/** Run one rejection-sampling round over a set of problems, given a sampler that returns N
 *  candidate solution strings for a prompt. Returns the passing solutions to SFT on. */
export function RejectionSampleRound(
  Problems: EvalProblem[],
  Sample: (Problem: EvalProblem) => string[],
  TimeoutMs = 5000,
): RejectionRound[] {
  const Rounds: RejectionRound[] = [];
  for (const Problem of Problems) {
    const Candidates = Sample(Problem);
    const Passing = CollectPassing(Problem, Candidates, TimeoutMs);
    Rounds.push({ Problem: Problem.Name, Sampled: Candidates.length, Kept: Passing.length, Passing });
  }
  return Rounds;
}
