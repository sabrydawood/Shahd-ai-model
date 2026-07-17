// Postgres-backed ChatStore: conversations + messages live in the SAME database as the corpus, so
// chat memory is durable, traceable, and synced (not just runtime state). Uses raw postgres-js with
// its own connection; tables are created on first use (idempotent). Same interface as the in-memory
// store, so the dashboard/tests are unaffected by which one is wired.

import postgres from "postgres";
import type { ChatStore, ConversationSummary, ChatMessage, ChatTraceStep } from "./ChatStore.ts";

type ConvRow = { id: string; title: string; updated_at: string };
type MsgRow = { role: string; content: string; trace: string | null };

export class PostgresChatStore implements ChatStore {
  private Sql: ReturnType<typeof postgres>;
  private Ready: Promise<void>;

  constructor(Url: string) {
    this.Sql = postgres(Url, { onnotice: () => {} }); // silence idempotent CREATE-IF-NOT-EXISTS notices
    // Swallow the rejection here so a DB blip at startup can't become an unhandled rejection (which
    // Bun turns into a process exit). The real failure still surfaces when a method awaits a query.
    this.Ready = this.Migrate().catch((Caught) => {
      console.warn(`PostgresChatStore: migration deferred: ${(Caught as Error).message}`);
    });
  }

  private async Migrate(): Promise<void> {
    await this.Sql`CREATE TABLE IF NOT EXISTS chat_conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
    await this.Sql`CREATE TABLE IF NOT EXISTS chat_messages (id BIGSERIAL PRIMARY KEY, conv_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`;
    // The reasoning trace is persisted PER MESSAGE (JSON) so past replies stay inspectable forever.
    await this.Sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS trace TEXT`;
    await this.Sql`CREATE INDEX IF NOT EXISTS chat_messages_conv ON chat_messages (conv_id, id)`;
  }

  // A corrupt/legacy trace cell must never break loading a conversation — it degrades to "no trace".
  // Element-level filter too: one malformed entry (a manual DB edit, a future writer) must not make
  // the UI's step renderer throw and take the whole conversation view down with it.
  private static ParseTrace(Raw: string | null): ChatTraceStep[] | null {
    if (Raw === null || Raw === "") return null;
    try {
      const Parsed: unknown = JSON.parse(Raw);
      if (!Array.isArray(Parsed)) return null;
      const Steps = Parsed.filter((E): E is ChatTraceStep => E !== null && typeof E === "object" && typeof (E as ChatTraceStep).Text === "string");
      return Steps.length > 0 ? Steps : null;
    } catch {
      return null;
    }
  }

  async CreateConversation(Id: string, Title: string, At: string): Promise<void> {
    await this.Ready;
    await this.Sql`INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (${Id}, ${Title}, ${At}, ${At}) ON CONFLICT (id) DO NOTHING`;
  }

  async ListConversations(): Promise<ConversationSummary[]> {
    await this.Ready;
    const Rows = (await this.Sql`SELECT id, title, updated_at FROM chat_conversations ORDER BY updated_at DESC`) as unknown as ConvRow[];
    return Rows.map((R) => ({ Id: R.id, Title: R.title, UpdatedAt: R.updated_at }));
  }

  async GetMessages(ConvId: string): Promise<ChatMessage[]> {
    await this.Ready;
    const Rows = (await this.Sql`SELECT role, content, trace FROM chat_messages WHERE conv_id = ${ConvId} ORDER BY id`) as unknown as MsgRow[];
    return Rows.map((R) => ({ Role: R.role === "assistant" ? "assistant" : "user", Content: R.content, Trace: PostgresChatStore.ParseTrace(R.trace) }));
  }

  async AddMessage(ConvId: string, Role: "user" | "assistant", Content: string, At: string, Trace?: ChatTraceStep[] | null): Promise<void> {
    await this.Ready;
    const TraceJson = Trace != null && Trace.length > 0 ? JSON.stringify(Trace) : null;
    await this.Sql`INSERT INTO chat_messages (conv_id, role, content, created_at, trace) VALUES (${ConvId}, ${Role}, ${Content}, ${At}, ${TraceJson})`;
    await this.Sql`UPDATE chat_conversations SET updated_at = ${At} WHERE id = ${ConvId}`;
  }

  async DeleteConversation(ConvId: string): Promise<void> {
    await this.Ready;
    await this.Sql`DELETE FROM chat_messages WHERE conv_id = ${ConvId}`;
    await this.Sql`DELETE FROM chat_conversations WHERE id = ${ConvId}`;
  }

  async Close(): Promise<void> {
    await this.Sql.end();
  }
}
