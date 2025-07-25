import prisma from "./db.server";

// Check if the shop has an active subscription. If not, create a new one and return the confirmation URL.
export async function ensureActiveSubscription(admin, shop) {
  let usage;
  try {
    usage = await prisma.usageSubscription.findUnique({ where: { shop } });
  } catch (err) {
    console.error("DB lookup failed:", err);
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
