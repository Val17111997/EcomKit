// app/subscription.server.js
import prisma from "./db.server";
import crypto from "crypto";

/* ----------------------------- helpers trial ----------------------------- */

async function getActiveSubscriptionWithTrial(admin) {
  const res = await admin.graphql(`#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          trialDays
          createdAt
          lineItems { id plan { pricingDetails { __typename } } }
        }
      }
    }
  `);
  const json = await res.json();
  return (
    json?.data?.currentAppInstallation?.activeSubscriptions?.find(
      (s) => s.status === "ACTIVE"
    ) || null
  );
}

// Calcule la date de fin d'essai à partir de createdAt + trialDays
function trialEndsAtFrom(sub) {
  if (!sub?.trialDays || sub.trialDays <= 0 || !sub?.createdAt) return null;
  const created = new Date(sub.createdAt);
  const ends = new Date(created);
  ends.setUTCDate(ends.getUTCDate() + sub.trialDays);
  return ends;
}

function isInTrial(activeSub) {
  const ends = trialEndsAtFrom(activeSub);
  return !!(ends && Date.now() < ends.getTime());
}

/* ---------------------------- helpers lock/throttle ---------------------------- */

// Lock atomique (updateMany conditionnel) + throttle
async function tryAcquireLock(shop, periodKey, throttleMs = 2 * 60 * 1000) {
  const now = new Date();

  // Throttle : si déjà traité il y a < throttleMs, on saute
  const row = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  if (
    row?.lastProcessedAt &&
    now.getTime() - new Date(row.lastProcessedAt).getTime() < throttleMs
  ) {
    return { acquired: false, reason: "throttled" };
  }

  // Tentative de lock atomique : ne pose le token que si processingToken est NULL/""
  const token = crypto.randomUUID();
  const res = await prisma.usageBillingState.updateMany({
    where: {
      shop,
      periodKey,
      OR: [{ processingToken: null }, { processingToken: "" }],
    },
    data: { processingToken: token, lastProcessedAt: now },
  });

  if (res.count === 1) return { acquired: true, token };
  return { acquired: false, reason: "locked" };
}

async function releaseLock(shop, periodKey, token) {
  // Libère uniquement si le lock est encore tenu par *ce* token
  await prisma.usageBillingState.updateMany({
    where: { shop, periodKey, processingToken: token },
    data: { processingToken: null },
  });
}

/* --------------------------- processMonthlyUsage --------------------------- */

/**
 * Compte et facture l'usage du mois courant (facture uniquement le DELTA de palier)
 * - Clamp l'usage au "remaining" du cap Shopify pour éviter les erreurs
 * - Continue d'utiliser usage.lineItemId (line item d'usage)
 */
