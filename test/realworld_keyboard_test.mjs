// Real-hardware manual test: drives the MCP server end-to-end against the
// actually-installed OpenInputBridge driver. Not an automated CI test (no
// assertions) - prints results for the operator/agent to cross-check
// against what actually happened on screen (Notepad content, cursor
// position). See test/REALWORLD_TESTING.md for the full test log.
//
// IMPORTANT: text here deliberately avoids symbols known to differ between
// US and JIS keyboard layouts (see REALWORLD_TESTING.md's JIS-layout
// finding) - this run isolates the focus-targeting fix from that separate,
// already-confirmed issue.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "realworld-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name}] isError=${result.isError ?? false} -> ${text}`);
  return result;
}

console.log("=== get_driver_status ===");
await call("get_driver_status");

console.log("=== enable_input_control ===");
await call("enable_input_control");

console.log("=== type_text (line 1, layout-safe chars only) ===");
await call("type_text", { text: "OpenInputBridge MCP real hardware test 12345" });

console.log("=== press_key Enter ===");
await call("press_key", { key: "Enter" });

console.log("=== type_text (line 2, mixed case) ===");
await call("type_text", { text: "Second line UPPER lower MiXeD 13579" });

console.log("=== press_key Enter ===");
await call("press_key", { key: "Enter" });

console.log("=== key_down/key_up modifier test: hold ShiftLeft, press KeyA, release, press KeyB ===");
await call("key_down", { key: "ShiftLeft" });
await call("press_key", { key: "KeyA" });
await call("key_up", { key: "ShiftLeft" });
await call("press_key", { key: "KeyB" });
console.log('(expect "Ab" appended - held-shift A uppercase, released-shift B lowercase)');

console.log("=== press_key Enter ===");
await call("press_key", { key: "Enter" });

console.log("=== mouse_move relative (+100, +50) ===");
await call("mouse_move", { x: 100, y: 50, absolute: false });

console.log("=== mouse_move absolute (~screen center, normalized 0-65535) ===");
await call("mouse_move", { x: 32768, y: 32768, absolute: true });

console.log("=== mouse_wheel (scroll down 3 notches) ===");
await call("mouse_wheel", { delta: -360 });

console.log("=== get_exclusive_mode_status (sanity check, should be inactive) ===");
await call("get_exclusive_mode_status");

await client.close();
process.exit(0);
