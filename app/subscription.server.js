import prisma from "./db.server";

export async function processMonthlyUsage(admin, shop, existingUsage) {
  let usage = existingUsage;
  if (!usage) {
    usage = await prisma.usageSubscription.findUnique({ where: { shop } });
  }
  if (!usage) return null;

  const now = new Date();
  const cycle = new Date(usage.cycleStart);
  if (
    cycle.getUTCFullYear() === now.getUTCFullYear() &&
    cycle.getUTCMonth() === now.getUTCMonth()
  ) {
    return usage;
  }

  let amount = 0;
  if (usage.orderCount > 300) amount = 39.9;
  else if (usage.orderCount > 30) amount = 19.9;

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

  return await prisma.usageSubscription.update({
    where: { shop },
    data: { orderCount: 0, cycleStart: now },
  });
}

// Check if the shop has an active subscription. If not, create a new one and return the confirmation URL.
export async function ensureActiveSubscription(admin, shop) {
  let usage;
  try {
    usage = await prisma.usageSubscription.findUnique({ where: { shop } });
  } catch (err) {
    console.error("DB lookup failed:", err);
  }

  if (usage) {
    usage = await processMonthlyUsage(admin, shop, usage);
  }

  let subscriptionStatus = null;
  if (usage) {
    try {
      const check = await admin.graphql(
        `query($id: ID!) { node(id: $id) { ... on AppSubscription { status } } }`,
        { variables: { id: usage.subscriptionId } }
      );
      const checkJson = await check.json();
      subscriptionStatus = checkJson?.data?.node?.status;
    } catch (err) {
      console.error("Erreur vérification abonnement:", err);
    }
  }

  if (!usage || subscriptionStatus !== "ACTIVE") {
    if (usage && subscriptionStatus === "PENDING" && usage.confirmationUrl) {
      return { confirmationUrl: usage.confirmationUrl };
    }

    try {
      const returnUrl = `${process.env.SHOPIFY_APP_URL}/app`;
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
      if (payload.userErrors?.length) {
        return { error: payload.userErrors.map((e) => e.message).join(", ") };
      }

      if (usage) {
        await prisma.usageSubscription.update({
          where: { shop },
          data: {
            subscriptionId: payload.appSubscription.id,
            lineItemId: payload.appSubscription.lineItems[0].id,
            confirmationUrl: payload.confirmationUrl,
            orderCount: 0,
            cycleStart: new Date(),
          },
        });
      } else {
        await prisma.usageSubscription.create({
          data: {
            shop,
            subscriptionId: payload.appSubscription.id,
            lineItemId: payload.appSubscription.lineItems[0].id,
            confirmationUrl: payload.confirmationUrl,
            cycleStart: new Date(),
          },
        });
      }

      return { confirmationUrl: payload.confirmationUrl };
    } catch (createErr) {
      console.error("Erreur création abonnement:", createErr);
      return { error: "Impossible de créer l'abonnement." };
    }
  }

  return { active: true };
}
