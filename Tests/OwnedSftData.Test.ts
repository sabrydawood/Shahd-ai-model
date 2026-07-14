import { test, expect } from "bun:test";
import { BuildOwnedConversations } from "../Brain/Sft/OwnedSftData.ts";
import type { CodeSample } from "../Brain/Sft/OwnedSftData.ts";
import { SeededRng } from "../Brain/Random/SeededRng.ts";
import { ChatTokens } from "../Brain/Sft/ChatTemplate.ts";
import { ToolTokens } from "../Brain/Serving/ToolProtocol.ts";

const Samples: CodeSample[] = [
  { Lang: "typescript", Content: "export function add(a: number, b: number): number {\n  return a + b;\n}\n// a small utility used across the app\n" },
  { Lang: "unknown", Content: "x".repeat(200) }, // skipped: unknown language
  { Lang: "python", Content: "def f():\n    return 1\n" }, // skipped: too short (<60 chars)
];

test("BuildOwnedConversations: persona + arithmetic-as-tool + thinking + grounded code-lang", () => {
  const Convos = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 10, ThinkingCount: 5, PersonaRepeats: 1, MaxCodeConversations: 5 });

  // Every conversation is a well-formed system -> user -> ... -> assistant SFT example.
  for (const C of Convos) {
    expect(C[0]!.Role).toBe("System");
    expect(C.some((M) => M.Role === "Assistant")).toBe(true);
  }
  // Arithmetic is taught as a CALCULATOR TOOL CALL (learned tool-use, not a memorized answer).
  const CalcToolConvos = Convos.filter((C) => C.some((M) => M.Content.includes(ToolTokens.CallStart) && M.Content.includes("calculator")));
  expect(CalcToolConvos.length).toBeGreaterThanOrEqual(10);
  // The thinking scaffold appears.
  const Thinking = Convos.filter((C) => C.some((M) => M.Content.includes(ChatTokens.Think)));
  expect(Thinking.length).toBeGreaterThanOrEqual(5);
  // Grounded language-ID uses ONLY the real, known-language, long-enough sample.
  const Lang = Convos.filter((C) => C.some((M) => M.Content.startsWith("What programming language")));
  expect(Lang.length).toBe(1);
  expect(Lang[0]!.find((M) => M.Role === "Assistant")!.Content).toBe("typescript");
});

test("BuildOwnedConversations is deterministic for a given seed + samples", () => {
  const A = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 8, ThinkingCount: 3, PersonaRepeats: 2, MaxCodeConversations: 5 });
  const B = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 8, ThinkingCount: 3, PersonaRepeats: 2, MaxCodeConversations: 5 });
  expect(A).toEqual(B);
});
