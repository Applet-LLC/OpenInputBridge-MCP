import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "wheel-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`[${name}] -> ${result.content?.[0]?.text ?? ""}`);
}

await call("enable_input_control");

// Fill the document with enough short lines to make it scrollable.
for (let i = 1; i <= 60; i++) {
  await call("type_text", { text: `Line ${i}`, delayMs: 5 });
  await call("press_key", { key: "Enter" });
}

await client.close();
process.exit(0);
