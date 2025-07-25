import React, { useEffect, useCallback } from "react";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu, useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  Text,
  InlineStack,
  Box,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  // Authenticate with Shopify credentials to handle server-side queries
  const { authenticate } = await import("../shopify.server");
  const { ensureActiveSubscription } = await import("../subscription.server");
  // Get session information
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;
  const { admin, session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }

  const billing = await ensureActiveSubscription(admin, session.shop);

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    ...billing,
  });
};

export default function App() {
  const { apiKey, confirmationUrl, error } = useLoaderData();
  const app = useAppBridge();

  const redirectToBilling = useCallback(() => {
    if (!confirmationUrl) return;
    
    // Ouvrir directement dans un nouvel onglet
    window.open(confirmationUrl, '_blank', 'noopener,noreferrer');
  }, [confirmationUrl]);

  useEffect(() => {
    if (!confirmationUrl) return;

    redirectToBilling();
  }, [confirmationUrl, redirectToBilling]);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/offers-settings">Set-up BoostCart</Link>
        <Link to="/app/setup-bundlecard">Set-up Bundle-Card</Link>
        <Link to="/app/setup-ultimatepack">Set-up Ultimate Pack</Link>
        <Link to="/app/setup-packbuilder">Set-up Pack Builder</Link>
        <Link to="/app/support">Support client</Link>
        <Link to="/app/billing">Votre abonnement</Link>
      </NavMenu>
      
      {confirmationUrl ? (
        <Page>
          <Layout>
            <Layout.Section>
              <Box paddingBlockStart="800" paddingBlockEnd="800">
                <InlineStack gap="600" align="center" blockAlign="center">
                  <Card>
                    <Box padding="600">
                      <BlockStack gap="400" align="center">
                        <Text as="h2" variant="headingLg" alignment="center">
                          Abonnement requis
                        </Text>
                        <Text as="p" variant="bodyMd" alignment="center" tone="subdued">
                          Merci d'approuver l'abonnement pour utiliser l'app et accéder à toutes les fonctionnalités.
                        </Text>
                        <Box paddingBlockStart="200">
                          <Button 
                            onClick={redirectToBilling}
                            variant="primary"
                            size="large"
                          >
                            Ouvrir l'approbation
                          </Button>
                        </Box>
                        {error && (
                          <Text as="p" tone="critical" alignment="center">
                            Erreur: {error}
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  </Card>
                </InlineStack>
              </Box>
            </Layout.Section>
          </Layout>
        </Page>
      ) : (
        <Outlet />
      )}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};