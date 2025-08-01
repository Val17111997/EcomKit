import prisma from "./db.server";

export async function processMonthlyUsage(admin, shop, existingUsage) {
  let usage = existingUsage;
  if (!usage) {
    usage = await prisma.usageSubscription.findFirst({
      where: { shop, status: "ACTIVE" },
    });
  } else {
    usage = await prisma.usageSubscription.findFirst({ 
      where: { subscriptionId: existingUsage.subscriptionId } 
    });
  }
  if (!usage) return null;

  // Compte les commandes Shopify pour le mois courant
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

  let orderCount = 0;
  
  try {
    // Debug complet de la structure admin
    console.log(`[DEBUG] Type admin:`, typeof admin);
    console.log(`[DEBUG] Admin keys:`, Object.keys(admin || {}));
    console.log(`[DEBUG] Admin.session exists:`, !!admin.session);
    if (admin.session) {
      console.log(`[DEBUG] Session keys:`, Object.keys(admin.session || {}));
      console.log(`[DEBUG] Session.accessToken exists:`, !!admin.session.accessToken);
    }
    
    // Essaie différentes façons d'accéder à l'access token
    const accessToken = admin.session?.accessToken || 
                       admin.accessToken || 
                       admin.session?.token ||
                       admin.token;
    
    if (!accessToken) {
      // Si pas d'access token, essaie d'utiliser l'admin directement avec GraphQL
      console.log(`[DEBUG] Pas d'access token, essai GraphQL direct...`);
      
      const response = await admin.graphql(`
        query {
          shop {
            name
            id
          }
        }
      `);
      
      const json = await response.json();
      if (json?.data?.shop) {
        console.log(`[DEBUG] GraphQL fonctionne, shop: ${json.data.shop.name}`);
        
        // Essaie de compter via GraphQL (sans données protégées)
        const countResponse = await admin.graphql(`
          query {
            orders(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        `);
        
        const countJson = await countResponse.json();
        if (countJson?.data?.orders) {
          console.log(`[DEBUG] Accès GraphQL orders possible !`);
          // Si ça marche, on peut compter avec GraphQL
          throw new Error("GraphQL orders accessible mais besoin de pagination");
        } else {
          throw new Error("GraphQL orders bloqué - données protégées");
        }
      } else {
        throw new Error("GraphQL ne fonctionne pas du tout");
      }
    }
    
    console.log(`[DEBUG] Access token trouvé, longueur: ${accessToken.length}`);
    
    // Utilise l'API REST count
    const countResponse = await fetch(
      `https://${shop}/admin/api/2025-01/orders/count.json?status=any&created_at_min=${startOfMonth.toISOString()}&created_at_max=${endOfMonth.toISOString()}`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`[DEBUG] REST API response status: ${countResponse.status}`);
    
    if (countResponse.ok) {
      const countData = await countResponse.json();
      orderCount = countData.count || 0;
      console.log(`[USAGE] ✅ Commandes comptées via REST API: ${orderCount}`);
    } else {
      const errorText = await countResponse.text();
      console.error(`[DEBUG] REST API error: ${countResponse.status} - ${errorText}`);
      throw new Error(`REST API failed: ${countResponse.status} - ${errorText}`);
    }
    
  } catch (restError) {
    console.error("Erreur API REST count:", restError.message);
    
    // Fallback ultime : valeur en base avec avertissement clair
    orderCount = usage.orderCount || 0;
    console.warn(`[USAGE] ⚠️  IMPOSSIBLE DE COMPTER LES COMMANDES AUTOMATIQUEMENT`);
    console.warn(`[USAGE] ⚠️  Cause: ${restError.message}`);
    console.warn(`[USAGE] ⚠️  Utilisation valeur en base: ${orderCount}`);
    console.warn(`[USAGE] ⚠️  ACTION REQUISE: Vérifier les scopes (read_orders) ou demander approbation données protégées`);
  }

  const cycle = new Date(usage.cycleStart);
  // Si déjà facturé ce mois-ci, on skippe
  if (
    cycle.getUTCFullYear() === now.getUTCFullYear() &&
    cycle.getUTCMonth() === now.getUTCMonth()
  ) {
    return usage;
  }

  let amount = 0;
  if (orderCount > 300) amount = 39.9;
  else if (orderCount > 30) amount = 19.9;

  if (amount > 0) {
    try {
      const response = await admin.graphql(
        `mutation usage($id: ID!, $price: MoneyInput!) {
          appUsageRecordCreate(
            subscriptionLineItemId: $id,
            description: "Monthly usage",
            price: $price
          ) {
            userErrors { field message }
          }
        }`,
        { variables: { id: usage.lineItemId, price: { amount, currencyCode: "EUR" } } }
      );
      const json = await response.json();
      const errors = json?.data?.appUsageRecordCreate?.userErrors;
      if (errors?.length) {
        console.error(
          "[USAGE] Erreurs création usage:",
          errors.map((e) => e.message).join(", ")
        );
      }
    } catch (err) {
      console.error("Erreur facturation usage:", err);
    }
  }

  // Mets à jour la base uniquement pour garder une trace (optionnel)
  return await prisma.usageSubscription.update({
    where: { id: usage.id }, // Utilise l'id auto-increment pour l'update
    data: { orderCount, cycleStart: now },
  });
}

