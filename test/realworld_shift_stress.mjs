import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "shift-stress-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name}] isError=${result.isError ?? false} -> ${text}`);
  return result;
}

await call("enable_input_control");

console.log("=== type_text alternating case, delayMs=50 ===");
await call("type_text", { text: "MiXeD CaSe StReSs TeSt AbCdEfGh", delayMs: 50 });
await call("press_key", { key: "Enter" });

console.log("=== type_text alternating case, delayMs=100 ===");
await call("type_text", { text: "MiXeD CaSe StReSs TeSt AbCdEfGh", delayMs: 100 });

await client.close();
process.exit(0);
