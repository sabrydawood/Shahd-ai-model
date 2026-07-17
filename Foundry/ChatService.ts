// Orchestrates one chat turn with memory: persist the user message, feed the WHOLE prior
// conversation back as context (so it's a real dialogue, not stateless Q&A), stream the reply, then
// persist the assistant message. The actual token generation is injected (ChatStreamFn) so this
// stays decoupled from the model/checkpoint; persistence is the ChatStore.

import type { ChatStore, ChatMessage } from "./ChatStore.ts";

// One reasoning-trace line the model produced this turn (think / tool call+result / final answer) —
// structurally identical to Brain's TraceLine but declared here so ChatService stays decoupled from
// the model layer. Surfaced to the UI so the operator SEES how the model reasoned, not just its reply.
export type ChatTraceLine = { Step: number; Kind: string; Text: string; Detail?: string };
// OnThink/OnToolStep stream the reasoning LIVE while the model generates (think text token-by-token,
// each tool call the moment it executes); OnTrace still delivers the final authoritative trace.
// Segment increments per generation pass within one turn so the UI can group think spans.
export type ChatOpts = {
  Temperature: number;
  MaxTokens: number;
  ShouldStop?: () => boolean;
  OnTrace?: (Lines: ChatTraceLine[]) => void;
  OnThink?: (Delta: string, Segment: number) => void;
  OnToolStep?: (Line: ChatTraceLine) => void;
};
export type ChatStreamFn = (Messages: ChatMessage[], Opts: ChatOpts, OnDelta: (Delta: string) => void) => Promise<string>;

function TitleFrom(Message: string): string {
  const One = Message.replace(/\s+/g, " ").trim();
  return One.length <= 48 ? One || "New chat" : One.slice(0, 47) + "…";
}

export class ChatService {
  // One in-flight turn per conversation: serialize turns on the same ConvId so a second turn always
  // sees the first turn's persisted messages (no lost context, no interleaved storage order).
  private Tail = new Map<string, Promise<unknown>>();

  constructor(
    private Store: ChatStore,
    private Stream: ChatStreamFn,
    private Now: () => string = (): string => new Date().toISOString(),
  ) {}

  private RunExclusive<T>(Key: string, Fn: () => Promise<T>): Promise<T> {
    const Prev = this.Tail.get(Key) ?? Promise.resolve();
    const Next = Prev.then(Fn, Fn); // run after the previous turn settles (resolved OR rejected)
    const Guard = Next.then(
      () => undefined,
      () => undefined,
    );
    this.Tail.set(Key, Guard);
    void Guard.then(() => {
      if (this.Tail.get(Key) === Guard) this.Tail.delete(Key); // drop idle keys
    });
    return Next;
  }

  ListConversations(): ReturnType<ChatStore["ListConversations"]> {
    return this.Store.ListConversations();
  }

  Messages(ConvId: string): Promise<ChatMessage[]> {
    return this.Store.GetMessages(ConvId);
  }

  Delete(ConvId: string): Promise<void> {
    return this.Store.DeleteConversation(ConvId);
  }

  /** Run a turn: persist the user message, stream the reply with full history as context, persist it.
   * Serialized per ConvId so concurrent turns on the same conversation can't lose context or interleave. */
  Turn(ConvId: string, Message: string, Opts: ChatOpts, OnDelta: (Delta: string) => void): Promise<string> {
    return this.RunExclusive(ConvId, async () => {
      const At = this.Now();
      await this.Store.CreateConversation(ConvId, TitleFrom(Message), At);
      const History = await this.Store.GetMessages(ConvId); // prior turns (before this message)
      await this.Store.AddMessage(ConvId, "user", Message, At);

      const Context: ChatMessage[] = [...History, { Role: "user", Content: Message }];
      // Capture the turn's reasoning trace and persist it WITH the assistant message — every past
      // reply stays inspectable (how did it decide?), which is the lens for finding weaknesses.
      let Captured: ChatTraceLine[] | null = null;
      const WrappedOpts: ChatOpts = {
        ...Opts,
        OnTrace: (Lines): void => {
          Captured = Lines;
          Opts.OnTrace?.(Lines);
        },
      };
      const Reply = await this.Stream(Context, WrappedOpts, OnDelta);
      await this.Store.AddMessage(ConvId, "assistant", Reply, this.Now(), Captured);
      return Reply;
    });
  }
}
