import { json, redirect } from "@remix-run/node";
import { useActionData, Form, useNavigation, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, Button, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  
  // 🔍 DIAGNOSTIC APPROFONDI
  try {
    console.log("🔍 Vérification complète de l'environnement billing...");
    
    // Vérifier les abonnements existants
    const { appSubscriptions } = await billing.check();
    console.log("📋 Abonnements existants:", appSubscriptions);
    
    // Informations de debug
    const debugInfo = {
      shop: session.shop,
      environment: process.env.NODE_ENV,
      appUrl: process.env.SHOPIFY_APP_URL,
      hasExistingSubscriptions: appSubscriptions?.length > 0,
      subscriptionDetails: appSubscriptions
    };
    
    return json({ debugInfo });
    
  } catch (error) {
    console.error("❌ Erreur lors du diagnostic:", error);
    return json({ 
      debugInfo: { 
        shop: session.shop, 
        error: error.message
      } 
    });
  }
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  
  if (formData.get("action") === "subscribe") {
    console.log("🚀 === DÉBUT CRÉATION ABONNEMENT ===");
    console.log("🏪 Shop:", session.shop);
    console.log("🌍 Environment:", process.env.NODE_ENV);
    console.log("🔗 App URL:", process.env.SHOPIFY_APP_URL);
    
    try {
      // 🔍 ÉTAPE 1: Vérifier l'état actuel
      console.log("📋 Étape 1: Vérification des abonnements existants...");
      const { appSubscriptions } = await billing.check();
      console.log("📋 Abonnements trouvés:", appSubscriptions?.length || 0);
      
      if (appSubscriptions && appSubscriptions.length > 0) {
        console.log("⚠️ Des abonnements existent déjà:", appSubscriptions);
        return json({
          warning: "Un abonnement existe déjà",
          details: "Vous avez déjà un abonnement actif",
          existingSubscriptions: appSubscriptions
        });
      }
      
      // 🔍 ÉTAPE 2: Tentative de création avec plus de paramètres
      console.log("💳 Étape 2: Création de l'abonnement...");
      console.log("🎯 Plan demandé: 'starter'");
      
      const billingRequest = {
        plan: "starter",
        isTest: true, // 🚨 IMPORTANT: Mode test
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app?shop=${session.shop}`,
      };
      
      console.log("📝 Paramètres de billing.request:", billingRequest);
      
      const billingCheck = await billing.request(billingRequest);
      
      console.log("✅ Succès! Réponse billing:", billingCheck);
      console.log("🔗 URL de confirmation:", billingCheck.confirmationUrl);
      
      // Rediriger vers l'URL de confirmation Shopify
      return redirect(billingCheck.confirmationUrl);
      
    } catch (error) {
      console.error("❌ === ERREUR DÉTAILLÉE ===");
      console.error("❌ Message:", error.message);
      console.error("❌ Stack:", error.stack);
      console.error("❌ Type:", error.constructor.name);
      
      // Plus de détails sur l'erreur
      let detailedError = error.message;
      if (error.response) {
        console.error("❌ Response status:", error.response.status);
        console.error("❌ Response data:", error.response.data);
        detailedError += ` (Status: ${error.response.status})`;
      }
      
      return json({ 
        error: "Erreur lors de la création de l'abonnement",
        details: detailedError,
        timestamp: new Date().toISOString(),
        shop: session.shop
      });
    }
  }
  
  // Action pour nettoyer les abonnements existants (debug)
  if (formData.get("action") === "cleanup") {
    try {
      const { appSubscriptions } = await billing.check();
      console.log("🧹 Nettoyage - Abonnements trouvés:", appSubscriptions);
      
      return json({
        cleanup: true,
        found: appSubscriptions?.length || 0,
        subscriptions: appSubscriptions
      });
    } catch (error) {
      return json({
        error: "Erreur lors du nettoyage",
        details: error.message
      });
    }
  }
  
  return json({ success: true });
};

export default function PlansPage() {
  const { debugInfo } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  
  const isSubscribing = navigation.formData?.get("action") === "subscribe";
  const isCleaning = navigation.formData?.get("action") === "cleanup";

  return (
    <Page>
      <TitleBar title="Plans & Facturation - DEBUG" />
      <Layout>
        <Layout.Section>
          
          {/* INFORMATIONS DE DEBUG */}
          <Card sectioned>
            <BlockStack gap="300">
              <Text variant="headingSm" tone="critical">
                🔍 INFORMATIONS DE DEBUG
              </Text>
              <Text variant="bodyMd">Shop: {debugInfo.shop}</Text>
              <Text variant="bodyMd">Environment: {debugInfo.environment || 'undefined'}</Text>
              <Text variant="bodyMd">App URL: {debugInfo.appUrl || 'undefined'}</Text>
              <Text variant="bodyMd">
                Abonnements existants: {debugInfo.hasExistingSubscriptions ? '✅ OUI' : '❌ NON'}
              </Text>
              {debugInfo.subscriptionDetails && (
                <Text variant="bodyMd">
                  Détails: {JSON.stringify(debugInfo.subscriptionDetails, null, 2)}
                </Text>
              )}
            </BlockStack>
          </Card>

          <Card sectioned>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                💼 Starter Plan - 19,90$/mois
              </Text>
              
              <Text variant="bodyMd">
                ✨ 14 jours d'essai gratuit puis 19,90$/mois
              </Text>
              
              {/* RÉSULTATS DES ACTIONS */}
              {actionData?.error && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" tone="critical">❌ ERREUR DÉTAILLÉE</Text>
                    <Text variant="bodyMd" tone="critical">{actionData.error}</Text>
                    <Text variant="bodyMd">Détails: {actionData.details}</Text>
                    <Text variant="bodyMd">Timestamp: {actionData.timestamp}</Text>
                    <Text variant="bodyMd">Shop: {actionData.shop}</Text>
                  </BlockStack>
                </Card>
              )}
              
              {actionData?.warning && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" tone="warning">⚠️ AVERTISSEMENT</Text>
                    <Text variant="bodyMd">{actionData.warning}</Text>
                    <Text variant="bodyMd">{actionData.details}</Text>
                    <Text variant="bodyMd">
                      Abonnements: {JSON.stringify(actionData.existingSubscriptions, null, 2)}
                    </Text>
                  </BlockStack>
                </Card>
              )}
              
              {actionData?.cleanup && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" tone="success">🧹 NETTOYAGE</Text>
                    <Text variant="bodyMd">Abonnements trouvés: {actionData.found}</Text>
                    <Text variant="bodyMd">
                      Détails: {JSON.stringify(actionData.subscriptions, null, 2)}
                    </Text>
                  </BlockStack>
                </Card>
              )}
              
              {/* BOUTONS D'ACTION */}
              <BlockStack gap="300">
                <Form method="post">
                  <input type="hidden" name="action" value="subscribe" />
                  <Button 
                    variant="primary"
                    size="large"
                    loading={isSubscribing}
                    submit
                    fullWidth
                  >
                    {isSubscribing ? "⏳ Création en cours..." : "🎯 Créer abonnement (mode debug)"}
                  </Button>
                </Form>
                
                <Form method="post">
                  <input type="hidden" name="action" value="cleanup" />
                  <Button 
                    variant="secondary"
                    size="medium"
                    loading={isCleaning}
                    submit
                    fullWidth
                  >
                    {isCleaning ? "🧹 Vérification..." : "🔍 Vérifier abonnements existants"}
                  </Button>
                </Form>
              </BlockStack>
              
              <Text variant="bodySm" tone="subdued">
                Version debug avec logs complets dans la console serveur
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}