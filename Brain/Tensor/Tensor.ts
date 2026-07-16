// The 2D tensor + autograd node. Every op produces a Tensor that remembers its parents (Prev)
// and how to push gradient to them (BackwardFn); Backward() walks that graph in reverse.
// Data/Grad are flat Float64Array (row-major, index = Row*Cols + Col). Shape is kept
// rank-general (number[]) for the future ComputeBackend seam, but Phase-1 ops treat it as 2D
// via the Rows/Cols fields.
//
// GRAD IS LAZY: the buffer only materializes on first access (reads of an untouched grad are
// semantically zero either way, so behavior is identical). Eager allocation doubled the memory
// of every forward — including eval/sampling forwards whose grads are NEVER touched — and that
// 2x tape was precisely what capped the training worker pool's width on this machine (16
// concurrent tapes OOM'd). Backward() completes the other half: it releases each interior
// node's buffers as soon as they have been consumed (see ReleaseBuffers).

import { Tape } from "./Tape.ts";

function NoBackward(): void {}

const EmptyBuffer = new Float64Array(0);

export class Tensor {
  Data: Float64Array;
  Rows: number;
  Cols: number;
  readonly Shape: readonly number[];
  Prev: Tensor[];
  BackwardFn: () => void;
  private GradStore: Float64Array | null = null;

  constructor(Rows: number, Cols: number, Data?: Float64Array, Prev: Tensor[] = []) {
    this.Rows = Rows;
    this.Cols = Cols;
    this.Shape = [Rows, Cols];
    this.Data = Data ?? new Float64Array(Rows * Cols);
    // Only retain the graph when the tape is on (skipped during sampling/eval).
    this.Prev = Tape.On ? Prev : [];
    this.BackwardFn = NoBackward;
  }

  /** Gradient buffer, materialized on first touch (an untouched grad IS zero, so allocating it
   *  eagerly bought nothing and cost a full extra tape of memory). */
  get Grad(): Float64Array {
    if (this.GradStore === null) this.GradStore = new Float64Array(this.Rows * this.Cols);
    return this.GradStore;
  }

  /** Replace the grad backing store (the training worker pool points params at shared memory). */
  set Grad(Buffer: Float64Array) {
    this.GradStore = Buffer;
  }

  /** Number of elements (Rows * Cols) — NOT Data.length, which is 0 after ReleaseBuffers. */
  get Size(): number {
    return this.Rows * this.Cols;
  }

  /** Reset this node's gradient to zero. A never-touched grad is already zero — stays lazy. */
  ZeroGrad(): void {
    this.GradStore?.fill(0);
  }

  /** Drop this node's buffers. Backward() calls it on every INTERIOR node right after its
   *  BackwardFn has fired: reverse-topological order guarantees every consumer of this node ran
   *  earlier, so nothing can read the memory again — holding a full step's tape (Data + Grad for
   *  every activation) until GC noticed it was garbage is what made concurrent training workers
   *  memory-bound. Never called on leaves (params — the optimizer still needs them) or the root
   *  (the caller reads the loss value). A post-release Grad read would silently re-materialize
   *  zeros — acceptable for a consumed interior node, meaningless for a live one, hence the
   *  strict interior-only rule. */
  ReleaseBuffers(): void {
    this.Data = EmptyBuffer;
    this.GradStore = null;
  }
}
