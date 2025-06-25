// app/routes/app.plans.jsx
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export const loader = async () => {
  return json({ success: true });
};

export default function PlansPage() {
  const handleRedirectToPricing = () => {
    // URL exacte qui fonctionne manuellement
    const pricingUrl = "https://admin.shopify.com/store/ecomkit-demo/charges/ecom-kit-2/pricing_plans";
    
    console.log("Redirection vers:", pricingUrl);
    
    try {
      // Méthode simple et fiable: Redirection directe
      if (window.top) {
        window.top.location.href = pricingUrl;
      } else {
        window.location.href = pricingUrl;
      }
      console.log("Redirection lancée");
    } catch (error) {
      console.log("Erreur de redirection:", error);
      // Fallback
      window.open(pricingUrl, '_blank');
    }
  };

  return (
    <Page>
      <TitleBar title="Plans & Facturation" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Text variant="headingMd" as="h2">
              💼 Plan Premium
            </Text>
            <Text variant="bodyMd" as="p">
              Débloquez toutes les fonctionnalités d'Ecom-kit pour booster vos ventes.
            </Text>
            <Text variant="bodyMd" as="p">
              <strong>19,90€/mois</strong> - ✨ Essai gratuit de 7 jours
            </Text>
            
            <ul style={{ margin: "15px 0", paddingLeft: "20px" }}>
              <li>🚀 Accès à toutes les fonctionnalités BoostCart</li>
              <li>📊 Analytics avancées</li>
              <li>🎯 Support prioritaire</li>
              <li>💡 Mises à jour automatiques</li>
            </ul>
            
            <div style={{ marginTop: "20px" }}>
              <Button 
                primary 
                size="large"
                onClick={handleRedirectToPricing}
              >
                🎯 Commencer l'essai gratuit
              </Button>
            </div>
            
            <Text variant="bodySm" as="p" color="subdued" alignment="center">
              Vous serez redirigé vers la page de facturation Shopify
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}