export async function processMonthlyUsage(admin, shop, existingUsage) {
  let usage =
    existingUsage ||
    (await prisma.usageSubscription.findFirst({
      where: { shop, status: "ACTIVE" },
    }));

  // Sécurité : s'assurer qu'on a bien un enregistrement DB (id numérique)
  if (!usage || typeof usage.id !== "number") {
    usage = await prisma.usageSubscription.findFirst({
      where: { shop, status: "ACTIVE" },
    });
  }
  if (!usage) return null;

  // Fenêtre du mois courant en UTC
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const endOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)
  );

  // ====== A) STOP si essai en cours (aucune facturation d'usage) ======
  const activeSub = await getActiveSubscriptionWithTrial(admin);
  if (isInTrial(activeSub)) {
    console.log("[USAGE] ⏸ Essai en cours – aucune facturation d'usage.");
    // On met quand même à jour l'UI plus bas (orderCount), mais on ne mutera rien.
  }

  let orderCount = 0;

  // ====== 1) COMPTER LES COMMANDES ======
  try {
    console.log(`[USAGE] 🚀 Comptage automatique activé (approbation Shopify obtenue)`);

    const startDate = startOfMonth.toISOString();
    const endDate = endOfMonth.toISOString();
    // exclut test/cancelled, ne prend que paid/partially_paid
    const queryString = `created_at:>=${startDate} created_at:<=${endDate} -status:cancelled -test:true (financial_status:paid OR financial_status:partially_paid)`;

    // 1er batch
    const response = await admin.graphql(
      `#graphql
        query OrdersCount($query: String!) {
          orders(first: 250, query: $query) {
            edges { node { id createdAt } cursor }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query: queryString } }
    );
    const json = await response.json();
    console.log(`[DEBUG] Réponse GraphQL orders reçue`);

    if (json?.data?.orders) {
      const edges = json.data.orders.edges || [];
      orderCount = edges.length;
      console.log(`[USAGE] ✅ ${orderCount} commandes trouvées pour la période`);

      let hasNextPage = json.data.orders.pageInfo?.hasNextPage;
      let lastCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

      // Pagination
      while (hasNextPage && lastCursor) {
        console.log(`[DEBUG] Pagination: récupération de la suite...`);
        const nextResponse = await admin.graphql(
          `#graphql
            query OrdersNext($query: String!, $cursor: String!) {
              orders(first: 250, after: $cursor, query: $query) {
                edges { node { id } cursor }
                pageInfo { hasNextPage }
              }
            }`,
          { variables: { query: queryString, cursor: lastCursor } }
        );
        const nextJson = await nextResponse.json();
        if (nextJson?.data?.orders) {
          const nextEdges = nextJson.data.orders.edges || [];
          orderCount += nextEdges.length;
          hasNextPage = nextJson.data.orders.pageInfo?.hasNextPage;
          lastCursor =
            nextEdges.length > 0 ? nextEdges[nextEdges.length - 1].cursor : null;
          console.log(`[DEBUG] +${nextEdges.length} commandes, total: ${orderCount}`);
        } else {
          console.log(`[DEBUG] Fin de pagination`);
          break;
        }
      }

      console.log(
        `[USAGE] 🎯 TOTAL FINAL: ${orderCount} commandes pour ${startDate} à ${endDate}`
      );
    } else if (json?.errors) {
      console.error(`[ERROR] Erreurs GraphQL:`, json.errors);
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    } else {
      console.error(`[ERROR] Structure de réponse inattendue:`, JSON.stringify(json, null, 2));
      throw new Error("Réponse GraphQL inattendue");
    }
  } catch (error) {
    console.error("Erreur comptage automatique:", error.message);
    // Fallback pour l'UI
    orderCount = usage.orderCount || 0;
    console.warn(`[USAGE] ⚠️  FALLBACK: Utilisation valeur en base: ${orderCount}`);
    console.warn(`[USAGE] ⚠️  Cause: ${error.message}`);
  }

  // Toujours mettre à jour l'UI
  await prisma.usageSubscription.update({
    where: { id: usage.id },
    data: { orderCount },
  });

  // Si essai → s'arrêter ici (aucune mutation de facturation)
  if (isInTrial(activeSub)) {
    return { ...usage, orderCount };
  }

  // ====== 2) LOGIQUE PALIERS & DELTA ======
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

  // État de facturation (ton état applicatif)
  let state = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  if (!state) {
    state = await prisma.usageBillingState.create({
      data: { shop, periodKey, billedTier: 0, billedAmount: 0 },
    });
  }

  // Si le palier n'a pas augmenté → rien à facturer
  if (currentTier <= state.billedTier) {
    return { ...usage, orderCount };
  }

  // Delta à facturer (ex: passer de 19.9 -> 39.9 facture +20.0)
  const delta = TIERS[currentTier].price - TIERS[state.billedTier].price;
  if (delta <= 0) return { ...usage, orderCount };

  // Idempotence (évite double débit a posteriori)
  const idemKey = `${shop}:${periodKey}:${state.billedTier}->${currentTier}`;
  if (state.lastIdemKey === idemKey) return { ...usage, orderCount };

  // ====== 2.b) Lock + throttle pour bloquer les parallélismes ======
  const lock = await tryAcquireLock(shop, periodKey);
  if (!lock.acquired) {
    console.log(`[USAGE] 🔒 Skip facturation (raison: ${lock.reason}) – anti-doublon.`);
    return { ...usage, orderCount };
  }

  // ====== 3) CLAMP AU CAP RESTANT (clé pour éviter l’erreur Shopify) ======
  let toBill = delta; // par défaut (sera clampé)
  try {
    const subRes = await admin.graphql(`#graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            status
            lineItems {
              id
              plan {
                pricingDetails {
                  __typename
                  ... on AppUsagePricing {
                    cappedAmount { amount currencyCode }
                    terms
                  }
                }
              }
              usageRecords(first: 100, reverse: true) {
                edges { node { createdAt price { amount } } }
              }
            }
          }
        }
      }
    `);
    const subJson = await subRes.json();
    const active = subJson?.data?.currentAppInstallation?.activeSubscriptions?.find(
      (s) => s.status === "ACTIVE"
    );
    const usageItem = active?.lineItems?.find(
      (li) => li?.plan?.pricingDetails?.__typename === "AppUsagePricing"
    );

    if (usageItem?.plan?.pricingDetails?.cappedAmount?.amount != null) {
      const capped = Number(usageItem.plan.pricingDetails.cappedAmount.amount);

      // Somme des usages enregistrés sur le mois calendaire
      const usedThisMonth = (usageItem.usageRecords?.edges ?? [])
        .filter((e) => {
          const d = new Date(e.node.createdAt);
          return d >= startOfMonth && d <= endOfMonth;
        })
        .reduce((sum, e) => sum + Number(e.node.price.amount), 0);

      const remaining = Math.max(capped - usedThisMonth, 0);
      toBill = Math.min(Math.max(delta, 0), remaining);

      if (toBill <= 0) {
        console.log("[USAGE] Cap atteint ou rien à facturer | remaining:", remaining, "delta:", delta);
        await releaseLock(shop, periodKey, lock.token);
        return { ...usage, orderCount };
      }
    } else {
      console.warn("[USAGE] ⚠️ Aucun line item d’usage trouvé sur la souscription ACTIVE");
    }
  } catch (e) {
    console.warn("[USAGE] ⚠️ Lecture du cap impossible, tentative de facturation du delta brut:", e?.message);
  }

  // ====== 4) CRÉATION USAGE RECORD (avec toBill clampé) ======
  try {
    const resp = await admin.graphql(
      `#graphql
        mutation usage($id: ID!, $price: MoneyInput!, $desc: String!) {
          appUsageRecordCreate(
            subscriptionLineItemId: $id
            description: $desc
            price: $price
          ) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id: usage.lineItemId, // line item d’usage stocké en DB
          price: { amount: toBill, currencyCode: "EUR" },
          desc: `Monthly usage ${periodKey} — tier ${state.billedTier}→${currentTier} (+${toBill.toFixed(
            2
          )}€)`,
        },
      }
    );
    const respJson = await resp.json();
    const errors = respJson?.data?.appUsageRecordCreate?.userErrors;
    if (errors?.length) {
      console.error("[USAGE] create error:", errors.map((e) => e.message).join(", "));
    } else {
      await prisma.$transaction([
        prisma.usageBillingState.update({
          where: { shop_periodKey: { shop, periodKey } },
          data: {
            billedTier: currentTier,
            billedAmount: state.billedAmount + toBill,
            lastIdemKey: idemKey,
          },
        }),
        prisma.usageSubscription.update({
          where: { id: usage.id },
          data: { cycleStart: new Date() },
        }),
      ]);
      console.log("[USAGE] 💸 billed delta €", toBill, "tier", state.billedTier, "->", currentTier);
    }
  } catch (e) {
    console.error("bill delta error:", e);
  } finally {
    await releaseLock(shop, periodKey, lock.token);
  }

  const updatedUsage = await prisma.usageSubscription.findUnique({
    where: { id: usage.id },
  });
  return { ...updatedUsage, orderCount };
}

