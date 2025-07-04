import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  try {
    // Authenticate with Shopify credentials
    const { admin, billing, session } = await authenticate.admin(request);
    
    // Détecter votre boutique de développement
    const shopDomain = session.shop;
    console.log("Shop domain:", shopDomain);
    
    const isDevelopmentStore = shopDomain === 'ecomkit-demo.myshopify.com';
    console.log("Is your development store:", isDevelopmentStore);
    
    // 🚫 BYPASS TEMPORAIREMENT DÉSACTIVÉ POUR DEBUG
    // if (isDevelopmentStore) {
    //   console.log("✅ Development store detected - free access granted");
    //   return json({
    //     apiKey: process.env.SHOPIFY_API_KEY || "",
    //     subscription: {
    //       hasAccess: true,
    //       isTrialActive: false,
    //       isDevelopmentStore: true,
    //       subscriptionStatus: 'DEVELOPMENT',
    //       trialDaysRemaining: null,
    //       details: null
    //     }
    //   });
    // }
    
    // MAINTENANT TOUTES LES BOUTIQUES (Y COMPRIS VOTRE DEV) PASSENT PAR LA VÉRIFICATION
    console.log("🔍 Checking subscription for store:", shopDomain);
    
    // ✅ UTILISER LE BON NOM DE PLAN QUI CORRESPOND À PARTNERS DASHBOARD
    await billing.require({
      plans: ["starter"], // ✅ CORRIGÉ : utilise le nom exact du Partners Dashboard
      onFailure: async () => {
        throw new Response("Could not verify a subscription", { status: 401 });
      },
    });
    
    // Si on arrive ici, l'abonnement est actif
    const { appSubscriptions } = await billing.check();
    const subscription = appSubscriptions[0];
    const isTrialActive = subscription?.test || false;
    const subscriptionStatus = subscription?.status || 'ACTIVE';
    
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
        isDevelopmentStore, // 🆕 Gardons cette info pour référence
        subscriptionStatus,
        trialDaysRemaining,
        details: subscription
      }
    });
    
  } catch (error) {
    console.error("Error in app loader:", error);
    
    // Si c'est une erreur 401 (pas d'abonnement), Shopify redirigera automatiquement
    if (error instanceof Response && error.status === 401) {
      throw error;
    }
    
    // Pour toute autre erreur, essayer de continuer
    try {
      const { session } = await authenticate.admin(request);
      
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        subscription: {
          hasAccess: false,
          isTrialActive: false,
          subscriptionStatus: 'ERROR',
          trialDaysRemaining: null,
          details: null,
          error: error.message
        }
      });
    } catch (fallbackError) {
      // En dernier recours
      throw new Response("Authentication failed", { status: 500 });
    }
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
        <Link to="/app/setup-packbuilder">Set-up Pack Builder</Link>
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
};