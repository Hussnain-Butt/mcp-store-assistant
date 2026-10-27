import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WRITES_ENABLED } from "./db.js";

const CATEGORIES = ["Kitchen", "Bedding", "Lighting", "Decor", "Bath", "Outdoor"] as const;
/** Orders that count as revenue. Pending, cancelled and refunded orders do not. */
const REVENUE_STATUSES = "('paid','shipped','delivered')";
const DAY = 24 * 60 * 60 * 1000;

const LOG_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "logs", "audit.log");

function audit(tool: string, args: unknown, ok: boolean, ms: number) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), tool, args, ok, ms }) + "\n");
  } catch {
    // Logging must never break a tool call.
  }
}

const money = (n: number) => Math.round(n * 100) / 100;
const since = (days: number) => new Date(Date.now() - days * DAY).toISOString();
/** "Olivia Carter" -> "Olivia C." so customer names are never fully exposed to the model. */
const maskName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
};

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Wraps a handler with timing, audit logging and a clean error message. */
function guarded<A>(name: string, fn: (args: A) => unknown) {
  return async (args: A) => {
    const start = Date.now();
    try {
      const data = fn(args);
      audit(name, args, true, Date.now() - start);
      return result(data);
    } catch (err) {
      audit(name, args, false, Date.now() - start);
      return failure(err instanceof Error ? err.message : "Unexpected error");
    }
  };
}

