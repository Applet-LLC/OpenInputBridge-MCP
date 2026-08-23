// Baseline absolute move (primary monitor, near the boundary with
// secondary), then N relative moves down (crossing onto secondary),
// then N relative moves back up (crossing back onto primary) - all
// within one process/connection. Absolute mode can only reach the
// primary monitor (see test/REALWORLD_TESTING.md item 6), so getting
// onto the secondary monitor at all has to go through relative moves.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "mouse-relative-sequence", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`[${name} ${JSON.stringify(args)}] -> ${result.content?.[0]?.text ?? ""}`);
}

await call("enable_input_control");

// Baseline: physical (1500, 1400) via our own absolute move (primary monitor).
await call("mouse_move", { x: 28577, y: 63716, absolute: true });

console.log("=== moving down (into secondary monitor) ===");
for (let i = 0; i < 5; i++) {
  await call("mouse_move", { x: 0, y: 300, absolute: false });
}

console.log("=== moving back up (back onto primary monitor) ===");
for (let i = 0; i < 5; i++) {
  await call("mouse_move", { x: 0, y: -300, absolute: false });
}

await client.close();
process.exit(0);
