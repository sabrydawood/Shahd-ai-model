import { test, expect } from "bun:test";
import { LoadConfig } from "../Brain/Config/LoadConfig.ts";
import { CreateRngStreams } from "../Brain/Random/SeededRng.ts";
import { Shahd } from "../Brain/Nn/Shahd.ts";
import { SpeculativeSample } from "../Brain/Reasoning/ReasoningBarrel.ts";
import { ProbsFromLogits, SampleFromDistribution } from "../Brain/Sampling/Distribution.ts";
import { SampleFromLogits } from "../Brain/Sampling/Sampler.ts";
import { SeededRng } from "../Brain/Random/SeededRng.ts";

function TinyModel(NumLayers: number, Seed: number, BlockSize = 32): Shahd {
  const Config = LoadConfig({
    Overrides: { Model: { VocabSize: 20, EmbedDim: 16, NumLayers, NumHeads: 2, BlockSize } },
    UseCli: false,
    UseEnv: false,
  });
  return new Shahd(Config, CreateRngStreams(Seed).InitRng);
}

test("ProbsFromLogits returns a one-hot argmax when Temperature<=0 (greedy contract honored)", () => {
  const Logits = new Float64Array([0.1, 5.0, 0.2, -1, 3.0]);
  const Probs = ProbsFromLogits(Logits, 0, 5, { Temperature: 0, TopK: 0, TopP: 1 });
  expect(Probs[1]).toBe(1); // the argmax
  expect(Probs[0]).toBe(0);
  expect(Probs[4]).toBe(0);
});

test("speculative sampling works when the draft has a smaller BlockSize than the target", () => {
  const Target = TinyModel(2, 7, 32);
  const Draft = TinyModel(1, 11, 8); // smaller context than the target
  const Prompt = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // longer than the draft's BlockSize
  const Result = SpeculativeSample(Target, Draft, Prompt, 5, { Temperature: 1, TopK: 0, TopP: 1 }, new SeededRng(1), 4);
  expect(Result.Ids.length).toBe(Prompt.length + 5); // no crash; full sequence produced
});

test("refactored sampler still matches a direct distribution sample (behavior preserved)", () => {
  const Rng1 = new SeededRng(5);
  const Rng2 = new SeededRng(5);
  const Logits = new Float64Array(20);
  for (let I = 0; I < 20; I++) Logits[I] = new SeededRng(I + 1).NextGaussian();
  const Options = { Temperature: 0.8, TopK: 5, TopP: 0.9 };
  const ViaSampler = SampleFromLogits(Logits, 0, 20, Options, Rng1);
  const ViaDistribution = SampleFromDistribution(ProbsFromLogits(Logits, 0, 20, Options), Rng2);
  expect(ViaSampler).toBe(ViaDistribution); // same single RNG draw, same selection
});

test("speculative sampling with the target as its own draft accepts every proposal", () => {
  const Model = TinyModel(2, 7);
  const Options = { Temperature: 0.9, TopK: 0, TopP: 1 };
  const Result = SpeculativeSample(Model, Model, [1, 2, 3], 12, Options, new SeededRng(3), 4);
  expect(Result.Ids.length).toBe(3 + 12);
  expect(Result.AcceptedTokens).toBe(Result.DraftTokens); // q == p => accept probability 1
  expect(Result.TargetCalls).toBeLessThan(12); // fewer target passes than tokens produced
});

test("speculative sampling with a weaker draft still produces a full, valid sequence", () => {
  const Target = TinyModel(2, 7);
  const Draft = TinyModel(1, 11);
  const Options = { Temperature: 1, TopK: 10, TopP: 0.95 };
  const Result = SpeculativeSample(Target, Draft, [4, 5, 6], 10, Options, new SeededRng(2), 4);
  expect(Result.Ids.length).toBe(3 + 10);
  expect(Result.AcceptedTokens).toBeLessThanOrEqual(Result.DraftTokens);
  for (const Id of Result.Ids) expect(Id).toBeGreaterThanOrEqual(0);
});
