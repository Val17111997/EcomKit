import { Page, Layout, Card, Text, BlockStack, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;
  const { session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }
  return null;
};

export default function PlansPage() {
  return (
    <Page>
      <TitleBar title="Plans & Facturation" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                💼 Facturation gérée par Shopify
              </Text>
              
              <Text variant="bodyMd">
                ✨ Votre facturation est maintenant gérée automatiquement par Shopify via Managed Pricing.
              </Text>
              
              <Text variant="bodyMd" tone="success">
                🚀 Plus besoin de code complexe - Shopify s'occupe de tout !
              </Text>
              
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Avantages du Managed Pricing :
                </Text>
                <ul style={{ paddingLeft: "20px" }}>
                  <li>✅ Interface de facturation native Shopify</li>
                  <li>✅ Gestion automatique des abonnements</li>
                  <li>✅ Pas de code de facturation à maintenir</li>
                  <li>✅ Validation Shopify simplifiée</li>
                  <li>✅ Moins de risques de bugs</li>
                </ul>
              </BlockStack>
              
              <Text variant="bodySm" tone="subdued">
                Les marchands verront vos plans directement dans l'App Store Shopify
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}