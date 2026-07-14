// Persistent chat memory contract so the model behaves like a real assistant with history, not a
// stateless Q&A box. Async (a Postgres implementation fits the same interface as the in-memory one),
// mirroring DocumentStore. The Postgres store keeps conversations synced in the SAME database as the
// corpus, so everything is traceable and memory is durable across restarts — not just runtime state.

export type ConversationSummary = { Id: string; Title: string; UpdatedAt: string };
export type ChatMessage = { Role: "user" | "assistant"; Content: string };

export interface ChatStore {
  /** Create the conversation if it does not already exist (idempotent on first message). */
  CreateConversation(Id: string, Title: string, At: string): Promise<void>;
  /** All conversations, most recently updated first. */
  ListConversations(): Promise<ConversationSummary[]>;
  /** A conversation's messages in order (the memory replayed as context). */
  GetMessages(ConvId: string): Promise<ChatMessage[]>;
  /** Append a message and bump the conversation's UpdatedAt. */
  AddMessage(ConvId: string, Role: "user" | "assistant", Content: string, At: string): Promise<void>;
  /** Remove a conversation and its messages. */
  DeleteConversation(ConvId: string): Promise<void>;
}
