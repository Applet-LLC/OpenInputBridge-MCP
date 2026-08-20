// Full interactive exclusive-mode session: enables exclusive mode, sends a
// synthetic marker, waits (giving a human operator a window to try
// physical keys), sends a second synthetic marker, disables exclusive
// mode, then waits again (giving the operator a window to confirm
// physical keys work again). Timestamped output so the transcript lines
// up with what the operator was asked to do at each phase.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().split("T")[1].replace("Z", "");

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "exclusive-session-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${ts()}] [${name}] -> ${text}`);
  return result;
}

await call("enable_input_control");

console.log(`[${ts()}] === PHASE 1: enabling exclusive mode (watchdogTimeoutMs=90000) ===`);
await call("enable_exclusive_input_mode", { watchdogTimeoutMs: 90000 });

await call("type_text", { text: "MARKER_BEFORE_" });

console.log(`[${ts()}] === PHASE 2: waiting 20s - TYPE ON THE PHYSICAL KEYBOARD NOW (should NOT appear) ===`);
await sleep(20000);

console.log(`[${ts()}] === PHASE 3: sending second synthetic marker to reconfirm still active ===`);
await call("type_text", { text: "_MARKER_STILL_ACTIVE" });

console.log(`[${ts()}] === PHASE 4: disabling exclusive mode ===`);
await call("disable_exclusive_input_mode");

await call("type_text", { text: "_MARKER_AFTER_DISABLE" });

console.log(`[${ts()}] === PHASE 5: waiting 15s - TYPE ON THE PHYSICAL KEYBOARD NOW (SHOULD appear this time) ===`);
await sleep(15000);

console.log(`[${ts()}] === DONE ===`);
await client.close();
process.exit(0);
