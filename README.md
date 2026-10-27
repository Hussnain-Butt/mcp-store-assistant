# Store Assistant MCP Server

A secure [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude (or any MCP client, such as Cursor) to an online store's database. Ask questions in plain English and Claude answers from live data:

- "How did sales do this month compared with last month?"
- "Which products are about to run out, and how many should I reorder?"
- "Where is order 1042?"
- "Who are our best customers this quarter?"

It ships with a sample database for **Cedar & Co.**, a fictional home goods store with 36 products, 80 customers and 460 orders, so you can try it in two minutes.

## Tools

| Tool | What it does |
|---|---|
| `search_products` | Find products by name, category, price or stock, with units sold in the last 30 days |
| `get_order` | One order's status, items, total, masked customer name and tracking |
| `sales_report` | Revenue, orders, average order value and units for the last N days, compared with the period before, grouped by day, week, category or product |
| `low_stock` | Products below a threshold, with days of stock left and a suggested reorder quantity |
| `top_customers` | Best customers by spend, with masked names and no emails |
| `update_stock` | Set a product's stock. **Only exists when writes are enabled** (see below) |

It also provides a `store://schema` resource and a `weekly_review` prompt that asks Claude for a weekly business review.

## Security by design

- **Read-only by default.** The database is opened read-only, and the one write tool is not even registered unless you set `STORE_ALLOW_WRITES=true`.
- **No raw SQL from the model.** Every tool runs a fixed, parameterised query, so the model cannot inject SQL.
- **Validated input.** Every argument is checked with Zod: types, ranges, string lengths and SKU format.
- **Privacy.** Customer names are masked ("Olivia C.") and emails are never returned.
- **Capped results.** Every list has a maximum size, so one call cannot dump a whole table.
- **Audit log.** Every tool call is written to `logs/audit.log` with its arguments, result and duration.
- **Tool annotations.** Read tools are marked `readOnlyHint`, and the write tool `destructiveHint`, so clients can ask for confirmation.

## Quick start

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm run build
npm run seed
npm test
```

### Use it in Claude Code

```bash
claude mcp add store-assistant -- node --disable-warning=ExperimentalWarning /absolute/path/to/mcp-store-demo/dist/index.js
```

### Use it in Claude Desktop

Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "store-assistant": {
      "command": "node",
      "args": ["--disable-warning=ExperimentalWarning", "/absolute/path/to/mcp-store-demo/dist/index.js"]
    }
  }
}
```

To allow stock updates, add `"env": { "STORE_ALLOW_WRITES": "true" }` to that entry.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `STORE_DB_PATH` | `data/store.db` | Path to the SQLite database |
| `STORE_ALLOW_WRITES` | `false` | Set to `true` to enable the `update_stock` tool |

## Adapting it to your store

The tools live in `src/tools.ts`. To connect a real store, point the queries at your own database (PostgreSQL, MySQL) or API (Shopify, WooCommerce, Stripe) and keep the same pattern: fixed queries, validated input, masked personal data and an audit log.

## Tests

- `npm test` starts the server over stdio, calls every tool and checks that the write tool is hidden.
- `npm run test:writes` enables writes, checks that a malicious SKU is rejected, updates one product, then reseeds the database.

## License

MIT
