// Diagnostic tool for the absolute mouse-move coordinate mapping question
// (test/REALWORLD_TESTING.md item 6, currently ON HOLD - see that doc for
// why). Sends a handful of absolute mouse_move calls spanning the full
// normalized range and prints each; run this alongside a script/manual
// check of the actual cursor position (e.g. PowerShell's
// [System.Windows.Forms.Cursor]::Position) after each call to see whether
// the cursor lands where expected, moves at all, or stays roughly fixed
// regardless of input (the last is what was observed mid-session when the
// display configuration unexpectedly changed from dual- to single-monitor -
// re-run this once a stable multi-monitor setup is available again).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-calibration", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name} ${JSON.stringify(args)}] -> ${text}`);
}

await call("enable_input_control");

// Spread across the full normalized range so a real mapping (linear or
// otherwise) should be easy to distinguish from "not moving at all".
const points = [
  { x: 0, y: 0 },
  { x: 10000, y: 10000 },
  { x: 20000, y: 5000 },
  { x: 32768, y: 32768 },
  { x: 65535, y: 65535 },
];

for (const { x, y } of points) {
  console.log(`=== absolute move to normalized (${x}, ${y}) - check actual cursor position now ===`);
  await call("mouse_move", { x, y, absolute: true });
  await sleep(1500); // pause so a manual PowerShell check can run between points
}

await client.close();
process.exit(0);
