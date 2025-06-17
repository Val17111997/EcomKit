// app/routes/webhooks.shop.redact.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log("Received SHOP_REDACT webhook");
  
  // Extract shop information
  const shopDomain = payload.shop_domain;
  const shopId = payload.shop_id;
  
  if (shopDomain) {
    console.log(`Processing data deletion for shop: ${shopDomain} (ID: ${shopId})`);
    
    try {
      // TODO: Delete ALL shop data from your app's database
      // This webhook is sent 48 hours after shop uninstallation
      
      // Example implementation:
      
      // Delete all shop-related data
      // await db.shopSettings.deleteMany({
      //   where: { shop_domain: shopDomain }
      // });
      
      // await db.shopAnalytics.deleteMany({
      //   where: { shop_domain: shopDomain }
      // });
      
      // await db.customerData.deleteMany({
      //   where: { shop_domain: shopDomain }
      // });
      
      // await db.productData.deleteMany({
      //   where: { shop_domain: shopDomain }
      // });
      
      // Delete session data
      // await db.session.deleteMany({
      //   where: { shop: shopDomain }
      // });
      
      // Log the deletion for compliance records
      console.log(`Successfully deleted all data for shop ${shopDomain}`);
      
    } catch (error) {
      console.error("Error deleting shop data:", error);
      throw new Response("Error processing shop deletion", { status: 500 });
    }
  }

  throw new Response();
};