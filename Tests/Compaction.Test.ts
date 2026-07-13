import { test, expect } from "bun:test";
import { ChatSession } from "../Brain/Serving/ChatSession.ts";
import { ExtractiveSummarizer } from "../Brain/Serving/Compaction.ts";
import { ToolTokens } from "../Brain/Serving/ToolProtocol.ts";
import { DefaultToolRegistry, DefaultToolContext } from "../Brain/Serving/Tools/ToolsBarrel.ts";

test("ExtractiveSummarizer keeps intent + conclusions, marks tool turns, drops noise", () => {
  const Summary = ExtractiveSummarizer([
    { Role: "User", Content: "Please refactor the payment module. It has duplicated logic." },
    { Role: "Assistant", Content: `${ToolTokens.CallStart}{"name":"file_read","arguments":{"path":"pay.ts"}}${ToolTokens.CallEnd}` },
    { Role: "User", Content: `${ToolTokens.ResultStart}{"content":"..."}${ToolTokens.ResultEnd}` },
    { Role: "Assistant", Content: "I extracted a shared helper and removed the duplication." },
  ]);
  expect(Summary).toContain("Summary of earlier conversation");
  expect(Summary).toContain("refactor the payment module"); // user intent kept
  expect(Summary).toContain("called tool: file_read"); // tool call marked, not dumped
  expect(Summary).toContain("tool result received"); // tool result reduced
  expect(Summary).toContain("extracted a shared helper"); // assistant conclusion kept
});

test("Compact with a summarizer preserves key points (not just elision)", () => {
  const Session = new ChatSession("system");
  Session.AddUser("Build a rate limiter with a token bucket.");
  Session.AddAssistant("Done: token bucket with refill.");
  Session.AddUser("Now add per-IP keys.");
  Session.AddAssistant("Added per-IP buckets.");
  Session.AddUser("And metrics.");
  Session.AddAssistant("Added counters.");
  const Dropped = Session.Compact(2, ExtractiveSummarizer);
  expect(Dropped).toBe(4);
  const Note = Session.Messages[1]; // system, summary note, then 2 recent
  expect(Note.Role).toBe("System");
  expect(Note.Content).toContain("token bucket"); // a key point survived compaction
  expect(Session.Messages.length).toBe(4);
});

test("Compact without a summarizer falls back to a structural elision marker", () => {
  const Session = new ChatSession("system");
  for (let I = 0; I < 5; I++) Session.AddUser(`turn ${I}`);
  Session.Compact(2);
  expect(String(Session.Messages[1].Content)).toContain("elided");
});

test("compact tool summarizes by default via DefaultToolContext", async () => {
  const Session = new ChatSession("system");
  for (let I = 0; I < 6; I++) {
    Session.AddUser(`request ${I}`);
    Session.AddAssistant(`answer ${I}`);
  }
  const Result = await DefaultToolRegistry().Run({ Name: "compact", Arguments: { keep: 3 } }, DefaultToolContext({ Session }));
  expect(Result["summarized"]).toBe(true);
  expect(String(Session.Messages[1].Content)).toContain("Summary of earlier conversation");
});
