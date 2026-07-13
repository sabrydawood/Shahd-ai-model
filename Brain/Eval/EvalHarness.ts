// Code-eval harness (Phase 5). A problem is a set of tests; a candidate solution is prepended and
// run. Computes correct-count and the unbiased pass@k — the go/no-go metric for Phase 4/5.

import { RunCode } from "./CodeExecutor.ts";
import { PassAtK } from "./PassAtK.ts";

export type EvalProblem = {
  Name: string;
  Tests: string; // code that references the candidate's definitions and throws on failure
};

export type ProblemEval = { Name: string; Correct: number; N: number; PassAt1: number };

/** Run every candidate against the problem's tests; count how many pass. */
export function EvaluateProblem(Problem: EvalProblem, Candidates: string[], TimeoutMs = 5000): ProblemEval {
  let Correct = 0;
  for (const Candidate of Candidates) {
    if (RunCode(`${Candidate}\n${Problem.Tests}`, TimeoutMs).Passed) Correct++;
  }
  return {
    Name: Problem.Name,
    Correct,
    N: Candidates.length,
    PassAt1: Candidates.length > 0 ? PassAtK(Candidates.length, Correct, 1) : 0,
  };
}

/** Mean pass@k across a suite of problems, each evaluated with N candidates. */
export function PassAtKSuite(Problems: EvalProblem[], CandidatesPer: string[][], K: number): number {
  if (Problems.length === 0) return 0;
  let Total = 0;
  for (let I = 0; I < Problems.length; I++) {
    const Cands = CandidatesPer[I] ?? [];
    let Correct = 0;
    for (const C of Cands) if (RunCode(`${C}\n${Problems[I].Tests}`).Passed) Correct++;
    Total += Cands.length >= K ? PassAtK(Cands.length, Correct, K) : 0;
  }
  return Total / Problems.length;
}
