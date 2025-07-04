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
    // Authenticate with Shopify credentials
    const { admin, billing, session } = await authenticate.admin(request);
    
    const shopDomain = session.shop;
    console.log("🏪 Shop domain:", shopDomain);
    
    // ✅ Vérifier l'abonnement mais ne pas bloquer - laisser chaque route décider
    console.log("🔍 Checking subscription for store:", shopDomain);
    
    try {
      const { appSubscriptions } = await billing.check();
      console.log("📋 Abonnements trouvés:", appSubscriptions?.length || 0);
      
      if (appSubscriptions && appSubscriptions.length > 0) {
        const subscription = appSubscriptions[0];
        const isTrialActive = subscription?.test || false;
        const subscriptionStatus = subscription?.status || 'ACTIVE';
        
        let trialDaysRemaining = null;
        if (isTrialActive && subscription?.trialDays) {
          const createdAt = new Date(subscription.createdAt);
          const now = new Date();
          const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
          trialDaysRemaining = Math.max(0, subscription.trialDays - daysPassed);
        }
        
        console.log("✅ Abonnement actif trouvé:", subscriptionStatus);
        
        return json({
          apiKey: process.env.SHOPIFY_API_KEY || "",
          subscription: {
            hasAccess: true,
            needsSubscription: false,
            isTrialActive,
            subscriptionStatus,
            trialDaysRemaining,
            details: subscription,
            shopDomain
          }
        });
      } else {
        console.log("❌ Aucun abonnement trouvé");
        
        return json({
          apiKey: process.env.SHOPIFY_API_KEY || "",
          subscription: {
            hasAccess: false,
            needsSubscription: true,
            isTrialActive: false,
            subscriptionStatus: 'NONE',
            trialDaysRemaining: null,
            details: null,
            shopDomain
          }
        });
      }
      
    } catch (billingError) {
      console.error("❌ Billing error:", billingError);
      
      // En cas d'erreur, permettre l'accès pour tester
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        subscription: {
          hasAccess: false,
          needsSubscription: true,
          isTrialActive: false,
          subscriptionStatus: 'ERROR',
          trialDaysRemaining: null,
          details: null,
          error: billingError.message,
          shopDomain
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
          shopDomain: session.shop
        }
      });
    } catch (fallbackError) {
      throw new Response("Authentication failed", { status: 500 });
    }
  }
};

// ✅ Composant principal avec gestion d'hydration
export default function App() {
  const { apiKey, subscription } = useLoaderData();
  const [isClient, setIsClient] = useState(false);

  // ✅ useEffect pour éviter les différences serveur/client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // ✅ Pendant l'hydration, afficher un état minimal identique serveur/client
  if (!isClient) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div>Chargement...</div>
      </AppProvider>
    );
  }

  // ✅ Après hydration, afficher le contenu complet
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
      
      {/* Toujours afficher le contenu principal - gérer l'abonnement dans les sous-routes */}
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