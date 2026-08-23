// Sends a single mouse_move call with args from the command line, for
// interleaving with an external (PowerShell) cursor-position check after
// each call. Usage: node realworld_mouse_move_once.mjs <x> <y> <absolute:0|1>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , xArg, yArg, absoluteArg] = process.argv;
const x = Number(xArg);
const y = Number(yArg);
const absolute = absoluteArg === "1";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-move-once", version: "0.0.1" });
await client.connect(transport);

await client.callTool({ name: "enable_input_control", arguments: {} });
const result = await client.callTool({ name: "mouse_move", arguments: { x, y, absolute } });
console.log(result.content?.[0]?.text ?? "");

await client.close();
process.exit(0);
