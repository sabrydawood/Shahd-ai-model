// Fully-owned synthetic SFT conversations (Phase 8). Zero external data — every conversation is
// generated deterministically here, so it is license-clean and reproducible. These teach the CHAT
// FORMAT, tool-CALLING, and a thinking scaffold (mechanism, not knowledge — a tiny model can't hold
// much). Built from the REAL SFT infra (ChatMessage + BuildToolConversation + WrapThinking) so it
// feeds RenderForTraining/SftStep unchanged. External permissive text (OASST, Gutenberg…) is layered
// in via data collection later; this is the owned core that makes the model reply + call tools.
//
// UNIFIED RECIPE (the corrected one): every owned conversation trains under the ONE OwnedSystemPrompt,
// and every owned assistant turn STARTS with a short <|think|>…<|endthink|> scratchpad. The thinking
// behavior is carried by the DATA, not by a separate system prompt — a tiny model keys behavior on
// the prompt prefix, and a think-only prompt that serving never presents leaves the scaffold
// unreachable (the NanoChat2 lesson: 800 thinking examples behind DefaultThinkingSystemPrompt were
// invisible at serving time because ServeChatAgent presents OwnedSystemPrompt).

import type { ChatMessage } from "./ChatTemplate.ts";
import type { ToolExemplar } from "./ToolUseExamples.ts";
import { BuildToolConversation, ToolUseExemplars } from "./ToolUseExamples.ts";
import { WrapThinkingAnswer } from "../Reasoning/AnswerExtraction.ts";
import { WrapThinking } from "../Reasoning/ThinkingMode.ts";
import type { SeededRng } from "../Random/SeededRng.ts";

// EXPORTED because serving must present the model with the SAME system prompt it was trained on:
// a 2.5M surface-level model does not generalize across system prompts, and serving it a long
// unseen preamble (e.g. a rendered tool manifest, which training never included) collapses its
// behavior to the dominant pattern regardless of the question.
export const OwnedSystemPrompt = "You are Shahd, a helpful coding assistant.";
const System = OwnedSystemPrompt;

// A fixed persona so the model has one consistent voice to imitate: [user, think, reply] — the think
// span becomes the visible reasoning in the serving trace. Identity wording is CANONICAL and matches
// OwnedSystemPrompt ("a helpful coding assistant"): near-identical but different self-descriptions
// read as different patterns to a tiny model, so there is exactly one. Identity questions carry both
// casings/variants because byte-BPE sees "Who" and "who" as different token streams.
const Persona: readonly [string, string, string][] = [
  ["hi", "The user greeted me. I should greet them back and offer help.", "Hello! How can I help you with your code today?"],
  ["Hi", "The user greeted me. I should greet them back and offer help.", "Hello! How can I help you with your code today?"],
  ["hello", "The user greeted me. I should greet them back and offer help.", "Hi there! What would you like help with?"],
  ["Hello", "The user greeted me. I should greet them back and offer help.", "Hi there! What would you like help with?"],
  ["hey", "The user greeted me. I should greet them back and offer help.", "Hey! Ask me a question or give me a coding task."],
  ["who are you?", "The user is asking about my identity. I should introduce myself.", "I'm Shahd, a helpful coding assistant. Ask me a question or give me a task."],
  ["who are you", "The user is asking about my identity. I should introduce myself.", "I'm Shahd, a helpful coding assistant. Ask me a question or give me a task."],
  ["Who are you?", "The user is asking about my identity. I should introduce myself.", "I'm Shahd, a helpful coding assistant. Ask me a question or give me a task."],
  ["what is your name?", "The user wants to know my name.", "My name is Shahd. I'm a helpful coding assistant."],
  ["what's your name?", "The user wants to know my name.", "My name is Shahd. I'm a helpful coding assistant."],
  ["what are you?", "The user is asking what I am.", "I'm Shahd, a helpful coding assistant that can also call tools."],
  ["are you an AI?", "The user is asking whether I am an AI.", "Yes — I'm Shahd, a small AI coding assistant."],
  ["introduce yourself", "The user asked me to introduce myself.", "I'm Shahd, a helpful coding assistant. Ask me a question or give me a task."],
  ["tell me about yourself", "The user asked me to introduce myself.", "I'm Shahd, a helpful coding assistant. I can answer questions, use tools, and help with code."],
  ["what can you do?", "The user wants to know my capabilities.", "I can answer questions, do calculations with my tools, and help with small coding tasks."],
  ["help", "The user is asking how to get started.", "Ask me a question, give me a coding task, or request a calculation."],
  ["thanks", "The user thanked me. A short acknowledgement is enough.", "You're welcome!"],
  ["thank you", "The user thanked me. A short acknowledgement is enough.", "Happy to help!"],
  ["bye", "The user is leaving. I should say goodbye.", "Goodbye! Come back anytime."],
  ["goodbye", "The user is leaving. I should say goodbye.", "Goodbye! See you later."],
  ["quit", "The user is leaving. I should say goodbye.", "Goodbye! See you later."],
  ["exit", "The user is leaving. I should say goodbye.", "Goodbye! See you later."],
  ["stop", "The user is leaving. I should say goodbye.", "Goodbye! See you later."],
];

