import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "jis-layout-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`[${name}] -> ${text}`);
  return result;
}

await call("enable_input_control");

console.log("=== auto-detect check ===");
await call("type_text", { text: "AUTO=", layout: "auto" });

console.log("=== digit-row shift symbols (JIS) ===");
await call("type_text", { text: "!\"#$%&'()", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== minus/equal (JIS) ===");
await call("type_text", { text: "-^=~", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== brackets (JIS) ===");
await call("type_text", { text: "@[`{", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== backslash-position key (JIS) ===");
await call("type_text", { text: "]}", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== semicolon/quote (JIS) ===");
await call("type_text", { text: ";:+*", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== comma/period/slash (JIS, expected same as US) ===");
await call("type_text", { text: ",.<>?/", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== IntlRo (JIS-only key, no US equivalent) ===");
await call("type_text", { text: "\\_", layout: "jis" });
await call("press_key", { key: "Enter" });

console.log("=== IntlYen (JIS-only key, no US equivalent) ===");
await call("type_text", { text: "¥|", layout: "jis" });

await client.close();
process.exit(0);
