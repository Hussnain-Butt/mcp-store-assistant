#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DB_PATH, WRITES_ENABLED, openDatabase } from "./db.js";
import { registerStoreTools } from "./tools.js";

const db = openDatabase();

const server = new McpServer({ name: "store-assistant", version: "1.0.0" });

registerStoreTools(server, db);

server.registerResource(
  "store-schema",
  "store://schema",
  {
    title: "Store database schema",
    description: "Tables and columns available to the store tools",
    mimeType: "text/plain",
  },
  async (uri) => {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string; sql: string }>;
    return { contents: [{ uri: uri.href, text: tables.map((t) => t.sql).join("\n\n") }] };
  },
);

server.registerPrompt(
  "weekly_review",
  {
    title: "Weekly business review",
    description: "Ask Claude for a weekly review of sales, stock and customers",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Using the store tools, write a short weekly business review for the owner: " +
            "1) revenue and orders for the last 7 days compared with the week before, " +
            "2) the best and worst categories, " +
            "3) products that need reordering, with quantities, " +
            "4) our top 3 customers this month. Keep it under 200 words and end with 3 recommended actions.",
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is reserved for the MCP protocol, so status messages go to stderr.
console.error(`store-assistant MCP server running (db: ${DB_PATH}, writes: ${WRITES_ENABLED ? "ON" : "off"})`);

const shutdown = () => {
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
