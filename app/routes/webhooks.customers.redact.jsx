// app/routes/webhooks.customers.redact.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  console.log("CUSTOMERS_REDACT webhook received for shop:", shop);
  console.log("Customer ID:", payload.customer?.id);
  
  // TODO: Implémenter la suppression des données client
  // Si vous avez besoin de la DB, importez-la ici dans l'action uniquement:
  // const db = await import("../db.server").then(m => m.default);
  
  throw new Response();
};