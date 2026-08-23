// Sends mouse_move(absolute) + mouse_click for one target, args from CLI.
// Usage: node realworld_mouse_click_once.mjs <normX> <normY> <button>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , xArg, yArg, button] = process.argv;
const x = Number(xArg);
const y = Number(yArg);

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-click-once", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`[${name}] -> ${result.content?.[0]?.text ?? ""}`);
}

await call("enable_input_control");
await call("mouse_move", { x, y, absolute: true });
await call("mouse_click", { button: button || "left" });

await client.close();
process.exit(0);
