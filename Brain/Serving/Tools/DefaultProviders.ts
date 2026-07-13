// Safe default context providers. Note the deliberate omissions: DefaultToolContext supplies NO
// AskUser and NO WebSearch, so user_ask errors (never blocks a headless server) and web_search
// falls back to its labeled offline stub. It DOES supply an in-memory Memory, a deterministic Clock
// (fixed epoch), and a seeded Rng, so tool runs are reproducible.

import { SeededRng } from "../../Random/SeededRng.ts";
import type { MemoryStore, ToolContext, ToolRegistryView } from "./ToolTypes.ts";
import type { Workspace } from "./Workspace.ts";
import type { ChatSession } from "../ChatSession.ts";

export class InMemoryMemoryStore implements MemoryStore {
  private Map = new Map<string, string>();
  Set(Key: string, Value: string): void {
    this.Map.set(Key, Value);
  }
  Get(Key: string): string | undefined {
    return this.Map.get(Key);
  }
  Keys(): string[] {
    return [...this.Map.keys()];
  }
}

export type ContextParts = {
  Session?: ChatSession;
  Registry?: ToolRegistryView;
  Workspace?: Workspace;
  MaxFileBytes?: number;
  Seed?: number;
};

const FixedEpochMs = 1_700_000_000_000; // deterministic clock default (2023-11-14T22:13:20Z)

/** Build a context with safe, deterministic defaults; pass the session/registry/workspace to wire. */
export function DefaultToolContext(Parts: ContextParts = {}): ToolContext {
  const Rng = new SeededRng(Parts.Seed ?? 1);
  return {
    Session: Parts.Session,
    Registry: Parts.Registry,
    Workspace: Parts.Workspace,
    MaxFileBytes: Parts.MaxFileBytes ?? 262144,
    Memory: new InMemoryMemoryStore(),
    Clock: () => FixedEpochMs,
    Rng: { NextU32: () => Rng.NextUint32() },
  };
}
