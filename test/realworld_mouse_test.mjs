import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name}] -> ${text}`);
  return result;
}

await call("enable_input_control");

console.log("=== relative move (+200, +0) ===");
await call("mouse_move", { x: 200, y: 0, absolute: false });

console.log("=== relative move (0, +150) ===");
await call("mouse_move", { x: 0, y: 150, absolute: false });

await client.close();
process.exit(0);
