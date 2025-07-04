import { json, redirect } from "@remix-run/node";
import { useActionData, Form, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, Text, Button, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useEffect } from "react";

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  
  if (formData.get("action") === "subscribe") {
    console.log("🚀 Création d'abonnement pour:", session.shop);
    
    try {
      // Créer un vrai abonnement Shopify avec le bon shop dans l'URL
      const billingCheck = await billing.request({
        plan: "starter", // ✅ CORRIGÉ : utilise le nom exact du Partners Dashboard
        isTest: true, // Mettez false en production
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app?shop=${session.shop}`, // ✅ CORRIGÉ : inclut le shop actuel
      });
      
      console.log("✅ Abonnement créé:", billingCheck);
      
      // Rediriger vers l'URL de confirmation Shopify
      return redirect(billingCheck.confirmationUrl);
      
    } catch (error) {
      console.error("❌ Erreur création abonnement:", error);
      
      return json({ 
        error: "Erreur lors de la création de l'abonnement",
        details: error.message 
      });
    }
  }
  
  return json({ success: true });
};

export default function PlansPage() {
  const actionData = useActionData();
  const navigation = useNavigation();
  
  const isSubscribing = navigation.formData?.get("action") === "subscribe";

  return (
    <Page>
      <TitleBar title="Plans & Facturation" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                💼 Starter Plan - 19,90$/mois
              </Text>
              
              <Text variant="bodyMd">
                ✨ 14 jours d'essai gratuit puis 19,90$/mois
              </Text>
              
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Fonctionnalités incluses :
                </Text>
                <ul style={{ paddingLeft: "20px" }}>
                  <li>BoostCart - Panier intelligent avec offres progressives</li>
                  <li>Pack Builder - Créateur de packs interactif</li>
                  <li>Bundle Cards - Affichage élégant des variantes</li>
                  <li>Ultimate Pack - Constructeur de packs avancé</li>
                  <li>Support client prioritaire</li>
                  <li>Mises à jour gratuites</li>
                </ul>
              </BlockStack>
              
              {actionData?.error && (
                <Text variant="bodyMd" tone="critical">
                  ❌ {actionData.error}
                  {actionData.details && <div>Détails: {actionData.details}</div>}
                </Text>
              )}
              
              {actionData?.success && (
                <Text variant="bodyMd" tone="success">
                  ✅ Redirection vers la page de paiement...
                </Text>
              )}
              
              <Form method="post">
                <input type="hidden" name="action" value="subscribe" />
                <Button 
                  variant="primary"
                  size="large"
                  loading={isSubscribing}
                  submit
                  fullWidth
                >
                  {isSubscribing ? "⏳ Création en cours..." : "🎯 Commencer l'essai gratuit"}
                </Button>
              </Form>
              
              <Text variant="bodySm" tone="subdued">
                Vous serez redirigé vers la page de paiement Shopify officielle
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}