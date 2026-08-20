#!/usr/bin/env node
/**
 * openinputbridge-mcp entry point. Starts an MCP server over stdio that
 * exposes OpenInputBridge (kernel-level, Interception-compatible key/mouse
 * injection) as SendInput()-alternative tools for GUI/native-app test
 * automation. See README.md for setup and SECURITY.md for the safety model.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OibBridge } from "./bridge.js";
import { SafetyGate, DEFAULT_SAFETY_OPTIONS } from "./safety.js";
import { registerTools } from "./tools.js";

function readSafetyOptionsFromEnv() {
  const maxEventsPerWindow = Number(process.env.OIB_MCP_RATE_LIMIT_MAX ?? DEFAULT_SAFETY_OPTIONS.maxEventsPerWindow);
  const windowMs = Number(process.env.OIB_MCP_RATE_LIMIT_WINDOW_MS ?? DEFAULT_SAFETY_OPTIONS.windowMs);
  return {
    maxEventsPerWindow: Number.isFinite(maxEventsPerWindow) && maxEventsPerWindow > 0 ? maxEventsPerWindow : DEFAULT_SAFETY_OPTIONS.maxEventsPerWindow,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_SAFETY_OPTIONS.windowMs,
  };
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    process.stderr.write(
      "openinputbridge-mcp: OpenInputBridge is Windows-only; this process will start but every tool call will fail.\n",
    );
  }

  const bridge = new OibBridge();
  const safety = new SafetyGate(readSafetyOptionsFromEnv());

  const server = new McpServer({
    name: "openinputbridge-mcp",
    version: "0.1.0",
  });

  registerTools(server, bridge, safety);

  const shutdown = () => {
    bridge.dispose();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`openinputbridge-mcp: fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
