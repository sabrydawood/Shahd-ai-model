// Offline BPE merge training (kept out of the training loop, per the spec's train/serve split).
// Reads a corpus file, learns N merges, and writes them as JSON for BytePairEncoder to load.
//
//   bun run train:bpe --Corpus=Corpus/Code.txt --Out=Corpus/Merges.json --Merges=4000

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TrainBpe } from "../Brain/Tokenizer/BpeMergeTrainer.ts";
import { ReadArg } from "./ScriptArgs.ts";

const CorpusPath = ReadArg("--Corpus=", "");
const OutPath = ReadArg("--Out=", "Corpus/Merges.json");
const NumMerges = Number(ReadArg("--Merges=", "1000"));

if (CorpusPath === "" || !existsSync(CorpusPath)) {
  console.error("TrainBpeMerges: provide --Corpus=<path to a UTF-8 text file>");
  process.exit(1);
}

const Model = TrainBpe(readFileSync(CorpusPath, "utf8"), NumMerges);
const Dir = dirname(OutPath);
if (Dir !== "" && !existsSync(Dir)) mkdirSync(Dir, { recursive: true });
writeFileSync(OutPath, JSON.stringify(Model));
console.log(
  `TrainBpeMerges: wrote ${Model.Merges.length} merges to ${OutPath} (vocab ${256 + Model.Merges.length}).`,
);
