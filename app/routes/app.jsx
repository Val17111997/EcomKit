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
        <Link to="/app/offers-settings"> 🛒 Panier BoostCart</Link>
        <Link to="/app/guides">📘 Guides d'installation</Link>
        <Link to="/app/support">💬 Support client</Link>
        <Link to="/app/billing">💳 Votre abonnement</Link>
      </NavMenu>
      
      {confirmationUrl ? (
        <Page>
          <Layout>
            <Layout.Section>
              <Box paddingBlockStart="800" paddingBlockEnd="800">
                <InlineStack gap="600" align="center" blockAlign="center">
                  <Card>
                    <Box padding="600">
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingLg">
                          Ecomkit
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Votre suite d'extensions pour optimiser l'expérience d'achat et booster vos conversions
                        </Text>
                        
                        <Text as="p" variant="headingXl">
                          Gratuit <Text as="span" variant="bodyLg" tone="subdued">puis à usage</Text>
                        </Text>
                        
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd">Gratuit jusqu'à 30 commandes</Text>
                          <Text as="p" variant="bodyMd">19,90 € jusqu'à 300 commandes</Text>
                          <Text as="p" variant="bodyMd">39,90 € au-delà de 300 commandes</Text>
                          <Text as="p" variant="bodyMd">Extensions BoostCart, Pack Builder, Bundle Cards</Text>
                        </BlockStack>
                        
                        <Box paddingBlockStart="200">
                          <Button 
                            onClick={redirectToBilling}
                            variant="primary"
                            size="large"
                            fullWidth
                          >
                            Démarrer
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