// Worker-thread entry for the training pool (see WorkerPool.ts for the full design). Receives ONE
// init message, builds its own Shahd instance from the same Config, re-points every parameter at
// the SHARED weight memory (and its private grad slab), then parks in a blocking Atomics loop:
// wake -> zero grads -> run ForwardBackward over its assigned sequences -> report -> sleep. After
// init there is no postMessage traffic at all — the barrier is pure shared-memory signaling, which
// is what lets the main thread's Accumulate stay synchronous.
//
// The model code is UNTOUCHED here on purpose (plan §5): a worker trains a full private model that
// happens to alias shared weights, so every op, the tape, and the loss behave exactly as in the
// sequential path. Only gradient REDUCTION differs, and that happens on the main thread.

import type { WorkerInit } from "./WorkerPool.ts";
import { CmdSlot, StatusSlot, SeqCountSlot, CmdGo, CmdShutdown, StatusDone, StatusError, AliasParams } from "./WorkerPool.ts";
import { CreateRngStreams } from "../Random/SeededRng.ts";
import { Shahd } from "../Nn/Shahd.ts";
import { ForwardBackward } from "./TrainingStep.ts";
import { ActivateFromConfig } from "../ComputeBackend/BackendSelector.ts";

// Worker-global surface, typed narrowly (no DOM lib in this project). The lowercase names are the
// Web Worker platform API — not ours to rename.
const WorkerScope = globalThis as unknown as {
  onmessage: ((Event: { data: WorkerInit }) => void) | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  postMessage: (Value: unknown) => void;
};

function RunLoop(Init: WorkerInit): void {
  // Same backend selection as the main thread (each JS realm has its own selector; the Go DLL
  // itself loads once per process). Init weights are immediately overwritten by the shared alias.
  ActivateFromConfig(Init.Config);
  const Model = new Shahd(Init.Config, CreateRngStreams(Init.Config.Training.Seed).InitRng);
  AliasParams(Model.Parameters(), Init.Weights, Init.Grads, false);

  const Ctl = new Int32Array(Init.Ctl);
  const Grads = new Float64Array(Init.Grads);
  const Ids = new Int32Array(Init.Ids);
  const Targets = new Int32Array(Init.Targets);
  const Loss = new Float64Array(Init.Loss);

  WorkerScope.postMessage("ready"); // delivery does not need this thread's event loop afterwards

  while (true) {
    Atomics.wait(Ctl, CmdSlot, 0);
    const Cmd = Atomics.exchange(Ctl, CmdSlot, 0);
    if (Cmd === CmdShutdown) return;
    if (Cmd !== CmdGo) continue; // spurious wake with no pending command

    try {
      Grads.fill(0); // fresh accumulation window (the model's Grad arrays alias this slab)
      const SeqCount = Atomics.load(Ctl, SeqCountSlot);
      let LossSum = 0;
      for (let S = 0; S < SeqCount; S++) {
        const IdsArr = Array.from(Ids.subarray(S * Init.SeqLen, (S + 1) * Init.SeqLen));
        const TargetsArr = Array.from(Targets.subarray(S * Init.SeqLen, (S + 1) * Init.SeqLen));
        LossSum += ForwardBackward(Model, IdsArr, TargetsArr);
      }
      Loss[0] = LossSum;
      Atomics.store(Ctl, StatusSlot, StatusDone);
    } catch (Err) {
      // The error itself cannot cross the barrier — log it here, signal the class of failure.
      console.error("TrainWorker: ForwardBackward failed:", Err);
      Atomics.store(Ctl, StatusSlot, StatusError);
    }
    Atomics.notify(Ctl, StatusSlot);
  }
}

WorkerScope.onmessage = (Event) => {
  WorkerScope.onmessage = null; // exactly one init; the loop below never yields back
  RunLoop(Event.data);
};
