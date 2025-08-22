import prisma from "./db.server";

export async function processMonthlyUsage(admin, shop, existingUsage) {
  let usage = existingUsage || await prisma.usageSubscription.findFirst({ where: { shop, status: "ACTIVE" } });
  
  // PATCH 2: Si usage ne vient pas de la DB (pas d'id numérique), on le recharge
  if (!usage || typeof usage.id !== "number") {
    usage = await prisma.usageSubscription.findFirst({ where: { shop, status: "ACTIVE" } });
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
    const startDate = startOfMonth.toISOString(); // 2025-08-01T00:00:00.000Z
    const endDate = endOfMonth.toISOString(); // 2025-08-31T23:59:59.000Z
    const queryString = `created_at:>=${startDate} created_at:<=${endDate} -status:cancelled -test:true (financial_status:paid OR financial_status:partially_paid)`;
    
    const response = await admin.graphql(`
      query OrdersCount($query: String!) {
        orders(first: 250, query: $query) {
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
    `, { variables: { query: queryString } });

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
          query OrdersNext($query: String!, $cursor: String!) {
            orders(first: 250, after: $cursor, query: $query) {
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
        `, { variables: { query: queryString, cursor: lastCursor } });
        
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

  // On met TOUJOURS à jour le compteur pour l'UI
  await prisma.usageSubscription.update({
    where: { id: usage.id },
    data: { orderCount },
  });

  // === NOUVELLE LOGIQUE FACTURATION PAR DELTA ===
  const TIERS = [
    { tier: 0, price: 0 },
    { tier: 1, price: 19.9 },
    { tier: 2, price: 39.9 },
  ];
  const pickTier = (n) => (n > 300 ? 2 : n > 30 ? 1 : 0);
  const periodKeyOf = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const periodKey = periodKeyOf(now);
  const currentTier = pickTier(orderCount);
  
  // 1) Récupère/initialise l'état du mois
  let state = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  if (!state) {
    state = await prisma.usageBillingState.create({
      data: { shop, periodKey, billedTier: 0, billedAmount: 0 },
    });
  }
  
  // 2) Si palier pas augmenté → rien à facturer
  if (currentTier <= state.billedTier) {
    return { ...usage, orderCount };
  }
  
  // 3) Calculer le DELTA à facturer (ex: 39.9 - 19.9 = 20.0)
  const delta = TIERS[currentTier].price - TIERS[state.billedTier].price;
  if (delta <= 0) {
    return { ...usage, orderCount };
  }
  
  // 4) Idempotence applicative pour éviter un double débit en cas de retry
  const idemKey = `${shop}:${periodKey}:${state.billedTier}->${currentTier}`;
  if (state.lastIdemKey === idemKey) {
    return { ...usage, orderCount };
  }
  
  // 5) Créer l'AppUsageRecord pour le delta uniquement
  try {
    const resp = await admin.graphql(
      `mutation usage($id: ID!, $price: MoneyInput!, $desc: String!) {
        appUsageRecordCreate(
          subscriptionLineItemId: $id,
          description: $desc,
          price: $price
        ) { userErrors { field message } }
      }`,
      {
        variables: {
          id: usage.lineItemId,
          price: { amount: delta, currencyCode: "EUR" },
          desc: `Monthly usage ${periodKey} — tier ${state.billedTier}→${currentTier} (+${delta.toFixed(2)}€)`,
        },
      }
    );
    const json = await resp.json();
    const errors = json?.data?.appUsageRecordCreate?.userErrors;
    if (errors?.length) {
      console.error("[USAGE] create error:", errors.map(e => e.message).join(", "));
    } else {
      await prisma.$transaction([
        prisma.usageBillingState.update({
          where: { shop_periodKey: { shop, periodKey } },
          data: {
            billedTier: currentTier,
            billedAmount: state.billedAmount + delta,
            lastIdemKey: idemKey,
          },
        }),
        prisma.usageSubscription.update({
          where: { id: usage.id },
          data: { cycleStart: now }, // optionnel
        }),
      ]);
      console.log("[USAGE] 💸 billed delta €", delta, "tier", state.billedTier, "->", currentTier);
    }
  } catch (e) {
    console.error("bill delta error:", e);
  }
  
  const updatedUsage = await prisma.usageSubscription.findUnique({
    where: { id: usage.id }
  });
  return { ...updatedUsage, orderCount };
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
      
      // Utilise upsert pour éviter P2002 (Unique constraint failed)
      await prisma.usageSubscription.upsert({
        where: { subscriptionId: activeShopify.id },
        update: {
          status: "ACTIVE",
          confirmationUrl: null,
          lineItemId: activeShopify.lineItems[0].id,
          shop // s'assurer que le shop est correct
        },
        create: {
          shop,
          subscriptionId: activeShopify.id,
          lineItemId: activeShopify.lineItems[0].id,
          status: "ACTIVE"
          // Pas de cycleStart ici - sera défini après première facturation
        }
      });
      
      // Annule tous les autres abonnements pour ce shop
      await prisma.usageSubscription.updateMany({
        where: { 
          shop, 
          subscriptionId: { not: activeShopify.id }
        },
        data: { status: "CANCELLED", confirmationUrl: null },
      });
      
      // PATCH 1: Récupère l'enregistrement DB (id numérique) et PAS l'objet Shopify
      const dbUsage = await prisma.usageSubscription.findFirst({
        where: { shop, subscriptionId: activeShopify.id },
      });
      
      const res = await processMonthlyUsage(admin, shop, dbUsage);
      return { active: true, orderCount: res?.orderCount ?? null };
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
    const res = await processMonthlyUsage(admin, shop, active);
    return { active: true, orderCount: res?.orderCount ?? null };
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
    const res = await processMonthlyUsage(admin, shop, pending);
    return { active: true, orderCount: res?.orderCount ?? null };
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
        confirmationUrl: payload.confirmationUrl
        // Pas de cycleStart - sera défini après première facturation
      },
    });
    console.log("[SUBSCRIPTION] Apres creation en base");

    return { confirmationUrl: payload.confirmationUrl };
  } catch (createErr) {
    console.error("Erreur création abonnement:", createErr);
    return { error: "Impossible de créer l'abonnement." };
  }
}