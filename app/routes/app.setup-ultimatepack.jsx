import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  Text,
  Select,
  Checkbox,
  InlineStack,
  Tabs,
  Box,
  List,
  Icon,
  Collapsible,
  Link,
  Image
} from "@shopify/polaris";
import { CheckSmallIcon, InfoIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Structure par défaut pour Ultimate Pack
    let ultimatePackSettings = {
      // Produit principal
      pack_product: "",
      default_variant_index: 1,
      
      // Couleurs
      cta_color: "#000000",
      badge_color: "#000000",
      
      // Pack 1
      pack_title_1: "Pack 1",
      pack_badge_1: "",
      shipping_text_1: "✓ Livraison offerte",
      
      // Pack 2
      pack_title_2: "Pack 2", 
      pack_badge_2: "POPULAIRE",
      shipping_text_2: "✓ Livraison offerte",
      
      // Pack 3
      pack_title_3: "Pack 3",
      pack_badge_3: "MEILLEURE OFFRE",
      shipping_text_3: "✓ Livraison offerte"
    };
    
    // Récupérer l'ID de la boutique
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
        }
      }
    `);
    
    const shopData = await shopResponse.json();
    const shopId = shopData.data?.shop?.id;
    
    // Récupérer tous les metafields dans le namespace "ultimatepack"
    const metafieldsResponse = await admin.graphql(`
      query {
        shop {
          metafields(namespace: "ultimatepack", first: 100) {
            edges {
              node {
                id
                key
                value
              }
            }
          }
        }
      }
    `);
    
    const metafieldsData = await metafieldsResponse.json();
    const metafields = metafieldsData.data?.shop?.metafields?.edges || [];
    
    // Mettre à jour les settings avec les valeurs des metafields
    metafields.forEach(({ node }) => {
      const { key, value } = node;
      
      // Traiter les valeurs selon leur type
      switch (key) {
        case 'default_variant_index':
          ultimatePackSettings[key] = parseInt(value);
          break;
          
        default:
          ultimatePackSettings[key] = value;
          break;
      }
    });
    
    return json({
      ultimatePackSettings,
      shopId,
      currentTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Erreur de chargement:", error);
    return json({
      error: `Impossible de charger les paramètres: ${error.message}`
    });
  }
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Récupérer les données du formulaire
    const formData = await request.formData();
    const settings = {};
    
    // Extraire toutes les valeurs du formulaire
    for (const [key, value] of formData.entries()) {
      settings[key] = value;
    }
    
    console.log("Paramètres Ultimate Pack à enregistrer:", settings);
    
    // Obtenir l'ID de la boutique
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
        }
      }
    `);
    
    const shopData = await shopResponse.json();
    const shopId = shopData.data?.shop?.id;
    
    if (!shopId) {
      throw new Error("Impossible de récupérer l'ID de la boutique");
    }
    
    // Créer un tableau de metafields à mettre à jour
    const metafields = [];
    
    // Ajouter chaque paramètre comme un metafield (SEULEMENT les champs non vides)
    for (const [key, value] of Object.entries(settings)) {
      // Ignorer les champs vides ou undefined
      if (value === undefined || value === null || value === '') {
        console.log(`Champ ignoré (vide): ${key} = ${value}`);
        continue;
      }
      
      // Déterminer le type de valeur
      let type = "single_line_text_field";
      
      if (key === "default_variant_index") {
        type = "number_integer";
      }
      
      metafields.push({
        namespace: "ultimatepack",
        key,
        type,
        value: String(value),
        ownerId: shopId
      });
    }
    
    console.log("Metafields Ultimate Pack à enregistrer:", metafields);
    
    // Si aucun metafield à enregistrer, retourner succès
    if (metafields.length === 0) {
      return json({
        success: true,
        message: "Aucune modification à enregistrer",
        settings
      });
    }
    
    // Diviser les metafields en lots de 25 maximum pour respecter les limites de l'API
    const metafieldBatches = [];
    for (let i = 0; i < metafields.length; i += 25) {
      metafieldBatches.push(metafields.slice(i, i + 25));
    }
    
    // Exécuter les mutations pour chaque lot
    const results = [];
    
    for (const batch of metafieldBatches) {
      const mutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;
      
      const variables = {
        metafields: batch
      };
      
      const response = await admin.graphql(mutation, { variables });
      const responseData = await response.json();
      results.push(responseData);
      
      console.log("Réponse GraphQL Ultimate Pack:", responseData);
      
      // Vérifier les erreurs
      if (responseData.data?.metafieldsSet?.userErrors?.length > 0) {
        const errors = responseData.data.metafieldsSet.userErrors;
        throw new Error(`Erreurs GraphQL: ${JSON.stringify(errors)}`);
      }
    }
    
    return json({
      success: true,
      message: "Ultimate Pack enregistré avec succès!",
      settings
    });
    
  } catch (error) {
    console.error("Erreur d'enregistrement Ultimate Pack:", error);
    return json({
      success: false,
      message: `Une erreur est survenue lors de l'enregistrement: ${error.message}`
    });
  }
};

