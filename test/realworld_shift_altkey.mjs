import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "shift-altkey-test", version: "0.0.1" });
await client.connect(transport);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name} ${JSON.stringify(args)}] -> ${text}`);
  return result;
}

await call("enable_input_control");

// Same "MiXeD" sequence as the failing type_text case, but alternating
// ShiftLeft/ShiftRight between consecutive shifted characters, with only
// the SAME modest timing type_text itself uses (~25-50ms), to test
// whether same-scancode repeat/debounce (not raw elapsed time) is the
// real cause of the shift-state loss.
const seq = [
  { key: "KeyM", shift: "ShiftLeft" },
  { key: "KeyI", shift: null },
  { key: "KeyX", shift: "ShiftRight" },
  { key: "KeyE", shift: null },
  { key: "KeyD", shift: "ShiftLeft" },
];

for (const { key, shift } of seq) {
  if (shift) {
    await call("key_down", { key: shift });
    await sleep(30);
  }
  await call("key_down", { key });
  await sleep(25);
  await call("key_up", { key });
  await sleep(30);
  if (shift) {
    await call("key_up", { key: shift });
    await sleep(30);
  }
}

await client.close();
process.exit(0);
