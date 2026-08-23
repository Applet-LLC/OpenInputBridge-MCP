// Sends a single press_key call. Usage: node realworld_key_once.mjs <key>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , key] = process.argv;

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "key-once", version: "0.0.1" });
await client.connect(transport);

await client.callTool({ name: "enable_input_control", arguments: {} });
const result = await client.callTool({ name: "press_key", arguments: { key } });
console.log(result.content?.[0]?.text ?? "");

await client.close();
process.exit(0);
