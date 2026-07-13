// Renders the available tools into the system prompt so the tool surface is part of what the MODEL
// sees, not just what the host can run (Sabry's "مدمج في المودل نفسه"). Reuses the ToolTokens
// sentinels from ToolProtocol so the advertised call format is exactly the one the loop parses.
// (Whether a toy-scale model USES tools well is the scale-dependent CAPABILITIES concern; this is
// the mechanism that makes the tools visible to it.)

import { ToolTokens } from "../ToolProtocol.ts";
import type { Tool } from "./ToolTypes.ts";

/** A compact, model-readable catalog of tools + how to invoke one. */
export function RenderToolManifest(Tools: Tool[]): string {
  const Lines = Tools.map((T) => `- ${T.Name}${T.Args ? ` ${T.Args}` : ""}: ${T.Description}`);
  return [
    "You can use tools. To call one, emit exactly:",
    `${ToolTokens.CallStart}{"name":"<tool>","arguments":{...}}${ToolTokens.CallEnd}`,
    "The result comes back between " + `${ToolTokens.ResultStart} ... ${ToolTokens.ResultEnd}` + " markers.",
    "Call `finish` with your final answer when done. Available tools:",
    ...Lines,
  ].join("\n");
}

/** Prepend the tool manifest to a base system prompt. */
export function ToolSystemPrompt(BasePrompt: string, Tools: Tool[]): string {
  return `${BasePrompt}\n\n${RenderToolManifest(Tools)}`;
}