/* ------------------------ ensureActiveSubscription ------------------------ */

/**
 * Vérifie/assure une souscription ACTIVE :
 * 1) si active → synchro DB (+ process usage si pas en essai)
 * 2) sinon → crée une souscription "mensuel + usage" (2 lineItems)
 */
export async function ensureActiveSubscription(admin, shop) {
  // 1) Vérifier côté Shopify (source de vérité)
  try {
    const res = await admin.graphql(`#graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            status
            trialDays
            createdAt
            lineItems { id plan { pricingDetails { __typename } } }
          }
        }
      }
    `);
    const json = await res.json();
    const activeShopify =
      json?.data?.currentAppInstallation?.activeSubscriptions?.find(
        (sub) => sub.status === "ACTIVE"
      );

    if (activeShopify) {
      console.log("[SUBSCRIPTION] Abonnement actif trouvé côté Shopify, synchronisation de la base");

      // Identify usage line item (on garde le même champ lineItemId)
      const usageItem = activeShopify.lineItems.find(
        (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing"
      );

      await prisma.usageSubscription.upsert({
        where: { subscriptionId: activeShopify.id },
        update: {
          status: "ACTIVE",
          confirmationUrl: null,
          lineItemId: usageItem?.id ?? activeShopify.lineItems?.[0]?.id ?? null,
          shop,
        },
        create: {
          shop,
          subscriptionId: activeShopify.id,
          lineItemId: usageItem?.id ?? activeShopify.lineItems?.[0]?.id ?? null,
          status: "ACTIVE",
        },
      });

      // Annule les autres enregistrements locaux obsolètes
      await prisma.usageSubscription.updateMany({
        where: { shop, subscriptionId: { not: activeShopify.id } },
        data: { status: "CANCELLED", confirmationUrl: null },
      });

      const dbUsage = await prisma.usageSubscription.findFirst({
        where: { shop, subscriptionId: activeShopify.id },
      });

      // Si pas en essai → on facture l’usage, sinon on s’arrête là
      if (!isInTrial(activeShopify)) {
        const resProcess = await processMonthlyUsage(admin, shop, dbUsage);
        return { active: true, orderCount: resProcess?.orderCount ?? null };
      }
      console.log("[SUBSCRIPTION] Essai en cours – pas de processMonthlyUsage.");
      return { active: true, orderCount: null };
    }
  } catch (err) {
    console.error("Erreur check live subscription Shopify:", err);
    // on continue avec la DB
  }

  // 2) Fallback DB : si déjà ACTIVE localement → process usage (hors essai)
  const active = await prisma.usageSubscription.findFirst({
    where: { shop, status: "ACTIVE" },
  });
  if (active && !active.confirmationUrl) {
    const activeSub = await getActiveSubscriptionWithTrial(admin);
    if (!isInTrial(activeSub)) {
      const resProcess = await processMonthlyUsage(admin, shop, active);
      return { active: true, orderCount: resProcess?.orderCount ?? null };
    }
    console.log("[SUBSCRIPTION] Essai en cours (fallback) – pas de process.");
    return { active: true, orderCount: null };
  }

  // 3) Gérer un PENDING existant
  let pending = await prisma.usageSubscription.findFirst({
    where: { shop, status: "PENDING" },
    orderBy: { id: "desc" },
  });

  let subscriptionStatus = null;
  if (pending) {
    try {
      const check = await admin.graphql(
        `#graphql
         query($id: ID!) { node(id: $id) { ... on AppSubscription { status } } }`,
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
      where: { id: pending.id },
      data: { status: "ACTIVE", confirmationUrl: null },
    });
    await prisma.usageSubscription.updateMany({
      where: { shop, id: { not: pending.id } },
      data: { status: "CANCELLED", confirmationUrl: null },
    });
    const resProcess = await processMonthlyUsage(admin, shop, pending);
    return { active: true, orderCount: resProcess?.orderCount ?? null };
  }

  if (pending && subscriptionStatus === "PENDING" && pending.confirmationUrl) {
    return { confirmationUrl: pending.confirmationUrl };
  }

  // 4) Nettoyage des PENDING obsolètes
  if (pending) {
    await prisma.usageSubscription.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", confirmationUrl: null },
    });
  }

  // 5) CRÉER UNE NOUVELLE SOUSCRIPTION : RÉCURRENT + USAGE (avec 7 jours d'essai)
  try {
    const returnUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;

    const result = await admin.graphql(
      `#graphql
      mutation createSub($returnUrl: URL!) {
        appSubscriptionCreate(
          name: "Abonnement commandes mensuelles"
          returnUrl: $returnUrl
          trialDays: 7
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  interval: EVERY_30_DAYS
                  price: { amount: 9.90, currencyCode: EUR }
                }
              }
            },
            {
              plan: {
                appUsagePricingDetails: {
                  cappedAmount: { amount: 39.90, currencyCode: EUR }
                  terms: "0–30: 0€ • 31–300: +19,90€ • >300: +39,90€"
                }
              }
            }
          ]
        ) {
          confirmationUrl
          appSubscription {
            id
            status
            lineItems { id plan { pricingDetails { __typename } } }
          }
          userErrors { field message }
        }
      }`,
      { variables: { returnUrl } }
    );

    const data = await result.json();
    const payload = data?.data?.appSubscriptionCreate;
    console.log("[SUBSCRIPTION] Payload retour mutation:", payload);

    if (payload?.userErrors?.length) {
      return { error: payload.userErrors.map((e) => e.message).join(", ") };
    }

    const sub = payload.appSubscription;
    const usageItem = sub.lineItems.find(
      (li) => li.plan.pricingDetails.__typename === "AppUsagePricing"
    );

    await prisma.usageSubscription.create({
      data: {
        shop,
        subscriptionId: sub.id,
        lineItemId: usageItem?.id ?? sub.lineItems?.[0]?.id ?? null, // on stocke le line item d’usage
        status: "PENDING",
        confirmationUrl: payload.confirmationUrl,
      },
    });

    return { confirmationUrl: payload.confirmationUrl };
  } catch (createErr) {
    console.error("Erreur création abonnement:", createErr);
    return { error: "Impossible de créer l'abonnement." };
  }
}
