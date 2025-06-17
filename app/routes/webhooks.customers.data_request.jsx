// app/routes/webhooks.customers.data_request.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  console.log("CUSTOMERS_DATA_REQUEST webhook received for shop:", shop);
  console.log("Customer ID:", payload.customer?.id);
  
  // TODO: Implémenter la logique de collecte des données client
  // Si vous avez besoin de la DB, importez-la ici dans l'action uniquement
  
  throw new Response();
};