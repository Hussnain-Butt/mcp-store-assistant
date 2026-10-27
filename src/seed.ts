/**
 * Builds data/store.db with realistic sample data for "Cedar & Co.", a fictional
 * online home goods store. The data is generated from a fixed seed, and dates are
 * relative to today, so the demo always has recent sales to talk about.
 */
import { existsSync, rmSync } from "node:fs";
import { DB_PATH, SCHEMA_SQL, openDatabase } from "./db.js";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261027);
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const PRODUCTS: Array<[string, string, number]> = [
  ["Stoneware Dinner Plate Set", "Kitchen", 64],
  ["Cast Iron Skillet 26cm", "Kitchen", 48],
  ["Olive Wood Serving Board", "Kitchen", 36],
  ["Glass Pour-Over Coffee Maker", "Kitchen", 42],
  ["Linen Apron", "Kitchen", 28],
  ["Ceramic Mixing Bowls (3)", "Kitchen", 54],
  ["Stonewashed Linen Duvet Cover", "Bedding", 149],
  ["Organic Cotton Sheet Set", "Bedding", 119],
  ["Waffle Knit Throw Blanket", "Bedding", 79],
  ["Down Alternative Pillow", "Bedding", 45],
  ["Merino Wool Blanket", "Bedding", 189],
  ["Silk Pillowcase", "Bedding", 58],
  ["Rattan Pendant Light", "Lighting", 129],
  ["Brass Table Lamp", "Lighting", 98],
  ["Paper Floor Lamp", "Lighting", 115],
  ["Beeswax Taper Candles (6)", "Lighting", 22],
  ["Smart LED Bulb Pack", "Lighting", 39],
  ["Jute Area Rug 160x230", "Decor", 210],
  ["Handwoven Wall Hanging", "Decor", 74],
  ["Terracotta Planter Large", "Decor", 46],
  ["Oak Picture Frame Set", "Decor", 52],
  ["Ribbed Glass Vase", "Decor", 34],
  ["Boucle Cushion Cover", "Decor", 38],
  ["Turkish Cotton Bath Towel", "Bath", 32],
  ["Bamboo Bath Mat", "Bath", 29],
  ["Ceramic Soap Dispenser", "Bath", 24],
  ["Waffle Bathrobe", "Bath", 89],
  ["Linen Shower Curtain", "Bath", 68],
  ["Teak Outdoor Side Table", "Outdoor", 165],
  ["Acacia Folding Chair", "Outdoor", 95],
  ["Outdoor String Lights 10m", "Outdoor", 44],
  ["Woven Picnic Basket", "Outdoor", 72],
  ["Enamel Camping Mug Set", "Outdoor", 26],
  ["Solar Garden Lantern", "Outdoor", 31],
  ["Herb Garden Starter Kit", "Outdoor", 27],
  ["Weatherproof Floor Cushion", "Outdoor", 59],
];

const FIRST = ["Olivia", "Liam", "Amelia", "Noah", "Sofia", "Omar", "Hannah", "Ethan", "Aisha", "James", "Mia", "Lucas", "Fatima", "Daniel", "Grace", "Yusuf", "Chloe", "Ryan", "Zara", "Henry"];
const LAST = ["Carter", "Patel", "Nguyen", "Brooks", "Khan", "Murphy", "Rossi", "Hughes", "Ali", "Bennett", "Clarke", "Silva", "Ahmed", "Foster", "Turner"];
const CITIES = ["London", "Manchester", "New York", "Austin", "Toronto", "Dubai", "Sydney", "Chicago", "Bristol", "Seattle"];
const CARRIERS = ["DHL", "UPS", "FedEx", "Royal Mail"];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = openDatabase({ forSeeding: true });
db.exec(SCHEMA_SQL);
db.exec("BEGIN");

const insertProduct = db.prepare("INSERT INTO products (id, sku, name, category, price, stock) VALUES (?, ?, ?, ?, ?, ?)");
PRODUCTS.forEach(([name, category, price], i) => {
  const lowStock = [2, 8, 13, 20, 30].includes(i);
  const stock = lowStock ? between(1, 7) : between(18, 140);
  insertProduct.run(i + 1, `CED-${category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`, name, category, price, stock);
});

const insertCustomer = db.prepare("INSERT INTO customers (id, name, email, city, joined_at) VALUES (?, ?, ?, ?, ?)");
for (let id = 1; id <= 80; id++) {
  const first = pick(FIRST);
  const last = pick(LAST);
  insertCustomer.run(id, `${first} ${last}`, `${first}.${last}${id}@example.com`.toLowerCase(), pick(CITIES), iso(now - between(130, 700) * DAY));
}

const insertOrder = db.prepare("INSERT INTO orders (id, customer_id, status, created_at, total) VALUES (?, ?, ?, ?, ?)");
const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
const insertShipment = db.prepare("INSERT INTO shipments (order_id, carrier, tracking, shipped_at, delivered_at) VALUES (?, ?, ?, ?, ?)");

// Popular products sell more often.
const weights = PRODUCTS.map((_, i) => ([6, 7, 8, 12, 17, 23, 30].includes(i) ? 4 : 1));
const totalWeight = weights.reduce((a, b) => a + b, 0);
function pickProduct(): number {
  let r = rand() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i + 1;
  }
  return weights.length;
}

let orderId = 1001;
for (let n = 0; n < 460; n++, orderId++) {
  // More orders in recent weeks, as a growing store would see.
  const ageDays = Math.floor(Math.pow(rand(), 1.35) * 120);
  const createdAt = now - ageDays * DAY - between(0, 23) * 60 * 60 * 1000;
  let status: string;
  if (ageDays <= 1) status = pick(["pending", "paid", "paid"]);
  else if (ageDays <= 5) status = pick(["paid", "shipped", "shipped"]);
  else if (ageDays <= 10) status = pick(["shipped", "delivered", "delivered"]);
  else status = rand() < 0.05 ? pick(["cancelled", "refunded"]) : "delivered";

  const lines = new Map<number, number>();
  const count = between(1, 3);
  for (let k = 0; k < count; k++) {
    const pid = pickProduct();
    lines.set(pid, (lines.get(pid) ?? 0) + between(1, 2));
  }
  let total = 0;
  const items: Array<[number, number, number]> = [];
  for (const [pid, qty] of lines) {
    const price = PRODUCTS[pid - 1][2];
    total += price * qty;
    items.push([pid, qty, price]);
  }
  insertOrder.run(orderId, between(1, 80), status, iso(createdAt), Math.round(total * 100) / 100);
  for (const [pid, qty, price] of items) insertItem.run(orderId, pid, qty, price);

  if (status === "shipped" || status === "delivered") {
    const shippedAt = createdAt + between(1, 2) * DAY;
    const deliveredAt = status === "delivered" ? shippedAt + between(2, 5) * DAY : null;
    insertShipment.run(orderId, pick(CARRIERS), `TRK${between(10000000, 99999999)}`, iso(shippedAt), deliveredAt === null ? null : iso(deliveredAt));
  }
}

db.exec("COMMIT");
const summary = db.prepare("SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM orders) AS orders").get();
db.close();
console.log(`Seeded ${DB_PATH}`, summary);
