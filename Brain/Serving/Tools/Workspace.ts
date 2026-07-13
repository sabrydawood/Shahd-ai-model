// The dedicated, controllable safety boundary for every filesystem tool (mirrors GuardedGenerate's
// role for generation). A Workspace pins a Root directory and refuses any path that escapes it:
// user-supplied paths are resolved against Root and rejected if the relative result climbs out
// (starts with "..") or is absolute. This is the ONE place path-traversal is stopped, so file tools
// can never touch bytes outside the sanctioned root no matter what the model emits.

import { resolve, relative, isAbsolute, sep } from "node:path";

export class Workspace {
  readonly Root: string;

  constructor(Root: string) {
    this.Root = resolve(Root);
  }

  /** Resolve a workspace-relative path to an absolute one, or throw if it escapes Root. */
  Resolve(RelPath: string): string {
    const Absolute = resolve(this.Root, RelPath);
    const Rel = relative(this.Root, Absolute);
    if (Rel === "") return Absolute; // the root itself
    if (Rel === ".." || Rel.startsWith(".." + sep) || isAbsolute(Rel)) {
      throw new Error(`path escapes workspace root: ${RelPath}`);
    }
    return Absolute;
  }

  /** The path shown back to the model — always relative to Root, never leaking the absolute prefix. */
  Display(Absolute: string): string {
    const Rel = relative(this.Root, Absolute);
    return Rel === "" ? "." : Rel;
  }
}
