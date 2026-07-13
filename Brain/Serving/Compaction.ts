// Conversation compaction (M1). When a session grows too long, older turns are collapsed into a
// SUMMARY that preserves the important points, instead of being blindly truncated. A Summarizer is
// injected: the deterministic ExtractiveSummarizer here is the owned default (condenses each dropped
// turn to a single signal line — user intents and assistant conclusions kept, tool chatter reduced
// to a marker); a host may inject a model-backed summarizer with the same shape for richer summaries.

import type { ChatMessage } from "../Sft/ChatTemplate.ts";
import { ToolTokens, ParseToolCall } from "./ToolProtocol.ts";

export type Summarizer = (Messages: ChatMessage[]) => string;

const MaxLineChars = 160;
const MaxLines = 40;

/** Condense one turn to a single signal line: tool turns become markers, prose keeps its first sentence. */
function CondenseTurn(Content: string): string {
  if (Content.includes(ToolTokens.ResultStart)) return "(tool result received)";
  const Call = ParseToolCall(Content);
  if (Call !== null) return `(called tool: ${Call.Name})`;
  const Clean = Content.replace(/<\|[^|]*\|>/g, " ").replace(/\s+/g, " ").trim();
  if (Clean.length === 0) return "";
  const First = Clean.split(/(?<=[.!?])\s/)[0] ?? Clean;
  return First.length > MaxLineChars ? First.slice(0, MaxLineChars - 1) + "…" : First;
}

/** Deterministic extractive summary of dropped turns — the owned default Summarizer. */
export function ExtractiveSummarizer(Messages: ChatMessage[]): string {
  const Lines: string[] = [];
  for (const Message of Messages) {
    const Condensed = CondenseTurn(Message.Content);
    if (Condensed.length > 0) Lines.push(`${Message.Role}: ${Condensed}`);
  }
  const Shown = Lines.slice(0, MaxLines);
  const Overflow = Lines.length - Shown.length;
  if (Overflow > 0) Shown.push(`…and ${Overflow} more earlier turn(s)`);
  return "Summary of earlier conversation:\n" + Shown.join("\n");
}
