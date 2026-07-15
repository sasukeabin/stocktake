import dotenv from "dotenv";
import express from "express";
import path from "path";
import {fileURLToPath} from "url";
import {adminClient, loadOfflineSession, shopify} from "./shopify.js";
import {csvForStocktake, findStocktake, saveStocktake} from "./store.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({limit: "10mb"}));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/auth", async (req, res) => {
  await shopify.auth.begin({
    shop: shopify.utils.sanitizeShop(req.query.shop, true),
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res
  });
});

app.get("/auth/callback", async (req, res) => {
  await shopify.auth.callback({
    rawRequest: req,
    rawResponse: res
  });
  res.redirect(`/?shop=${encodeURIComponent(req.query.shop)}`);
});

app.get("/api/locations", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const response = await adminClient(session).query({
    data: {
      query: `#graphql
        query Locations {
          locations(first: 50) {
            nodes {
              id
              name
            }
          }
        }`
    }
  });
  const json = await response.body;
  res.json(json.data.locations.nodes);
});

app.get("/api/lookup", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const code = String(req.query.code || "").trim();
  const locationId = String(req.query.locationId || "").trim();
  if (!code) return res.status(400).json({error: "Missing barcode or SKU"});

  const response = await adminClient(session).query({
    data: {
      query: `#graphql
        query VariantLookup($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              id
              title
              sku
              barcode
              product { title }
              inventoryItem {
                id
                inventoryLevels(first: 20) {
                  nodes {
                    location { id name }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }`,
      variables: {
        query: `barcode:${code} OR sku:${code}`
      }
    }
  });

  const json = await response.body;
  const variant = json.data.productVariants.nodes.find((node) => node.barcode === code || node.sku === code);
  if (!variant) return res.status(404).json({error: "No Shopify product matched this barcode or SKU"});

  const level = variant.inventoryItem.inventoryLevels.nodes.find((node) => node.location.id === locationId)
    || variant.inventoryItem.inventoryLevels.nodes[0];

  res.json({
    barcode: variant.barcode,
    sku: variant.sku,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    inventoryItemId: variant.inventoryItem.id,
    locationId: level?.location?.id || locationId,
    locationName: level?.location?.name || "",
    shopifyQuantity: level?.quantities?.[0]?.quantity ?? 0
  });
});

app.post("/api/stocktakes", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const saved = saveStocktake({
    shop: session.shop,
    name: req.body.name,
    locationId: req.body.locationId,
    lines: req.body.lines
  });
  res.json(saved);
});

app.get("/api/stocktakes/:id.csv", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const stocktake = findStocktake(session.shop, req.params.id);
  if (!stocktake) return res.status(404).send("Stocktake not found");

  res.header("Content-Type", "text/csv");
  res.attachment(`${stocktake.name.replace(/[^a-z0-9]+/gi, "-")}.csv`);
  res.send(csvForStocktake(stocktake));
});

app.post("/api/stocktakes/:id/apply", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const stocktake = findStocktake(session.shop, req.params.id);
  if (!stocktake) return res.status(404).json({error: "Stocktake not found"});

  const changes = stocktake.lines
    .map((line) => ({
      inventoryItemId: line.inventoryItemId,
      locationId: stocktake.locationId || line.locationId,
      delta: Number(line.countedQuantity) - Number(line.shopifyQuantity),
      changeFromQuantity: Number(line.shopifyQuantity)
    }))
    .filter((change) => change.inventoryItemId && change.locationId && Number.isFinite(change.delta) && change.delta !== 0);

  if (!changes.length) return res.json({message: "No inventory changes to apply"});

  const response = await adminClient(session).query({
    data: {
      query: `#graphql
        mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
          inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            userErrors { field message }
            inventoryAdjustmentGroup { id createdAt reason }
          }
        }`,
      variables: {
        idempotencyKey: `stocktake-${stocktake.id}`,
        input: {
          reason: "correction",
          name: "available",
          referenceDocumentUri: `bss-stocktake://${stocktake.id}`,
          changes
        }
      }
    }
  });

  const json = await response.body;
  res.json(json.data.inventoryAdjustQuantities);
});

async function requireSession(req, res) {
  const shop = shopify.utils.sanitizeShop(req.query.shop || req.header("x-shopify-shop-domain"), true);
  if (!shop) {
    res.status(401).json({error: "Missing shop"});
    return null;
  }

  const session = await loadOfflineSession(shop);
  if (!session) {
    res.status(401).json({authUrl: `/auth?shop=${encodeURIComponent(shop)}`});
    return null;
  }
  return session;
}

app.listen(port, () => {
  console.log(`BSS Shopify Stocktake app running on port ${port}`);
});
