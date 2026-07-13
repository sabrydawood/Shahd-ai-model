// Explicit public surface of the tool system (rule: named barrel, no index.ts magic). Everything a
// host needs to build a registry, wire a context, render the manifest, and run tools.

export type { Tool, ToolExecute, ToolResult, ToolContext, ToolRegistryView, MemoryStore } from "./ToolTypes.ts";
export { ToolRegistry } from "./ToolRegistry.ts";
export { Workspace } from "./Workspace.ts";
export { Err, RequireString, OptionalString, RequireNumber, OptionalNumber, OptionalBool, ToolArgError } from "./ToolArgs.ts";

export { CalculatorTool, StatsTool } from "./MathTools.ts";
export { JsonTool, RegexTool, TextTool } from "./TextTools.ts";
export { RunCodeTool } from "./CodeTools.ts";
export { FileReadTool, FileListTool, FileSearchTool, FileWriteTool } from "./FileTools.ts";
export { CurrentTimeTool, HashTool, UuidTool, RandomIntTool } from "./SystemTools.ts";
export { WebSearchTool, MemoryStoreTool, MemoryRecallTool } from "./KnowledgeTools.ts";
export { UserAskTool, ListToolsTool, PlanTool, CompactTool, FinishTool } from "./ControlTools.ts";

export { RenderToolManifest, ToolSystemPrompt } from "./ToolManifest.ts";
export { InMemoryMemoryStore, DefaultToolContext } from "./DefaultProviders.ts";
export type { ContextParts } from "./DefaultProviders.ts";
export {
  BuildToolRegistry,
  DefaultToolRegistry,
  ToolsPolicyFromConfig,
  DefaultToolsPolicy,
} from "./BuildRegistry.ts";
export type { ToolsPolicy, FileAccess } from "./BuildRegistry.ts";
export { BuildAgentTooling } from "./AgentTooling.ts";
export type { AgentTooling } from "./AgentTooling.ts";
