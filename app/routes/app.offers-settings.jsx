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
    // Structure par défaut pour les offres
    let offersSettings = {
      // Offre 1
      enable_offer1: false,
      offer1_type: "shipping",
      offer1_threshold: 55,
      offer1_text_before: "Encore [amount_left]€ pour obtenir l'offre 1",
      offer1_text_after: "Offre 1 activée !",
      offer1_product_url: "",
      
      // Offre 2
      enable_offer2: false,
      offer2_type: "gift",
      offer2_threshold: 75,
      offer2_text_before: "Encore [amount_left]€ pour obtenir l'offre 2",
      offer2_text_after: "Offre 2 activée !",
      offer2_product_url: "",
      
      // Offre 3
      enable_offer3: false,
      offer3_type: "gift",
      offer3_threshold: 100,
      offer3_text_before: "Encore [amount_left]€ pour obtenir l'offre 3",
      offer3_text_after: "Offre 3 activée !",
      offer3_product_url: ""
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
    
    // Récupérer tous les metafields dans le namespace "ecomkit"
    const metafieldsResponse = await admin.graphql(`
      query {
        shop {
          metafields(namespace: "ecomkit", first: 100) {
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
        case 'enable_offer1':
        case 'enable_offer2':
        case 'enable_offer3':
          offersSettings[key] = value === 'true';
          break;
          
        case 'offer1_threshold':
        case 'offer2_threshold':
        case 'offer3_threshold':
          offersSettings[key] = parseFloat(value);
          break;
          
        default:
          offersSettings[key] = value;
          break;
      }
    });
    
    return json({
      offersSettings,
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
    
    console.log("Paramètres à enregistrer:", settings);
    
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
      
      if (key.startsWith("enable_offer")) {
        type = "boolean";
      } else if (key.includes("threshold")) {
        type = "number_decimal";
      }
      
      metafields.push({
        namespace: "ecomkit",
        key,
        type,
        value: String(value),
        ownerId: shopId
      });
    }
    
    console.log("Metafields à enregistrer:", metafields);
    
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
      
      console.log("Réponse GraphQL:", responseData);
      
      // Vérifier les erreurs
      if (responseData.data?.metafieldsSet?.userErrors?.length > 0) {
        const errors = responseData.data.metafieldsSet.userErrors;
        throw new Error(`Erreurs GraphQL: ${JSON.stringify(errors)}`);
      }
    }
    
    return json({
      success: true,
      message: "Offres enregistrées avec succès!",
      settings
    });
    
  } catch (error) {
    console.error("Erreur d'enregistrement:", error);
    return json({
      success: false,
      message: `Une erreur est survenue lors de l'enregistrement: ${error.message}`
    });
  }
};

// Composant Guide de personnalisation
function CustomizationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = useCallback(() => setIsOpen(!isOpen), [isOpen]);
  
  return (
    <Card sectioned>
      <InlineStack align="space-between" blockAlign="center">
        <div>
          <Text variant="headingMd" as="h2">
            Étape 3 : Personnalisez l'affichage
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment personnaliser l'affichage et sélectionner vos produits complémentaires
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="customization-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment personnaliser votre BoostCart ?</Text>
          </div>
          
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Styles et couleurs :</strong> Adaptez l'apparence de votre progress bar aux couleurs de votre marque
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Messages personnalisés :</strong> Rédigez des messages engageants qui incitent à l'achat
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Produits complémentaires :</strong> Sélectionnez les produits à proposer en cadeau selon vos objectifs
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Position et timing :</strong> Définissez où et quand afficher votre progress bar pour un impact maximal
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Image
              source="/images/etape-3-BoostCart.jpg"
              alt="Guide de personnalisation BoostCart"
              width={300}
              style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
            />
          </Box>
          
          <Box paddingBlockStart="4">
            <Button 
              url="shopify:admin/themes/current/editor?context=apps"
              external
              variant="primary"
            >
              Personnaliser l'affichage
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
            Étape 1 : Activez l'extension dans votre thème Shopify
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment activer le panier BoostCart
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="activation-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment activer BoostCart dans votre thème ?</Text>
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
                <strong>Ajoutez l'extension :</strong> Dans l'éditeur de thème, allez dans "Extensions d'applications" et activez "BoostCart"
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Enregistrez :</strong> Cliquez sur "Enregistrer" pour publier les modifications
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Image
              source="/images/etape-1-BoostCart.jpg"
              alt="Guide d'activation BoostCart"
              width={300}
              style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
            />
          </Box>
          
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
            Étape 2 : Configurez vos offres paniers pour la Progress Bar
          </Text>
          <Text variant="bodyMd" color="subdued">
            Découvrez comment configurer vos offres BoostCart
          </Text>
        </div>
        <Button onClick={handleToggle} plain>
          {isOpen ? "Masquer" : "Afficher"} le guide
        </Button>
      </InlineStack>
      
      <Collapsible open={isOpen} id="startup-guide">
        <Box paddingBlockStart="4">
          <div style={{ marginBottom: "1rem" }}>
            <Text variant="headingMd" as="h3">Comment créer des offres efficaces ?</Text>
          </div>
          
          <List type="number">
            <List.Item>
              <Text variant="bodyMd">
                <strong>Choisissez le type d'offre :</strong> Livraison offerte (pour encourager les achats) ou Cadeau offert (pour augmenter la valeur perçue)
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Définissez des seuils progressifs :</strong> Ex: 50€, 75€, 100€ pour créer un effet d'escalier
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Personnalisez vos messages :</strong> Utilisez <code>[amount_left]</code> pour afficher le montant restant
              </Text>
            </List.Item>
            <List.Item>
              <Text variant="bodyMd">
                <strong>Pour les cadeaux :</strong> Ajoutez l'URL du produit (ex: /products/echantillon-gratuit)
              </Text>
            </List.Item>
          </List>
          
          <Box paddingBlockStart="4">
            <Banner status="info">
              <Text variant="bodyMd">
                <strong>💡 Astuce pour les produits offerts :</strong> Créez un produit avec le nom du produit suivi de "offert" (ex: "Magnésium marin offert"), définissez le prix à 0€ et renseignez le prix avant réduction (ex: prix avant réduction 14€, prix final 0€). Cela permettra d'afficher la valeur du cadeau tout en l'offrant gratuitement.
              </Text>
            </Banner>
          </Box>
        </Box>
      </Collapsible>
    </Card>
  );
}

