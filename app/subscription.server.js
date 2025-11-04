// app/subscription.server.js
import prisma from "./db.server";
import crypto from "crypto";

/* ----------------------------- helpers trial ----------------------------- */

async function getActiveSubscription(admin) {
  // ✅ Fonction helper pour construire la query avec ou sans le champ test
  const buildQuery = (withTest) => `#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          trialDays
          createdAt
          currentPeriodEnd
          ${withTest ? "test" : ""}
          lineItems { 
            id 
            plan { 
              pricingDetails { 
                __typename
                ... on AppUsagePricing {
                  balanceUsed { amount }
                  cappedAmount { amount }
                }
              } 
            } 
          }
        }
      }
    }
  `;

  // ✅ Tenter avec le champ test, fallback si non supporté
  let res = await admin.graphql(buildQuery(true));
  let json = await res.json();
  
  // Si erreur sur le champ test, retry sans
  if (json?.errors?.some(e => String(e.message).toLowerCase().includes("test"))) {
    console.log("[SUBSCRIPTION] ⚠️ Champ 'test' non supporté, retry sans ce champ");
    res = await admin.graphql(buildQuery(false));
    json = await res.json();
  }
  
  // ✅ Vérifier les erreurs GraphQL
  if (json?.errors) {
    console.error("[SUBSCRIPTION] ❌ Erreur GraphQL getActiveSubscription:", json.errors);
    throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(", ")}`);
  }
  
  const active = json?.data?.currentAppInstallation?.activeSubscriptions?.find(
    (s) => s.status === "ACTIVE"
  ) || null;
  
  // ✅ Si le champ test n'existe pas, on met false par défaut (= production)
  if (active && typeof active.test === "undefined") {
    active.test = false;
  }
  
  return active;
}

function trialEndsAtFrom(sub) {
  if (!sub?.trialDays || sub.trialDays <= 0 || !sub?.createdAt) return null;
  const created = new Date(sub.createdAt);
  const ends = new Date(created);
  ends.setUTCDate(ends.getUTCDate() + sub.trialDays);
  return ends;
}

function isInTrial(activeSub) {
  // Si pas de trialDays configuré → pas d'essai
  if (!activeSub?.trialDays || activeSub.trialDays <= 0) return false;
  
  const ends = trialEndsAtFrom(activeSub);
  if (!ends) return false;
  
  const now = Date.now();
  const inTrial = now < ends.getTime();
  
  // ✅ LOG CRUCIAL pour déboguer
  console.log("[TRIAL DEBUG]", {
    trialDays: activeSub.trialDays,
    createdAt: activeSub.createdAt,
    trialEndsAt: ends.toISOString(),
    now: new Date(now).toISOString(),
    inTrial,
    msRemaining: ends.getTime() - now,
    daysRemaining: (ends.getTime() - now) / (24 * 60 * 60 * 1000)
  });
  
  return inTrial;
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
async function tryAcquireLock(shop, periodKey, throttleMs = 30 * 1000) {
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
  console.log("[USAGE] 🚀 Début processMonthlyUsage pour", shop);
  
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
  if (!usage) {
    console.warn("[USAGE] ❌ Aucun usage trouvé pour", shop);
    return null;
  }

  // ==== Lire la souscription ACTIVE (trial + fenêtre de cycle)
  const activeSub = await getActiveSubscription(admin);
  if (!activeSub) {
    console.warn("[SUBSCRIPTION] Aucune souscription ACTIVE détectée.");
    return { ...usage, orderCount: usage.orderCount ?? 0 };
  }

  const now = new Date();
  const { cycleStart, cycleEnd } = getCurrentCycleWindow(activeSub, now);
  const periodKey = periodKeyForCycle(cycleStart);

  // ✅ GUARD: Ignorer les abonnements de test (environnement dev)
  if (activeSub?.test === true) {
    console.log("[USAGE] 🧪 Installation de test détectée — skip facturation.");
    const orderCount = await countOrdersForCycle(admin, cycleStart, cycleEnd);
    await prisma.usageSubscription.update({
      where: { id: usage.id },
      data: { orderCount },
    });
    return { ...usage, orderCount };
  }

  // ✅ CORRECTION CRITIQUE : Vérifier l'essai et ARRÊTER si actif
  const inTrial = isInTrial(activeSub);
  if (inTrial) {
    console.log("[USAGE] ⏸ Essai en cours – aucune facturation d'usage.");
    // ✅ TOUJOURS compter pour l'UI même pendant l'essai
    const orderCount = await countOrdersForCycle(admin, cycleStart, cycleEnd);
    await prisma.usageSubscription.update({
      where: { id: usage.id },
      data: { orderCount },
    });
    return { ...usage, orderCount }; // ✅ ARRÊT ICI - Ne pas facturer
  }

  // ==== 1) Compter les commandes sur le CYCLE (shopify-like 30j)
  console.log(`[USAGE] 📊 Comptage commandes pour cycle ${cycleStart.toISOString()} → ${cycleEnd.toISOString()}`);
  const orderCount = await countOrdersForCycle(admin, cycleStart, cycleEnd);
  console.log(`[USAGE] 🎯 TOTAL CYCLE: ${orderCount} commandes`);

  // Toujours mettre à jour l'UI
  await prisma.usageSubscription.update({
    where: { id: usage.id },
    data: { orderCount },
  });

  // ==== 2) Logique paliers & delta (sur le CYCLE)
  const TIERS = [
    { tier: 0, price: 0 },
    { tier: 1, price: 19.9 }, // 31–300
    { tier: 2, price: 39.9 }, // >300
  ];
  const pickTier = (n) => (n > 300 ? 2 : n > 30 ? 1 : 0);
  const currentTier = pickTier(orderCount);

  // État de facturation pour CE CYCLE
  let state = await prisma.usageBillingState.upsert({
    where: { shop_periodKey: { shop, periodKey } },
    update: {}, // Rien à mettre à jour si existe déjà
    create: { shop, periodKey, billedTier: 0, billedAmount: 0 },
  });

  // Si le palier n'a pas augmenté → rien à facturer
  if (currentTier <= state.billedTier) {
    console.log(`[USAGE] ✅ Palier actuel (${currentTier}) <= palier facturé (${state.billedTier}), rien à faire`);
    return { ...usage, orderCount };
  }

  // ✅ Calculer le delta entre paliers
  const delta = TIERS[currentTier].price - TIERS[state.billedTier].price;
  const idemKey = `${periodKey}:${currentTier}`;
  if (state.lastIdemKey === idemKey) {
    console.log("[USAGE] ⏭ Déjà facturé ce palier ce cycle, skip");
    return { ...usage, orderCount };
  }

  console.log(`[USAGE] 💰 Changement de palier détecté: ${state.billedTier} → ${currentTier} (delta: +${delta}€)`);

  // ==== 3) Lock + throttle (anti-doublon)
  const lock = await tryAcquireLock(shop, periodKey, 30 * 1000);
  if (!lock.acquired) {
    console.log(`[USAGE] ⏸ Lock non acquis (raison: ${lock.reason}) - skip facturation`);
    return { ...usage, orderCount };
  }

  // ✅ PURISME: Re-check de l'état après acquisition du lock
  // (au cas où un autre thread aurait facturé entre-temps)
  const freshState = await prisma.usageBillingState.findUnique({
    where: { shop_periodKey: { shop, periodKey } },
  });
  
  if (freshState && freshState.billedTier >= currentTier) {
    console.log(`[USAGE] ✅ Un autre thread a déjà facturé ce palier (${freshState.billedTier})`);
    await releaseLock(shop, periodKey, lock.token);
    return { ...usage, orderCount };
  }
  
  if (freshState && freshState.lastIdemKey === idemKey) {
    console.log("[USAGE] ⏭ Un autre thread a déjà facturé ce palier+cycle (idemKey match)");
    await releaseLock(shop, periodKey, lock.token);
    return { ...usage, orderCount };
  }

  // ==== 3b) Récupérer cycle cap & usage total déjà facturé + lineItem live
  let toBill = delta;
  let liveLineItemId = usage.lineItemId; // fallback
  
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
             }
           }
         }
       }`,
      { variables: { id: activeSub.id } }
    );
    const lineJson = await subLineQuery.json();
    
    // ✅ Gestion des erreurs GraphQL
    if (lineJson?.errors) {
      throw new Error(`GraphQL errors: ${lineJson.errors.map(e => e.message).join(", ")}`);
    }
    
    const subNode = lineJson?.data?.node;
    
    // ✅ Trouver le line item d'usage LIVE
    const item = subNode?.lineItems?.find(
      (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing"
    ) || subNode?.lineItems?.[0];

    if (!item) {
      console.error("[USAGE] ❌ Aucun line item trouvé - impossible de facturer");
      await releaseLock(shop, periodKey, lock.token);
      return { ...usage, orderCount };
    }

    // ✅ Utiliser le lineItemId LIVE (au cas où il aurait changé)
    liveLineItemId = item.id;

    const capped = Number(item.plan?.pricingDetails?.cappedAmount?.amount || 0);
    
    // ✅ Utiliser balanceUsed directement (plus fiable que pagination des records)
    const usedThisCycle = Number(item.plan?.pricingDetails?.balanceUsed?.amount || 0);

    const remaining = Math.max(capped - usedThisCycle, 0);
    toBill = Math.min(Math.max(delta, 0), remaining);

    console.log("[USAGE] 📊 Cap info:", {
      cap: capped,
      usedThisCycle,
      remaining,
      toBill,
      liveLineItemId
    });

    if (toBill <= 0) {
      console.log(
        "[USAGE] ⚠️ Cap cycle atteint ou rien à facturer | remaining:",
        remaining,
        "delta:",
        delta
      );
      await releaseLock(shop, periodKey, lock.token);
      return { ...usage, orderCount };
    }
  } catch (e) {
    console.error("[USAGE] ❌ Erreur lecture cap/cycle:", e?.message);
    // Ne pas tenter de facturer si on ne peut pas lire le cap
    await releaseLock(shop, periodKey, lock.token);
    return { ...usage, orderCount };
  }

  // ==== 4) Création usage record (toBill clampé et arrondi)
  try {
    // ✅ Arrondir à 2 décimales pour éviter les problèmes de float
    const amount = Math.round(toBill * 100) / 100;
    
    console.log(`[USAGE] 💳 Création usage record: ${amount.toFixed(2)}€ sur line item ${liveLineItemId}`);
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
          id: liveLineItemId, // ✅ Utiliser le lineItemId LIVE
          price: { amount, currencyCode: "EUR" },
          desc: `Cycle ${periodKey} — tier ${state.billedTier}→${currentTier} (+${amount.toFixed(
            2
          )}€)`,
        },
      }
    );
    const respJson = await resp.json();
    const errors = respJson?.data?.appUsageRecordCreate?.userErrors;
    if (errors?.length) {
      console.error("[USAGE] ❌ Erreur création usage record:", errors.map((e) => e.message).join(", "));
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
        "[USAGE] ✅ Facturation réussie: €",
        toBill.toFixed(2),
        "tier",
        state.billedTier,
        "->",
        currentTier
      );
    }
  } catch (e) {
    console.error("[USAGE] ❌ Erreur facturation:", e);
  } finally {
    await releaseLock(shop, periodKey, lock.token);
  }

  const updatedUsage = await prisma.usageSubscription.findUnique({
    where: { id: usage.id },
  });
  return { ...updatedUsage, orderCount };
}

