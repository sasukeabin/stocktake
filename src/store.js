import fs from "fs";
import path from "path";

const dataDir = path.resolve("data");
const stocktakesPath = path.join(dataDir, "stocktakes.json");

function ensureStore() {
  fs.mkdirSync(dataDir, {recursive: true});
  if (!fs.existsSync(stocktakesPath)) fs.writeFileSync(stocktakesPath, "[]", "utf8");
}

export function readStocktakes() {
  ensureStore();
  return JSON.parse(fs.readFileSync(stocktakesPath, "utf8"));
}

export function saveStocktake(stocktake) {
  const stocktakes = readStocktakes();
  const saved = {
    id: stocktake.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    shop: stocktake.shop,
    name: stocktake.name || `Stocktake ${new Date().toLocaleDateString()}`,
    locationId: stocktake.locationId,
    lines: stocktake.lines || [],
    createdAt: stocktake.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const index = stocktakes.findIndex((entry) => entry.id === saved.id && entry.shop === saved.shop);
  if (index >= 0) stocktakes[index] = saved;
  else stocktakes.push(saved);
  fs.writeFileSync(stocktakesPath, JSON.stringify(stocktakes, null, 2));
  return saved;
}

export function findStocktake(shop, id) {
  return readStocktakes().find((stocktake) => stocktake.shop === shop && stocktake.id === id);
}

export function csvForStocktake(stocktake) {
  const rows = [
    ["Stocktake", stocktake.name],
    ["Shop", stocktake.shop],
    ["Created", stocktake.createdAt],
    [],
    ["Barcode", "SKU", "Product", "Variant", "Shopify quantity", "Counted quantity", "Variance", "Inventory item ID", "Location ID"]
  ];

  for (const line of stocktake.lines) {
    rows.push([
      line.barcode || "",
      line.sku || "",
      line.productTitle || "",
      line.variantTitle || "",
      line.shopifyQuantity ?? "",
      line.countedQuantity ?? "",
      variance(line.shopifyQuantity, line.countedQuantity),
      line.inventoryItemId || "",
      stocktake.locationId || ""
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function variance(expected, counted) {
  const expectedNumber = Number(expected);
  const countedNumber = Number(counted);
  if (!Number.isFinite(expectedNumber) || !Number.isFinite(countedNumber)) return "";
  return countedNumber - expectedNumber;
}

function csvCell(value = "") {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
