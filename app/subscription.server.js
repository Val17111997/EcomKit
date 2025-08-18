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
    // COMPTAGE AUTOMATIQUE RÉEL avec approbation Shopify
    console.log(`[USAGE] 🚀 Comptage automatique activé (approbation Shopify obtenue)`);
    
    // Compte les commandes du mois via GraphQL
    const startDate = startOfMonth.toISOString().split('T')[0];
    const endDate = endOfMonth.toISOString().split('T')[0];
    
    const response = await admin.graphql(`
      query {
        orders(first: 250, query: "created_at:>=${startDate} created_at:<=${endDate}") {
          edges {
            node {
              id
              createdAt
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `);

    const json = await response.json();
    console.log(`[DEBUG] Réponse GraphQL orders reçue`);
    
    if (json?.data?.orders) {
      const edges = json.data.orders.edges || [];
      orderCount = edges.length;
      console.log(`[USAGE] ✅ ${orderCount} commandes trouvées pour la période`);
      
      // Gestion de la pagination si plus de 250 commandes
      let hasNextPage = json.data.orders.pageInfo?.hasNextPage;
      let lastCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      
      while (hasNextPage && lastCursor) {
        console.log(`[DEBUG] Pagination: récupération de la suite...`);
        
        const nextResponse = await admin.graphql(`
          query {
            orders(first: 250, after: "${lastCursor}", query: "created_at:>=${startDate} created_at:<=${endDate}") {
              edges {
                node {
                  id
                }
                cursor
              }
              pageInfo {
                hasNextPage
              }
            }
          }
        `);
        
        const nextJson = await nextResponse.json();
        
        if (nextJson?.data?.orders) {
          const nextEdges = nextJson.data.orders.edges || [];
          orderCount += nextEdges.length;
          hasNextPage = nextJson.data.orders.pageInfo?.hasNextPage;
          lastCursor = nextEdges.length > 0 ? nextEdges[nextEdges.length - 1].cursor : null;
          console.log(`[DEBUG] +${nextEdges.length} commandes, total: ${orderCount}`);
        } else {
          console.log(`[DEBUG] Fin de pagination`);
          break;
        }
      }
      
      console.log(`[USAGE] 🎯 TOTAL FINAL: ${orderCount} commandes pour ${startDate} à ${endDate}`);
      
    } else if (json?.errors) {
      console.error(`[ERROR] Erreurs GraphQL:`, json.errors);
      throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
    } else {
      console.error(`[ERROR] Structure de réponse inattendue:`, JSON.stringify(json, null, 2));
      throw new Error("Réponse GraphQL inattendue");
    }
    
  } catch (error) {
    console.error("Erreur comptage automatique:", error.message);
    
    // Fallback sur la valeur en base avec avertissement
    orderCount = usage.orderCount || 0;
    console.warn(`[USAGE] ⚠️  FALLBACK: Utilisation valeur en base: ${orderCount}`);
    console.warn(`[USAGE] ⚠️  Cause: ${error.message}`);
    console.warn(`[USAGE] ⚠️  Vérifiez que l'app a bien été réinstallée après approbation`);
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