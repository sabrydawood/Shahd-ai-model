// Sample from a trained checkpoint via the SAFE generation path (GuardedGenerate). Rebuilds the
// char tokenizer from the checkpoint's persisted vocab (no corpus needed).
//
//   bun run sample --Checkpoint=Checkpoints/Last.ckpt --Prompt="function "

import { LoadRunnableModel } from "../Brain/Checkpoint/LoadRunnableModel.ts";
import { GuardedGenerate } from "../Brain/Safety/GuardedGenerate.ts";
import { DefaultSampling } from "../Brain/Sampling/Sampler.ts";
import { ReadArg } from "./ScriptArgs.ts";

const CkptPath = ReadArg("--Checkpoint=", "Checkpoints/Last.ckpt");
const Prompt = ReadArg("--Prompt=", "function ");
const MaxNewTokens = Number(ReadArg("--MaxNewTokens=", "300"));
const Temperature = Number(ReadArg("--Temperature=", "0.8"));

const { Model, Tokenizer, Config, Rng } = LoadRunnableModel(CkptPath);

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
