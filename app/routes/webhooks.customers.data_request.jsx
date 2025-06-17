// app/routes/webhooks.customers.data_request.jsx
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  if (!admin) {
    // The admin context isn't returned if the webhook fired after a shop was uninstalled.
    throw new Response();
  }

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      console.log("Received CUSTOMERS_DATA_REQUEST webhook");
      
      // Log the data request for compliance
      const dataRequest = {
        shop_domain: shop,
        customer_id: payload.customer?.id,
        orders_requested: payload.orders_requested || [],
        requested_at: new Date().toISOString(),
        webhook_payload: JSON.stringify(payload)
      };
      
      console.log("Customer data request:", dataRequest);
      
      // TODO: Implement your data collection logic here
      // You should collect all customer data from your app's database
      // and prepare it for delivery to the customer
      
      break;
    case "CUSTOMERS_REDACT":
      console.log("Received CUSTOMERS_REDACT webhook");
      
      // Delete customer data from your app's database
      const customerId = payload.customer?.id;
      if (customerId) {
        // TODO: Delete customer data from your database
        console.log(`Deleting data for customer: ${customerId}`);
        
        // Example: await db.customerData.deleteMany({
        //   where: { shopify_customer_id: customerId }
        // });
      }
      
      break;
    case "SHOP_REDACT":
      console.log("Received SHOP_REDACT webhook");
      
      // Delete shop data 48 hours after shop uninstallation
      const shopDomain = payload.shop_domain;
      if (shopDomain) {
        // TODO: Delete all shop data from your database
        console.log(`Deleting all data for shop: ${shopDomain}`);
        
        // Example: await db.shopData.deleteMany({
        //   where: { shop_domain: shopDomain }
        // });
      }
      
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};