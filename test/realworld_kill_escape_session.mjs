// Verifies the documented "process kill = guaranteed escape hatch" claim
// from SECURITY.md: while exclusive mode is active, forcibly killing
// oib_bridge.exe should cause the driver's own WDF file-close cleanup to
// detach it from the precedence chain and free its capture queue,
// restoring physical input - independent of any of our own disable/
// watchdog logic. This script only sets up the armed state and then
// idles; the actual kill happens externally (Stop-Process) partway
// through the idle window, and a human confirms physical input resumes.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().split("T")[1].replace("Z", "");

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "kill-escape-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${ts()}] [${name}] -> ${text}`);
  return result;
}

await call("enable_input_control");
console.log(`[${ts()}] === enabling exclusive mode (watchdogTimeoutMs=120000, long so it won't auto-expire first) ===`);
await call("enable_exclusive_input_mode", { watchdogTimeoutMs: 120000 });
await call("type_text", { text: "BEFORE_KILL_MARKER_" });

console.log(`[${ts()}] === now BLOCKED: idling 60s - kill oib_bridge.exe externally during this window ===`);
await sleep(60000);

console.log(`[${ts()}] === done idling (script exiting; if oib_bridge.exe was already killed this call will fail, which is fine) ===`);
try {
  await call("get_exclusive_mode_status");
} catch (err) {
  console.log(`[${ts()}] (expected if oib_bridge.exe was killed) error: ${err}`);
}
await client.close();
process.exit(0);
