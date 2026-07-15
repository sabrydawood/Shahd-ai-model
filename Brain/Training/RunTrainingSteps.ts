// Bare training-step loop (no eval, no checkpointing, no logging) — the minimal loop shared by the
// demo scripts. For a full run with eval + structured logging, use TrainLoop instead.

import type { Shahd } from "../Nn/Shahd.ts";
import type { Optimizer } from "../Optim/OptimBarrel.ts";
import type { DataLoader } from "../Data/DataLoader.ts";
import type { ResolvedConfig } from "../Config/ConfigTypes.ts";
import { AccumulateGradients } from "./GradAccumulation.ts";
import { ClipGradGlobalNorm, ComputeLr } from "../Optim/OptimBarrel.ts";

export function RunTrainingSteps(Model: Shahd, Optimizer: Optimizer, Loader: DataLoader, Config: ResolvedConfig): void {
  for (let Step = 0; Step < Config.Schedule.MaxSteps; Step++) {
    AccumulateGradients(Model, Optimizer, Loader, Config.Training.BatchSize);
    ClipGradGlobalNorm(Optimizer.Params, Config.Optimizer.GradClipNorm);
    Optimizer.Step(ComputeLr(Step, Config));
  }
}
