// Standing CI gate (REVIEW.md L5): numerically verify the full model's backward pass with a
// finite-difference gradient check. Runs on a tiny config so it is fast. Exits non-zero on
// failure so it breaks the build. Part of `bun run ci`.

import { LoadConfig } from "../Brain/Config/LoadConfig.ts";
import { CreateRngStreams } from "../Brain/Random/SeededRng.ts";
import { Shahd } from "../Brain/Nn/Shahd.ts";
import { CrossEntropy } from "../Brain/Ops/OpsBarrel.ts";
import { GradCheck } from "../Brain/Autograd/GradCheck.ts";

function CheckModel(Label: string, Overrides: Parameters<typeof LoadConfig>[0]): boolean {
  const Config = LoadConfig(Overrides);
  const Rng = CreateRngStreams(Config.Training.Seed);
  const Model = new Shahd(Config, Rng.InitRng);
  const Ids = [1, 4, 2, 5, 3];
  const Targets = [4, 2, 5, 3, 6];
  const Result = GradCheck(Model.Parameters(), () => CrossEntropy(Model.Forward(Ids), Targets), {
    Tolerance: 1e-3,
  });
  console.log(
    `GradCheck[${Label}]: maxAbsErr=${Result.MaxAbsError.toExponential(3)} ` +
      `maxRelErr=${Result.MaxRelError.toExponential(3)} passed=${Result.Passed}`,
  );
  return Result.Passed;
}

const Tied = CheckModel("tied+multihead", {
  Overrides: { Model: { EmbedDim: 8, NumLayers: 2, NumHeads: 2, BlockSize: 8, VocabSize: 7, MlpRatio: 2, WeightTying: true } },
  UseCli: false,
  UseEnv: false,
});

const Untied = CheckModel("untied+singlehead", {
  Overrides: { Model: { EmbedDim: 6, NumLayers: 1, NumHeads: 1, BlockSize: 8, VocabSize: 7, MlpRatio: 2, WeightTying: false } },
  UseCli: false,
  UseEnv: false,
});

if (!Tied || !Untied) {
  console.error("GradCheck FAILED — a backward pass is numerically wrong.");
  process.exit(1);
}
console.log("GradCheck: OK");
