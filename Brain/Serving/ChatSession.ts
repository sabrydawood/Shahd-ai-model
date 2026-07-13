// Multi-turn chat state (Phase 6). Holds the running conversation and renders the model prompt via
// the chat template. Tool results are appended as user-visible turns so the model can read them.

import type { ChatMessage } from "../Sft/ChatTemplate.ts";
import { RenderChat } from "../Sft/ChatTemplate.ts";

export class ChatSession {
  Messages: ChatMessage[] = [];

  constructor(SystemPrompt?: string) {
    if (SystemPrompt !== undefined) this.Messages.push({ Role: "System", Content: SystemPrompt });
  }

  AddUser(Content: string): void {
    this.Messages.push({ Role: "User", Content });
  }

  AddAssistant(Content: string): void {
    this.Messages.push({ Role: "Assistant", Content });
  }

  /** Feed a tool result back into the conversation (as a user turn the model reads next). */
  AddToolResult(Content: string): void {
    this.Messages.push({ Role: "User", Content });
  }

  /** Render the prompt string for the model, cueing it to produce the next assistant turn. */
  RenderPrompt(): string {
    return RenderChat(this.Messages, true);
  }

  /**
   * Structurally compact the conversation: keep the leading system message (if any) and the last
   * `Keep` non-system turns, collapsing everything dropped into one synthetic note so context
   * shrinks deterministically. Returns how many turns were dropped.
   */
  Compact(Keep: number): number {
    const System = this.Messages[0]?.Role === "System" ? [this.Messages[0]] : [];
    const Body = this.Messages.slice(System.length);
    if (Body.length <= Keep) return 0;
    const Dropped = Body.length - Keep;
    const Recent = Body.slice(Body.length - Keep);
    const Note: ChatMessage = { Role: "System", Content: `[${Dropped} earlier turn(s) elided to save context]` };
    this.Messages = [...System, Note, ...Recent];
    return Dropped;
  }
}
