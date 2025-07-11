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
    
    // Test simple avec billing.check()
    const { hasActivePayment, appSubscriptions } = await billing.check();
    console.log("Billing check résultat:", { hasActivePayment, appSubscriptions });
    
    return json({
      subscription: appSubscriptions?.[0] || null,
      hasActivePayment
    });
  } catch (error) {
    console.error("Erreur loader billing:", error);
    return json({
      subscription: null,
      hasActivePayment: false,
      error: error.message
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
        const response = await billing.request({
          plan: plan,
          isTest: true,
          returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?success=1`,
        });
        
        console.log("Réponse billing.request:", response);
        console.log("Redirection vers:", response.confirmationUrl);
        
        return redirect(response.confirmationUrl);
      } catch (billingError) {
        console.log("Erreur billing attrapée:", billingError);
        
        // Vérifier si c'est une erreur 401 avec URL de réauthorisation
        if (billingError.status === 401 && billingError.headers) {
          const reauthorizeUrl = billingError.headers.get('X-Shopify-API-Request-Failure-Reauthorize-Url');
          
          if (reauthorizeUrl) {
            console.log("URL de réauthorisation trouvée:", reauthorizeUrl);
            // Retourner l'URL pour redirection côté client
            return json({
              redirectToTop: reauthorizeUrl
            });
          }
        }
        
        // Si ce n'est pas le cas, relancer l'erreur
        throw billingError;
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
  const { subscription, hasActivePayment, error } = useLoaderData();
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
        {/* Message de debug */}
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

        {/* Abonnement actif */}
        {subscription && (
          <Layout.Section>
            <Banner title={`Abonné au plan ${subscription.name}`} tone="success">
              <Button onClick={handleCancel} tone="critical">
                Annuler
              </Button>
            </Banner>
          </Layout.Section>
        )}

        {/* Erreurs */}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Erreur">
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}

        {/* Plans disponibles */}
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
      </Layout>
    </Page>
  );
}