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
    
    console.log("🏪 Shop:", session.shop);
    
    // Vérification du statut d'abonnement avec Managed Pricing
    const shopName = session.shop.replace('.myshopify.com', '');
    const appHandle = "ecom-kit-2";
    
    // Vérifiez le statut d'abonnement via GraphQL
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
    
    let hasActiveSubscription = false;
    let subscriptions = [];
    
    try {
      const subscriptionResponse = await admin.graphql(subscriptionQuery);
      const subscriptionData = await subscriptionResponse.json();
      
      subscriptions = subscriptionData.data?.currentAppInstallation?.activeSubscriptions || [];
      hasActiveSubscription = subscriptions.length > 0;
      
      console.log("📋 Active subscriptions:", subscriptions);
      console.log("✅ Has subscription:", hasActiveSubscription);
      
    } catch (subscriptionError) {
      console.warn("⚠️ Erreur vérification abonnement:", subscriptionError);
      // En cas d'erreur, on assume pas d'abonnement pour forcer la vérification
      hasActiveSubscription = false;
    }
    
    return json({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shop: session.shop,
      managedPricing: true,
      hasSubscription: hasActiveSubscription,
      subscriptions: subscriptions,
      shopName: shopName,
      appHandle: appHandle,
      pricingUrl: `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`
    });
    
  } catch (error) {
    console.error("❌ Erreur d'authentification:", error);
    throw new Response("Authentication failed", { status: 500 });
  }
};

export default function App() {
  const { 
    apiKey, 
    shop, 
    managedPricing, 
    hasSubscription, 
    subscriptions, 
    shopName, 
    appHandle,
    pricingUrl 
  } = useLoaderData();
  
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    
    // Redirection automatique vers pricing si pas d'abonnement
    if (isClient && !hasSubscription) {
      console.log("🔄 Pas d'abonnement détecté - Redirection vers pricing plans");
      
      // Option 1: App Bridge Navigation (Recommandée)
      if (window.shopify && window.shopify.app) {
        window.shopify.app.getState().then((state) => {
          const url = `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`;
          window.open(url, '_top');
        });
      } else {
        // Option 2: Fallback direct
        const url = `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`;
        window.open(url, '_top');
      }
    }
  }, [isClient, hasSubscription, shopName, appHandle]);

  if (!isClient) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div>Chargement...</div>
      </AppProvider>
    );
  }

  // Si pas d'abonnement, afficher un message de redirection
  if (!hasSubscription) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div style={{ 
          padding: '40px', 
          textAlign: 'center',
          backgroundColor: '#f6f6f7',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <h2>🚀 Bienvenue dans ecom-kit !</h2>
          <p>Redirection vers la sélection de votre plan...</p>
          <br/>
          <p>
            <strong>Si la redirection ne fonctionne pas :</strong>
            <br/>
            <a 
              href={pricingUrl}
              target="_top"
              style={{
                color: '#2563eb',
                textDecoration: 'underline'
              }}
            >
              Cliquez ici pour choisir votre plan
            </a>
          </p>
          <br/>
          <small style={{ color: '#6b7280' }}>
            URL: {pricingUrl}
          </small>
        </div>
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
        
        {/* Debug info */}
        <Link to="#" onClick={(e) => {
          e.preventDefault();
          console.log("🔍 Debug abonnement:", { hasSubscription, subscriptions });
        }}>
          Debug: {hasSubscription ? '✅ Abonné' : '❌ Pas abonné'}
        </Link>
      </NavMenu>
      
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