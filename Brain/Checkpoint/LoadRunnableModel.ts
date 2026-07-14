// Rebuild a runnable model + tokenizer from a checkpoint file in one place: load the checkpoint,
// reconstruct the exact config/model/optimizer, apply the weights, and rebuild the tokenizer from
// its persisted state. Shared by Sample (CLI) and the dashboard chat endpoint so the load path is
// not duplicated. Char tokenizer only (the only kind our trainers persist today).

import { LoadConfig } from "../Config/LoadConfig.ts";
import { CreateRngStreams } from "../Random/SeededRng.ts";
import type { RngStreams } from "../Random/SeededRng.ts";
import { CharTokenizer } from "../Tokenizer/CharTokenizer.ts";
import type { Tokenizer } from "../Tokenizer/TokenizerTypes.ts";
import { Shahd } from "../Nn/Shahd.ts";
import { CreateOptimizer } from "../Optim/OptimBarrel.ts";
import { LoadCheckpoint, ApplyCheckpoint } from "./CheckpointReader.ts";
import type { ConfigOverride, ResolvedConfig } from "../Config/ConfigTypes.ts";

export type RunnableModel = { Model: Shahd; Tokenizer: Tokenizer; Config: ResolvedConfig; Rng: RngStreams };

export function LoadRunnableModel(Path: string): RunnableModel {
  const Ckpt = LoadCheckpoint(Path);
  // Rebuild the exact config from the checkpoint (UseCli/UseEnv off so it isn't perturbed).
  const Config = LoadConfig({ Overrides: Ckpt.Config as ConfigOverride, UseCli: false, UseEnv: false });
  const Rng = CreateRngStreams(Config.Training.Seed);
  const Model = new Shahd(Config, Rng.InitRng);
  const Optimizer = CreateOptimizer(Model.Parameters(), Config);
  ApplyCheckpoint(Ckpt, Model, Optimizer, Rng);

  const State = Ckpt.TokenizerState as { Kind: string; Chars: string[] } | null;
  if (State === null || State.Kind !== "Char" || !Array.isArray(State.Chars)) {
    throw new Error("LoadRunnableModel: checkpoint has no Char tokenizer state to rebuild from");
  }
  const Tokenizer = new CharTokenizer(State.Chars);
  return { Model, Tokenizer, Config, Rng };
}
