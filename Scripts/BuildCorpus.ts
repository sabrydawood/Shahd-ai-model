// Build a training-ready corpus from a manifest of permissively-licensed source files, running the
// full Phase-3 pipeline (license -> quality -> dedup -> decontam -> FIM) and writing the result +
// a provenance manifest. Reads the seed corpus by default.
//
//   bun run Scripts/BuildCorpus.ts
//   bun run Scripts/BuildCorpus.ts --Manifest=Corpus/Manifest.json --Out=Corpus/Built.txt --Fim=0.3

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { BuildCorpus } from "../Brain/Data/CorpusBuilder.ts";
import type { SourceDocument } from "../Brain/Data/CorpusBuilder.ts";
import { SeededRng } from "../Brain/Random/SeededRng.ts";
import { ReadArg } from "./ScriptArgs.ts";

type ManifestEntry = { Source: string; License: string; Path: string; Lang?: string };
type ManifestFile = { Documents: ManifestEntry[] };

const ManifestPath = ReadArg("--Manifest=", "Corpus/Manifest.json");
const OutPath = ReadArg("--Out=", "Corpus/Built.txt");
const FimFraction = Number(ReadArg("--Fim=", "0"));

const Manifest = JSON.parse(readFileSync(ManifestPath, "utf8")) as ManifestFile;
const Sources: SourceDocument[] = Manifest.Documents
  .filter((E) => existsSync(E.Path))
  .map((E) => ({ Source: E.Source, License: E.License, Path: E.Path, Content: readFileSync(E.Path, "utf8"), IngestedAt: "2026-07-13T00:00:00.000Z" }));

const Built = BuildCorpus(Sources, {
  FimFraction: Number.isFinite(FimFraction) ? FimFraction : 0,
  FimRng: new SeededRng(1),
});

if (!existsSync(dirname(OutPath))) mkdirSync(dirname(OutPath), { recursive: true });
writeFileSync(OutPath, Built.Text);
writeFileSync(OutPath.replace(/\.txt$/, "") + ".Manifest.json", Built.Manifest.ToJson());

console.log("BuildCorpus:");
console.log(`  manifest        = ${ManifestPath} (${Manifest.Documents.length} documents)`);
console.log(`  dropped         = non-permissive ${Built.Stats.DroppedNonPermissive}, low-quality ${Built.Stats.DroppedLowQuality}, near-dup ${Built.Stats.DroppedNearDuplicate}, contaminated ${Built.Stats.DroppedContaminated}`);
console.log(`  FIM-rewritten   = ${Built.Stats.FimRewritten}`);
console.log(`  kept            = ${Built.Stats.Kept} documents, ${Built.Stats.TotalBytes} bytes`);
console.log(`  license summary = ${JSON.stringify(Built.Manifest.Summary().ByLicense)}`);
console.log(`  wrote           = ${OutPath}`);
