// MCP client over an injected transport. Does the initialize handshake, lists the server's tools,
// and calls them. Keeps no protocol state beyond what the transport needs, so it works the same over
// a mock (tests) or a real stdio server (StdioTransport).

import type { McpTransport, McpTool } from "./McpTypes.ts";

const ProtocolVersion = "2024-11-05";

export class McpClient {
  private Transport: McpTransport;
  private InitPromise: Promise<void> | null = null; // memoized so concurrent first calls share one handshake

  constructor(Transport: McpTransport) {
    this.Transport = Transport;
  }

  /** Handshake: initialize, then send the initialized notification. Idempotent + concurrency-safe. */
  Initialize(): Promise<void> {
    if (this.InitPromise === null) this.InitPromise = this.DoInitialize();
    return this.InitPromise;
  }

  private async DoInitialize(): Promise<void> {
    await this.Transport.Rpc("initialize", {
      protocolVersion: ProtocolVersion,
      capabilities: {},
      clientInfo: { name: "shahd", version: "1.0" },
    });
    this.Transport.Notify("notifications/initialized");
  }

  /** List the tools the server exposes (initializes first if needed). */
  async ListTools(): Promise<McpTool[]> {
    await this.Initialize();
    const Result = (await this.Transport.Rpc("tools/list")) as { tools?: McpTool[] };
    return Result.tools ?? [];
  }

  /** Call a server tool by name; returns the raw MCP result. */
  async CallTool(Name: string, Arguments: Record<string, unknown>): Promise<unknown> {
    await this.Initialize();
    return this.Transport.Rpc("tools/call", { name: Name, arguments: Arguments });
  }

  Close(): void {
    this.Transport.Close();
  }
}
