// Positions the cursor and scrolls, all within one process/connection.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , xArg, yArg, deltaArg] = process.argv;
const x = Number(xArg);
const y = Number(yArg);
const delta = Number(deltaArg);

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "wheel-scroll-once", version: "0.0.1" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`[${name} ${JSON.stringify(args)}] -> ${result.content?.[0]?.text ?? ""}`);
}

await call("enable_input_control");
await call("mouse_move", { x, y, absolute: true });
await call("mouse_wheel", { delta });

await client.close();
process.exit(0);
