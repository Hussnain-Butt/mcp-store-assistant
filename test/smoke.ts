/**
 * Starts the built server over stdio, lists its tools and calls each one,
 * the same way Claude Desktop or Claude Code would.
 * Run: npm run build && npm test
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", "dist/index.js"],
  stderr: "ignore",
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "));

const calls: Array<[string, Record<string, unknown>]> = [
  ["search_products", { query: "lamp" }],
  ["sales_report", { days: 30, group_by: "category" }],
  ["low_stock", { threshold: 10 }],
  ["top_customers", { days: 90, limit: 3 }],
  ["get_order", { order_id: 1042 }],
  ["get_order", { order_id: 99999 }],
];

let failures = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  const expectError = name === "get_order" && args.order_id === 99999;
  const ok = expectError ? res.isError === true : !res.isError;
  if (!ok) failures++;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${name} ${JSON.stringify(args)}\n${text.slice(0, 600)}`);
}

// Writes are off by default, so update_stock must not be offered.
const writeExposed = tools.some((t) => t.name === "update_stock");
console.log(`\n[${writeExposed ? "FAIL" : "PASS"}] update_stock hidden when writes are off`);
if (writeExposed) failures++;

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
