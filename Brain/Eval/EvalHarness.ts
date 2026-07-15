// Code-eval harness (Phase 5). A problem is a set of tests; a candidate solution is prepended and
// run. Computes correct-count and the unbiased pass@k — the go/no-go metric for Phase 4/5.

import { RunCode } from "./CodeExecutor.ts";
import { PassAtK } from "./PassAtK.ts";

export type EvalProblem = {
  Name: string;
  Tests: string; // code that references the candidate's definitions and throws on failure
};

export type ProblemEval = { Name: string; Correct: number; N: number; PassAt1: number };

/** Execute ONE candidate against a problem's tests via the sandboxed runner. The single place that
 *  builds the (candidate + tests) source and reads back pass/fail — EvaluateProblem here and
 *  RejectionSampling's CollectPassing both call this instead of duplicating the template string. */
export function RunAgainstTests(Problem: EvalProblem, Candidate: string, TimeoutMs = 5000): boolean {
  return RunCode(`${Candidate}\n${Problem.Tests}`, TimeoutMs).Passed;
}

/** Run every candidate against the problem's tests; count how many pass. */
export function EvaluateProblem(Problem: EvalProblem, Candidates: string[], TimeoutMs = 5000): ProblemEval {
  let Correct = 0;
  for (const Candidate of Candidates) {
    if (RunAgainstTests(Problem, Candidate, TimeoutMs)) Correct++;
  }
  return {
    Name: Problem.Name,
    Correct,
    N: Candidates.length,
    PassAt1: Candidates.length > 0 ? PassAtK(Candidates.length, Correct, 1) : 0,
  };
}