const Ops: readonly [string, (A: number, B: number) => number][] = [
  ["+", (A, B): number => A + B],
  ["-", (A, B): number => A - B],
  ["*", (A, B): number => A * B],
  ["/", (A, B): number => B === 0 ? 0 : A / B],
  ["^", (A, B): number => A ** B],
  ["%", (A, B): number => B === 0 ? 0 : A % B],
];

// Per-op operand ranges: '^' with two 2-digit operands can overflow to an astronomically large (or
// non-finite) result, and unconstrained '/' almost never divides evenly, teaching the model a "just
// round it" pattern instead of exact arithmetic. PickOperands keeps every op's example well-formed:
// '^' gets a small base/exponent, '/' picks a divisor that evenly divides the dividend, everything else
// uses the caller's requested [Min, Max] range unchanged.
function PickOperands(Rng: SeededRng, Op: string, Min: number, Max: number): [number, number] {
  if (Op === "^") {
    const Base = 2 + Math.floor(Rng.NextFloat() * 11); // 2..12
    const Exponent = 2 + Math.floor(Rng.NextFloat() * 3); // 2..4
    return [Base, Exponent];
  }
  const A = Min + Math.floor(Rng.NextFloat() * (Max - Min + 1));
  if (Op === "/") {
    const B = 1 + Math.floor(Rng.NextFloat() * Math.min(Max, 12)); // small divisor
    return [A * B, B]; // dividend is an exact multiple of the divisor
  }
  const B = Min + Math.floor(Rng.NextFloat() * (Max - Min + 1));
  return [A, B];
}

// One owned conversation: system -> user -> (think + reply). WrapThinking puts the scratchpad in
// front of the visible reply — exactly the shape SplitThinking/the serving trace parse back out.
function Owned(User: string, Thinking: string, Reply: string): ChatMessage[] {
  return [
    { Role: "System", Content: System },
    { Role: "User", Content: User },
    { Role: "Assistant", Content: WrapThinking(Thinking, Reply) },
  ];
}

// Arithmetic taught as a TOOL CALL (not a memorized answer) — the model learns to reach for the
// calculator, exactly the learned-tool behavior the agent loop expects. Both assistant turns think
// first (decide to call the tool; read its result) so the trace shows the decision, not just the call.
function ArithmeticToolConversation(Rng: SeededRng): ChatMessage[] {
  const [Op, Fn] = Ops[Math.floor(Rng.NextFloat() * Ops.length)]!;
  const [A, B] = PickOperands(Rng, Op, 1, 99);
  const Result = Fn(A, B);
  const Exemplar: ToolExemplar = {
    User: `What is ${A} ${Op} ${B}?`,
    CallThinking: `The user wants ${A} ${Op} ${B}. I should use the calculator tool.`,
    Call: { name: "calculator", arguments: { a: A, op: Op, b: B } },
    Result: { result: Result },
    AnswerThinking: `The calculator returned ${Result}.`,
    Answer: `${A} ${Op} ${B} = ${Result}.`,
  };
  return BuildToolConversation(Exemplar, System);
}