export function registerStoreTools(server: McpServer, db: DatabaseSync) {
  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Find products in the store catalogue by name, category, price or stock. Returns price, stock and units sold in the last 30 days.",
      inputSchema: {
        query: z.string().max(80).optional().describe("Words to look for in the product name, e.g. 'lamp'"),
        category: z.enum(CATEGORIES).optional(),
        max_price: z.number().positive().max(100000).optional().describe("Only products at or below this price (USD)"),
        in_stock_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(25).default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("search_products", ({ query, category, max_price, in_stock_only, limit }) => {
      const where: string[] = [];
      const params: Array<string | number> = [since(30)];
      if (query) {
        where.push("p.name LIKE ? ESCAPE '\\'");
        params.push(`%${query.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
      }
      if (category) { where.push("p.category = ?"); params.push(category); }
      if (max_price !== undefined) { where.push("p.price <= ?"); params.push(max_price); }
      if (in_stock_only) where.push("p.stock > 0");
      params.push(limit);
      const rows = db.prepare(`
        SELECT p.sku, p.name, p.category, p.price, p.stock,
               COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUSES} THEN oi.quantity END), 0) AS sold_30d
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o ON o.id = oi.order_id AND o.created_at >= ?
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        GROUP BY p.id
        ORDER BY sold_30d DESC, p.name
        LIMIT ?`).all(...params);
      return { count: rows.length, products: rows };
    }),
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order details",
      description: "Look up one order by its number: status, items, total, customer (name masked) and shipping/tracking details.",
      inputSchema: { order_id: z.number().int().positive().describe("Order number, e.g. 1042") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("get_order", ({ order_id }) => {
      const order = db.prepare(`
        SELECT o.id, o.status, o.created_at, o.total, c.name AS customer, c.city
        FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`).get(order_id) as
        | { id: number; status: string; created_at: string; total: number; customer: string; city: string }
        | undefined;
      if (!order) throw new Error(`Order ${order_id} was not found.`);
      const items = db.prepare(`
        SELECT p.sku, p.name, oi.quantity, oi.unit_price
        FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(order_id);
      const shipment = db.prepare("SELECT carrier, tracking, shipped_at, delivered_at FROM shipments WHERE order_id = ?").get(order_id) ?? null;
      return { ...order, customer: maskName(order.customer), items, shipment };
    }),
  );

  server.registerTool(
    "sales_report",
    {
      title: "Sales report",
      description: "Revenue, order count, average order value and units sold for the last N days, compared with the period before, broken down by day, week, category or product.",
      inputSchema: {
        days: z.number().int().min(1).max(60).default(30).describe("How many days back to report on"),
        group_by: z.enum(["day", "week", "category", "product"]).default("category"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("sales_report", ({ days, group_by }) => {
      const from = since(days);
      const prevFrom = since(days * 2);
      const totals = (start: string, end: string) =>
        db.prepare(`
          SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                 COALESCE(SUM(oi.quantity), 0) AS units
          FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE o.status IN ${REVENUE_STATUSES} AND o.created_at >= ? AND o.created_at < ?`).get(start, end) as
          { orders: number; revenue: number; units: number };
      const nowIso = new Date().toISOString();
      const cur = totals(from, nowIso);
      const prev = totals(prevFrom, from);
      const growth = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);

      const keyExpr = {
        day: "substr(o.created_at, 1, 10)",
        week: "strftime('%Y-W%W', o.created_at)",
        category: "p.category",
        product: "p.name",
      }[group_by];
      const orderBy = group_by === "day" || group_by === "week" ? "key" : "revenue DESC";
      const breakdown = db.prepare(`
        SELECT ${keyExpr} AS key, COUNT(DISTINCT o.id) AS orders,
               ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue, SUM(oi.quantity) AS units
        FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
        WHERE o.status IN ${REVENUE_STATUSES} AND o.created_at >= ?
        GROUP BY key ORDER BY ${orderBy} LIMIT 31`).all(from);

      return {
        period: { days, from: from.slice(0, 10), to: nowIso.slice(0, 10) },
        revenue: money(cur.revenue),
        orders: cur.orders,
        units_sold: cur.units,
        average_order_value: cur.orders ? money(cur.revenue / cur.orders) : 0,
        vs_previous_period: {
          revenue: money(prev.revenue),
          orders: prev.orders,
          revenue_growth_pct: growth(cur.revenue, prev.revenue),
          orders_growth_pct: growth(cur.orders, prev.orders),
        },
        group_by,
        breakdown,
        note: "Revenue counts paid, shipped and delivered orders. Pending, cancelled and refunded orders are excluded.",
      };
    }),
  );

  server.registerTool(
    "low_stock",
    {
      title: "Low stock alert",
      description: "Products at or below a stock threshold, with recent sales, estimated days of stock left and a suggested reorder quantity to cover 30 days.",
      inputSchema: { threshold: z.number().int().min(0).max(500).default(10) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("low_stock", ({ threshold }) => {
      const rows = db.prepare(`
        SELECT p.sku, p.name, p.category, p.stock,
               COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUSES} THEN oi.quantity END), 0) AS sold_30d
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o ON o.id = oi.order_id AND o.created_at >= ?
        WHERE p.stock <= ?
        GROUP BY p.id ORDER BY p.stock`).all(since(30), threshold) as Array<{ sku: string; name: string; category: string; stock: number; sold_30d: number }>;
      return {
        threshold,
        count: rows.length,
        products: rows.map((r) => {
          const perDay = r.sold_30d / 30;
          return {
            ...r,
            avg_daily_sales: Math.round(perDay * 100) / 100,
            days_of_stock_left: perDay > 0 ? Math.floor(r.stock / perDay) : null,
            suggested_reorder: Math.max(0, Math.ceil(perDay * 30) - r.stock),
          };
        }),
      };
    }),
  );

  server.registerTool(
    "top_customers",
    {
      title: "Top customers",
      description: "Customers who spent the most in the last N days. Names are masked and emails are never returned.",
      inputSchema: {
        days: z.number().int().min(1).max(120).default(90),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("top_customers", ({ days, limit }) => {
      const rows = db.prepare(`
        SELECT c.name, c.city, COUNT(o.id) AS orders, ROUND(SUM(o.total), 2) AS spent, MAX(o.created_at) AS last_order
        FROM customers c JOIN orders o ON o.customer_id = c.id
        WHERE o.status IN ${REVENUE_STATUSES} AND o.created_at >= ?
        GROUP BY c.id ORDER BY spent DESC LIMIT ?`).all(since(days), limit) as Array<{ name: string; city: string; orders: number; spent: number; last_order: string }>;
      return { days, customers: rows.map((r) => ({ ...r, name: maskName(r.name), last_order: r.last_order.slice(0, 10) })) };
    }),
  );

  // Write access is opt-in: the tool does not exist unless STORE_ALLOW_WRITES=true.
  if (WRITES_ENABLED) {
    server.registerTool(
      "update_stock",
      {
        title: "Update stock level",
        description: "Set the stock level of one product by SKU. Only available when the server runs with STORE_ALLOW_WRITES=true.",
        inputSchema: {
          sku: z.string().regex(/^CED-[A-Z]{3}-\d{3}$/).describe("Product SKU, e.g. CED-LIG-014"),
          new_stock: z.number().int().min(0).max(10000),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      guarded("update_stock", ({ sku, new_stock }) => {
        const before = db.prepare("SELECT name, stock FROM products WHERE sku = ?").get(sku) as { name: string; stock: number } | undefined;
        if (!before) throw new Error(`No product with SKU ${sku}.`);
        db.prepare("UPDATE products SET stock = ? WHERE sku = ?").run(new_stock, sku);
        return { sku, name: before.name, previous_stock: before.stock, new_stock };
      }),
    );
  }
}
