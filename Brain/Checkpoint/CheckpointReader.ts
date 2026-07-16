// Load a checkpoint and apply it into a model/optimizer/RNG. Hard-fails with a field-level diff
// on any shape-relevant config mismatch (never silently reshapes) — the config embedded in the
// checkpoint is authoritative about the architecture the weights belong to.

import { readFileSync } from "node:fs";
import type { Shahd } from "../Nn/Shahd.ts";
import type { Optimizer } from "../Optim/OptimBarrel.ts";
import type { RngStreams } from "../Random/SeededRng.ts";
import { DecodeFloat64, CheckpointFormatVersion, ChecksumPayload } from "./CheckpointFormat.ts";
import type { Checkpoint } from "./CheckpointFormat.ts";

const ShapeFields = ["EmbedDim", "NumLayers", "NumHeads", "BlockSize", "VocabSize"] as const;

/** Parse a checkpoint from its JSON text (used by both the file loader and the Postgres store). Verifies
 *  the payload checksum when present (older, pre-checksum checkpoints omit it and still load) — a
 *  mismatch means silent corruption/truncation, and failing loudly here beats loading wrong weights. */
export function ParseCheckpoint(Text: string): Checkpoint {
  const Data = JSON.parse(Text) as Checkpoint;
  if (Data.FormatVersion !== CheckpointFormatVersion) {
    throw new Error(`ParseCheckpoint: format version ${Data.FormatVersion} != ${CheckpointFormatVersion}`);
  }
  if (typeof Data.Checksum === "string") {
    const Actual = ChecksumPayload(Data.Params, Data.Optimizer, Data.Config);
    if (Actual !== Data.Checksum) {
      throw new Error(`ParseCheckpoint: checksum mismatch — checkpoint is corrupt or truncated (expected ${Data.Checksum.slice(0, 12)}…, got ${Actual.slice(0, 12)}…)`);
    }
  }
  return Data;
}

export function LoadCheckpoint(Path: string): Checkpoint {
  return ParseCheckpoint(readFileSync(Path, "utf8"));
}

// Shape checks + weight copy, shared by the full resume (ApplyCheckpoint) and the weights-only
// warm start (ApplyCheckpointWeights) so the two paths can never drift.
function ApplyParams(Ckpt: Checkpoint, Model: Shahd): void {
  const Diffs: string[] = [];
  for (const Field of ShapeFields) {
    const Want = Ckpt.Config.Model[Field];
    const Have = Model.Config.Model[Field];
    if (Want !== Have) Diffs.push(`${Field}: checkpoint=${Want} model=${Have}`);
  }
  if (Diffs.length > 0) {
    throw new Error(`ApplyCheckpoint: architecture mismatch — cannot load weights:\n  ${Diffs.join("\n  ")}`);
  }

  const Params = Model.Parameters();
  if (Params.length !== Ckpt.Params.length) {
    throw new Error(`ApplyCheckpoint: parameter count mismatch ${Params.length} vs ${Ckpt.Params.length}`);
  }
  for (let I = 0; I < Params.length; I++) {
    const P = Params[I];
    const S = Ckpt.Params[I];
    if (P.Rows !== S.Rows || P.Cols !== S.Cols) {
      throw new Error(`ApplyCheckpoint: tensor ${I} shape ${P.Rows}x${P.Cols} vs ${S.Rows}x${S.Cols}`);
    }
    const Decoded = DecodeFloat64(S.Data);
    if (Decoded.length !== P.Rows * P.Cols) {
      throw new Error(`ApplyCheckpoint: tensor ${I} payload length ${Decoded.length} != ${P.Rows * P.Cols} (truncated/corrupt checkpoint)`);
    }
    P.Data.set(Decoded);
  }
}

/** Apply ONLY the model weights from a checkpoint — the pretrain→SFT warm start: SFT continues from
 *  the base model's weights under a FRESH optimizer/schedule/RNG, so the saved AdamW moments and RNG
 *  streams (which belong to the pretraining run) are deliberately NOT restored. Same hard shape
 *  checks as ApplyCheckpoint (never silently reshapes). No config-hash warning here: the configs
 *  legitimately differ (new schedule/optimizer) and nothing stale is being reused. */
export function ApplyCheckpointWeights(Ckpt: Checkpoint, Model: Shahd): void {
  ApplyParams(Ckpt, Model);
}

export function ApplyCheckpoint(Ckpt: Checkpoint, Model: Shahd, Optimizer: Optimizer, Rng: RngStreams): void {
  // Non-shape config drift (e.g. Optimizer Beta/WeightDecay, NormKind, MlpRatio) passes the shape check
  // but silently reinterprets the saved optimizer moments / architecture under different hyperparameters.
  // We don't hard-fail (resuming with a changed MaxSteps/LR is legitimate) but we WARN loudly so a
  // genuinely-wrong resume is visible rather than silent.
  if (Ckpt.ConfigHash !== Model.Config.ConfigHash) {
    console.warn(`ApplyCheckpoint: config hash differs (checkpoint=${Ckpt.ConfigHash.slice(0, 12)}… model=${Model.Config.ConfigHash.slice(0, 12)}…) — architecture shapes match but some non-shape config (optimizer/norm/etc.) changed; the saved optimizer moments are being reused under the new config.`);
  }

  ApplyParams(Ckpt, Model);

  const MDump = Ckpt.Optimizer.M.map(DecodeFloat64);
  const VDump = Ckpt.Optimizer.V.map(DecodeFloat64);
  if (MDump.length < Optimizer.M.length || VDump.length < Optimizer.V.length) {
    throw new Error(`ApplyCheckpoint: optimizer moment count mismatch (checkpoint has ${MDump.length}/${VDump.length}, model expects ${Optimizer.M.length}/${Optimizer.V.length})`);
  }
  for (let I = 0; I < Optimizer.M.length; I++) {
    if (MDump[I].length !== Optimizer.M[I].length || VDump[I].length !== Optimizer.V[I].length) {
      throw new Error(`ApplyCheckpoint: optimizer moment ${I} length mismatch (truncated/corrupt checkpoint)`);
    }
    Optimizer.M[I].set(MDump[I]);
    Optimizer.V[I].set(VDump[I]);
  }
  Optimizer.StepCount = Ckpt.Optimizer.StepCount;

  Rng.InitRng.SetState(Ckpt.Rng.Init);
  Rng.DataRng.SetState(Ckpt.Rng.Data);
  Rng.DropoutRng.SetState(Ckpt.Rng.Dropout);
  Rng.SamplingRng.SetState(Ckpt.Rng.Sampling);
}