// Composant Guide d'ajout d'extension
function ExtensionGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 1 : Ajoutez l'extension sur votre thème Shopify
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment ajouter Ultimate Pack dans votre thème
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="extension-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment ajouter Ultimate Pack dans votre thème ?</Text>
          </div>
          
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Accédez à votre admin Shopify :</strong> Allez dans "Boutique en ligne" → "Thèmes"
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Personnalisez votre thème :</strong> Cliquez sur "Personnaliser" à côté de votre thème actif
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Ajoutez l'extension :</strong> Dans l'éditeur de thème, cliquez sur le + pour ajouter une section
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                Cliquez sur Application, puis Ultimate Pack
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/themes/current/editor"
              external
              variant="primary"
            >
              Personnaliser le thème
            </Button>
          </Box>
        </Box>
      </Collapsible>
    </Card>
  );
}

// Composant Guide de configuration des produits
function ProductConfigGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 2 : Choisissez les produits que vous allez proposer en pack et configurez vos offres
          </Text>
          <Text variant="bodyMd" color="subdued">
            Configurez vos produits et offres pack dans Ultimate Pack
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="product-config-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment configurer vos produits et offres pack ?</Text>
          </div>
          
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Sélectionnez vos produits :</strong> Choisissez les produits que vous souhaitez proposer en pack
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Définissez les quantités :</strong> Configurez les différentes quantités pour vos packs (ex: 2, 3, 5 produits)
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Créez vos offres :</strong> Définissez des remises attractives pour encourager l'achat en pack
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Personnalisez l'affichage :</strong> Configurez les titres, badges et messages pour vos packs
              </Text>
            </List.Item>
          </List>
        </Box>
      </Collapsible>
    </Card>
  );
}

export default function UltimatePackSetup() {
  const loaderData = useLoaderData();
  const { ultimatePackSettings, error } = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  // État local pour les settings
  const [settings, setSettings] = useState(ultimatePackSettings || {});
  
  // Mise à jour des settings si les données chargées changent
  useEffect(() => {
    if (ultimatePackSettings) {
      setSettings(ultimatePackSettings);
    }
  }, [ultimatePackSettings]);
  
  // Détermine si le formulaire est en cours de soumission
  const isSubmitting = navigation.state === "submitting";
  
  // Afficher un message de succès/erreur
  const [showStatusMessage, setShowStatusMessage] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  
  useEffect(() => {
    if (actionData) {
      setShowStatusMessage(true);
      setStatusMessage(actionData.message);
      setIsSuccess(actionData.success);
      
      const timer = setTimeout(() => {
        setShowStatusMessage(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [actionData]);
  
  return (
    <Page
      title="Setup Ultimate Pack"
      subtitle="Configurez l'extension Ultimate Pack pour vos produits"
    >
      {/* Bannière */}
      <Box paddingBlockEnd="6">
        <Image
          source="/images/banniere-ultimate-pack.png"
          alt="Ultimate Pack"
          width="100%"
          style={{ borderRadius: "8px" }}
        />
      </Box>
      
      {/* Message de statut */}
      {(showStatusMessage || error) && (
        <Box paddingBlockEnd="4">
          <Banner
            status={isSuccess ? "success" : "critical"}
          >
            {error || statusMessage}
          </Banner>
        </Box>
      )}
      
      <Layout>
        {/* Guide d'ajout d'extension */}
        <Layout.Section>
          <ExtensionGuide />
        </Layout.Section>
        
        {/* Guide de configuration des produits */}
        <Layout.Section>
          <ProductConfigGuide />
        </Layout.Section>
        
        {/* Vidéo tutoriel */}
        <Layout.Section>
          <div style={{ marginTop: "24px" }}>
            <video 
              width="500" 
              height="auto" 
              controls
              preload="metadata"
              style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
            >
              <source src="/videos/tuto2.mp4" type="video/mp4" />
              Votre navigateur ne supporte pas la lecture vidéo.
            </video>
          </div>
        </Layout.Section>
        
        {/* Espacement en bas de page */}
        <Layout.Section>
          <div style={{ height: "80px" }}></div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}