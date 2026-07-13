// Shared argument coercion + result helpers (rule #4: one home for this, no 15 subtly-different
// `String(Arguments["x"] ?? "")` copies). Every built-in tool coerces its args through these, so
// missing/bad arguments fail the same way everywhere and results share one shape.

import type { ToolResult } from "./ToolTypes.ts";

/** A recoverable tool failure. Tools return this (never throw) so the agent loop keeps going. */
export function Err(Message: string): ToolResult {
  return { error: Message };
}

/** Thrown for a missing/ill-typed required argument; the registry converts it to an Err result. */
export class ToolArgError extends Error {}

export function RequireString(Arguments: Record<string, unknown>, Key: string): string {
  const Value = Arguments[Key];
  if (typeof Value === "string") return Value;
  if (typeof Value === "number" || typeof Value === "boolean") return String(Value);
  throw new ToolArgError(`missing or non-string argument: ${Key}`);
}

export function OptionalString(Arguments: Record<string, unknown>, Key: string, Default: string): string {
  const Value = Arguments[Key];
  if (Value === undefined || Value === null) return Default;
  return String(Value);
}

export function RequireNumber(Arguments: Record<string, unknown>, Key: string): number {
  const Value = Number(Arguments[Key]);
  if (!Number.isFinite(Value)) throw new ToolArgError(`missing or non-numeric argument: ${Key}`);
  return Value;
}

export function OptionalNumber(Arguments: Record<string, unknown>, Key: string, Default: number): number {
  const Raw = Arguments[Key];
  if (Raw === undefined || Raw === null) return Default;
  const Value = Number(Raw);
  return Number.isFinite(Value) ? Value : Default;
}

export function OptionalBool(Arguments: Record<string, unknown>, Key: string, Default: boolean): boolean {
  const Value = Arguments[Key];
  if (typeof Value === "boolean") return Value;
  if (Value === "true") return true;
  if (Value === "false") return false;
  return Default;
}
