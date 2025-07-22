import { useEffect } from "react";
import { Link, useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  InlineStack,
  Divider,
  Badge,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const { shop } = session;

    let usage = await prisma.usageSubscription.findUnique({ where: { shop } });

    if (!usage) {
      const returnUrl = `${process.env.SHOPIFY_APP_URL}/app`;
      const result = await admin.graphql(`
        mutation createSub($returnUrl: URL!) {
          appSubscriptionCreate(
            name: "Abonnement commandes mensuelles",
            returnUrl: $returnUrl,
            lineItems: [{ plan: { appUsagePricingDetails: {
              cappedAmount: { amount: 39.90, currencyCode: EUR }
              terms: "Gratuit jusqu’à 30 commandes/mois. 31 à 300 commandes/mois : 19,90 €. Plus de 300 commandes/mois : 39,90 €."
            } } }],
            trialDays: 7
          ) {
            confirmationUrl
            appSubscription { id lineItems { id } }
            userErrors { field message }
          }
        }
      `, { variables: { returnUrl } });

      const data = await result.json();
      const payload = data.data.appSubscriptionCreate;
      if (payload.userErrors?.length) {
        throw new Error(payload.userErrors.map(e => e.message).join(", "));
      }
      await prisma.usageSubscription.create({
        data: {
          shop,
          subscriptionId: payload.appSubscription.id,
          lineItemId: payload.appSubscription.lineItems[0].id,
          cycleStart: new Date(),
        },
      });
      return json({ confirmationUrl: payload.confirmationUrl });
    }

    let nextPrice = 0;
    if (usage.orderCount > 300) nextPrice = 39.90;
    else if (usage.orderCount > 30) nextPrice = 19.90;

    return json({ orderCount: usage.orderCount, nextPrice });
  } catch (error) {
    console.error("Erreur dans loader:", error);
    return json({ error: error.message });
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  // Action pour activer/désactiver les extensions si nécessaire
  return { success: true };
};

export default function Index() {
  const { orderCount, nextPrice, error, confirmationUrl } = useLoaderData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (confirmationUrl) {
      const redirect = Redirect.create(shopify);
      redirect.dispatch(Redirect.Action.REMOTE, confirmationUrl);
    }
  }, [confirmationUrl, shopify]);

  if (confirmationUrl) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <Text>Redirection vers la page de souscription…</Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const extensions = [
    {
      id: "boostcart",
      name: "BoostCart",
      description: "Drawer de panier intelligent avec offres progressives",
      features: [
        "Barre de progression avec paliers de réduction",
        "Produits offerts automatiques selon le montant",
        "Section produits complémentaires"
      ],
      configUrl: "/app/offers-settings"
    },
    {
      id: "packbuilder",
      name: "Pack Builder",
      description: "Créateur de packs avec sélection de variantes",
      features: [
        "Sélection interactive de variantes",
        "Toast notifications élégants",
        "Validation intelligente des choix"
      ],
      configUrl: "/app/setup-packbuilder"
    },
    {
      id: "bundle-cards",
      name: "Bundle Cards",
      description: "Affichage des variantes sous forme de cartes élégantes",
      features: [
        "Cartes visuelles pour chaque variante",
        "Badges personnalisables par variante",
        "Prix barrés automatiques"
      ],
      configUrl: "/app/setup-bundlecard"
    },
    {
      id: "ultimate-pack",
      name: "Ultimate Pack",
      description: "Constructeur de pack interactif avec paliers de réduction",
      features: [
        "Interface de construction de pack intuitive",
        "Système de paliers avec réductions progressives",
        "Sauvegarde automatique de la sélection"
      ],
      configUrl: "/app/setup-ultimatepack"
    }
  ];

  return (
    <Page>
      <TitleBar title="Ecomkit - Extensions Shopify">
      </TitleBar>
      
      <BlockStack gap="800">
        {/* Informations de consommation */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Votre consommation ce mois-ci</Text>
                <Text as="p">{orderCount ?? 0} commandes</Text>
                <Text as="p" tone="subdued">
                  Montant prévisionnel : {nextPrice === 0 ? "gratuit" : `${nextPrice}€`}
                </Text>
                <Text tone="subdued" as="p">
                  Gratuit jusqu’à 30 commandes, 19,90 € jusqu’à 300, puis 39,90 €.
                </Text>
                {error && <Text as="p" tone="critical">❌ Erreur: {error}</Text>}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* En-tête de bienvenue */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="h1" variant="headingLg">
                      Bienvenue dans Ecomkit 🚀
                    </Text>
                    <Badge tone="warning">
                      Version de test
                    </Badge>
                  </InlineStack>
                  <Text variant="bodyLg" as="p" tone="subdued">
                    Votre suite d'extensions pour optimiser l'expérience d'achat et booster vos conversions
                  </Text>
                </BlockStack>
                
                <Divider />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Grille des extensions */}
        <Layout>
          <Layout.Section>
            <BlockStack gap="600">
              <Text as="h2" variant="headingLg">Vos Extensions</Text>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
                gap: '1.5rem' 
              }}>
                {extensions.map((extension) => (
                  <Card key={extension.id}>
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <InlineStack gap="300">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">{extension.name}</Text>
                          </BlockStack>
                        </InlineStack>
                      </InlineStack>
                      
                      <Text variant="bodyMd" tone="subdued">
                        {extension.description}
                      </Text>
                      
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">Fonctionnalités principales :</Text>
                        <List type="bullet">
                          {extension.features.map((feature, index) => (
                            <List.Item key={index}>{feature}</List.Item>
                          ))}
                        </List>
                      </BlockStack>
                      
                      {/* Bouton de configuration */}
                      <Box paddingBlockStart="300">
                        <Link to={extension.configUrl} style={{ textDecoration: 'none' }}>
                          <Button 
                            variant="primary" 
                            size="medium"
                          >
                            Configurer
                          </Button>
                        </Link>
                      </Box>
                    </BlockStack>
                  </Card>
                ))}
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Accès rapide aux configurations */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Accès rapide aux configurations</Text>
                <Text variant="bodyMd" tone="subdued">
                  Configurez rapidement vos extensions depuis ces raccourcis
                </Text>
                
                <InlineStack gap="300" wrap>
                  <Link to="/app/offers-settings" style={{ textDecoration: 'none' }}>
                    <Button variant="secondary">⚡ BoostCart</Button>
                  </Link>
                  <Link to="/app/setup-packbuilder" style={{ textDecoration: 'none' }}>
                    <Button variant="secondary">🎯 Pack Builder</Button>
                  </Link>
                  <Link to="/app/setup-bundlecard" style={{ textDecoration: 'none' }}>
                    <Button variant="secondary">🃏 Bundle Cards</Button>
                  </Link>
                  <Link to="/app/setup-ultimatepack" style={{ textDecoration: 'none' }}>
                    <Button variant="secondary">🚀 Ultimate Pack</Button>
                  </Link>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Vidéo guide d'installation */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Découvrez votre guide d'installation</Text>
                <div style={{
                  position: 'relative',
                  paddingBottom: '56.25%',
                  height: 0,
                  overflow: 'hidden',
                  borderRadius: '8px'
                }}>
                  <iframe
                    src="https://www.youtube.com/embed/q_MxGoIKWJ0"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      border: 'none'
                    }}
                    allowFullScreen
                    title="Présentation Ecomkit"
                  />
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
  );
}