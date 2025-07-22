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
              console.log(`[WEBHOOK] Sessions supprimées pour ${shop}`);
            } catch (error) {
              console.error(`[WEBHOOK] Erreur suppression sessions: ${error.message}`);
            }
          }
          break;
  
        case "ORDERS_CREATE":
          try {
            await db.usageSubscription.update({
              where: { shop },
              data: { orderCount: { increment: 1 } },
            });
          } catch (error) {
            console.error(`[WEBHOOK] Erreur incrément commande: ${error.message}`);
          }
          break;
  
        case "APP_SUBSCRIPTIONS_BILLING_CYCLE_RENEWED":
          try {
            const usage = await db.usageSubscription.findUnique({ where: { shop } });
            if (usage) {
              let price = 0;
              let description = "";
              if (usage.orderCount > 300) {
                price = 39.90;
                description = `Facturation Premium – ${usage.orderCount} commandes sur le cycle`;
              } else if (usage.orderCount > 30) {
                price = 19.90;
                description = `Facturation Standard – ${usage.orderCount} commandes sur le cycle`;
              }
              if (price > 0) {
                await admin.graphql(`\n        mutation {\n          appUsageRecordCreate(subscriptionLineItemId: "${usage.lineItemId}", price: { amount: ${price}, currencyCode: EUR }, description: "${description}") {\n            userErrors { field message }\n          }\n        }\n      `);
              }
              await db.usageSubscription.update({
                where: { shop },
                data: { orderCount: 0, cycleStart: new Date() },
              });
            }
          } catch (error) {
            console.error(`[WEBHOOK] Erreur cycle: ${error.message}`);
          }
          break;
          
        case "APP_SUBSCRIPTIONS_UPDATE":
          console.log(`[WEBHOOK] Mise à jour abonnement:`, payload.app_subscription);
          
          try {
            const subscriptionStatus = payload.app_subscription.status;
            const subscriptionId = payload.app_subscription.id;
            
            console.log(`[WEBHOOK] Abonnement ${subscriptionId} -> ${subscriptionStatus}`);
            
            // Ici vous pouvez mettre à jour votre base de données si nécessaire
            // Par exemple, désactiver des fonctionnalités si l'abonnement est annulé
            
            if (subscriptionStatus === "CANCELLED" || subscriptionStatus === "EXPIRED") {
              console.log(`[WEBHOOK] Abonnement ${subscriptionStatus} - fonctionnalités à désactiver`);
              // TODO: Désactiver les fonctionnalités de l'app pour ce shop
            } else if (subscriptionStatus === "ACTIVE") {
              console.log(`[WEBHOOK] Abonnement ACTIF - fonctionnalités activées`);
              // TODO: Activer les fonctionnalités de l'app pour ce shop
            }
            
          } catch (error) {
            console.error(`[WEBHOOK] Erreur traitement abonnement: ${error.message}`);
          }
          break;
          
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