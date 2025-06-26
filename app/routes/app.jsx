import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  // Replace with the "app_handle" from your shopify.app.toml file
  const appHandle = "ecom-kit-2";
  
  try {
    // Authenticate with Shopify credentials to handle server-side queries
    const { admin, billing, redirect, session } = await authenticate.admin(request);
    
    // SOLUTION SIMPLE : Détecter votre boutique par son nom
    const shopDomain = session.shop;
    console.log("Shop domain:", shopDomain);
    
    const isDevelopmentStore = shopDomain === 'ecomkit-demo.myshopify.com';
    console.log("Is your development store:", isDevelopmentStore);
    
    // Si c'est VOTRE boutique de développement, accès gratuit
    if (isDevelopmentStore) {
      console.log("✅ Development store detected - free access granted");
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        subscription: {
          hasAccess: true,
          isTrialActive: false,
          isDevelopmentStore: true,
          subscriptionStatus: 'DEVELOPMENT',
          trialDaysRemaining: null,
          details: null
        }
      });
    }
    
    // Pour toutes les autres boutiques : vérification d'abonnement normale
    console.log("🔍 Checking subscription for real store:", shopDomain);
    
    const { hasActivePayment, appSubscriptions } = await billing.check();
    
    // Extract the store handle from the shop domain
    const storeHandle = shopDomain.replace('.myshopify.com', '');
    
    // If there's no active subscription, redirect to the plan selection page...
    if (!hasActivePayment) {
      console.log("❌ No active payment - redirecting to pricing");
      return redirect(`https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`, {
        target: "_top", // required since the URL is outside the embedded app scope
      });
    }
    
    // ...Otherwise, continue loading the app as normal
    const subscription = appSubscriptions[0];
    const isTrialActive = subscription?.test || false;
    const subscriptionStatus = subscription?.status || 'UNKNOWN';
    
    // Calculer les jours restants d'essai si applicable
    let trialDaysRemaining = null;
    if (isTrialActive && subscription?.trialDays) {
      const createdAt = new Date(subscription.createdAt);
      const now = new Date();
      const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      trialDaysRemaining = Math.max(0, subscription.trialDays - daysPassed);
    }
    
    return json({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      subscription: {
        hasAccess: true,
        isTrialActive,
        subscriptionStatus,
        trialDaysRemaining,
        details: subscription
      }
    });
    
  } catch (error) {
    console.error("Error in app loader:", error);
    
    // En cas d'erreur, rediriger vers la version simple avec billing check uniquement
    const { billing, redirect, session } = await authenticate.admin(request);
    
    const { hasActivePayment, appSubscriptions } = await billing.check();
    
    const shopDomain = session.shop;
    const storeHandle = shopDomain.replace('.myshopify.com', '');
    
    if (!hasActivePayment) {
      return redirect(`https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`, {
        target: "_top",
      });
    }
    
    const subscription = appSubscriptions[0];
    const isTrialActive = subscription?.test || false;
    const subscriptionStatus = subscription?.status || 'UNKNOWN';
    
    return json({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      subscription: {
        hasAccess: true,
        isTrialActive,
        subscriptionStatus,
        trialDaysRemaining: null,
        details: subscription
      }
    });
  }
};

export default function App() {
  const { apiKey, subscription } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/offers-settings">Set-up BoostCart</Link>
        <Link to="/app/setup-bundlecard">Set-up Bundle-Card</Link>
        <Link to="/app/setup-ultimatepack">Set-up Ultimate Pack</Link>
        <Link to="/app/support">Support client</Link>
        <Link to="/app/plans">Plans & Facturation</Link>
      </NavMenu>
      
      {/* Passer les données d'abonnement aux sous-routes */}
      <Outlet context={{ subscription }} />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
}