import { test, expect } from "bun:test";
import { CreateWikipediaProvider } from "../Foundry/WikipediaProvider.ts";
import type { SourceInput } from "../Foundry/FoundryBarrel.ts";
import { ClassifyDocument } from "../Foundry/FoundryBarrel.ts";

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

test("curated origin makes an approved CC-BY-SA source training-eligible despite the code allowlist", () => {
  // CC-BY-SA is NOT on the permissive code allowlist, so a normal web doc would be Rejected — but a
  // curated (explicitly-approved) source is quality-gated to Filtered, with the license still recorded.
  const CleanText = "Cairo is the capital of Egypt and one of the largest cities in Africa and the Arab world.\n".repeat(4);
  expect(ClassifyDocument("CC-BY-SA-4.0", CleanText, "web-permissive").Tier).toBe("Rejected"); // normal path
  expect(ClassifyDocument("CC-BY-SA-4.0", CleanText, "curated").Tier).toBe("Filtered"); // approved source
});
