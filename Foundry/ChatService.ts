// Orchestrates one chat turn with memory: persist the user message, feed the WHOLE prior
// conversation back as context (so it's a real dialogue, not stateless Q&A), stream the reply, then
// persist the assistant message. The actual token generation is injected (ChatStreamFn) so this
// stays decoupled from the model/checkpoint; persistence is the ChatStore.

import type { ChatStore, ChatMessage } from "./ChatStore.ts";

export type ChatOpts = { Temperature: number; MaxTokens: number };
export type ChatStreamFn = (Messages: ChatMessage[], Opts: ChatOpts, OnDelta: (Delta: string) => void) => Promise<string>;

function TitleFrom(Message: string): string {
  const One = Message.replace(/\s+/g, " ").trim();
  return One.length <= 48 ? One || "New chat" : One.slice(0, 47) + "…";
}

export class ChatService {
  constructor(
    private Store: ChatStore,
    private Stream: ChatStreamFn,
    private Now: () => string = (): string => new Date().toISOString(),
  ) {}

  ListConversations(): ReturnType<ChatStore["ListConversations"]> {
    return this.Store.ListConversations();
  }

  Messages(ConvId: string): Promise<ChatMessage[]> {
    return this.Store.GetMessages(ConvId);
  }

  Delete(ConvId: string): Promise<void> {
    return this.Store.DeleteConversation(ConvId);
  }

  /** Run a turn: persist the user message, stream the reply with full history as context, persist it. */
  async Turn(ConvId: string, Message: string, Opts: ChatOpts, OnDelta: (Delta: string) => void): Promise<string> {
    const At = this.Now();
    await this.Store.CreateConversation(ConvId, TitleFrom(Message), At);
    const History = await this.Store.GetMessages(ConvId); // prior turns (before this message)
    await this.Store.AddMessage(ConvId, "user", Message, At);

    const Context: ChatMessage[] = [...History, { Role: "user", Content: Message }];
    const Reply = await this.Stream(Context, Opts, OnDelta);
    await this.Store.AddMessage(ConvId, "assistant", Reply, this.Now());
    return Reply;
  }
}
