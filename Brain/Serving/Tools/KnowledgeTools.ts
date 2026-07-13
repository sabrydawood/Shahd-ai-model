// Knowledge tools: web search + a session key/value memory. web_search uses an injected provider
// when present and otherwise returns a CLEARLY-LABELED offline stub (never a silent fake and never
// a hard network dependency — the brain stays owned/self-contained). Memory tools require an
// injected store and error without one, so they can't accidentally read a global.

import type { Tool } from "./ToolTypes.ts";
import { Err, RequireString } from "./ToolArgs.ts";

// Search the web. Args: { query: string }. Offline stub unless Context.WebSearch is wired.
export const WebSearchTool: Tool = {
  Name: "web_search",
  Description: "Search the web for a query (offline stub unless a provider is configured).",
  Args: "{ query: string }",
  Execute: async (Arguments, Context) => {
    const Query = RequireString(Arguments, "query");
    if (Context?.WebSearch !== undefined) return Context.WebSearch(Query);
    return { stub: true, note: "web_search is an offline stub (no network provider configured)", query: Query, results: [] };
  },
};

// Store a fact. Args: { key: string, value: string }.
export const MemoryStoreTool: Tool = {
  Name: "memory_store",
  Description: "Persist a key/value fact for the rest of the session.",
  Args: "{ key: string, value: string }",
  Execute: (Arguments, Context) => {
    if (Context?.Memory === undefined) return Err("memory unavailable (no store configured)");
    const Key = RequireString(Arguments, "key");
    Context.Memory.Set(Key, RequireString(Arguments, "value"));
    return { stored: true, key: Key };
  },
};

// Recall a fact or list keys. Args: { key?: string }.
export const MemoryRecallTool: Tool = {
  Name: "memory_recall",
  Description: "Recall a stored value by key, or list all keys when no key is given.",
  Args: "{ key?: string }",
  Execute: (Arguments, Context) => {
    if (Context?.Memory === undefined) return Err("memory unavailable (no store configured)");
    const Key = Arguments["key"];
    if (typeof Key !== "string" || Key === "") return { keys: Context.Memory.Keys() };
    const Value = Context.Memory.Get(Key);
    return Value === undefined ? Err(`no memory for key: ${Key}`) : { key: Key, value: Value };
  },
};
