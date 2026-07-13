// Sample from a trained checkpoint via the SAFE generation path (GuardedGenerate). Rebuilds the
// char tokenizer from the checkpoint's persisted vocab (no corpus needed).
//
//   bun run sample --Checkpoint=Checkpoints/Last.ckpt --Prompt="function "

import { LoadConfig } from "../Brain/Config/LoadConfig.ts";
import { CreateRngStreams } from "../Brain/Random/SeededRng.ts";
import { CharTokenizer } from "../Brain/Tokenizer/CharTokenizer.ts";
import { Shahd } from "../Brain/Nn/Shahd.ts";
import { CreateOptimizer } from "../Brain/Optim/OptimBarrel.ts";
import { LoadCheckpoint, ApplyCheckpoint } from "../Brain/Checkpoint/CheckpointReader.ts";
import { GuardedGenerate } from "../Brain/Safety/GuardedGenerate.ts";
import { DefaultSampling } from "../Brain/Sampling/Sampler.ts";
import type { ConfigOverride } from "../Brain/Config/ConfigTypes.ts";
import { ReadArg } from "./ScriptArgs.ts";

const CkptPath = ReadArg("--Checkpoint=", "Checkpoints/Last.ckpt");
const Prompt = ReadArg("--Prompt=", "function ");
const MaxNewTokens = Number(ReadArg("--MaxNewTokens=", "300"));
const Temperature = Number(ReadArg("--Temperature=", "0.8"));

const Ckpt = LoadCheckpoint(CkptPath);
// Rebuild the exact config from the checkpoint (UseCli off so it isn't perturbed).
const Config = LoadConfig({ Overrides: Ckpt.Config as ConfigOverride, UseCli: false, UseEnv: false });
const Rng = CreateRngStreams(Config.Training.Seed);
const Model = new Shahd(Config, Rng.InitRng);
const Optimizer = CreateOptimizer(Model.Parameters(), Config);
ApplyCheckpoint(Ckpt, Model, Optimizer, Rng);

const State = Ckpt.TokenizerState as { Kind: string; Chars: string[] } | null;
if (State === null || State.Kind !== "Char" || !Array.isArray(State.Chars)) {
  throw new Error("Sample: checkpoint has no Char tokenizer state to rebuild from");
}
const Tokenizer = new CharTokenizer(State.Chars);

const Text = GuardedGenerate(
  Model,
  Tokenizer,
  Prompt,
  MaxNewTokens,
  { ...DefaultSampling, Temperature },
  Rng.SamplingRng,
  Config,
);
console.log(Text);
