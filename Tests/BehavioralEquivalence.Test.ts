// Behavioral-equivalence gate (ARCHITECTURE.md §8): a small Shahd config trained through the
// full pipeline must drive eval loss clearly DOWN and be able to memorize a repetitive corpus.
// This is behavioral, not bit-exact vs nano-gpt.ts (weight-tying / named RNG streams / scaled
// init / BPE deliberately break numerical equivalence). The numerical oracle is GradCheck.

import { test, expect } from "bun:test";
import { LoadConfig } from "../Brain/Config/LoadConfig.ts";
import { CreateRngStreams } from "../Brain/Random/SeededRng.ts";
import { CharTokenizer } from "../Brain/Tokenizer/CharTokenizer.ts";
import { TrainValSplit } from "../Brain/Data/TrainValSplit.ts";
import { InMemoryDataLoader } from "../Brain/Data/DataLoader.ts";
import { Shahd } from "../Brain/Nn/Shahd.ts";
import { CreateOptimizer, ClipGradGlobalNorm, ComputeLr } from "../Brain/Optim/OptimBarrel.ts";
import { AccumulateGradients } from "../Brain/Training/GradAccumulation.ts";
import { EvalLoss } from "../Brain/Training/EvalLoop.ts";

test("the full training pipeline drives eval loss clearly down", () => {
  const Corpus = "function f(x) { return x + 1; }\n".repeat(80);
  const Tokenizer = CharTokenizer.FromCorpus(Corpus);
  const Encoded = Tokenizer.Encode(Corpus);

  const Config = LoadConfig({
    Overrides: {
      Model: { EmbedDim: 32, NumLayers: 2, NumHeads: 2, BlockSize: 16, VocabSize: Tokenizer.VocabSize },
      Training: { BatchSize: 8, Seed: 1, EvalIterations: 10 },
      Schedule: { Kind: "Cosine", WarmupSteps: 5, MaxSteps: 60, MinLrRatio: 0.1 },
      Optimizer: { Kind: "AdamW", LearningRate: 0.005 },
    },
    UseCli: false,
    UseEnv: false,
  });

  const Rng = CreateRngStreams(Config.Training.Seed);
  const { Train, Val } = TrainValSplit(Encoded, 0.2);
  const TrainLoader = new InMemoryDataLoader(Train, Config.Model.BlockSize, Rng.DataRng);
  const ValLoader = new InMemoryDataLoader(Val, Config.Model.BlockSize, Rng.DataRng);
  const Model = new Shahd(Config, Rng.InitRng);
  const Optimizer = CreateOptimizer(Model.Parameters(), Config);

  const Before = EvalLoss(Model, ValLoader, 10).Loss;
  for (let Step = 0; Step < Config.Schedule.MaxSteps; Step++) {
    AccumulateGradients(Model, Optimizer, TrainLoader, Config.Training.BatchSize);
    ClipGradGlobalNorm(Optimizer.Params, Config.Optimizer.GradClipNorm);
    Optimizer.Step(ComputeLr(Step, Config));
  }
  const After = EvalLoss(Model, ValLoader, 10).Loss;

  expect(Before).toBeGreaterThan(1.5); // random init starts high
  expect(After).toBeLessThan(Before * 0.6); // loss dropped substantially
}, 30_000);
