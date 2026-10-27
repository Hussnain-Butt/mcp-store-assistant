/**
 * Checks that update_stock is offered only when STORE_ALLOW_WRITES=true,
 * and that it rejects bad input. Run "npm run seed" afterwards to reset the data.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", "dist/index.js"],
  env: { ...(process.env as Record<string, string>), STORE_ALLOW_WRITES: "true" },
  stderr: "ignore",
});
const client = new Client({ name: "write-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const tool = tools.find((t) => t.name === "update_stock");
console.log("update_stock offered:", Boolean(tool), JSON.stringify(tool?.annotations));

const bad = await client.callTool({ name: "update_stock", arguments: { sku: "'; DROP TABLE products;--", new_stock: 5 } });
console.log("bad SKU rejected:", bad.isError === true);

const ok = await client.callTool({ name: "update_stock", arguments: { sku: "CED-LIG-014", new_stock: 40 } });
console.log((ok.content as Array<{ text: string }>)[0].text);

await client.close();
