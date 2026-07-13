// Chat template + special tokens (Phase 4). Renders a system/user/assistant conversation into
// the token format the model is SFT'd on. RenderForTraining also returns a loss mask so training
// counts ONLY the assistant's response tokens (and its end-of-turn), never the prompt.

import type { SpecialTokenizer } from "../Tokenizer/SpecialTokenizer.ts";

export const ChatTokens = {
  System: "<|system|>",
  User: "<|user|>",
  Assistant: "<|assistant|>",
  EndOfTurn: "<|endofturn|>",
  Think: "<|think|>",
  EndThink: "<|endthink|>",
} as const;

export const ChatTokenList: readonly string[] = Object.values(ChatTokens);

export type ChatRole = "System" | "User" | "Assistant";
export type ChatMessage = { Role: ChatRole; Content: string };

const RoleToken: Record<ChatRole, string> = {
  System: ChatTokens.System,
  User: ChatTokens.User,
  Assistant: ChatTokens.Assistant,
};

/** Render a conversation to a plain string; AddAssistantCue appends the assistant token to prompt a reply. */
export function RenderChat(Messages: ChatMessage[], AddAssistantCue = true): string {
  let Out = "";
  for (const Message of Messages) Out += RoleToken[Message.Role] + Message.Content + ChatTokens.EndOfTurn;
  if (AddAssistantCue) Out += ChatTokens.Assistant;
  return Out;
}

export type TrainingSequence = { Ids: number[]; LossMask: boolean[] };

/** Token ids + per-token loss mask (true only on assistant content + its end-of-turn). */
export function RenderForTraining(Messages: ChatMessage[], Tok: SpecialTokenizer): TrainingSequence {
  const Ids: number[] = [];
  const LossMask: boolean[] = [];
  const Push = (SubIds: number[], Trainable: boolean): void => {
    for (const Id of SubIds) {
      Ids.push(Id);
      LossMask.push(Trainable);
    }
  };
  for (const Message of Messages) {
    const Trainable = Message.Role === "Assistant";
    Push([Tok.Id(RoleToken[Message.Role])], false); // role marker is never trained
    Push(Tok.Encode(Message.Content), Trainable);
    Push([Tok.Id(ChatTokens.EndOfTurn)], Trainable); // teach the model to stop after replying
  }
  return { Ids, LossMask };
}
