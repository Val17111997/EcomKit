import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  Banner,
  Badge,
  Divider,
  Box,
  InlineStack,
  BlockStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useEffect } from "react";

// Plans définis directement dans le fichier pour éviter les erreurs d'import
const BASIC_MONTHLY_PLAN = "Basic Monthly";
const PREMIUM_MONTHLY_PLAN = "Premium Monthly";
const BASIC_ANNUAL_PLAN = "Basic Annual";
const PREMIUM_ANNUAL_PLAN = "Premium Annual";

export const loader = async ({ request }) => {
  try {
    console.log("=== BILLING LOADER START ===");
    
    const { billing } = await authenticate.admin(request);
    console.log("Authentification réussie");
    
    // Vérifier si c'est un retour de succès depuis Shopify
    const url = new URL(request.url);
    const success = url.searchParams.get('success');
    const chargeId = url.searchParams.get('charge_id');
    
    // Si c'est un retour de succès, afficher une page de confirmation
    if (success === '1' && chargeId) {
      console.log("Retour de succès détecté, charge_id:", chargeId);
      return json({
        subscription: null,
        hasActivePayment: false,
        successReturn: true,
        chargeId: chargeId,
        showSuccessPage: true
      });
    }
    
    // Test simple avec billing.check()
    const { hasActivePayment, appSubscriptions } = await billing.check();
    console.log("Billing check résultat:", { hasActivePayment, appSubscriptions });
    
    return json({
      subscription: appSubscriptions?.[0] || null,
      hasActivePayment,
      successReturn: false,
      showSuccessPage: false
    });
  } catch (error) {
    console.error("Erreur loader billing:", error);
    return json({
      subscription: null,
      hasActivePayment: false,
      error: error.message,
      successReturn: false,
      showSuccessPage: false
    });
  }
};

export const action = async ({ request }) => {
  try {
    console.log("=== ACTION START ===");
    
    const { billing } = await authenticate.admin(request);
    console.log("Authentification action réussie");
    
    const formData = await request.formData();
    const action = formData.get("action");
    const plan = formData.get("plan");

    console.log("Action reçue:", { action, plan });

    if (action === "subscribe") {
      console.log("Début création abonnement pour:", plan);
      
      console.log("Tentative billing.request avec paramètres:", {
        plan: plan,
        isTest: true,
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?success=1`
      });
      
      try {
        // URL de retour - utiliser l'URL locale en développement
        const url = new URL(request.url);
        const isDev = url.hostname.includes('trycloudflare.com') || url.hostname === 'localhost';
        
        let returnUrl;
        if (isDev) {
          // En développement, utiliser l'URL du tunnel CloudFlare
          returnUrl = `${url.protocol}//${url.host}/app/billing/return`;
        } else {
          // En production, utiliser l'URL de production
          returnUrl = `https://ecomkit.fly.dev/app/billing/return`;
        }
        
        console.log("URL de retour calculée:", returnUrl);
        console.log("Environnement détecté:", isDev ? "Développement" : "Production");
        
        const response = await billing.request({
          plan: plan,
          isTest: true,
          returnUrl: returnUrl,
        });
        
        console.log("Réponse billing.request:", response);
        console.log("Redirection vers:", response.confirmationUrl);
        
        return redirect(response.confirmationUrl);
      } catch (billingError) {
        console.log("Erreur billing attrapée:", billingError);
        
        // Cas 1: Erreur 401 avec URL de réauthorisation (normal)
        if (billingError.status === 401 && billingError.headers) {
          const reauthorizeUrl = billingError.headers.get('X-Shopify-API-Request-Failure-Reauthorize-Url');
          
          if (reauthorizeUrl) {
            console.log("URL de réauthorisation trouvée:", reauthorizeUrl);
            return json({
              redirectToTop: reauthorizeUrl
            });
          } else {
            console.log("Erreur 401 sans URL de réauthorisation");
            return json({ 
              error: "Impossible de créer l'abonnement. Veuillez réessayer." 
            }, { status: 500 });
          }
        }
        
        // Cas 2: Autres types d'erreurs
        console.error("Erreur billing non gérée:", billingError);
        return json({ 
          error: `Erreur lors de la création de l'abonnement: ${billingError.message || 'Erreur inconnue'}` 
        }, { status: 500 });
      }
    }
    
    if (action === "cancel") {
      console.log("Tentative annulation");
      const { appSubscriptions } = await billing.check();
      if (appSubscriptions?.[0]) {
        await billing.cancel({
          subscriptionId: appSubscriptions[0].id,
        });
        return json({ success: true, message: "Abonnement annulé" });
      }
    }
  } catch (error) {
    console.error("ERREUR DÉTAILLÉE dans action billing:");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("Error object:", error);
    
    return json({ 
      error: `Erreur lors de la souscription: ${error.message}`,
      details: error.stack 
    }, { status: 500 });
  }

  return json({ success: false });
};