// Check if the shop has an active subscription. If not, create a new one and return the confirmation URL.
export async function ensureActiveSubscription(admin, shop) {
  // 1. CHECK LIVE CÔTÉ SHOPIFY EN PREMIER (correction du bug de boucle)
  try {
    const res = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            status
            lineItems { id }
          }
        }
      }
    `);
    const json = await res.json();
    const activeShopify = json?.data?.currentAppInstallation?.activeSubscriptions?.find(
      sub => sub.status === "ACTIVE"
    );
    
    if (activeShopify) {
      console.log("[SUBSCRIPTION] Abonnement actif trouvé côté Shopify, synchronisation de la base");
      // Cherche d'abord s'il existe déjà un enregistrement pour ce shop avec cet abonnement
      const existing = await prisma.usageSubscription.findFirst({
        where: { 
          shop,
          subscriptionId: activeShopify.id 
        }
      });

      if (existing) {
        await prisma.usageSubscription.update({
          where: { id: existing.id }, // Utilise l'id auto-increment
          data: {
            status: "ACTIVE",
            confirmationUrl: null,
            lineItemId: activeShopify.lineItems[0].id,
          }
        });
      } else {
        await prisma.usageSubscription.create({
          data: {
            shop,
            subscriptionId: activeShopify.id,
            lineItemId: activeShopify.lineItems[0].id,
            status: "ACTIVE",
            confirmationUrl: null,
            cycleStart: new Date(),
          }
        });
      }
      
      // Annule tous les autres abonnements pour ce shop
      await prisma.usageSubscription.updateMany({
        where: { 
          shop, 
          subscriptionId: { not: activeShopify.id }
        },
        data: { status: "CANCELLED", confirmationUrl: null },
      });
      
      await processMonthlyUsage(admin, shop, { ...activeShopify, shop });
      return { active: true };
    }
  } catch (err) {
    console.error("Erreur check live subscription Shopify:", err);
    // Continue avec la logique basée sur la DB en cas d'erreur
  }

  // 2. Check en base locale (logique existante)
  const active = await prisma.usageSubscription.findFirst({
    where: { shop, status: "ACTIVE" },
  });

  if (active && !active.confirmationUrl) {
    await processMonthlyUsage(admin, shop, active);
    return { active: true };
  }

  // 3. Gestion des abonnements PENDING
  let pending = await prisma.usageSubscription.findFirst({
    where: { shop, status: "PENDING" },
    orderBy: { id: "desc" },
  });

  let subscriptionStatus = null;
  if (pending) {
    try {
      const check = await admin.graphql(
        `query($id: ID!) { node(id: $id) { ... on AppSubscription { status } } }`,
        { variables: { id: pending.subscriptionId } }
      );
      const checkJson = await check.json();
      subscriptionStatus = checkJson?.data?.node?.status;
    } catch (err) {
      console.error("Erreur vérification abonnement:", err);
    }
  }

  if (pending && subscriptionStatus === "ACTIVE") {
    await prisma.usageSubscription.update({
      where: { id: pending.id }, // Utilise l'id auto-increment
      data: { status: "ACTIVE", confirmationUrl: null },
    });
    await prisma.usageSubscription.updateMany({
      where: { shop, id: { not: pending.id } }, // Utilise l'id auto-increment
      data: { status: "CANCELLED", confirmationUrl: null },
    });
    await processMonthlyUsage(admin, shop, pending);
    return { active: true };
  }

  if (pending && subscriptionStatus === "PENDING") {
    if (pending.confirmationUrl) {
      return { confirmationUrl: pending.confirmationUrl };
    }
  }

  // 4. Nettoyage des abonnements obsolètes
  if (pending) {
    await prisma.usageSubscription.update({
      where: { id: pending.id }, // Utilise l'id auto-increment
      data: { status: "CANCELLED", confirmationUrl: null },
    });
  }

  // 5. Création d'un nouvel abonnement
  try {
    const returnUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    const result = await admin.graphql(
        `mutation createSub($returnUrl: URL!) {
          appSubscriptionCreate(
            name: "Abonnement commandes mensuelles",
            returnUrl: $returnUrl,
            lineItems: [{ plan: { appUsagePricingDetails: {
              cappedAmount: { amount: 39.90, currencyCode: EUR }
              terms: "Gratuit jusqu'à 30 commandes/mois. 31 à 300 commandes/mois : 19,90 €. Plus de 300 commandes/mois : 39,90 €."
            } } }],
            trialDays: 7
          ) {
            confirmationUrl
            appSubscription { id lineItems { id } }
            userErrors { field message }
          }
        }`,
        { variables: { returnUrl } }
      );

    const data = await result.json();
    const payload = data.data.appSubscriptionCreate;
    console.log("[SUBSCRIPTION] Payload retour mutation:", payload);
    
    if (payload.userErrors?.length) {
      return { error: payload.userErrors.map((e) => e.message).join(", ") };
    }

    console.log("[SUBSCRIPTION] Avant creation en base");
    await prisma.usageSubscription.create({
      data: {
        shop,
        subscriptionId: payload.appSubscription.id,
        lineItemId: payload.appSubscription.lineItems[0].id,
        status: "PENDING",
        confirmationUrl: payload.confirmationUrl,
        cycleStart: new Date(),
      },
    });
    console.log("[SUBSCRIPTION] Apres creation en base");

    return { confirmationUrl: payload.confirmationUrl };
  } catch (createErr) {
    console.error("Erreur création abonnement:", createErr);
    return { error: "Impossible de créer l'abonnement." };
  }
}