// Composant pour gérer une offre
function OfferForm({ index, settings, onChange }) {
  const offerTypes = [
    { label: "Livraison offerte", value: "shipping" },
    { label: "Cadeau offert", value: "gift" }
  ];
  
  const offerNumber = index + 1;
  
  // Récupérer les valeurs de cette offre
  const enabled = settings[`enable_offer${offerNumber}`];
  const type = settings[`offer${offerNumber}_type`];
  const threshold = settings[`offer${offerNumber}_threshold`];
  const textBefore = settings[`offer${offerNumber}_text_before`];
  const textAfter = settings[`offer${offerNumber}_text_after`];
  const productUrl = settings[`offer${offerNumber}_product_url`];
  
  return (
    <div style={{ padding: "1rem 0" }}>
      <FormLayout>
        <Checkbox
          label={`Activer l'offre ${offerNumber}`}
          checked={enabled}
          onChange={(value) => onChange(`enable_offer${offerNumber}`, value)}
        />
        
        <Select
          label="Type d'offre"
          options={offerTypes}
          value={type}
          onChange={(value) => onChange(`offer${offerNumber}_type`, value)}
          disabled={!enabled}
        />
        
        <TextField
          label={`Seuil d'activation (en €)`}
          type="number"
          value={String(threshold)}
          onChange={(value) => onChange(`offer${offerNumber}_threshold`, value)}
          disabled={!enabled}
        />
        
        <TextField
          label="Message avant activation"
          value={textBefore}
          onChange={(value) => onChange(`offer${offerNumber}_text_before`, value)}
          helpText="Utilisez [amount_left] pour afficher le montant restant"
          disabled={!enabled}
          multiline={2}
        />
        
        <TextField
          label="Message après activation"
          value={textAfter}
          onChange={(value) => onChange(`offer${offerNumber}_text_after`, value)}
          disabled={!enabled}
          multiline={2}
        />
        
        {type === "gift" && (
          <TextField
            label="URL du produit à offrir"
            value={productUrl}
            onChange={(value) => onChange(`offer${offerNumber}_product_url`, value)}
            placeholder="/products/nom-du-produit"
            helpText="Entrez l'URL du produit à offrir (ex: /products/mon-produit)"
            disabled={!enabled}
          />
        )}
        
        {enabled && (
          <Banner status="info">
            <InlineStack gap="2" blockAlign="center">
              <Icon source={CheckSmallIcon} />
              <Text variant="bodyMd">
                <strong>Aperçu :</strong> Cette offre sera activée quand le panier atteindra {threshold}€
              </Text>
            </InlineStack>
          </Banner>
        )}
      </FormLayout>
    </div>
  );
}

