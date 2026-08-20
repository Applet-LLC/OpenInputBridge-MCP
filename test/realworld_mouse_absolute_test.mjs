import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-absolute-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name}] -> ${text}`);
  return result;
}

await call("enable_input_control");

// Screen is 3440x1440 (primary). Target pixel (860, 360) = 25% across,
// 25% down. Normalized 0-65535: x=860/3440*65535=16384, y=360/1440*65535=16384.
console.log("=== absolute move to normalized (16384, 16384) -> expect pixel ~(860, 360) ===");
await call("mouse_move", { x: 16384, y: 16384, absolute: true });

await client.close();
process.exit(0);
