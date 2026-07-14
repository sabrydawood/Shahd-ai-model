// System info for the dashboard (M11): what the runtime is, what compute the model uses, the model
// size, and the detected GPU. Honest about compute: the default backend is the CPU TypeScript path,
// and the GPU (even if present) is NOT wired into the forward path yet — so gpuUsed is false. The
// heavy bits (model param count, GPU probe, FFI probe) are computed ONCE at load and cached.

import { cpus, platform, arch, totalmem } from "node:os";
import { existsSync } from "node:fs";
import { LoadConfig } from "../Brain/Config/LoadConfig.ts";
import { CreateRngStreams } from "../Brain/Random/SeededRng.ts";
import { Shahd } from "../Brain/Nn/Shahd.ts";

export type SystemInfo = {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  memGb: number;
  runtime: string;
  computeBackend: string;
  goFfiAvailable: boolean;
  modelParams: number;
  modelConfig: string;
  gpu: string;
  gpuUsed: boolean;
};

function ModelStats(): { Params: number; Config: string } {
  const Config = LoadConfig({ UseCli: false, UseEnv: false });
  const Model = new Shahd(Config, CreateRngStreams(Config.Training.Seed).InitRng);
  const Params = Model.Parameters().reduce((Acc, P) => Acc + P.Size, 0);
  return { Params, Config: `emb=${Config.Model.EmbedDim} L=${Config.Model.NumLayers} ctx=${Config.Model.BlockSize} vocab=${Config.Model.VocabSize}` };
}

function DetectGpu(): string {
  try {
    const Result = Bun.spawnSync(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], { stdout: "pipe", stderr: "pipe" });
    const Out = Result.stdout.toString().trim();
    return Out.length > 0 ? (Out.split("\n")[0] ?? "").trim() : "none detected";
  } catch {
    return "none detected";
  }
}

// Probe by DLL presence, NOT by dlopen: actually loading the cgo lib starts the Go runtime's own
// scheduler threads, which segfault Bun when combined with the model/Postgres native work at startup.
function FfiAvailable(): boolean {
  return existsSync("GoKernels/matmul.dll");
}

const CachedModel = ModelStats();
const CachedGpu = DetectGpu();
const CachedFfi = FfiAvailable();

export function GetSystemInfo(): SystemInfo {
  const Cpu = cpus();
  const Compute = LoadConfig({ UseCli: false, UseEnv: false }).Compute;
  return {
    platform: platform(),
    arch: arch(),
    cpuModel: (Cpu[0]?.model ?? "unknown").trim(),
    cpuCount: Cpu.length,
    memGb: Math.round(totalmem() / 1e9),
    runtime: `Bun ${Bun.version}`,
    computeBackend: `${Compute.Backend}/${Compute.Precision}`,
    goFfiAvailable: CachedFfi,
    modelParams: CachedModel.Params,
    modelConfig: CachedModel.Config,
    gpu: CachedGpu,
    gpuUsed: false, // GPU is detected but not wired into the forward path yet
  };
}
