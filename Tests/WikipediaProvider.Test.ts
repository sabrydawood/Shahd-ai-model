import { test, expect } from "bun:test";
import { CreateWikipediaProvider } from "../Foundry/WikipediaProvider.ts";
import type { SourceInput } from "../Foundry/FoundryBarrel.ts";
import { ClassifyDocument, HttpError } from "../Foundry/FoundryBarrel.ts";

const MockResponse = {
  query: {
    pages: {
      "1": { pageid: 1, title: "القاهرة", extract: "القاهرة هي عاصمة جمهورية مصر العربية وأكبر مدنها وإحدى أكبر مدن أفريقيا والوطن العربي والشرق الأوسط. ".repeat(4) },
      "2": { pageid: 2, title: "Stub", extract: "short" }, // skipped: below MinChars
    },
  },
};

test("Wikipedia provider yields article extracts as curated CC-BY-SA docs and skips stubs", async () => {
  const Batches: SourceInput[] = [];
  const Provider = CreateWikipediaProvider({ FetchJson: async () => MockResponse, OnRepoReady: async (_S, Docs) => { Batches.push(...Docs); } });
  const Ret = await Provider.Fetch("ar", 1);
  expect(Ret.length).toBe(0); // streaming mode
  expect(Batches.length).toBe(1); // القاهرة kept, Stub dropped
  expect(Batches[0]!).toMatchObject({ License: "CC-BY-SA-4.0", Origin: "curated", Lang: "text-ar" });
  expect(Batches[0]!.Content).toContain("القاهرة");
});

test("Wikipedia is a streaming source: a huge Limit is capped per run (MaxPerRun), not turned into 200k requests", async () => {
  // Regression for the "hang": a 2,000,000 Limit once became ceil(2e6/10)+10 = 200,010 requests. With
  // MaxPerRun it collects a bounded chunk this run instead. Here every request returns 10 fresh docs, so
  // MaxPerRun=30 must be reached in ~3 requests — nowhere near the raw-Limit-derived ceiling.
  let Calls = 0;
  const Provider = CreateWikipediaProvider({
    MaxPerRun: 30,
    Sleep: async () => {},
    FetchJson: async () => {
      Calls++;
      const P: Record<string, { pageid: number; title: string; extract: string }> = {};
      for (let I = 0; I < 10; I++) { const Id = Calls * 100 + I; P[String(Id)] = { pageid: Id, title: "A" + Id, extract: "Long enough article body. ".repeat(20) }; }
      return { query: { pages: P } };
    },
    OnRepoReady: async () => {},
  });
  await Provider.Fetch("en", 2_000_000); // absurd Limit
  expect(Calls).toBeLessThanOrEqual(5); // ~3 requests for 30 docs — NOT thousands
});

test("Wikipedia circuit-breaks on persistent HTTP 429 instead of spinning through every request", async () => {
  // Every request 429s forever. Without a breaker this would try MaxRequests (~510 for MaxPerRun=5000)
  // requests; with it, the run stops after MaxConsecutiveFailures=3 failed requests. Each failed request
  // is retried MaxAttempts(=4) times inside FetchWithBackoff, so 3 requests * 4 attempts = 12 fetch calls.
  let Calls = 0;
  const Provider = CreateWikipediaProvider({
    MaxConsecutiveFailures: 3,
    Sleep: async () => {}, // no real backoff waiting
    FetchJson: async () => { Calls++; throw new HttpError(429, null); },
    OnRepoReady: async () => {},
  });
  const Ret = await Provider.Fetch("en", 100_000);
  expect(Ret.length).toBe(0);
  expect(Calls).toBe(12); // 3 request-failures * 4 attempts each — bounded, not 500+
});

test("curated origin makes an approved CC-BY-SA source training-eligible despite the code allowlist", () => {
  // CC-BY-SA is NOT on the permissive code allowlist, so a normal web doc would be Rejected — but a
  // curated (explicitly-approved) source is quality-gated to Filtered, with the license still recorded.
  const CleanText = "Cairo is the capital of Egypt and one of the largest cities in Africa and the Arab world.\n".repeat(4);
  expect(ClassifyDocument("CC-BY-SA-4.0", CleanText, "web-permissive").Tier).toBe("Rejected"); // normal path
  expect(ClassifyDocument("CC-BY-SA-4.0", CleanText, "curated").Tier).toBe("Filtered"); // approved source
});