/* ------------------------ Helper: Count Orders ------------------------ */
/**
 * Compte les commandes sur une période donnée
 */
async function countOrdersForCycle(admin, cycleStart, cycleEnd) {
  let orderCount = 0;
  try {
    const startDate = cycleStart.toISOString();
    const endDate = cycleEnd.toISOString();

    // ✅ Syntaxe optimisée pour éviter les variations entre shops
    const queryString = `created_at:>=${startDate} created_at:<=${endDate} test:false -status:cancelled (financial_status:paid OR financial_status:partially_paid)`;

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

    // ✅ Vérifier les erreurs GraphQL
    if (json?.errors) {
      throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(", ")}`);
    }

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
        
        // ✅ Vérifier les erreurs GraphQL dans la pagination
        if (nextJson?.errors) {
          console.error("[USAGE] ⚠️ Erreur GraphQL pagination:", nextJson.errors);
          break; // Arrêter la pagination mais garder ce qu'on a
        }
        
        const nextEdges = nextJson?.data?.orders?.edges || [];
        orderCount += nextEdges.length;
        hasNextPage = nextJson?.data?.orders?.pageInfo?.hasNextPage;
        lastCursor =
          nextEdges.length > 0 ? nextEdges[nextEdges.length - 1].cursor : null;
      }
    } else if (json?.errors) {
      throw new Error(json.errors.map((e) => e.message).join(", "));
    } else {
      throw new Error("Réponse GraphQL inattendue (orders)");
    }
  } catch (error) {
    console.error("[USAGE] ❌ Erreur comptage automatique:", error.message);
    orderCount = 0;
  }
  return orderCount;
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

      // ✅ Toujours appeler processMonthlyUsage (il gère l'essai en interne)
      const dbUsage = await prisma.usageSubscription.findFirst({
        where: { shop, subscriptionId: activeShopify.id },
      });
      const resProcess = await processMonthlyUsage(admin, shop, dbUsage);
      return { active: true, orderCount: resProcess?.orderCount ?? null };
    }
  } catch (err) {
    console.error("[SUBSCRIPTION] ❌ Erreur check live subscription Shopify:", err);
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
        
        // ✅ Trouver le lineItemId d'usage
        const usageItem = subDetails?.lineItems?.find(
          (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing"
        );
        const freshLineItemId = usageItem?.id ?? subDetails?.lineItems?.[0]?.id ?? pending.lineItemId;
        
        await prisma.usageSubscription.update({
          where: { id: pending.id },
          data: { 
            status: "ACTIVE", 
            confirmationUrl: null,
            lineItemId: freshLineItemId,
            trialConsumed: !stillInTrial,
          },
        });
        await prisma.usageSubscription.updateMany({
          where: { shop, id: { not: pending.id } },
          data: { status: "CANCELLED", confirmationUrl: null },
        });
        
        const resProcess = await processMonthlyUsage(admin, shop, pending);
        return { active: true, orderCount: resProcess?.orderCount ?? null };
      }
      if (status === "PENDING" && pending.confirmationUrl) {
        return { confirmationUrl: pending.confirmationUrl };
      }
    } catch (err) {
      console.error("[SUBSCRIPTION] ❌ Erreur vérification abonnement:", err);
    }

    // Nettoyage PENDING obsolète
    await prisma.usageSubscription.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", confirmationUrl: null },
    });
  }

  // ✅ Vérifier si la boutique a déjà consommé son essai
  const alreadyConsumed = await hasConsumedTrial(shop);
  const trialDays = alreadyConsumed ? 0 : 7; // Essai uniquement si jamais consommé
  
  console.log(`[SUBSCRIPTION] Création nouvel abonnement - Essai: ${trialDays} jours ${alreadyConsumed ? '(déjà consommé)' : '(nouveau client)'}`);

  // Créer une SOUSCRIPTION usage-only (cap 39,90€)
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
                  terms: "0-30: 0€ • 31-300: 19,90€ • >300: 39,90€"
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
      console.error("[SUBSCRIPTION] ❌ Erreur création:", payload.userErrors);
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

    console.log("[SUBSCRIPTION] ✅ Abonnement créé, redirection vers:", payload.confirmationUrl);
    return { confirmationUrl: payload.confirmationUrl };
  } catch (createErr) {
    console.error("[SUBSCRIPTION] ❌ Erreur création abonnement:", createErr);
    return { error: "Impossible de créer l'abonnement." };
  }
}
