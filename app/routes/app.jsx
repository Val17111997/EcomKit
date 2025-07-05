import { json, redirect } from "@remix-run/node";
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
    
    console.log("🏪 Shop:", session.shop);
    
    // Vérification du statut d'abonnement avec Managed Pricing
    const shopName = session.shop.replace('.myshopify.com', '');
    const appHandle = "ecom-kit-2";
    
    // Avec Managed Pricing, vous pouvez vérifier le statut via GraphQL
    const subscriptionQuery = `
      query appInstallation {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
          }
        }
      }
    `;
    
    try {
      const subscriptionResponse = await admin.graphql(subscriptionQuery);
      const subscriptionData = await subscriptionResponse.json();
      
      const activeSubscriptions = subscriptionData.data?.currentAppInstallation?.activeSubscriptions || [];
      const hasActiveSubscription = activeSubscriptions.length > 0;
      
      console.log("📋 Active subscriptions:", activeSubscriptions);
      console.log("✅ Has subscription:", hasActiveSubscription);
      
      // Si pas d'abonnement et qu'on n'est pas déjà sur la page de plans
      const url = new URL(request.url);
      const isOnPlansPage = url.pathname.includes('/plans');
      
      if (!hasActiveSubscription && !isOnPlansPage) {
        console.log("🔄 Redirection vers pricing plans");
        // Redirection vers la page Shopify de sélection des plans
        const pricingUrl = `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`;
        return redirect(pricingUrl);
      }
      
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shop: session.shop,
        managedPricing: true,
        hasSubscription: hasActiveSubscription,
        subscriptions: activeSubscriptions,
        pricingUrl: `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`
      });
      
    } catch (subscriptionError) {
      console.warn("⚠️ Erreur vérification abonnement:", subscriptionError);
      
      // En cas d'erreur, on laisse passer (pour éviter de bloquer l'app)
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shop: session.shop,
        managedPricing: true,
        hasSubscription: true, // On assume qu'il y a un abonnement en cas d'erreur
        subscriptions: [],
        pricingUrl: `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`
      });
    }
    
  } catch (error) {
    console.error("❌ Erreur d'authentification:", error);
    throw new Response("Authentication failed", { status: 500 });
  }
};

export default function App() {
  const { apiKey, shop, managedPricing, hasSubscription, subscriptions, pricingUrl } = useLoaderData();
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
        
        {/* Debug info - à retirer en production */}
        {!hasSubscription && (
          <Link to={pricingUrl} target="_blank">⚠️ Upgrade Plan</Link>
        )}
      </NavMenu>
      
      {/* Shopify Managed Pricing gère automatiquement la facturation */}
      <Outlet context={{ 
        shop, 
        managedPricing, 
        hasSubscription, 
        subscriptions,
        pricingUrl 
      }} />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};