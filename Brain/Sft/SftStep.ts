// One SFT forward+backward over a rendered training sequence. Uses masked cross-entropy so only
// the assistant's response tokens contribute to the loss (Phase 4). Inputs predict the next token;
// the target mask is the per-token loss mask shifted by one.

import type { Shahd } from "../Nn/Shahd.ts";
import type { TrainingSequence } from "./ChatTemplate.ts";
import { MaskedCrossEntropy } from "../Ops/OpsBarrel.ts";
import { Backward } from "../Autograd/Backward.ts";

/** Returns the (masked) loss value, or 0 if the sequence has no trainable target tokens. */
export function SftForwardBackward(Model: Shahd, Sequence: TrainingSequence): number {
  const Ids = Sequence.Ids;
  if (Ids.length < 2) return 0;
  const Inputs = Ids.slice(0, -1);
  const Targets = Ids.slice(1);
  const TargetMask = Sequence.LossMask.slice(1); // loss at position i predicts token i+1
  if (!TargetMask.includes(true)) return 0;

  const Logits = Model.Forward(Inputs);
  const Loss = MaskedCrossEntropy(Logits, Targets, TargetMask);
  Backward(Loss);
  return Loss.Data[0];
}
