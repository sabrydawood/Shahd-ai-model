// Tool-use SFT exemplars — this is what makes tools "مدمج في المودل نفسه": the model is TRAINED to
// decide when to call a tool, to format the call with the exact ToolTokens the loop parses, and to
// answer after reading the tool result. RenderForTraining puts the loss ONLY on the assistant turns
// (the tool-call turn and the final answer), so tool-calling behavior is learned, not hard-coded.
// (At toy scale this is mechanism, not competence — CAPABILITIES.md's mechanism-vs-quality split.)

import type { ChatMessage } from "./ChatTemplate.ts";
import { ToolTokens } from "../Serving/ToolProtocol.ts";

export type ToolExemplar = {
  User: string;
  Call: { name: string; arguments: Record<string, unknown> };
  Result: Record<string, unknown>;
  Answer: string;
};

// A spread of tools and intents so the model sees the general shape, not one memorized call.
export const ToolUseExemplars: ToolExemplar[] = [
  { User: "What is 128 * 47?", Call: { name: "calculator", arguments: { a: 128, op: "*", b: 47 } }, Result: { result: 6016 }, Answer: "128 * 47 = 6016." },
  { User: "Run this and tell me the output: console.log(2 ** 10)", Call: { name: "run_code", arguments: { code: "console.log(2 ** 10)" } }, Result: { passed: true, stdout: "1024\n" }, Answer: "It prints 1024." },
  { User: "Show me the contents of README.md", Call: { name: "file_read", arguments: { path: "README.md" } }, Result: { path: "README.md", content: "# Shahd" }, Answer: "The file starts with the heading \"# Shahd\"." },
  { User: "Look up the latest Bun release.", Call: { name: "web_search", arguments: { query: "latest Bun release" } }, Result: { stub: true, results: [] }, Answer: "I couldn't reach the web here, so I can't confirm the latest release." },
  { User: "Remember that the API base URL is https://api.example.com", Call: { name: "memory_store", arguments: { key: "api_base_url", value: "https://api.example.com" } }, Result: { stored: true, key: "api_base_url" }, Answer: "Saved the API base URL." },
];

function CallText(Call: ToolExemplar["Call"]): string {
  return `${ToolTokens.CallStart}${JSON.stringify(Call)}${ToolTokens.CallEnd}`;
}

function ResultText(Result: Record<string, unknown>): string {
  return `${ToolTokens.ResultStart}${JSON.stringify(Result)}${ToolTokens.ResultEnd}`;
}

/** Turn an exemplar into a 5-message SFT conversation (system, user, tool-call, result, answer). */
export function BuildToolConversation(Exemplar: ToolExemplar, SystemPrompt: string): ChatMessage[] {
  return [
    { Role: "System", Content: SystemPrompt },
    { Role: "User", Content: Exemplar.User },
    { Role: "Assistant", Content: CallText(Exemplar.Call) }, // trainable: emit the tool call
    { Role: "User", Content: ResultText(Exemplar.Result) }, // tool result fed back
    { Role: "Assistant", Content: Exemplar.Answer }, // trainable: answer from the result
  ];
}
