import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Banner,
  Text,
  InlineStack,
  Box,
  List,
  Collapsible,
  Image
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Structure par défaut pour Pack Builder
    let packBuilderSettings = {
      // Configuration générale
      builder_enabled: true,
      max_products_per_pack: 5,
      min_products_per_pack: 2,
      
      // Apparence
      primary_color: "#000000",
      secondary_color: "#f5f5f5",
      button_text: "Créer mon pack",
      
      // Remises
      discount_type: "percentage", // percentage ou fixed
      discount_value: 10,
      bulk_discount_enabled: false,
      bulk_discount_threshold: 3,
      bulk_discount_value: 15,
      
      // Messages
      pack_title: "Créez votre pack personnalisé",
      pack_description: "Sélectionnez vos produits favoris et économisez",
      empty_pack_message: "Votre pack est vide, ajoutez des produits",
      
      // Paramètres avancés
      show_individual_prices: true,
      show_total_savings: true,
      allow_quantity_change: true
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
    
    // Récupérer tous les metafields dans le namespace "packbuilder"
    const metafieldsResponse = await admin.graphql(`
      query {
        shop {
          metafields(namespace: "packbuilder", first: 100) {
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
        case 'max_products_per_pack':
        case 'min_products_per_pack':
        case 'discount_value':
        case 'bulk_discount_threshold':
        case 'bulk_discount_value':
          packBuilderSettings[key] = parseInt(value);
          break;
          
        case 'builder_enabled':
        case 'bulk_discount_enabled':
        case 'show_individual_prices':
        case 'show_total_savings':
        case 'allow_quantity_change':
          packBuilderSettings[key] = value === 'true';
          break;
          
        default:
          packBuilderSettings[key] = value;
          break;
      }
    });
    
    return json({
      packBuilderSettings,
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
    
    console.log("Paramètres Pack Builder à enregistrer:", settings);
    
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
      
      if (["max_products_per_pack", "min_products_per_pack", "discount_value", "bulk_discount_threshold", "bulk_discount_value"].includes(key)) {
        type = "number_integer";
      } else if (["builder_enabled", "bulk_discount_enabled", "show_individual_prices", "show_total_savings", "allow_quantity_change"].includes(key)) {
        type = "boolean";
      }
      
      metafields.push({
        namespace: "packbuilder",
        key,
        type,
        value: String(value),
        ownerId: shopId
      });
    }
    
    console.log("Metafields Pack Builder à enregistrer:", metafields);
    
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
      
      console.log("Réponse GraphQL Pack Builder:", responseData);
      
      // Vérifier les erreurs
      if (responseData.data?.metafieldsSet?.userErrors?.length > 0) {
        const errors = responseData.data.metafieldsSet.userErrors;
        throw new Error(`Erreurs GraphQL: ${JSON.stringify(errors)}`);
      }
    }
    
    return json({
      success: true,
      message: "Pack Builder configuré avec succès!",
      settings
    });
    
  } catch (error) {
    console.error("Erreur d'enregistrement Pack Builder:", error);
    return json({
      success: false,
      message: `Une erreur est survenue lors de l'enregistrement: ${error.message}`
    });
  }
};

// Composant Étape 1 - Création du produit pack
function ProductCreationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 1 : Créez un produit pack avec une variante par produit qui compose le pack
          </Text>
          <Text variant="bodyMd" color="subdued">
            Configurez votre produit principal pour le constructeur de packs
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="product-creation-guide">
        <Box paddingBlockStart="4">
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Accédez à vos produits :</strong> Allez dans "Produits" dans votre admin Shopify
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Créez un nouveau produit :</strong> Cliquez sur "Ajouter un produit"
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Configurez les variantes :</strong> Créez une variante pour chaque produit qui composera le pack
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Définissez les prix :</strong> Mettez le prix final du pack pour chaque variante
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/products/new"
              external
              variant="primary"
            >
              Créer un produit
            </Button>
          </Box>
          
          <Box paddingBlockStart="4">
            <video 
              width="500" 
              height="auto" 
              controls
              preload="metadata"
              style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
            >
              <source src="/videos/tuto5.mp4" type="video/mp4" />
              Votre navigateur ne supporte pas la lecture vidéo.
            </video>
          </Box>
        </Box>
      </Collapsible>
    </Card>
  );
}

// Composant Guide d'installation
function InstallationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 2 : Activez Pack Builder sur votre boutique
          </Text>
          <Text variant="bodyMd" color="subdued">
            Intégrez le constructeur de packs dans votre thème Shopify
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="installation-guide">
        <Box paddingBlockStart="4">
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
                <strong>Créez un template produit :</strong> Créez un template produit pour le produit dont vous souhaitez afficher les variantes en lots
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Ajoutez l'extension :</strong> Dans l'éditeur de thème, cliquez sur le + pour ajouter une section, positionné généralement au dessus des boutons de paiement
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                Cliquez sur Application, puis Pack Builder
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/themes/current/editor"
              external
              variant="primary"
            >
              Ouvrir l'éditeur de thème
            </Button>
          </Box>
          
          <Box paddingBlockStart="4">
            <video 
              width="500" 
              height="auto" 
              controls
              preload="metadata"
              style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
            >
              <source src="/videos/tuto3.mp4" type="video/mp4" />
              Votre navigateur ne supporte pas la lecture vidéo.
            </video>
          </Box>
        </Box>
      </Collapsible>
    </Card>
  );
}



export default function PackBuilder() {
  const loaderData = useLoaderData();
  const { packBuilderSettings, error } = loaderData;
  const actionData = useActionData();
  
  // Gestion des messages de statut
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
      title="Pack Builder"
      subtitle="Configurez votre constructeur de packs personnalisés"
    >
      {/* Bannière */}
      <div style={{ marginBottom: "24px" }}>
        <Image
          source="/images/banniere-pack-builder.png"
          alt="Pack Builder"
          width="100%"
          style={{ borderRadius: "8px" }}
        />
      </div>
      
      {/* Message de statut */}
      {(showStatusMessage || error) && (
        <div style={{ marginBottom: "16px" }}>
          <Banner
            status={isSuccess ? "success" : "critical"}
          >
            {error || statusMessage}
          </Banner>
        </div>
      )}
      
      <Layout>
        {/* Étape 1 - Création du produit pack */}
        <Layout.Section>
          <ProductCreationGuide />
        </Layout.Section>
        
        {/* Étape 2 - Guide d'installation */}
        <Layout.Section>
          <InstallationGuide />
        </Layout.Section>
        
        {/* Espacement en bas de page */}
        <Layout.Section>
          <div style={{ height: "80px" }}></div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}