// A direct think -> answer example in the canonical <|think|>…<|endthink|><answer>…</answer> format
// the answer extractor parses. Trains under the SAME unified system prompt as everything else. The
// "Think first." user suffix is the feature that separates this direct-answer shape from the
// tool-call shape trained on the same question form — one prompt, two learnable behaviors.
function ThinkingConversation(Rng: SeededRng): ChatMessage[] {
  const [Op, Fn] = Ops[Math.floor(Rng.NextFloat() * Ops.length)]!;
  const [A, B] = PickOperands(Rng, Op, 2, 98);
  const Result = Fn(A, B);
  const Reasoning = `The problem is ${A} ${Op} ${B}. Applying ${Op} to ${A} and ${B} gives ${Result}.`;
  const Assistant = WrapThinkingAnswer(Reasoning, String(Result));
  return [
    { Role: "System", Content: System },
    { Role: "User", Content: `What is ${A} ${Op} ${B}? Think first.` },
    { Role: "Assistant", Content: Assistant },
  ];
}

// The transition a single-exchange corpus never teaches: a COMPLETED assistant turn followed by a
// NEW user question. Without it, the second message of any conversation is out-of-distribution and
// the model collapses to its most frequent opener (a greeting). Each multi-turn conversation
// stitches 2-3 short owned exchanges under ONE system message; the exchanges reuse the exact same
// builders (identical wording) as the single-turn data, so this adds ONLY the turn transition, not
// a new content distribution. Code-ID exchanges are excluded — their snippets would blow the block
// budget of a stitched conversation.
function MultiTurnConversation(Rng: SeededRng): ChatMessage[] {
  const Exchanges = 2 + Math.floor(Rng.NextFloat() * 2); // 2..3 exchanges
  const Out: ChatMessage[] = [{ Role: "System", Content: System }];
  for (let E = 0; E < Exchanges; E++) {
    const Pick = Rng.NextFloat();
    let Msgs: ChatMessage[];
    if (Pick < 0.4) {
      const [User, Thinking, Reply] = Persona[Math.floor(Rng.NextFloat() * Persona.length)]!;
      Msgs = Owned(User, Thinking, Reply);
    } else if (Pick < 0.8) {
      Msgs = ArithmeticToolConversation(Rng);
    } else {
      Msgs = ThinkingConversation(Rng);
    }
    for (const M of Msgs) if (M.Role !== "System") Out.push(M);
  }
  return Out;
}

export type CodeSample = { Lang: string; Content: string };

// Language identification over a REAL snippet — a truthful, corpus-grounded task.
function CodeLangConversation(Sample: CodeSample): ChatMessage[] {
  const Snippet = Sample.Content.split("\n").slice(0, 12).join("\n").slice(0, 480).trimEnd();
  return Owned(
    `What programming language is this code written in?\n\n${Snippet}`,
    "I need to identify the language from the snippet's syntax and keywords.",
    Sample.Lang,
  );
}

export type OwnedSftOptions = { ArithmeticCount?: number; ThinkingCount?: number; PersonaRepeats?: number; MaxCodeConversations?: number; MultiTurnCount?: number };

/** Build the full owned SFT conversation set (each item is one system/user/assistant conversation).
 *  Deterministic given the same Rng + code samples. */
export function BuildOwnedConversations(CodeSamples: CodeSample[], Rng: SeededRng, Options: OwnedSftOptions = {}): ChatMessage[][] {
  const ArithmeticCount = Options.ArithmeticCount ?? 200;
  const ThinkingCount = Options.ThinkingCount ?? 100;
  const PersonaRepeats = Options.PersonaRepeats ?? 20;
  const MaxCodeConversations = Options.MaxCodeConversations ?? 1500;
  const MultiTurnCount = Options.MultiTurnCount ?? 300;

  const Out: ChatMessage[][] = [];
  for (let R = 0; R < PersonaRepeats; R++) for (const [User, Thinking, Reply] of Persona) Out.push(Owned(User, Thinking, Reply));
  for (let I = 0; I < ArithmeticCount; I++) Out.push(ArithmeticToolConversation(Rng));
  for (let I = 0; I < ThinkingCount; I++) Out.push(ThinkingConversation(Rng));
  for (let I = 0; I < MultiTurnCount; I++) Out.push(MultiTurnConversation(Rng));
  for (const Exemplar of ToolUseExemplars) for (let R = 0; R < 10; R++) Out.push(BuildToolConversation(Exemplar, System));
  let Added = 0;
  for (const Sample of CodeSamples) {
    if (Added >= MaxCodeConversations) break;
    if (Sample.Lang === "unknown" || Sample.Content.trim().length < 60) continue;
    Out.push(CodeLangConversation(Sample));
    Added++;
  }
  return Out;
}
