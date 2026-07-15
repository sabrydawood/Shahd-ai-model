import { test, expect } from "bun:test";
import { InMemoryCollectionStateStore, ComputeExhausted } from "../Foundry/FoundryBarrel.ts";

test("ComputeExhausted: a bounded source is 'complete' ONLY when it ran dry before the cap", () => {
  // Genuinely exhausted: bounded, 0 new, saw dups, and produced FEWER than the cap (ran out of data).
  expect(ComputeExhausted("bounded", 0, 14355, 14355, 2_000_000)).toBe(true);
  // THE REGRESSION GUARD: bounded source re-run but CAPPED (processed === cap) — more data remains, so
  // it must NOT be called complete. Without the `< cap` guard this returned true (the false "you're stuck").
  expect(ComputeExhausted("bounded", 0, 2000, 2000, 2000)).toBe(false);
  // Still collecting (new docs this run) -> not exhausted.
  expect(ComputeExhausted("bounded", 500, 100, 600, 2000)).toBe(false);
  // Streaming sources are never exhausted.
  expect(ComputeExhausted("streaming", 0, 100, 100, 2000)).toBe(false);
  // First-ever run with only new docs -> not exhausted (nothing re-checked yet).
  expect(ComputeExhausted("bounded", 100, 0, 100, 2000)).toBe(false);
});

test("collection ledger: upsert / get / all with lifetime + exhausted tracking", async () => {
  const S = new InMemoryCollectionStateStore();
  expect(await S.Get("oasst:all")).toBeNull(); // never collected

  await S.Upsert({ SourceKey: "oasst:all", Kind: "conversation", Cursor: "{}", Collected: 100, Exhausted: false, UpdatedAt: "2026-07-15T00:00:00.000Z" });
  const G = await S.Get("oasst:all");
  expect(G?.Collected).toBe(100);
  expect(G?.Exhausted).toBe(false);
  expect(G?.Kind).toBe("conversation");

  // A later run of the same bounded source produced 0 new -> marked exhausted (idempotent on SourceKey).
  await S.Upsert({ SourceKey: "oasst:all", Kind: "conversation", Cursor: "{}", Collected: 100, Exhausted: true, UpdatedAt: "2026-07-15T01:00:00.000Z" });
  expect((await S.Get("oasst:all"))?.Exhausted).toBe(true);

  await S.Upsert({ SourceKey: "wikipedia:en", Kind: "knowledge", Cursor: "{}", Collected: 20, Exhausted: false, UpdatedAt: "2026-07-15T02:00:00.000Z" });
  const All = await S.All();
  expect(All.length).toBe(2);
  expect(All[0]!.SourceKey).toBe("wikipedia:en"); // most recently updated first
});

test("collection ledger: stored state is a copy — later caller mutation cannot leak in", async () => {
  const S = new InMemoryCollectionStateStore();
  const State = { SourceKey: "github:x", Kind: "code" as const, Cursor: "{}", Collected: 5, Exhausted: false, UpdatedAt: "2026-07-15T00:00:00.000Z" };
  await S.Upsert(State);
  State.Collected = 999; // mutate after storing
  expect((await S.Get("github:x"))?.Collected).toBe(5);
});
