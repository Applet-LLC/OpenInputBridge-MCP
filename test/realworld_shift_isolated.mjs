import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "shift-isolated-test", version: "0.0.1" });
await client.connect(transport);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name} ${JSON.stringify(args)}] -> ${text}`);
  return result;
}

await call("enable_input_control");

// Manually spell M,i,X,e,D with generous 200ms gaps between every single
// primitive event, bypassing type_text/press_key's internal timing
// entirely, to determine whether sufficient raw delay ever fixes the
// X/D shift-state loss seen in type_text.
const seq = [
  { key: "KeyM", shift: true },
  { key: "KeyI", shift: false },
  { key: "KeyX", shift: true },
  { key: "KeyE", shift: false },
  { key: "KeyD", shift: true },
];

for (const { key, shift } of seq) {
  if (shift) {
    await call("key_down", { key: "ShiftLeft" });
    await sleep(200);
  }
  await call("key_down", { key });
  await sleep(200);
  await call("key_up", { key });
  await sleep(200);
  if (shift) {
    await call("key_up", { key: "ShiftLeft" });
    await sleep(200);
  }
}

await client.close();
process.exit(0);
