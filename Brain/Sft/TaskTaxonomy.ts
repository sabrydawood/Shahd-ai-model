// The named code-product tasks Shahd is SFT'd to do (Phase 4). REVIEW.md flagged that "instruction
// -> code" is meaningless without a concrete task checklist; this is that checklist and the home
// for each task's default instruction. SFT data is collected per task against these.

import type { ChatMessage } from "./ChatTemplate.ts";

export const CodeTasks = [
  "BugFix",
  "TestGeneration",
  "DocGeneration",
  "CodeReview",
  "Refactor",
  "Explain",
  "Translate",
  "CommitMessage",
] as const;

export type CodeTask = (typeof CodeTasks)[number];

export const TaskInstructions: Record<CodeTask, string> = {
  BugFix: "Find and fix the bug in the following code. Return the corrected code.",
  TestGeneration: "Write unit tests for the following code.",
  DocGeneration: "Write clear documentation/comments for the following code.",
  CodeReview: "Review the following code and list concrete issues and improvements.",
  Refactor: "Refactor the following code for clarity and maintainability without changing behavior.",
  Explain: "Explain what the following code does, step by step.",
  Translate: "Translate the following code to the requested target language.",
  CommitMessage: "Write a concise conventional-commit message for the following diff.",
};

const SystemPrompt = "You are Shahd, a precise coding assistant. Prefer correct, minimal, readable code.";

/** Build a chat conversation for a task. Include Response to make it an SFT training example. */
export function BuildTaskMessages(Task: CodeTask, Input: string, Response?: string): ChatMessage[] {
  const Messages: ChatMessage[] = [
    { Role: "System", Content: SystemPrompt },
    { Role: "User", Content: `${TaskInstructions[Task]}\n\n${Input}` },
  ];
  if (Response !== undefined) Messages.push({ Role: "Assistant", Content: Response });
  return Messages;
}
