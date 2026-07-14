// Persistent chat memory (bun:sqlite) so the model behaves like a real assistant with a history,
// not a stateless Q&A box: conversations and their messages survive restarts, and each turn feeds
// prior turns back as context (bounded by the model's context window — the serving cap trims the
// oldest tokens). Local single-file DB; independent of the corpus Postgres.

import { Database } from "bun:sqlite";

export type ConversationSummary = { Id: string; Title: string; UpdatedAt: string };
export type ChatMessage = { Role: "user" | "assistant"; Content: string };

type ConvRow = { Id: string; Title: string; UpdatedAt: string };
type MsgRow = { Role: string; Content: string };

export class ChatStore {
  private Db: Database;

  constructor(Path = "Chat.db") {
    this.Db = new Database(Path);
    this.Db.run("PRAGMA journal_mode = WAL");
    this.Db.run("CREATE TABLE IF NOT EXISTS conversations (Id TEXT PRIMARY KEY, Title TEXT NOT NULL, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL)");
    this.Db.run("CREATE TABLE IF NOT EXISTS messages (Id INTEGER PRIMARY KEY AUTOINCREMENT, ConvId TEXT NOT NULL, Role TEXT NOT NULL, Content TEXT NOT NULL, CreatedAt TEXT NOT NULL)");
    this.Db.run("CREATE INDEX IF NOT EXISTS messages_conv ON messages (ConvId, Id)");
  }

  CreateConversation(Id: string, Title: string, At: string): void {
    this.Db.run("INSERT OR IGNORE INTO conversations (Id, Title, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?)", [Id, Title, At, At]);
  }

  ListConversations(): ConversationSummary[] {
    return (this.Db.query("SELECT Id, Title, UpdatedAt FROM conversations ORDER BY UpdatedAt DESC").all() as ConvRow[]).map((R) => ({ Id: R.Id, Title: R.Title, UpdatedAt: R.UpdatedAt }));
  }

  GetMessages(ConvId: string): ChatMessage[] {
    return (this.Db.query("SELECT Role, Content FROM messages WHERE ConvId = ? ORDER BY Id").all(ConvId) as MsgRow[]).map((R) => ({ Role: R.Role === "assistant" ? "assistant" : "user", Content: R.Content }));
  }

  AddMessage(ConvId: string, Role: "user" | "assistant", Content: string, At: string): void {
    this.Db.run("INSERT INTO messages (ConvId, Role, Content, CreatedAt) VALUES (?, ?, ?, ?)", [ConvId, Role, Content, At]);
    this.Db.run("UPDATE conversations SET UpdatedAt = ? WHERE Id = ?", [At, ConvId]);
  }

  DeleteConversation(ConvId: string): void {
    this.Db.run("DELETE FROM messages WHERE ConvId = ?", [ConvId]);
    this.Db.run("DELETE FROM conversations WHERE Id = ?", [ConvId]);
  }

  Close(): void {
    this.Db.close();
  }
}
