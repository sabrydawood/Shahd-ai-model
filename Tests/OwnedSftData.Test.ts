import { test, expect } from "bun:test";
import { BuildOwnedConversations, OwnedSystemPrompt } from "../Brain/Sft/OwnedSftData.ts";
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
  // Grounded language-ID uses ONLY the real, known-language, long-enough sample — the reply is the
  // language name after the think scratchpad.
  const Lang = Convos.filter((C) => C.some((M) => M.Content.startsWith("What programming language")));
  expect(Lang.length).toBe(1);
  const LangReply = Lang[0]!.find((M) => M.Role === "Assistant")!.Content;
  expect(LangReply.endsWith(`${ChatTokens.EndThink}typescript`)).toBe(true);
});

test("unified recipe: ONE system prompt everywhere + every owned assistant turn thinks first", () => {
  const Convos = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 6, ThinkingCount: 4, PersonaRepeats: 1, MaxCodeConversations: 5 });
  for (const C of Convos) {
    // The single training prompt is exactly what serving presents (train/serve prompt parity).
    expect(C[0]!.Content).toBe(OwnedSystemPrompt);
    // The thinking behavior lives in the data: every assistant turn opens with the scratchpad.
    for (const M of C) if (M.Role === "Assistant") expect(M.Content.startsWith(ChatTokens.Think)).toBe(true);
  }
});

test("identity coverage: 'who are you?' variants answer with the canonical identity, not a task pattern", () => {
  const Convos = BuildOwnedConversations([], new SeededRng(7), { ArithmeticCount: 0, ThinkingCount: 0, PersonaRepeats: 1, MaxCodeConversations: 0 });
  const Identity = ["who are you?", "who are you", "Who are you?", "what is your name?", "what are you?"];
  for (const Q of Identity) {
    const Hit = Convos.find((C) => C.some((M) => M.Role === "User" && M.Content === Q));
    expect(Hit).toBeDefined();
    expect(Hit!.find((M) => M.Role === "Assistant")!.Content).toContain("Shahd");
  }
});

test("multi-turn: stitched conversations teach the completed-turn -> next-question transition", () => {
  const All = BuildOwnedConversations([], new SeededRng(7), { ArithmeticCount: 0, ThinkingCount: 0, PersonaRepeats: 0, MaxCodeConversations: 0, MultiTurnCount: 40 });
  // The 5 fixed tool exemplars x10 are always present; a stitched conversation is the one with >= 2
  // REAL user questions (tool-result user messages don't count).
  const Convos = All.filter((C) => C.filter((M) => M.Role === "User" && !M.Content.startsWith(ToolTokens.ResultStart)).length >= 2);
  expect(Convos.length).toBe(40);
  let SawTransition = 0;
  for (const C of Convos) {
    // Exactly ONE system message, at the front — stitching must not duplicate it mid-conversation.
    expect(C[0]!.Role).toBe("System");
    expect(C.filter((M) => M.Role === "System").length).toBe(1);
    // Ends with a completed assistant turn, and every assistant turn thinks first (unified recipe).
    expect(C[C.length - 1]!.Role).toBe("Assistant");
    for (const M of C) if (M.Role === "Assistant") expect(M.Content.startsWith(ChatTokens.Think)).toBe(true);
    // No code-ID snippets inside a stitched conversation (block-size budget guard).
    expect(C.some((M) => M.Content.startsWith("What programming language"))).toBe(false);
    // The transition being taught: an assistant turn followed by a NEW user question — i.e. a user
    // message that is NOT a tool result being fed back.
    for (let I = 0; I + 1 < C.length; I++) {
      if (C[I]!.Role === "Assistant" && C[I + 1]!.Role === "User" && !C[I + 1]!.Content.startsWith(ToolTokens.ResultStart)) SawTransition++;
    }
  }
  // 2-3 exchanges per conversation means every conversation carries >= 1 such transition.
  expect(SawTransition).toBeGreaterThanOrEqual(40);
});

test("BuildOwnedConversations is deterministic for a given seed + samples", () => {
  const A = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 8, ThinkingCount: 3, PersonaRepeats: 2, MaxCodeConversations: 5 });
  const B = BuildOwnedConversations(Samples, new SeededRng(7), { ArithmeticCount: 8, ThinkingCount: 3, PersonaRepeats: 2, MaxCodeConversations: 5 });
  expect(A).toEqual(B);
});
