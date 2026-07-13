import { test, expect } from "bun:test";
import { BuildCorpus } from "../Brain/Data/CorpusBuilder.ts";
import type { SourceDocument } from "../Brain/Data/CorpusBuilder.ts";
import { FimTokens } from "../Brain/Data/FimReformat.ts";
import { SeededRng } from "../Brain/Random/SeededRng.ts";

const GoodA = "export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n";
const GoodADup = GoodA; // a vendored exact copy — the duplicate the pipeline must collapse
const GoodB = "def multiply(x, y):\n    return x * y\n\ndef divide(x, y):\n    if y == 0:\n        return None\n    return x / y\n";
const GoodC = "package math\n\nfunc Max(a, b int) int {\n\tif a > b {\n\t\treturn a\n\t}\n\treturn b\n}\n";
const Minified = "var a=1;" + "x=x+1;".repeat(90); // one ~550-char line -> quality drops it

function Doc(License: string, Path: string, Content: string): SourceDocument {
  return { Source: "test", License, Path, Content };
}

test("pipeline drops non-permissive, low-quality, and near-duplicate docs", () => {
  const Sources = [
    Doc("MIT", "a.ts", GoodA),
    Doc("MIT", "a-dup.ts", GoodADup),
    Doc("MIT", "b.py", GoodB),
    Doc("MIT", "min.js", Minified),
    Doc("GPL-3.0", "gpl.c", GoodC),
    Doc("Apache-2.0", "c.go", GoodC),
  ];
  const Built = BuildCorpus(Sources);
  expect(Built.Stats.DroppedNonPermissive).toBe(1); // GPL
  expect(Built.Stats.DroppedLowQuality).toBe(1); // minified
  expect(Built.Stats.DroppedNearDuplicate).toBe(1); // a-dup == a
  expect(Built.Stats.Kept).toBe(3); // a, b, c
  expect(Built.Manifest.Entries.length).toBe(3);
  expect(Built.Manifest.Summary().ByLicense["GPL-3.0"]).toBeUndefined();
});

test("eval decontamination removes train docs sharing a long n-gram", () => {
  const Shared = "the quick brown fox jumps over the lazy dog and then keeps running forever more";
  const Sources = [Doc("MIT", "clean.txt", GoodB), Doc("MIT", "leak.txt", Shared)];
  const Built = BuildCorpus(Sources, { EvalDocs: [Shared], DecontaminationNgram: 8 });
  expect(Built.Stats.DroppedContaminated).toBe(1);
  expect(Built.Stats.Kept).toBe(1);
});

test("FIM reformatting rewrites the kept docs and is reconstructable", () => {
  const Built = BuildCorpus([Doc("MIT", "a.ts", GoodA), Doc("MIT", "b.py", GoodB)], {
    FimFraction: 1,
    FimRng: new SeededRng(3),
  });
  expect(Built.Stats.FimRewritten).toBe(2);
  expect(Built.Text).toContain(FimTokens.Prefix);
  expect(Built.Text).toContain(FimTokens.Middle);
});

test("empty/all-dropped input yields an empty but well-formed corpus", () => {
  const Built = BuildCorpus([Doc("GPL-3.0", "x.c", GoodA)]);
  expect(Built.Stats.Kept).toBe(0);
  expect(Built.Text).toBe("");
  expect(Built.Manifest.Entries.length).toBe(0);
});
