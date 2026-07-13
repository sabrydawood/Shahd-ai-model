// String / JSON / regex tools. The regex tool screens for catastrophic-backtracking patterns and
// caps input length (safety: a user-supplied regex is untrusted and could otherwise ReDoS-hang the
// server) — the same intent-oriented, ReDoS-safe discipline the content filter uses.

import type { Tool } from "./ToolTypes.ts";
import { Err, RequireString, OptionalString, OptionalBool } from "./ToolArgs.ts";

const MaxRegexInput = 100_000;

// Heuristic screen for the classic ReDoS shapes (nested quantifiers, quantified alternation of
// overlapping atoms). Not exhaustive, but blocks the constructs that actually blow up.
function LooksLikeReDoS(Pattern: string): boolean {
  return /(\([^)]*[+*][^)]*\)[+*])|(\(\.\*\)[+*])|(\[[^\]]*\][+*])[+*]/.test(Pattern);
}

// Parse or stringify JSON. Args: { action: 'parse'|'stringify', input: string, pretty?: boolean }.
export const JsonTool: Tool = {
  Name: "json",
  Description: "Parse a JSON string or stringify a value.",
  Args: "{ action: 'parse'|'stringify', input: string, pretty?: boolean }",
  Execute: (Arguments) => {
    const Action = RequireString(Arguments, "action");
    if (Action === "parse") {
      try {
        return { value: JSON.parse(RequireString(Arguments, "input")) };
      } catch (Error_) {
        return Err(`invalid JSON: ${(Error_ as Error).message}`);
      }
    }
    if (Action === "stringify") {
      const Pretty = OptionalBool(Arguments, "pretty", false);
      return { text: JSON.stringify(Arguments["input"], null, Pretty ? 2 : 0) };
    }
    return Err(`unknown action: ${Action}`);
  },
};

// Match or replace with a regex. Args: { pattern, text, flags?, action?: 'match'|'replace', replacement? }.
export const RegexTool: Tool = {
  Name: "regex",
  Description: "Regex match/replace over text (ReDoS-screened, input-capped).",
  Args: "{ pattern: string, text: string, flags?: string, action?: 'match'|'replace', replacement?: string }",
  Execute: (Arguments) => {
    const Pattern = RequireString(Arguments, "pattern");
    const Text = RequireString(Arguments, "text");
    if (Text.length > MaxRegexInput) return Err(`text exceeds ${MaxRegexInput} chars`);
    if (LooksLikeReDoS(Pattern)) return Err("pattern rejected: possible catastrophic backtracking");
    const Flags = OptionalString(Arguments, "flags", "");
    let Re: RegExp;
    try {
      Re = new RegExp(Pattern, Flags);
    } catch (Error_) {
      return Err(`invalid regex: ${(Error_ as Error).message}`);
    }
    const Action = OptionalString(Arguments, "action", "match");
    if (Action === "replace") {
      return { text: Text.replace(Re, OptionalString(Arguments, "replacement", "")) };
    }
    if (Action === "match") {
      const Matches = [...Text.matchAll(Re.global ? Re : new RegExp(Pattern, Flags + "g"))].map((M) => M[0]);
      return { matches: Matches, count: Matches.length };
    }
    return Err(`unknown action: ${Action}`);
  },
};

// Common string transforms. Args: { action, text, sep?, needle? }.
export const TextTool: Tool = {
  Name: "text",
  Description: "String transforms: upper/lower/trim/length/reverse/split/count.",
  Args: "{ action: 'upper'|'lower'|'trim'|'length'|'reverse'|'split'|'count', text: string, sep?: string, needle?: string }",
  Execute: (Arguments) => {
    const Action = RequireString(Arguments, "action");
    const Text = RequireString(Arguments, "text");
    switch (Action) {
      case "upper": return { text: Text.toUpperCase() };
      case "lower": return { text: Text.toLowerCase() };
      case "trim": return { text: Text.trim() };
      case "length": return { result: Text.length };
      case "reverse": return { text: [...Text].reverse().join("") };
      case "split": return { parts: Text.split(OptionalString(Arguments, "sep", "\n")) };
      case "count": {
        const Needle = RequireString(Arguments, "needle");
        return { result: Needle === "" ? 0 : Text.split(Needle).length - 1 };
      }
      default: return Err(`unknown action: ${Action}`);
    }
  },
};
