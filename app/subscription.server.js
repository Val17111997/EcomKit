// app/subscription.server.js
import prisma from "./db.server";
import crypto from "crypto";

/* ----------------------------- helpers trial ----------------------------- */

async function getActiveSubscription(admin) {
  const res = await admin.graphql(`#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          trialDays
          createdAt
          # currentPeriodEnd n'est pas garanti sur toutes les versions;
          # on l'utilise si dispo, sinon on calcule depuis createdAt.
          currentPeriodEnd
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

/* -------------------------- helpers cycle (30j) -------------------------- */

// Renvoie {cycleStart, cycleEnd} pour le CYCLE Shopify courant (interval EVERY_30_DAYS)
// Stratégie : si currentPeriodEnd dispo => start = end - 30j. Sinon, on « quantise » depuis createdAt.
function getCurrentCycleWindow(activeSub, now = new Date()) {
  const THIRTY_D_MS = 30 * 24 * 60 * 60 * 1000;

  if (activeSub?.currentPeriodEnd) {
    const end = new Date(activeSub.currentPeriodEnd);
    const start = new Date(end.getTime() - THIRTY_D_MS);
    return { cycleStart: start, cycleEnd: end };
  }

  // Fallback robuste : créé à t0, cycles de 30 jours exacts
  const created = new Date(activeSub.createdAt);
  const elapsed = now.getTime() - created.getTime();
  const periods = Math.floor(elapsed / THIRTY_D_MS);
  const start = new Date(created.getTime() + periods * THIRTY_D_MS);
  const end = new Date(start.getTime() + THIRTY_D_MS);
  return { cycleStart: start, cycleEnd: end };
}

// periodKey stable par cycle (évite l'explosion d'entrées et les régressions)
function periodKeyForCycle(cycleStart) {
  const y = cycleStart.getUTCFullYear();
  const m = String(cycleStart.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cycleStart.getUTCDate()).padStart(2, "0");
  return `cycle:${y}-${m}-${d}`;
}

/* ---------------------------- helpers lock/throttle ---------------------------- */

// Lock atomique (updateMany conditionnel) + throttle
async function tryAcquireLock(shop, periodKey, throttleMs = 2 * 60 * 1000) {
  const now = new Date();
  const row = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  if (
    row?.lastProcessedAt &&
    now.getTime() - new Date(row.lastProcessedAt).getTime() < throttleMs
  ) {
    return { acquired: false, reason: "throttled" };
  }

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
  await prisma.usageBillingState.updateMany({
    where: { shop, periodKey, processingToken: token },
    data: { processingToken: null },
  });
}

/* ----------------------------- NEW: Trial Tracking ----------------------------- */

/**
 * Vérifie si la boutique a déjà consommé son essai gratuit
 * En cherchant n'importe quel ancien abonnement avec trialConsumed=true
 */
async function hasConsumedTrial(shop) {
  const anyConsumedTrial = await prisma.usageSubscription.findFirst({
    where: { 
      shop,
      trialConsumed: true, // ✅ Cherche explicitement si un essai a été consommé
    },
    orderBy: { id: "desc" },
  });
  
  return !!anyConsumedTrial;
}

/* --------------------------- processMonthlyUsage --------------------------- */
/**
 * Compte et facture l'usage sur le **cycle Shopify courant (30 jours)**.
 * - Facture uniquement le DELTA de palier (0 → 19,90 → +20,00)
 * - Clamp sur le remaining du cap du cycle.
 * - Idempotent et anti-doublon.
 */
export async function processMonthlyUsage(admin, shop, existingUsage) {
  let usage =
    existingUsage ||
    (await prisma.usageSubscription.findFirst({
      where: { shop, status: "ACTIVE" },
    }));

  if (!usage || typeof usage.id !== "number") {
    usage = await prisma.usageSubscription.findFirst({
      where: { shop, status: "ACTIVE" },
    });
  }
  if (!usage) return null;

  // ==== Lire la souscription ACTIVE (trial + fenêtre de cycle)
  const activeSub = await getActiveSubscription(admin);
  if (!activeSub) {
    console.warn("[SUBSCRIPTION] Aucune souscription ACTIVE détectée.");
    return { ...usage, orderCount: usage.orderCount ?? 0 };
  }

  const now = new Date();
  const { cycleStart, cycleEnd } = getCurrentCycleWindow(activeSub, now);
  const periodKey = periodKeyForCycle(cycleStart);

  // STOP si essai
  if (isInTrial(activeSub)) {
    console.log("[USAGE] ⏸ Essai en cours – aucune facturation d'usage.");
  }

  // ==== 1) Compter les commandes sur le CYCLE (shopify-like 30j)
  let orderCount = 0;
  try {
    const startDate = cycleStart.toISOString();
    const endDate = cycleEnd.toISOString();
    console.log(`[USAGE] 🚀 Comptage commandes pour cycle ${startDate} → ${endDate}`);

    const queryString = `created_at:>=${startDate} created_at:<=${endDate} -status:cancelled -test:true (financial_status:paid OR financial_status:partially_paid)`;

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

      let hasNextPage = json.data.orders.pageInfo?.hasNextPage;
      let lastCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
      while (hasNextPage && lastCursor) {
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
        const nextEdges = nextJson?.data?.orders?.edges || [];
        orderCount += nextEdges.length;
        hasNextPage = nextJson?.data?.orders?.pageInfo?.hasNextPage;
        lastCursor =
          nextEdges.length > 0 ? nextEdges[nextEdges.length - 1].cursor : null;
      }
      console.log(`[USAGE] 🎯 TOTAL CYCLE: ${orderCount} commandes`);
    } else if (json?.errors) {
      throw new Error(json.errors.map((e) => e.message).join(", "));
    } else {
      throw new Error("Réponse GraphQL inattendue (orders)");
    }
  } catch (error) {
    console.error("Erreur comptage automatique:", error.message);
    orderCount = usage.orderCount || 0;
    console.warn(`[USAGE] ⚠️ FALLBACK DB: ${orderCount}`);
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

  // ==== 2) Logique paliers & delta (sur le CYCLE)
  const TIERS = [
    { tier: 0, price: 0 },
    { tier: 1, price: 19.9 }, // 31–300
    { tier: 2, price: 39.9 }, // >300
  ];
  const pickTier = (n) => (n > 300 ? 2 : n > 30 ? 1 : 0);
  const currentTier = pickTier(orderCount);

  // État de facturation pour CE CYCLE
  let state = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  if (!state) {
    state = await prisma.usageBillingState.create({
      data: { shop, periodKey, billedTier: 0, billedAmount: 0 },
    });
  }

  // Si le palier n'a pas augmenté → rien à facturer (pas de régression possible à l'intérieur d'un cycle)
  if (currentTier <= state.billedTier) {
    return { ...usage, orderCount };
  }

  // ✅ Calculer le delta entre paliers (pas billedAmount pour éviter erreurs sur clamp)
  const delta = TIERS[currentTier].price - TIERS[state.billedTier].price;
  const idemKey = `${periodKey}:${currentTier}`;
  if (state.lastIdemKey === idemKey) {
    console.log("[USAGE] ⏭ Déjà facturé ce palier ce cycle, skip");
    return { ...usage, orderCount };
  }

  // ==== 3) Lock + throttle (anti-doublon)
  const lock = await tryAcquireLock(shop, periodKey, 2 * 60 * 1000);
  if (!lock.acquired) {
    console.log("[USAGE] ⏸ Lock occupé ou throttle, skip");
    return { ...usage, orderCount };
  }

  // ==== 3b) Récupérer cycle cap & usage total déjà facturé
  let toBill = delta;
  try {
    const subLineQuery = await admin.graphql(
      `#graphql
       query($id: ID!) {
         node(id: $id) {
           ... on AppSubscription {
             id
             status
             createdAt
             currentPeriodEnd
             lineItems {
               id
               plan {
                 pricingDetails {
                   ... on AppUsagePricing {
                     balanceUsed { amount }
                     cappedAmount { amount }
                     interval
                   }
                 }
               }
               usageRecords(first: 100, sortKey: CREATED_AT, reverse: true) {
                 edges {
                   node {
                     id
                     createdAt
                     price { amount }
                   }
                 }
               }
             }
           }
         }
       }`,
      { variables: { id: activeSub.id } }
    );
    const lineJson = await subLineQuery.json();
    const subNode = lineJson?.data?.node;
    const item = subNode?.lineItems?.[0];

    if (item) {
      const capped = Number(item.plan?.pricingDetails?.cappedAmount?.amount || 0);
      const { cycleStart: cStart, cycleEnd: cEnd } = getCurrentCycleWindow(subNode, now);

      const usedThisCycle = (item.usageRecords?.edges || [])
        .filter((e) => {
          const d = new Date(e.node.createdAt);
          return d >= cStart && d < cEnd;
        })
        .reduce((sum, e) => sum + Number(e.node.price.amount), 0);

      const remaining = Math.max(capped - usedThisCycle, 0);
      toBill = Math.min(Math.max(delta, 0), remaining);

      if (toBill <= 0) {
        console.log(
          "[USAGE] Cap cycle atteint ou rien à facturer | remaining:",
          remaining,
          "delta:",
          delta
        );
        await releaseLock(shop, periodKey, lock.token);
        return { ...usage, orderCount };
      }
    } else {
      console.warn("[USAGE] ⚠️ Aucun line item d'usage trouvé sur la souscription ACTIVE");
    }
  } catch (e) {
    console.warn("[USAGE] ⚠️ Lecture cap/cycle impossible, tentative delta brut:", e?.message);
  }

  // ==== 4) Création usage record (toBill clampé)
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
          id: usage.lineItemId,
          price: { amount: toBill, currencyCode: "EUR" },
          desc: `Cycle ${periodKey} — tier ${state.billedTier}→${currentTier} (+${toBill.toFixed(
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
          data: { cycleStart: now },
        }),
      ]);
      console.log(
        "[USAGE] 💸 billed delta €",
        toBill,
        "tier",
        state.billedTier,
        "->",
        currentTier
      );
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
 * Assure une souscription ACTIVE (usage-only, cap 39,90€) + essai 7 jours UNIQUEMENT pour les nouveaux clients.
 */
export async function ensureActiveSubscription(admin, shop) {
  try {
    const activeShopify = await getActiveSubscription(admin);

    if (activeShopify) {
      console.log("[SUBSCRIPTION] Abonnement actif trouvé, synchro DB");

      const usageItem = activeShopify.lineItems.find(
        (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing"
      );

      // ✅ Déterminer si l'essai est encore actif ou consommé
      const stillInTrial = isInTrial(activeShopify);
      const trialConsumed = !stillInTrial; // Si plus en essai → essai consommé

      await prisma.usageSubscription.upsert({
        where: { subscriptionId: activeShopify.id },
        update: {
          status: "ACTIVE",
          confirmationUrl: null,
          lineItemId: usageItem?.id ?? activeShopify.lineItems?.[0]?.id ?? null,
          shop,
          trialConsumed, // ✅ Marque l'essai comme consommé si terminé
        },
        create: {
          shop,
          subscriptionId: activeShopify.id,
          lineItemId: usageItem?.id ?? activeShopify.lineItems?.[0]?.id ?? null,
          status: "ACTIVE",
          trialConsumed, // ✅ Marque l'essai comme consommé dès la création si pas en trial
        },
      });

      await prisma.usageSubscription.updateMany({
        where: { shop, subscriptionId: { not: activeShopify.id } },
        data: { status: "CANCELLED", confirmationUrl: null },
      });

      // ✅ CORRECTION : Toujours compter pour l'UI ; processMonthlyUsage ne facture pas si essai
      const dbUsage = await prisma.usageSubscription.findFirst({
        where: { shop, subscriptionId: activeShopify.id },
      });
      const resProcess = await processMonthlyUsage(admin, shop, dbUsage);
      return { active: true, orderCount: resProcess?.orderCount ?? null };
    }
  } catch (err) {
    console.error("Erreur check live subscription Shopify:", err);
  }

  // Pas d'actif → gérer PENDING existant puis sinon créer la souscription usage-only
  const pending = await prisma.usageSubscription.findFirst({
    where: { shop, status: "PENDING" },
    orderBy: { id: "desc" },
  });

  if (pending) {
    try {
      const check = await admin.graphql(
        `#graphql
         query($id: ID!) { node(id: $id) { ... on AppSubscription { status } } }`,
        { variables: { id: pending.subscriptionId } }
      );
      const checkJson = await check.json();
      const status = checkJson?.data?.node?.status;

      if (status === "ACTIVE") {
        // ✅ Récupérer les détails complets pour lineItemId + trial status
        const checkDetails = await admin.graphql(
          `#graphql
           query($id: ID!) { 
             node(id: $id) { 
               ... on AppSubscription { 
                 status 
                 trialDays
                 createdAt
                 lineItems { 
                   id 
                   plan { 
                     pricingDetails { __typename } 
                   } 
                 }
               } 
             } 
           }`,
          { variables: { id: pending.subscriptionId } }
        );
        const detailsJson = await checkDetails.json();
        const subDetails = detailsJson?.data?.node;
        const stillInTrial = subDetails ? isInTrial(subDetails) : false;
        
        // ✅ Trouver le lineItemId d'usage (au cas où il aurait changé entre PENDING et ACTIVE)
        const usageItem = subDetails?.lineItems?.find(
          (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing"
        );
        const freshLineItemId = usageItem?.id ?? subDetails?.lineItems?.[0]?.id ?? pending.lineItemId;
        
        await prisma.usageSubscription.update({
          where: { id: pending.id },
          data: { 
            status: "ACTIVE", 
            confirmationUrl: null,
            lineItemId: freshLineItemId, // ✅ Rafraîchir au cas où changé
            trialConsumed: !stillInTrial, // ✅ Marque comme consommé si plus en essai
          },
        });
        await prisma.usageSubscription.updateMany({
          where: { shop, id: { not: pending.id } },
          data: { status: "CANCELLED", confirmationUrl: null },
        });
        // ✅ CORRECTION : Appel systématique même pendant l'essai
        const resProcess = await processMonthlyUsage(admin, shop, pending);
        return { active: true, orderCount: resProcess?.orderCount ?? null };
      }
      if (status === "PENDING" && pending.confirmationUrl) {
        return { confirmationUrl: pending.confirmationUrl };
      }
    } catch (err) {
      console.error("Erreur vérification abonnement:", err);
    }

    // Nettoyage PENDING obsolète
    await prisma.usageSubscription.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", confirmationUrl: null },
    });
  }

  // ✅ CORRECTION MAJEURE : Vérifier si la boutique a déjà consommé son essai
  const alreadyConsumed = await hasConsumedTrial(shop);
  const trialDays = alreadyConsumed ? 0 : 7; // Essai uniquement si jamais consommé
  
  console.log(`[SUBSCRIPTION] Création nouvel abonnement - Essai: ${trialDays} jours ${alreadyConsumed ? '(déjà consommé)' : '(nouveau client)'}`);

  // Créer une SOUSCRIPTION usage-only (cap 39,90€, essai 7 jours UNIQUEMENT si jamais consommé)
  try {
    const returnUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    const result = await admin.graphql(
      `#graphql
      mutation createSub($returnUrl: URL!, $trialDays: Int!) {
        appSubscriptionCreate(
          name: "Abonnement commandes (usage-only)"
          returnUrl: $returnUrl
          trialDays: $trialDays
          lineItems: [
            {
              plan: {
                appUsagePricingDetails: {
                  cappedAmount: { amount: 39.90, currencyCode: EUR }
                  terms: "0–30: 0€ • 31–300: 19,90€ • >300: 39,90€"
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
      { variables: { returnUrl, trialDays } }
    );

    const data = await result.json();
    const payload = data?.data?.appSubscriptionCreate;

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
        lineItemId: usageItem?.id ?? sub.lineItems?.[0]?.id ?? null,
        status: "PENDING",
        confirmationUrl: payload.confirmationUrl,
        trialConsumed: trialDays === 0, // ✅ Si pas d'essai, déjà consommé
      },
    });

    return { confirmationUrl: payload.confirmationUrl };
  } catch (createErr) {
    console.error("Erreur création abonnement:", createErr);
    return { error: "Impossible de créer l'abonnement." };
  }
}
