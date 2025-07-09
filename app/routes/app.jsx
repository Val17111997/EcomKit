import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  try {
    // Remplacez par le "app_handle" de votre fichier shopify.app.toml
    const appHandle = "ecom-kit-2";
    
    // Authentification avec les credentials Shopify
    const { billing, session } = await authenticate.admin(request);
    
    console.log("🏪 Shop:", session.shop);
    
    // Vérification de l'abonnement actif avec l'API billing de Shopify
    const { hasActivePayment } = await billing.check();
    
    console.log("✅ Has active payment:", hasActivePayment);
    
    // Extraction du store handle depuis le domaine de la boutique
    const shop = session.shop; // ex: "cool-shop.myshopify.com"
    const storeHandle = shop.replace('.myshopify.com', '');
    
    // Si pas d'abonnement actif, redirection vers la page de sélection de plans
    if (!hasActivePayment) {
      console.log("🔄 Pas d'abonnement actif - Redirection vers pricing plans");
      
      // Redirection côté serveur (recommandée par Shopify)
      return redirect(`https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`, {
        target: "_top" // requis car l'URL est en dehors du scope de l'app embarquée
      });
    }
    
    // Sinon, continuer le chargement normal de l'app
    return json({
      apiKey: "12cef638ec0c369730c3c21c3372f0c9",
      shop: session.shop,
      storeHandle: storeHandle,
      appHandle: appHandle
    });
    
  } catch (error) {
    console.error("❌ Erreur d'authentification:", error);
    throw new Response("Authentication failed", { status: 500 });
  }
};

export default function App() {
  const { apiKey, shop, storeHandle, appHandle } = useLoaderData();

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
      
      <Outlet context={{ 
        shop, 
        storeHandle, 
        appHandle 
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