// Sequence-level training parallelism: the batch's sequences fan out across a PERSISTENT pool of
// JS worker threads, each running the UNMODIFIED ForwardBackward on its own model instance. This
// is the lever the kernel work could never reach — it parallelizes the serial TS share of the step
// (autograd bookkeeping, elementwise ops, embedding scatter) together with the matmuls, instead of
// only fanning out inside each tiny kernel call (measured: whole-step core use was 1.71 of 28).
//
// Sharing model (all zero-copy via SharedArrayBuffer):
//   - WEIGHTS: one shared flat buffer; the MAIN model's param Data arrays are re-pointed into it
//     (values copied once at pool creation), and every worker aliases the same memory. The main
//     thread's optimizer updates weights in place -> workers see them on the next step. Writes are
//     fenced by the step barrier (workers idle while the optimizer runs), so there are no races.
//   - GRADS: one PRIVATE flat buffer per worker (its model's Grad arrays alias it). No atomics on
//     f64 exist, so workers never share grad memory; the main thread reduces the buffers in FIXED
//     worker order after the barrier — deterministic run-to-run, and the only numeric difference
//     vs the sequential path is float addition ORDER (accepted ULP-level drift, plan §5).
//   - TASKS: per-worker Int32 id/target slabs + one Int32 control word pair, synchronized with
//     Atomics.wait/notify (measured ~4µs round-trip) — no per-step postMessage, no event loop, so
//     Accumulate stays SYNCHRONOUS and TrainLoop keeps its exact sequential structure.
//
// Data order: the main thread alone pulls from the DataLoader (in batch order), so the RNG stream
// consumed is IDENTICAL to the sequential path — resume/reproducibility semantics are unchanged.
//
// Kernel-thread interplay: while workers run, per-call goroutine fan-out inside the Go kernel is
// capped to 1 (SetKernelThreads — process-global, one Go runtime serves all JS threads): the pool
// IS the parallelism, and 16 concurrent calls each spawning 28 goroutines would only thrash. The
// cap is restored after the barrier so main-thread work (eval) keeps the all-cores kernel.

import type { ResolvedConfig } from "../Config/ConfigTypes.ts";
import type { DataLoader } from "../Data/DataLoader.ts";
import type { Shahd } from "../Nn/Shahd.ts";
import type { Tensor } from "../Tensor/Tensor.ts";
import { GetActiveBackend } from "../ComputeBackend/BackendSelector.ts";
import { GoFfiBackend } from "../ComputeBackend/GoFfiBackend.ts";

// Control-word layout (Int32Array): the worker sleeps on CmdSlot, the main thread on StatusSlot.
export const CmdSlot = 0;
export const StatusSlot = 1;
export const SeqCountSlot = 2;
export const CmdGo = 1;
export const CmdShutdown = 2;
export const StatusDone = 1;
export const StatusError = 2;

// Backstop so a dead worker thread cannot hang training forever (a healthy sequence takes well
// under a minute even on Micro shapes). Timing out is FATAL — the pool's state is unknown.
const StepWaitMs = 600_000;

/** The one message a worker ever receives: everything it needs, sent once at spawn. */
export type WorkerInit = {
  Config: ResolvedConfig;
  Weights: SharedArrayBuffer; // all params, flat, Parameters() order — aliased by every thread
  Grads: SharedArrayBuffer; // this worker's private grad accumulator, same layout
  Ctl: SharedArrayBuffer; // Int32 control words (slots above)
  Ids: SharedArrayBuffer; // Int32 [MaxSeqs * SeqLen] token ids
  Targets: SharedArrayBuffer; // Int32 [MaxSeqs * SeqLen] shifted targets
  Loss: SharedArrayBuffer; // Float64 [1] — sum of this worker's per-sequence losses
  MaxSeqs: number;
  SeqLen: number;
};

/** Re-point a model's parameter Data (and optionally Grad) into flat shared memory, preserving
 *  values when asked. Layout = Parameters() order, which both sides build from the same Config. */
