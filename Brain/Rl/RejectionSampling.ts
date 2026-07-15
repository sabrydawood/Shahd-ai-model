// RLVR via rejection sampling / STaR (Phase 5). The most stable verifiable-reward method at small
// scale: sample many candidate solutions, KEEP the ones whose code passes the tests, and SFT on
// those. Avoids the instability of full policy-gradient RL on a tiny model while still learning
// from an EXTERNAL ground-truth reward (execution) — the discriminator CAPABILITIES.md says
// actually works at this scale.

import { RunAgainstTests } from "../Eval/EvalHarness.ts";
import type { EvalProblem } from "../Eval/EvalHarness.ts";

/** Keep the DISTINCT candidates whose (candidate + tests) run passes — the SFT training set for this
 *  round. Deduping matters: without it, a sampler that emits the same passing string many times would
 *  over-weight that one solution in the next SFT round (and, across STaR rounds, collapse diversity).
 *  A candidate is marked seen BEFORE execution (not only on pass): a repeated FAILING candidate is
 *  skipped on its second occurrence instead of being re-run through the sandboxed executor for nothing. */
export function CollectPassing(Problem: EvalProblem, Candidates: string[], TimeoutMs = 5000): string[] {
  const Seen = new Set<string>();
  const Passing: string[] = [];
  for (const Candidate of Candidates) {
    const Key = Candidate.trim();
    if (Seen.has(Key)) continue;
    Seen.add(Key);
    if (RunAgainstTests(Problem, Candidate, TimeoutMs)) Passing.push(Candidate);
  }
  return Passing;
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