const plans = [
  {
    id: BASIC_MONTHLY_PLAN,
    name: "Basic",
    price: "19,90€",
    interval: "par mois",
    features: ["Boost-Cart", "Bundle-card", "Ultimate pack", "Pack builder"],
    popular: false,
  },
  {
    id: PREMIUM_MONTHLY_PLAN,
    name: "Premium",
    price: "29,90€",
    interval: "par mois",
    features: ["Toutes les fonctionnalités Basic", "Support prioritaire", "Fonctionnalités avancées"],
    popular: true,
  },
  {
    id: BASIC_ANNUAL_PLAN,
    name: "Basic Annuel",
    price: "199,90€",
    interval: "par an",
    savings: "Économisez 38,90€",
    features: ["Boost-Cart", "Bundle-card", "Ultimate pack", "Pack builder"],
    popular: false,
  },
  {
    id: PREMIUM_ANNUAL_PLAN,
    name: "Premium Annuel",
    price: "299,90€",
    interval: "par an",
    savings: "Économisez 58,90€",
    features: ["Toutes les fonctionnalités Basic", "Support prioritaire", "Fonctionnalités avancées"],
    popular: false,
  },
];

export default function Billing() {
  const { subscription, hasActivePayment, error, successReturn, showSuccessPage, chargeId } = useLoaderData();
  const submit = useSubmit();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  // Gestion de la redirection vers Shopify (sortir de l'iframe)
  useEffect(() => {
    if (actionData?.redirectToTop) {
      console.log("Redirection forcée vers:", actionData.redirectToTop);
      window.top.location.href = actionData.redirectToTop;
    }
  }, [actionData]);

  // Si c'est une page de succès, afficher le message de confirmation
  if (showSuccessPage) {
    return (
      <Page title="Abonnement confirmé !">
        <Layout>
          <Layout.Section>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '60vh',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '4rem', marginBottom: '2rem' }}>🎉</div>
              
              <Text variant="heading2xl" as="h1" alignment="center">
                Félicitations !
              </Text>
              
              <Text variant="headingLg" as="h2" alignment="center" tone="subdued">
                Votre abonnement à ecom-kit a été confirmé
              </Text>
              
              <div style={{
                backgroundColor: '#e8f5e8',
                padding: '2rem',
                borderRadius: '12px',
                margin: '2rem 0',
                border: '2px solid #00a86b',
                maxWidth: '500px'
              }}>
                <Text variant="headingMd" as="h3" alignment="center">
                  ✅ Votre essai gratuit de 7 jours a commencé !
                </Text>
                <Text alignment="center" tone="subdued">
                  ID de transaction : {chargeId}
                </Text>
              </div>

              <div style={{
                backgroundColor: '#f8f9fa',
                padding: '2rem',
                borderRadius: '8px',
                marginBottom: '2rem',
                textAlign: 'left',
                maxWidth: '600px'
              }}>
                <Text variant="headingMd" as="h3">
                  Prochaines étapes :
                </Text>
                <div style={{ marginTop: '1rem' }}>
                  <Text as="p">• Retournez à votre admin Shopify</Text>
                  <Text as="p">• Cliquez sur "Apps" dans le menu de gauche</Text>
                  <Text as="p">• Trouvez et cliquez sur "ecom-kit"</Text>
                  <Text as="p">• Commencez à configurer vos extensions !</Text>
                </div>
              </div>

              <Button
                variant="primary"
                size="large"
                onClick={() => {
                  window.top.location.href = 'https://admin.shopify.com';
                }}
              >
                Retourner à Shopify Admin
              </Button>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const handleSubscribe = (planId) => {
    console.log("Clic sur plan:", planId);
    submit(
      { action: "subscribe", plan: planId },
      { method: "POST" }
    );
  };

  const handleCancel = () => {
    if (confirm("Annuler l'abonnement ?")) {
      submit({ action: "cancel" }, { method: "POST" });
    }
  };

  return (
    <Page title="Facturation">
      <Layout>
        {/* Message de debug - temporaire */}
        {!showSuccessPage && (
          <Layout.Section>
            <Card>
              <Text as="h3" variant="headingMd">État de l'abonnement</Text>
              <Text as="p">
                Subscription: {subscription ? JSON.stringify(subscription) : "Aucun"}<br/>
                Has Active Payment: {hasActivePayment ? "Oui" : "Non"}<br/>
                Error: {error || "Aucune"}
              </Text>
            </Card>
          </Layout.Section>
        )}

        {/* Abonnement actif */}
        {!showSuccessPage && subscription && (
          <Layout.Section>
            <Banner title={`Abonné au plan ${subscription.name}`} tone="success">
              <Button onClick={handleCancel} tone="critical">
                Annuler
              </Button>
            </Banner>
          </Layout.Section>
        )}

        {/* Erreurs */}
        {!showSuccessPage && actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Erreur">
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}

        {/* Message de succès */}
        {!showSuccessPage && actionData?.success && (
          <Layout.Section>
            <Banner tone="success" title="Succès">
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}

        {/* Plans disponibles */}
        {!showSuccessPage && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg" as="h2">Choisissez votre plan</Text>
                
                {plans.map((plan) => (
                  <Card key={plan.id} sectioned>
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="headingMd">{plan.name}</Text>
                        {plan.popular && <Badge tone="attention">Populaire</Badge>}
                        {plan.savings && <Badge tone="success">{plan.savings}</Badge>}
                      </InlineStack>
                      
                      <Text variant="headingLg">{plan.price}</Text>
                      <Text tone="subdued">{plan.interval}</Text>
                      
                      <BlockStack gap="100">
                        {plan.features.map((feature, index) => (
                          <Text key={index}>✓ {feature}</Text>
                        ))}
                      </BlockStack>
                      
                      <Button
                        variant={plan.popular ? "primary" : "secondary"}
                        onClick={() => handleSubscribe(plan.id)}
                        loading={isLoading}
                        fullWidth
                      >
                        Choisir ce plan
                      </Button>
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}