export function AliasParams(Params: Tensor[], Weights: SharedArrayBuffer, Grads: SharedArrayBuffer | null, CopyValues: boolean): void {
  let Offset = 0;
  for (const P of Params) {
    const View = new Float64Array(Weights, Offset * 8, P.Size);
    if (CopyValues) View.set(P.Data);
    P.Data = View;
    if (Grads !== null) P.Grad = new Float64Array(Grads, Offset * 8, P.Size);
    Offset += P.Size;
  }
  if (Offset * 8 !== Weights.byteLength) {
    throw new Error(`WorkerPool: param layout mismatch — ${Offset * 8} bytes of params vs ${Weights.byteLength} shared`);
  }
}

export class TrainWorkerPool {
  private Workers: Worker[] = [];
  private Params: Tensor[];
  private Ctls: Int32Array[] = [];
  private GradViews: Float64Array[] = [];
  private IdsViews: Int32Array[] = [];
  private TargetsViews: Int32Array[] = [];
  private LossViews: Float64Array[] = [];
  private MaxSeqs: number;
  private SeqLen: number;

  /** Use CreateTrainWorkerPool — the constructor only wires already-initialized pieces. */
  constructor(Params: Tensor[], MaxSeqs: number, SeqLen: number) {
    this.Params = Params;
    this.MaxSeqs = MaxSeqs;
    this.SeqLen = SeqLen;
  }

  /** @internal registration used by CreateTrainWorkerPool for each spawned worker. */
  AddWorker(W: Worker, Ctl: Int32Array, Grads: Float64Array, Ids: Int32Array, Targets: Int32Array, Loss: Float64Array): void {
    this.Workers.push(W);
    this.Ctls.push(Ctl);
    this.GradViews.push(Grads);
    this.IdsViews.push(Ids);
    this.TargetsViews.push(Targets);
    this.LossViews.push(Loss);
  }

  get WorkerCount(): number {
    return this.Workers.length;
  }

  /** Drop-in parallel AccumulateGradients: BatchSize sequences fanned across the pool, gradients
   *  reduced into the main model's Grad buffers and scaled by 1/BatchSize, mean loss returned.
   *  Fully synchronous — the calling thread blocks on the step barrier (Atomics.wait). */
  Accumulate(Loader: DataLoader, BatchSize: number): number {
    const W = this.WorkerCount;
    const Needed = Math.ceil(BatchSize / W);
    if (Needed > this.MaxSeqs) {
      throw new Error(`WorkerPool: BatchSize ${BatchSize} needs ${Needed} seqs/worker but the pool was sized for ${this.MaxSeqs}`);
    }

    // The main thread ALONE consumes the loader (identical RNG stream to the sequential path),
    // round-robin so worker loads differ by at most one sequence.
    const Counts = new Array<number>(W).fill(0);
    for (let B = 0; B < BatchSize; B++) {
      const { Ids, Targets } = Loader.GetSequence();
      if (Ids.length !== this.SeqLen || Targets.length !== this.SeqLen) {
        throw new Error(`WorkerPool: sequence length ${Ids.length} != pool SeqLen ${this.SeqLen} (variable-length batches are not pooled)`);
      }
      const Wi = B % W;
      this.IdsViews[Wi].set(Ids, Counts[Wi] * this.SeqLen);
      this.TargetsViews[Wi].set(Targets, Counts[Wi] * this.SeqLen);
      Counts[Wi]++;
    }

    // While workers run, kernel calls must not fan out goroutines (the pool is the parallelism).
    const Backend = GetActiveBackend();
    const Kernel = Backend instanceof GoFfiBackend ? Backend : null;
    Kernel?.SetKernelThreads?.(1);
    try {
      for (let Wi = 0; Wi < W; Wi++) {
        const Ctl = this.Ctls[Wi];
        Atomics.store(Ctl, SeqCountSlot, Counts[Wi]);
        Atomics.store(Ctl, StatusSlot, 0);
        Atomics.store(Ctl, CmdSlot, CmdGo);
        Atomics.notify(Ctl, CmdSlot);
      }
      for (let Wi = 0; Wi < W; Wi++) {
        const Ctl = this.Ctls[Wi];
        while (Atomics.load(Ctl, StatusSlot) === 0) {
          if (Atomics.wait(Ctl, StatusSlot, 0, StepWaitMs) === "timed-out") {
            throw new Error(`WorkerPool: worker ${Wi} did not finish within ${StepWaitMs}ms — pool state unknown, aborting`);
          }
        }
        if (Atomics.load(Ctl, StatusSlot) === StatusError) {
          throw new Error(`WorkerPool: worker ${Wi} failed during ForwardBackward — see its stderr for the cause`);
        }
      }
    } finally {
      Kernel?.SetKernelThreads?.(0);
    }

    // Reduce in FIXED worker order (determinism), then apply the same 1/BatchSize scaling the
    // sequential AccumulateGradients applies to the accumulated gradient (never the LR).
    for (const P of this.Params) P.Grad.fill(0);
    for (let Wi = 0; Wi < W; Wi++) {
      const G = this.GradViews[Wi];
      let Offset = 0;
      for (const P of this.Params) {
        const Pg = P.Grad;
        for (let I = 0; I < Pg.length; I++) Pg[I] += G[Offset + I];
        Offset += Pg.length;
      }
    }
    const Inv = 1 / BatchSize;
    let TotalLoss = 0;
    for (let Wi = 0; Wi < W; Wi++) TotalLoss += this.LossViews[Wi][0];
    for (const P of this.Params) {
      const Pg = P.Grad;
      for (let I = 0; I < Pg.length; I++) Pg[I] *= Inv;
    }
    return TotalLoss * Inv;
  }

