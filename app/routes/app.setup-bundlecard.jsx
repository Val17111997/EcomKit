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
  Link
} from "@shopify/polaris";
import { CheckSmallIcon, InfoIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Structure par défaut pour les cartes Bundle
    let bundleSettings = {
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
    
    // Récupérer tous les metafields dans le namespace "bundlecards"
    const metafieldsResponse = await admin.graphql(`
      query {
        shop {
          metafields(namespace: "bundlecards", first: 100) {
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
          bundleSettings[key] = parseInt(value);
          break;
          
        default:
          bundleSettings[key] = value;
          break;
      }
    });
    
    return json({
      bundleSettings,
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
    
    console.log("Paramètres Bundle à enregistrer:", settings);
    
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
        namespace: "bundlecards",
        key,
        type,
        value: String(value),
        ownerId: shopId
      });
    }
    
    console.log("Metafields Bundle à enregistrer:", metafields);
    
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
      
      console.log("Réponse GraphQL Bundle:", responseData);
      
      // Vérifier les erreurs
      if (responseData.data?.metafieldsSet?.userErrors?.length > 0) {
        const errors = responseData.data.metafieldsSet.userErrors;
        throw new Error(`Erreurs GraphQL: ${JSON.stringify(errors)}`);
      }
    }
    
    return json({
      success: true,
      message: "Cartes Bundle enregistrées avec succès!",
      settings
    });
    
  } catch (error) {
    console.error("Erreur d'enregistrement Bundle:", error);
    return json({
      success: false,
      message: `Une erreur est survenue lors de l'enregistrement: ${error.message}`
    });
  }
};

// Composant Guide de création de produit
function ProductCreationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 1 : Créez votre produit avec vos variantes en lots
          </Text>
          <Text variant="bodyMd" color="subdued">
            Rendez-vous dans Shopify - Produits
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="product-creation-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment créer un produit avec des variantes en lots ?</Text>
          </div>
          
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
                <strong>Ajoutez des variantes :</strong> Créez différentes variantes (ex: Pack de 1, Pack de 3, Pack de 5)
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Configurez les prix :</strong> Définissez des prix dégressifs pour encourager les achats en lot
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/products"
              external
              variant="primary"
            >
              Gérer mes produits
            </Button>
          </Box>
        </Box>
      </Collapsible>
    </Card>
  );
}

// Composant Guide d'activation
function ActivationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 2 : Activez l'extension dans votre thème Shopify
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment activer les cartes Bundle dans votre thème
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="activation-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment activer Bundle Cards dans votre thème ?</Text>
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
                Cliquez sur Application, puis Bundle Card
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/themes/current/editor?context=apps"
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

// Composant Guide de démarrage
function StartupGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 3 : Configurez vos cartes produits
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment configurer vos cartes Bundle
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="startup-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment créer des cartes efficaces ?</Text>
          </div>
          
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Sélectionnez vos produits :</strong> Choisissez des produits avec plusieurs variantes
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Personnalisez les titres :</strong> Donnez des noms attractifs à vos packs
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Ajoutez des badges :</strong> Mettez en avant vos meilleures offres
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Messages de livraison :</strong> Ajoutez des informations rassurantes
              </Text>
            </List.Item>
          </List>
        </Box>
      </Collapsible>
    </Card>
  );
}

// Composant pour gérer les paramètres d'un pack
function PackForm({ index, settings, onChange }) {
  const packNumber = index + 1;
  
  // Récupérer les valeurs de ce pack
  const title = settings[`pack_title_${packNumber}`];
  const badge = settings[`pack_badge_${packNumber}`];
  const shipping = settings[`shipping_text_${packNumber}`];
  
  return (
    <div style={{ padding: "1rem 0" }}>
      <FormLayout>
        <TextField
          label={`Titre du Pack ${packNumber}`}
          value={title}
          onChange={(value) => onChange(`pack_title_${packNumber}`, value)}
          placeholder={`Pack ${packNumber}`}
        />
        
        <TextField
          label={`Badge du Pack ${packNumber}`}
          value={badge}
          onChange={(value) => onChange(`pack_badge_${packNumber}`, value)}
          placeholder="Ex: POPULAIRE, MEILLEURE OFFRE"
          helpText="Laissez vide si vous ne voulez pas de badge"
        />
        
        <TextField
          label={`Texte de livraison Pack ${packNumber}`}
          value={shipping}
          onChange={(value) => onChange(`shipping_text_${packNumber}`, value)}
          placeholder="✓ Livraison offerte"
        />
        
        <Banner status="info">
          <InlineStack gap="2" blockAlign="center">
            <Icon source={InfoIcon} />
            <Text variant="bodyMd">
              <strong>Aperçu :</strong> Ce pack apparaîtra avec le titre "{title}" {badge && `et le badge "${badge}"`}
            </Text>
          </InlineStack>
        </Banner>
      </FormLayout>
    </div>
  );
}

export default function BundleSetup() {
  const loaderData = useLoaderData();
  const { bundleSettings, error } = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  // État local pour les settings
  const [settings, setSettings] = useState(bundleSettings || {});
  
  // État pour les onglets
  const [selectedTab, setSelectedTab] = useState(0);
  
  // État pour la section configuration
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Mise à jour des settings si les données chargées changent
  useEffect(() => {
    if (bundleSettings) {
      setSettings(bundleSettings);
    }
  }, [bundleSettings]);
  
  // Mettre à jour un champ
  const handleSettingChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // Soumettre le formulaire
  const handleSubmit = (event) => {
    if (event) {
      event.preventDefault();
    }
    
    // Préparer les données pour la soumission
    const formData = new FormData();
    
    // Ajouter chaque paramètre au formData
    Object.entries(settings).forEach(([key, value]) => {
      formData.append(key, value);
    });
    
    // Soumettre le formulaire
    submit(formData, { method: "post", replace: true });
  };
  
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
  
  // Configuration des onglets
  const tabs = [
    {
      id: 'pack1',
      content: 'Pack 1',
      panelID: 'pack1-panel',
    },
    {
      id: 'pack2',
      content: 'Pack 2',
      panelID: 'pack2-panel',
    },
    {
      id: 'pack3',
      content: 'Pack 3',
      panelID: 'pack3-panel',
    },
  ];
  
  const handleTabChange = useCallback((selectedTabIndex) => {
    setSelectedTab(selectedTabIndex);
  }, []);
  
  const handleConfigToggle = useCallback(() => setIsConfigOpen(!isConfigOpen), [isConfigOpen]);
  
  return (
    <Page
      title="Paramètres des Cartes Bundle"
      subtitle="Configurez l'affichage de vos variantes produits sous forme de cartes"
    >
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
        {/* Guide de création de produit */}
        <Layout.Section>
          <ProductCreationGuide />
        </Layout.Section>
        
        {/* Guide d'activation */}
        <Layout.Section>
          <ActivationGuide />
        </Layout.Section>
        
        {/* Guide de démarrage */}
        <Layout.Section>
          <StartupGuide />
        </Layout.Section>
      </Layout>
    </Page>
  );
}