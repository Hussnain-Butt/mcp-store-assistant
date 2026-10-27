import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DB_PATH = resolve(process.env.STORE_DB_PATH ?? resolve(projectRoot, "data", "store.db"));

/** Writes are off unless the operator explicitly turns them on. */
export const WRITES_ENABLED = process.env.STORE_ALLOW_WRITES === "true";

export function openDatabase(options: { forSeeding?: boolean } = {}): DatabaseSync {
  if (options.forSeeding) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    return new DatabaseSync(DB_PATH);
  }
  if (!existsSync(DB_PATH)) {
    throw new Error(`Database not found at ${DB_PATH}. Run "npm run seed" first.`);
  }
  // Open read-only by default, so a tool can never change data by accident.
  return new DatabaseSync(DB_PATH, { readOnly: !WRITES_ENABLED });
}

export const SCHEMA_SQL = `
CREATE TABLE products (
  id          INTEGER PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       REAL NOT NULL,
  stock       INTEGER NOT NULL
);
CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  city        TEXT NOT NULL,
  joined_at   TEXT NOT NULL
);
CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','delivered','cancelled','refunded')),
  created_at  TEXT NOT NULL,
  total       REAL NOT NULL
);
CREATE TABLE order_items (
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL,
  unit_price  REAL NOT NULL
);
CREATE TABLE shipments (
  order_id    INTEGER PRIMARY KEY REFERENCES orders(id),
  carrier     TEXT NOT NULL,
  tracking    TEXT NOT NULL,
  shipped_at  TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_items_product ON order_items(product_id);
`;
