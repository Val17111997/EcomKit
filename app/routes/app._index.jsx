import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  Badge,
  Icon,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  // Action pour activer/désactiver les extensions si nécessaire
  return { success: true };
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const extensions = [
    {
      id: "boostcart",
      name: "BoostCart",
      description: "Drawer de panier intelligent avec offres progressives",
      features: [
        "Barre de progression avec paliers de réduction",
        "Produits offerts automatiques selon le montant",
        "Section produits complémentaires",
        "Codes de réduction intégrés",
        "Messages d'annonce personnalisés",
        "Design entièrement personnalisable"
      ],
      status: "active",
      category: "Conversion",
      icon: "🛒",
      color: "success"
    },
    {
      id: "bundle",
      name: "Bundle Creator",
      description: "Créateur de packs avec sélection de variantes",
      features: [
        "Sélection interactive de variantes",
        "Toast notifications élégants",
        "Validation intelligente des choix",
        "Intégration parfaite avec le thème",
        "Propriétés de panier personnalisées",
        "Messages de validation configurables"
      ],
      status: "active",
      category: "Produits",
      icon: "📦",
      color: "info"
    },
    {
      id: "pack-cartes",
      name: "Pack Découverte",
      description: "Affichage des variantes sous forme de cartes élégantes",
      features: [
        "Cartes visuelles pour chaque variante",
        "Badges personnalisables par variante",
        "Prix barrés automatiques",
        "Métadonnées produit (poids, doses)",
        "Sélection par défaut configurable",
        "Design responsive et moderne"
      ],
      status: "active",
      category: "Design",
      icon: "🎨",
      color: "warning"
    },
    {
      id: "packbuilder",
      name: "PackBuilder",
      description: "Constructeur de pack interactif avec paliers de réduction",
      features: [
        "Interface de construction de pack intuitive",
        "Système de paliers avec réductions progressives",
        "Sauvegarde automatique de la sélection",
        "Calcul de livraison offerte en temps réel",
        "Groupage intelligent dans le panier",
        "Optimisé mobile avec animations"
      ],
      status: "active",
      category: "Ventes",
      icon: "⚡",
      color: "critical"
    }
  ];

  const stats = {
    totalExtensions: extensions.length,
    activeExtensions: extensions.filter(ext => ext.status === "active").length,
    categories: [...new Set(extensions.map(ext => ext.category))].length
  };

  return (
    <Page>
      <TitleBar title="Ecomkit - Extensions Shopify">
        <button variant="primary" onClick={() => shopify.toast.show("Extensions synchronisées")}>
          Synchroniser
        </button>
      </TitleBar>
      
      <BlockStack gap="800">
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
                    <InlineStack gap="200">
                      <Badge tone="success">{stats.activeExtensions} actives</Badge>
                      <Badge tone="info">{stats.categories} catégories</Badge>
                    </InlineStack>
                  </InlineStack>
                  <Text variant="bodyLg" as="p" tone="subdued">
                    Votre suite d'extensions pour optimiser l'expérience d'achat et booster vos conversions
                  </Text>
                </BlockStack>
                
                <Divider />
                
                <InlineStack gap="400">
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd" alignment="center">📊 Performance</Text>
                      <Text variant="bodyMd" alignment="center" tone="subdued">
                        Toutes vos extensions sont optimisées pour la conversion
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd" alignment="center">🎨 Design</Text>
                      <Text variant="bodyMd" alignment="center" tone="subdued">
                        Interface moderne et entièrement personnalisable
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd" alignment="center">📱 Mobile</Text>
                      <Text variant="bodyMd" alignment="center" tone="subdued">
                        Optimisé pour tous les appareils
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
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
                          <Text as="span" variant="headingLg">{extension.icon}</Text>
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">{extension.name}</Text>
                            <Badge tone={extension.color}>{extension.category}</Badge>
                          </BlockStack>
                        </InlineStack>
                        <Badge tone="success">Actif</Badge>
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
                      
                      <InlineStack gap="200">
                        <Button variant="primary" size="large">
                          Configurer
                        </Button>
                        <Button variant="secondary">
                          Documentation
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))}
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Section ressources */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">📚 Ressources</Text>
                  <List>
                    <List.Item>
                      <Link url="https://docs.shopify.com/themes" target="_blank" removeUnderline>
                        Guide d'installation des extensions
                      </Link>
                    </List.Item>
                    <List.Item>
                      <Link url="#" removeUnderline>
                        Personnalisation avancée
                      </Link>
                    </List.Item>
                    <List.Item>
                      <Link url="#" removeUnderline>
                        Optimisation des performances
                      </Link>
                    </List.Item>
                    <List.Item>
                      <Link url="#" removeUnderline>
                        Bonnes pratiques UX/UI
                      </Link>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
              
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">🎯 Prochaines étapes</Text>
                  <List type="number">
                    <List.Item>Configurez BoostCart pour vos offres progressives</List.Item>
                    <List.Item>Créez vos premiers packs avec Bundle Creator</List.Item>
                    <List.Item>Personnalisez l'affichage de vos variantes</List.Item>
                    <List.Item>Optimisez vos taux de conversion</List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
          
          <Layout.Section variant="twoThirds">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">🚀 Mise en route rapide</Text>
                
                <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingSm">1. BoostCart - Drawer intelligent</Text>
                      <Badge tone="success">Recommandé</Badge>
                    </InlineStack>
                    <Text variant="bodyMd" tone="subdued">
                      Commencez par configurer votre drawer de panier avec les offres progressives. 
                      C'est l'extension qui aura le plus d'impact sur vos conversions.
                    </Text>
                    <InlineStack gap="200">
                      <Button size="small">Configurer maintenant</Button>
                      <Button variant="secondary" size="small">Voir la démo</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
                
                <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">2. Créez vos premiers packs</Text>
                    <Text variant="bodyMd" tone="subdued">
                      Utilisez Bundle Creator ou PackBuilder selon vos besoins : 
                      Bundle Creator pour des packs simples, PackBuilder pour des expériences plus avancées.
                    </Text>
                    <InlineStack gap="200">
                      <Button size="small">Bundle Creator</Button>
                      <Button size="small">PackBuilder</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
                
                <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">3. Optimisez l'affichage produit</Text>
                    <Text variant="bodyMd" tone="subdued">
                      Transformez vos pages produit avec Pack Découverte pour un affichage moderne des variantes.
                    </Text>
                    <Button size="small">Personnaliser l'affichage</Button>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Footer avec statistiques */}
        <Layout>
          <Layout.Section>
            <Card>
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued">Version Ecomkit</Text>
                  <Text as="h3" variant="headingMd">v2.1.0</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued">Extensions installées</Text>
                  <Text as="h3" variant="headingMd">{stats.totalExtensions}/4</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodyMd" tone="subdued">Dernière mise à jour</Text>
                  <Text as="h3" variant="headingMd">Aujourd'hui</Text>
                </BlockStack>
                <Button variant="primary">
                  Vérifier les mises à jour
                </Button>
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}