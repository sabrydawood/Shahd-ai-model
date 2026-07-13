// Control-flow tools — the ones that steer the agent itself rather than compute a value:
//   user_ask  : ask the human a question (errors, never blocks, when non-interactive)
//   list_tools: introspect the live registry (self-describing model)
//   plan      : record an explicit multi-step plan into the transcript
//   compact   : shrink the running conversation (structural, deterministic)
//   finish    : Terminal — a successful call ends the agent loop with a final answer

import type { Tool } from "./ToolTypes.ts";
import { Err, RequireString, OptionalNumber } from "./ToolArgs.ts";

// Ask the human. Args: { question: string }. Non-interactive by default (no provider => error).
export const UserAskTool: Tool = {
  Name: "user_ask",
  Description: "Ask the user a clarifying question and read their reply.",
  Args: "{ question: string }",
  Execute: async (Arguments, Context) => {
    const Question = RequireString(Arguments, "question");
    if (Context?.AskUser === undefined) {
      return Err("user_ask unavailable in this context (non-interactive)");
    }
    return { question: Question, answer: await Context.AskUser(Question) };
  },
};

// Enumerate available tools. Args: none.
export const ListToolsTool: Tool = {
  Name: "list_tools",
  Description: "List the tools available to you, with descriptions and argument specs.",
  Args: "{}",
  Execute: (_Arguments, Context) => {
    if (Context?.Registry === undefined) return { tools: [] };
    return {
      tools: Context.Registry.List().map((T) => ({ name: T.Name, description: T.Description, args: T.Args ?? "{}" })),
    };
  },
};

// Record an explicit plan. Args: { steps: string[] } or { plan: string }.
export const PlanTool: Tool = {
  Name: "plan",
  Description: "Record an explicit step-by-step plan before acting.",
  Args: "{ steps: string[] } | { plan: string }",
  Execute: (Arguments) => {
    const Raw = Arguments["steps"];
    if (Array.isArray(Raw)) return { acknowledged: true, steps: Raw.map(String) };
    if (typeof Arguments["plan"] === "string") return { acknowledged: true, plan: String(Arguments["plan"]) };
    return Err("provide steps: string[] or plan: string");
  },
};

// Compact the conversation. Args: { keep?: number }. Requires a session.
export const CompactTool: Tool = {
  Name: "compact",
  Description: "Summarize and drop older turns to free context, keeping the system prompt and recent turns.",
  Args: "{ keep?: number }",
  Execute: (Arguments, Context) => {
    if (Context?.Session === undefined) return Err("compact unavailable (no session)");
    const Keep = Math.max(1, Math.trunc(OptionalNumber(Arguments, "keep", 4)));
    const Dropped = Context.Session.Compact(Keep);
    return { compacted: true, droppedTurns: Dropped, kept: Keep };
  },
};

// Finish with a final answer. Terminal: a successful call ends the loop. Args: { answer: string }.
export const FinishTool: Tool = {
  Name: "finish",
  Description: "Provide your final answer and end the turn.",
  Args: "{ answer: string }",
  Terminal: true,
  Execute: (Arguments) => {
    return { answer: RequireString(Arguments, "answer") };
  },
};
