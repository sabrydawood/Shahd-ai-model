// In-memory ChatStore — the dependency-free fallback used when no DATABASE_URL is set (chat memory
// then lasts only for the process lifetime). Same interface as the Postgres store.

import type { ChatStore, ConversationSummary, ChatMessage } from "./ChatStore.ts";

type Conv = { Title: string; UpdatedAt: string; Messages: ChatMessage[] };

export class InMemoryChatStore implements ChatStore {
  private Convs = new Map<string, Conv>();

  async CreateConversation(Id: string, Title: string, At: string): Promise<void> {
    if (!this.Convs.has(Id)) this.Convs.set(Id, { Title, UpdatedAt: At, Messages: [] });
  }

  async ListConversations(): Promise<ConversationSummary[]> {
    return [...this.Convs.entries()]
      .map(([Id, C]) => ({ Id, Title: C.Title, UpdatedAt: C.UpdatedAt }))
      .sort((A, B) => (A.UpdatedAt < B.UpdatedAt ? 1 : -1));
  }

  async GetMessages(ConvId: string): Promise<ChatMessage[]> {
    return (this.Convs.get(ConvId)?.Messages ?? []).map((M) => ({ ...M }));
  }

  async AddMessage(ConvId: string, Role: "user" | "assistant", Content: string, At: string): Promise<void> {
    const C = this.Convs.get(ConvId);
    if (C === undefined) return;
    C.Messages.push({ Role, Content });
    C.UpdatedAt = At;
  }

  async DeleteConversation(ConvId: string): Promise<void> {
    this.Convs.delete(ConvId);
  }
}
