// Core tool contracts. A Tool is the agent's hand: a Name, a Description, an optional Args spec
// (rendered into the manifest the model reads), and an Execute that may be sync OR async and may
// consult an injected ToolContext. Async-capable Execute lets pure tools (calculator) and
// side-effecting tools (user_ask, web_search) share one registry and one agent loop.

import type { ChatSession } from "../ChatSession.ts";
import type { Summarizer } from "../Compaction.ts";
import type { Workspace } from "./Workspace.ts";

export type ToolResult = Record<string, unknown>;

export type ToolExecute = (
  Arguments: Record<string, unknown>,
  Context?: ToolContext,
) => ToolResult | Promise<ToolResult>;

export type Tool = {
  Name: string;
  Description: string;
  Args?: string; // human/model-readable argument spec, e.g. "{ path: string }"
  Terminal?: boolean; // a successful call ends the agent loop (e.g. `finish`)
  Execute: ToolExecute;
};

export type ToolRegistryView = { List: () => Tool[] };

// A tiny key/value memory the model can persist facts into across a session.
export type MemoryStore = {
  Set: (Key: string, Value: string) => void;
  Get: (Key: string) => string | undefined;
  Keys: () => string[];
};

// Injected host capabilities. Everything the control/knowledge tools need lives here so the tools
// stay pure and testable and every dangerous surface (fs, network, human) is swappable — and, by
// default, absent (so nothing can hang or reach out unless a provider is supplied).
export type ToolContext = {
  Session?: ChatSession; // control tools (compact) read/rewrite the running conversation
  Summarize?: Summarizer; // compact uses this to summarize dropped turns (else structural elision)
  Registry?: ToolRegistryView; // list_tools introspects the live registry
  Workspace?: Workspace; // file tools resolve through this (traversal-guarded)
  MaxFileBytes?: number; // per-file byte cap for file tools
  AskUser?: (Question: string) => Promise<string>; // absent => user_ask errors (never blocks)
  WebSearch?: (Query: string) => Promise<ToolResult>; // absent => labeled offline stub
  Memory?: MemoryStore; // absent => memory tools error
  Clock?: () => number; // ms since epoch; injected for determinism
  Rng?: { NextU32: () => number }; // injected randomness for uuid/random tools
};
