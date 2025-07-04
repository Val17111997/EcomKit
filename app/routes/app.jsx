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
    // Authentification et vérification d'abonnement
    const { admin, session } = await authenticate.admin(request);
    
    console.log("🏪 Shop:", session.shop);
    
    // ✅ VÉRIFIER L'ABONNEMENT AVEC MANAGED PRICING
    try {
      // Requête GraphQL pour vérifier les abonnements actifs
      const query = `
        query {
          currentAppInstallation {
            id
            activeSubscriptions {
              id
              name
              status
              test
            }
          }
        }
      `;
      
      const response = await admin.graphql(query);
      const data = await response.json();
      
      const installation = data.data?.currentAppInstallation;
      const activeSubscriptions = installation?.activeSubscriptions || [];
      
      console.log("📊 Abonnements actifs:", activeSubscriptions.length);
      
      // ✅ RETOURNER L'INFO AU CLIENT AU LIEU DE REDIRIGER CÔTÉ SERVEUR
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shop: session.shop,
        managedPricing: true,
        hasActiveSubscription: activeSubscriptions.length > 0,
        needsBilling: activeSubscriptions.length === 0,
        // URL pour la redirection côté client
        billingUrl: `https://${session.shop}/admin/charges/ecom-kit-2/pricing_plans`
      });
      
    } catch (graphqlError) {
      console.log("⚠️ Erreur lors de la vérification - Accès limité autorisé");
      
      return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shop: session.shop,
        managedPricing: true,
        hasActiveSubscription: false,
        needsBilling: true,
        billingUrl: `https://${session.shop}/admin/charges/ecom-kit-2/pricing_plans`
      });
    }
    
  } catch (error) {
    console.error("❌ Erreur d'authentification:", error);
    throw new Response("Authentication failed", { status: 500 });
  }
};

export default function App() {
  const { apiKey, shop, managedPricing, hasActiveSubscription, needsBilling, billingUrl } = useLoaderData();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // ✅ REDIRECTION AVEC APP BRIDGE (méthode officielle Shopify)
  useEffect(() => {
    if (isClient && needsBilling && billingUrl) {
      console.log("🔄 Redirection via App Bridge vers:", billingUrl);
      
      try {
        // Méthode 1: Via App Bridge
        if (window.shopifyApp) {
          window.shopifyApp.redirect({
            url: billingUrl,
            target: 'parent'
          });
        } 
        // Méthode 2: Via postMessage à la fenêtre parent
        else if (window.parent) {
          window.parent.postMessage({
            type: 'SHOPIFY_APP_REDIRECT',
            url: billingUrl
          }, '*');
        }
        // Méthode 3: Meta refresh (fallback)
        else {
          const meta = document.createElement('meta');
          meta.httpEquiv = 'refresh';
          meta.content = `0; url=${billingUrl}`;
          document.head.appendChild(meta);
        }
      } catch (error) {
        console.error("Erreur de redirection:", error);
      }
    }
  }, [isClient, needsBilling, billingUrl]);

  if (!isClient) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div>Chargement...</div>
      </AppProvider>
    );
  }

  // ✅ AFFICHER MESSAGE AVEC LIEN MANUEL
  if (needsBilling) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <div style={{ 
          padding: "40px", 
          textAlign: "center",
          fontSize: "16px",
          maxWidth: "600px",
          margin: "0 auto"
        }}>
          <div style={{ fontSize: "18px", marginBottom: "20px" }}>
            🎯 <strong>Abonnement requis</strong>
          </div>
          
          <div style={{ marginBottom: "30px", color: "#666" }}>
            Pour utiliser cette application, vous devez souscrire à un plan.
          </div>
          
          <div style={{ marginBottom: "20px" }}>
            <a 
              href={billingUrl} 
              target="_parent"
              style={{
                display: "inline-block",
                padding: "12px 24px",
                backgroundColor: "#5c6ac4",
                color: "white",
                textDecoration: "none",
                borderRadius: "4px",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              📋 Voir les plans disponibles
            </a>
          </div>
          
          <div style={{ fontSize: "14px", color: "#999" }}>
            Vous serez redirigé vers la page de sélection de plan Shopify
          </div>
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
        <Link to="/app/plans">Plans & Facturation</Link>g
        <Link to="/app/support">Support client</Link>
      </NavMenu>
      
      {/* Plus de gestion d'abonnement complexe - Shopify gère tout ! */}
      <Outlet context={{ shop, managedPricing, hasActiveSubscription }} />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};