import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;
  const { session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }
  const { shop } = session;

  const usage = await prisma.usageSubscription.findFirst({
    where: { shop, status: "ACTIVE" },
  });
  if (!usage) {
    return json({ hasSubscription: false });
  }

  let nextPrice = 0;
  if (usage.orderCount > 300) nextPrice = 39.90;
  else if (usage.orderCount > 30) nextPrice = 19.90;

  return json({
    hasSubscription: true,
    orderCount: usage.orderCount,
    nextPrice,
  });
};

export default function Billing() {
  const { hasSubscription, orderCount = 0, nextPrice = 0 } = useLoaderData();

  return (
    <Page title="Facturation">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              {!hasSubscription ? (
                <Text as="p">Aucun abonnement trouvé.</Text>
              ) : (
                <>
                  <Text variant="headingMd" as="h2">Votre consommation ce mois-ci</Text>
                  <Text as="p">{orderCount} commandes</Text>
                  <Text as="p" tone="subdued">
                    Montant prévisionnel : {nextPrice === 0 ? "gratuit" : `${nextPrice}€`}
                  </Text>
                  <Text tone="subdued" as="p">
                    Gratuit jusqu'à 30 commandes, 19,90 € jusqu'à 300, puis 39,90 €.
                  </Text>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
