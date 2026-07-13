// The end-to-end wiring that makes Config.Tools actually govern behavior (closes the gap where the
// schema fields were validated + frozen but never read). ONE function turns a ResolvedConfig into a
// ready registry + context + step budget: FileAccess/ExecEnabled/WebSearchEnabled pick which tools
// exist, WorkspaceRoot becomes the confinement root, MaxFileBytes the byte cap, MaxToolSteps the
// agent-loop budget. Serving/agent code calls this instead of hand-building tooling, so the central
// gate in ADR-0005 is truly the single source of control.

import type { ResolvedConfig } from "../../Config/ConfigTypes.ts";
import type { ChatSession } from "../ChatSession.ts";
import type { ToolContext } from "./ToolTypes.ts";
import { ToolRegistry } from "./ToolRegistry.ts";
import { BuildToolRegistry, ToolsPolicyFromConfig } from "./BuildRegistry.ts";
import { Workspace } from "./Workspace.ts";
import { DefaultToolContext } from "./DefaultProviders.ts";

export type AgentTooling = {
  Registry: ToolRegistry;
  Context: ToolContext;
  MaxSteps: number;
};

/** Build the registry + context + step budget entirely from Config.Tools (the single control point). */
export function BuildAgentTooling(Config: ResolvedConfig, Session?: ChatSession): AgentTooling {
  const Registry = BuildToolRegistry(ToolsPolicyFromConfig(Config));
  // Only construct a Workspace when file tools are enabled; its root comes from config, not a literal.
  const Root = Config.Tools.FileAccess === "Off" ? undefined : new Workspace(Config.Tools.WorkspaceRoot);
  const Context = DefaultToolContext({
    Session,
    Registry,
    Workspace: Root,
    MaxFileBytes: Config.Tools.MaxFileBytes,
    Seed: Config.Training.Seed,
  });
  return { Registry, Context, MaxSteps: Config.Tools.MaxToolSteps };
}
