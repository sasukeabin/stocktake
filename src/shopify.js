import "@shopify/shopify-api/adapters/node";
import {shopifyApi} from "@shopify/shopify-api";
import {SQLiteSessionStorage} from "@shopify/shopify-app-session-storage-sqlite";
import dotenv from "dotenv";

dotenv.config();

const hostName = (process.env.HOST || "").replace(/^https?:\/\//, "");

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SCOPES || "read_products,read_inventory,write_inventory").split(","),
  hostName,
  apiVersion: "2026-07",
  isEmbeddedApp: true,
  sessionStorage: new SQLiteSessionStorage("./shopify-sessions.sqlite")
});

export async function loadOfflineSession(shop) {
  const sessionId = shopify.session.getOfflineId(shop);
  return shopify.config.sessionStorage.loadSession(sessionId);
}

export function adminClient(session) {
  return new shopify.clients.Graphql({session});
}
