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

    try {
      const redirect = Redirect.create(app);
      // Vérifier que dispatch existe et est une fonction
      if (redirect && typeof redirect.dispatch === 'function') {
        redirect.dispatch(Redirect.Action.REMOTE, confirmationUrl);
      } else {
        console.error('App Bridge dispatch not available');
      }
    } catch (error) {
      console.error('App Bridge redirect failed:', error);
    }
  }, [app, confirmationUrl]);

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
              <Card>
                <BlockStack gap="200">
                  <Text>Merci d&apos;approuver l&apos;abonnement pour utiliser l&apos;app.</Text>
                  <Button onClick={redirectToBilling}>
                    Rouvrir l&apos;approbation
                  </Button>
                  <Text as="p">
                    <a
                      href={confirmationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ouvrir dans un nouvel onglet
                    </a>
                  </Text>
                  {error && <Text tone="critical">Erreur: {error}</Text>}
                </BlockStack>
              </Card>
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