import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    
    const shopDomain = session.shop;
    console.log("🏪 Shop domain:", shopDomain);
    
    // ✅ VÉRIFICATION D'ABONNEMENT VIA GRAPHQL
    try {
      console.log("🔍 Vérification des abonnements via GraphQL...");
      
      const query = `
        query {
          currentAppInstallation {
            id
            app {
              id
              title
            }
            activeSubscriptions {
              id
              name
              status
              createdAt
              currentPeriodEnd
              trialDays
              test
              lineItems {
                id
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                      interval
                    }
                  }
                }
              }
            }
          }
        }
      `;
      
      const response = await admin.graphql(query);
      const data = await response.json();
      
      console.log("📋 Réponse GraphQL:", JSON.stringify(data, null, 2));
      
      if (data.errors) {
        console.error("❌ Erreurs GraphQL:", data.errors);
        throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(", ")}`);
      }
      
      const installation = data.data?.currentAppInstallation;
      const activeSubscriptions = installation?.activeSubscriptions || [];
      
      console.log("📊 Abonnements actifs trouvés:", activeSubscriptions.length);
      
      if (activeSubscriptions.length > 0) {
        const subscription = activeSubscriptions[0];
        const isTrialActive = subscription.test || false;
        const subscriptionStatus = subscription.status || 'ACTIVE';
        
        // Calculer les jours restants d'essai
        let trialDaysRemaining = null;
        if (subscription.trialDays && subscription.createdAt) {
          const createdAt = new Date(subscription.createdAt);
          const now = new Date();
          const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
          trialDaysRemaining = Math.max(0, subscription.trialDays - daysPassed);
        }
        
        console.log("✅ Abonnement actif trouvé:", {
          id: subscription.id,
          name: subscription.name,
          status: subscriptionStatus,
          isTrialActive,
          trialDaysRemaining
        });
        
        return json({
          apiKey: process.env.SHOPIFY_API_KEY || "",
          subscription: {
            hasAccess: true,
            needsSubscription: false,
            isTrialActive,
            subscriptionStatus,
            trialDaysRemaining,
            details: subscription,
            shopDomain,
            method: "GraphQL"
          }
        });
      } else {
        console.log("❌ Aucun abonnement actif trouvé");
        
        return json({
          apiKey: process.env.SHOPIFY_API_KEY || "",
          subscription: {
            hasAccess: false,
            needsSubscription: true,
            isTrialActive: false,
            subscriptionStatus: 'NONE',
            trialDaysRemaining: null,
            details: null,
            shopDomain,
            method: "GraphQL"
          }
        });
      }
      
    } catch (graphqlError) {
      console.error("❌ Erreur GraphQL:", graphqlError);
      
      // En cas d'erreur GraphQL, permettre l'accès limité
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        subscription: {
          hasAccess: false,
          needsSubscription: true,
          isTrialActive: false,
          subscriptionStatus: 'ERROR',
          trialDaysRemaining: null,
          details: null,
          error: graphqlError.message,
          shopDomain,
          method: "GraphQL"
        }
      });
    }
    
  } catch (error) {
    console.error("❌ Error in app loader:", error);
    
    try {
      const { session } = await authenticate.admin(request);
      
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        subscription: {
          hasAccess: false,
          needsSubscription: true,
          isTrialActive: false,
          subscriptionStatus: 'ERROR',
          trialDaysRemaining: null,
          details: null,
          error: error.message,
          shopDomain: session.shop,
          method: "GraphQL"
        }
      });
    } catch (fallbackError) {
      throw new Response("Authentication failed", { status: 500 });
    }
  }
};

export default function App() {
  const { apiKey, subscription } = useLoaderData();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div>Chargement...</div>
      </AppProvider>
    );
  }

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/offers-settings">Set-up BoostCart</Link>
        <Link to="/app/setup-bundlecard">Set-up Bundle-Card</Link>
        <Link to="/app/setup-ultimatepack">Set-up Ultimate Pack</Link>
        <Link to="/app/setup-packbuilder">Set-up Pack Builder</Link>
        <Link to="/app/support">Support client</Link>
        <Link to="/app/plans">Plans & Facturation</Link>
      </NavMenu>
      
      <Outlet context={{ subscription }} />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};