  /** Shut the workers down. The pool is unusable afterwards. */
  Dispose(): void {
    for (let Wi = 0; Wi < this.Workers.length; Wi++) {
      Atomics.store(this.Ctls[Wi], CmdSlot, CmdShutdown);
      Atomics.notify(this.Ctls[Wi], CmdSlot);
      this.Workers[Wi].terminate();
    }
    this.Workers = [];
  }
}

/** Build a pool of Config.Training.Workers threads (capped by BatchSize) around Model: swaps the
 *  model's parameters into shared memory, spawns the workers, and waits for each to alias the
 *  weights and report ready. The model trains EXACTLY as before from the caller's point of view —
 *  only where the per-sequence work physically runs changes. */
export async function CreateTrainWorkerPool(Model: Shahd, Config: ResolvedConfig): Promise<TrainWorkerPool> {
  const Requested = Config.Training.Workers;
  if (Requested < 1) throw new Error("CreateTrainWorkerPool: Config.Training.Workers must be >= 1");
  const BatchSize = Config.Training.BatchSize;
  const W = Math.min(Requested, BatchSize);

  const Params = Model.Parameters();
  let Total = 0;
  for (const P of Params) Total += P.Size;
  const Weights = new SharedArrayBuffer(Total * 8);
  AliasParams(Params, Weights, null, true); // main keeps PRIVATE Grad arrays — reduction target

  const MaxSeqs = Math.ceil(BatchSize / W);
  const SeqLen = Config.Model.BlockSize;
  const Pool = new TrainWorkerPool(Params, MaxSeqs, SeqLen);

  const Ready: Promise<void>[] = [];
  for (let Wi = 0; Wi < W; Wi++) {
    const Grads = new SharedArrayBuffer(Total * 8);
    const Ctl = new SharedArrayBuffer(4 * 4);
    const Ids = new SharedArrayBuffer(MaxSeqs * SeqLen * 4);
    const Targets = new SharedArrayBuffer(MaxSeqs * SeqLen * 4);
    const Loss = new SharedArrayBuffer(8);
    const Init: WorkerInit = { Config, Weights, Grads, Ctl, Ids, Targets, Loss, MaxSeqs, SeqLen };

    const WorkerRef = new Worker(new URL("./TrainWorker.ts", import.meta.url));
    Ready.push(
      new Promise<void>((Resolve, Reject) => {
        WorkerRef.onmessage = () => Resolve();
        WorkerRef.onerror = (Event) => Reject(new Error(`WorkerPool: worker ${Wi} failed to start: ${Event.message}`));
      }),
    );
    WorkerRef.postMessage(Init);
    Pool.AddWorker(WorkerRef, new Int32Array(Ctl), new Float64Array(Grads), new Int32Array(Ids), new Int32Array(Targets), new Float64Array(Loss));
  }
  await Promise.all(Ready);
  return Pool;
}