export default function OffersSettings() {
  const loaderData = useLoaderData();
  const { offersSettings, error } = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  // État local pour les settings
  const [settings, setSettings] = useState(offersSettings || {});
  
  // État pour les onglets
  const [selectedTab, setSelectedTab] = useState(0);
  
  // État pour la section configuration
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Mise à jour des settings si les données chargées changent
  useEffect(() => {
    if (offersSettings) {
      setSettings(offersSettings);
    }
  }, [offersSettings]);
  
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
      id: 'offer1',
      content: 'Offre 1',
      panelID: 'offer1-panel',
    },
    {
      id: 'offer2',
      content: 'Offre 2',
      panelID: 'offer2-panel',
    },
    {
      id: 'offer3',
      content: 'Offre 3',
      panelID: 'offer3-panel',
    },
  ];
  
  const handleTabChange = useCallback((selectedTabIndex) => {
    setSelectedTab(selectedTabIndex);
  }, []);
  
  const handleConfigToggle = useCallback(() => setIsConfigOpen(!isConfigOpen), [isConfigOpen]);
  
  return (
    <Page
      title="Paramètres des offres Panier"
      subtitle="Configurez les offres à afficher dans votre panier BoostCart"
      primaryAction={{
        content: "Enregistrer toutes les offres",
        onAction: handleSubmit,
        loading: isSubmitting
      }}
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
        {/* Guide d'activation */}
        <Layout.Section>
          <ActivationGuide />
        </Layout.Section>
        
        {/* Guide de démarrage */}
        <Layout.Section>
          <StartupGuide />
        </Layout.Section>
        
        {/* Configuration des offres */}
        <Layout.Section>
          <Card sectioned>
            <InlineStack align="space-between" blockAlign="center">
              <div>
                <Text variant="headingMd" as="h2">
                  Configuration des offres
                </Text>
                <Text variant="bodyMd" color="subdued">
                  Configurez jusqu'à 3 offres progressives pour votre panier
                </Text>
              </div>
              <Button onClick={handleConfigToggle} plain>
                {isConfigOpen ? "Masquer" : "Afficher"} la configuration
              </Button>
            </InlineStack>
            
            <Collapsible open={isConfigOpen} id="offers-config">
              <Box paddingBlockStart="4">
                {/* Barre de contrôle des offres */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '24px',
                  padding: '16px',
                  backgroundColor: '#F6F6F7',
                  borderRadius: '12px',
                  marginBottom: '20px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: '#202223' }}>Offre 1</span>
                    <div 
                      style={{
                        width: '44px',
                        height: '24px',
                        backgroundColor: settings.enable_offer1 ? '#00A651' : '#E1E3E5',
                        borderRadius: '12px',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => handleSettingChange('enable_offer1', !settings.enable_offer1)}
                    >
                      <div style={{
                        width: '20px',
                        height: '20px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: settings.enable_offer1 ? '22px' : '2px',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}></div>
                    </div>
                  </div>
                  
                  <div style={{ color: '#D1D5DB', fontSize: '18px', fontWeight: '300' }}>⏐</div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: '#202223' }}>Offre 2</span>
                    <div 
                      style={{
                        width: '44px',
                        height: '24px',
                        backgroundColor: settings.enable_offer2 ? '#00A651' : '#E1E3E5',
                        borderRadius: '12px',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => handleSettingChange('enable_offer2', !settings.enable_offer2)}
                    >
                      <div style={{
                        width: '20px',
                        height: '20px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: settings.enable_offer2 ? '22px' : '2px',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}></div>
                    </div>
                  </div>
                  
                  <div style={{ color: '#D1D5DB', fontSize: '18px', fontWeight: '300' }}>⏐</div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: '#202223' }}>Offre 3</span>
                    <div 
                      style={{
                        width: '44px',
                        height: '24px',
                        backgroundColor: settings.enable_offer3 ? '#00A651' : '#E1E3E5',
                        borderRadius: '12px',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => handleSettingChange('enable_offer3', !settings.enable_offer3)}
                    >
                      <div style={{
                        width: '20px',
                        height: '20px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: settings.enable_offer3 ? '22px' : '2px',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}></div>
                    </div>
                  </div>
                </div>
                
                <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                  <Box padding="4">
                    <Form method="post" onSubmit={handleSubmit}>
                      {selectedTab === 0 && (
                        <OfferForm
                          index={0}
                          settings={settings}
                          onChange={handleSettingChange}
                        />
                      )}
                      {selectedTab === 1 && (
                        <OfferForm
                          index={1}
                          settings={settings}
                          onChange={handleSettingChange}
                        />
                      )}
                      {selectedTab === 2 && (
                        <OfferForm
                          index={2}
                          settings={settings}
                          onChange={handleSettingChange}
                        />
                      )}
                      
                      <Box paddingBlockStart="4">
                        <InlineStack gap="2">
                          <Button
                            submit
                            primary
                            loading={isSubmitting}
                          >
                            Enregistrer cette offre
                          </Button>
                          <Button
                            onClick={handleSubmit}
                            loading={isSubmitting}
                          >
                            Enregistrer toutes les offres
                          </Button>
                        </InlineStack>
                      </Box>
                    </Form>
                  </Box>
                </Tabs>
              </Box>
            </Collapsible>
          </Card>
        </Layout.Section>
        
        {/* Guide de personnalisation */}
        <Layout.Section>
          <CustomizationGuide />
        </Layout.Section>
      </Layout>
    </Page>
  );
}