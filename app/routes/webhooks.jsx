import { authenticate } from "../shopify.server";
import db from "../db.server";
import { processMonthlyUsage, ensureActiveSubscription } from "../subscription.server";

export const action = async ({ request }) => {
    try {
      const { topic, shop, session, admin, payload } = await authenticate.webhook(request);
      
      console.log(`[WEBHOOK] Reçu: ${topic} pour ${shop}`);
      
      if (!admin) {
        // L'admin context n'est pas retourné si le webhook arrive après désinstallation
        console.log("[WEBHOOK] Pas de contexte admin, probablement après désinstallation");
        return new Response("OK", { status: 200 });
      }
      
      switch (topic) {
        case "APP_UNINSTALLED":
          console.log(`[WEBHOOK] App désinstallée pour ${shop}`);
          if (session) {
            try {
              await db.session.deleteMany({ where: { shop } });
              await db.usageSubscription.deleteMany({ where: { shop } });
              console.log(`[WEBHOOK] Sessions et usage supprimés pour ${shop}`);
            } catch (error) {
              console.error(`[WEBHOOK] Erreur suppression données: ${error.message}`);
            }
          }
          break;
  
        case "ORDERS_CREATE":
          try {
            let usageSubscription = await db.usageSubscription.findFirst({
              where: { shop, status: "ACTIVE" },
            });

            if (!usageSubscription) {
              await ensureActiveSubscription(admin, shop);
              usageSubscription = await db.usageSubscription.findFirst({
                where: { shop, status: "ACTIVE" },
              });
            }

            if (!usageSubscription) {
              console.error(
                `[WEBHOOK] Impossible de trouver ou créer usageSubscription pour ${shop}`
              );
              break;
            }

            await processMonthlyUsage(admin, shop);
            await db.usageSubscription.update({
              where: { shop },
              data: { orderCount: { increment: 1 } },
            });
          } catch (error) {
            console.error(`[WEBHOOK] Erreur incrément commande: ${error.message}`);
          }
          break;
        case "APP_SUBSCRIPTIONS_UPDATE":
          try {
            const subscriptionStatus = payload.app_subscription.status;
            const subscriptionId = payload.app_subscription.id;

            console.log(`[WEBHOOK] Abonnement ${subscriptionId} -> ${subscriptionStatus}`);

            if (subscriptionStatus === "CANCELLED" || subscriptionStatus === "EXPIRED") {
              await db.usageSubscription.updateMany({
                where: { subscriptionId },
                data: { status: "CANCELLED", confirmationUrl: null },
              });
            } else if (subscriptionStatus === "ACTIVE") {
              await db.usageSubscription.updateMany({
                where: { subscriptionId },
                data: { status: "ACTIVE", confirmationUrl: null },
              });
              await db.usageSubscription.updateMany({
                where: { shop, subscriptionId: { not: subscriptionId } },
                data: { status: "CANCELLED", confirmationUrl: null },
              });
            }

          } catch (error) {
            console.error(`[WEBHOOK] Erreur traitement abonnement: ${error.message}`);
          }
          break;
          
        case "CUSTOMERS_DATA_REQUEST":
          console.log(`[WEBHOOK] Demande de données client pour ${shop}`);
          // Retourner les données client si vous en stockez
          break;
          
        case "CUSTOMERS_REDACT":
          console.log(`[WEBHOOK] Suppression données client pour ${shop}`);
          // Supprimer les données client si vous en stockez
          break;
          
        case "SHOP_REDACT":
          console.log(`[WEBHOOK] Suppression données shop pour ${shop}`);
          // Supprimer toutes les données liées à ce shop
          try {
            await db.session.deleteMany({ where: { shop } });
            console.log(`[WEBHOOK] Données shop supprimées pour ${shop}`);
          } catch (error) {
            console.error(`[WEBHOOK] Erreur suppression données shop: ${error.message}`);
          }
          break;
          
        default:
          console.log(`[WEBHOOK] Topic non géré: ${topic}`);
          return new Response("Unhandled webhook topic", { status: 404 });
      }
      
      console.log(`[WEBHOOK] ${topic} traité avec succès pour ${shop}`);
      return new Response("OK", { status: 200 });
      
    } catch (error) {
      console.error("[WEBHOOK] Erreur générale:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  };