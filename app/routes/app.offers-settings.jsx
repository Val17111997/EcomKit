// app/routes/app.offers-config.jsx
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
  Icon,
  Frame,
  ContextualSaveBar,
  Badge,
  BlockStack,
  ButtonGroup
} from "@shopify/polaris";
import { CheckSmallIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;
  const { admin, session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }
  
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
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;
  const { admin, session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }
  
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

export default function OffersConfig() {
  const loaderData = useLoaderData();
  const { offersSettings, error } = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  // État local pour les settings
  const [settings, setSettings] = useState(offersSettings || {});
  // État pour les settings originaux (pour détecter les changements)
  const [originalSettings, setOriginalSettings] = useState(offersSettings || {});
  
  // Mise à jour des settings si les données chargées changent
  useEffect(() => {
    if (offersSettings) {
      setSettings(offersSettings);
      setOriginalSettings(offersSettings);
    }
  }, [offersSettings]);
  
  // Fonction pour détecter si il y a des modifications non sauvegardées (dirty state)
  const isDirty = () => {
    return JSON.stringify(settings) !== JSON.stringify(originalSettings);
  };
  
  // Mettre à jour un champ
  const handleSettingChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // Annuler les modifications
  const handleCancel = () => {
    setSettings(originalSettings);
  };

  // Fonction pour faire défiler vers une offre spécifique
  const scrollToOffer = (offerNumber) => {
    const element = document.getElementById(`offer-${offerNumber}`);
    if (element) {
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
        inline: 'nearest' 
      });
    }
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
      
      // Si la sauvegarde a réussi, mettre à jour les settings originaux
      if (actionData.success) {
        setOriginalSettings(settings);
      }
      
      const timer = setTimeout(() => {
        setShowStatusMessage(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [actionData, settings]);

  return (
    <Frame>
      <div style={{ paddingBottom: '4rem' }}>
        <Page
          title="Configuration des offres"
          subtitle="Définissez jusqu'à 3 paliers progressifs pour inciter vos clients à augmenter leur panier."
        >
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
            {/* Résumé global */}
            <Layout.Section>
              <Card>
                <Box padding="5">
                  <Text variant="headingMd" as="h2" color="subdued">Résumé global</Text>
                  <div style={{ marginTop: '10px' }}>
                    <InlineStack gap="600" align="center" blockAlign="start" wrap={false}>
                      {/* Offre 1 */}
                      <div
                        style={{
                          width: "18rem",
                          boxShadow: settings.enable_offer1 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
                          borderRadius: ".75rem",
                          position: "relative",
                          zIndex: "0",
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => scrollToOffer(1)}
                        onMouseEnter={(e) => {
                          if (!settings.enable_offer1) {
                            e.currentTarget.style.boxShadow = '0 8px 16px 0 rgba(0, 0, 0, 0.12)';
                          }
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = settings.enable_offer1 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)";
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        {settings.enable_offer1 && (
                          <div style={{ position: "absolute", top: "-15px", right: "6px", zIndex: "100" }}>
                            <Badge size="large" tone="success">
                              Activée
                            </Badge>
                          </div>
                        )}
                        <Card>
                          <BlockStack gap="400">
                            <BlockStack gap="200" align="start">
                              <Text as="h3" variant="headingLg">
                                Offre 1
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {settings.enable_offer1 ? 
                                  (settings.offer1_type === 'shipping' ? 'Livraison gratuite' : 'Cadeau offert')
                                  : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <InlineStack blockAlign="end" gap="100" align="start">
                              <Text as="h2" variant="heading2xl">
                                {settings.enable_offer1 ? `${settings.offer1_threshold}€` : '–'}
                              </Text>
                              <Box paddingBlockEnd="200">
                                <Text variant="bodySm">seuil</Text>
                              </Box>
                            </InlineStack>
                            <BlockStack gap="100">
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Type :</strong> {settings.enable_offer1 ? 
                                  (settings.offer1_type === 'shipping' ? 'Livraison offerte' : 'Cadeau offert') 
                                  : 'Non configuré'}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Bénéfice :</strong> {settings.enable_offer1 ? 
                                  (settings.offer1_type === 'shipping' ? 
                                    `Livraison gratuite dès ${settings.offer1_threshold}€` : 
                                    'Cadeau offert'
                                  ) : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <Box paddingBlockStart="200" paddingBlockEnd="200">
                              <ButtonGroup fullWidth>
                                <Button 
                                  variant={settings.enable_offer1 ? "primary" : "secondary"}
                                  onClick={() => scrollToOffer(1)}
                                >
                                  {settings.enable_offer1 ? 'Modifier' : 'Configurer'}
                                </Button>
                              </ButtonGroup>
                            </Box>
                          </BlockStack>
                        </Card>
                      </div>

                      {/* Offre 2 */}
                      <div
                        style={{
                          width: "18rem",
                          boxShadow: settings.enable_offer2 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
                          borderRadius: ".75rem",
                          position: "relative",
                          zIndex: "0",
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => scrollToOffer(2)}
                        onMouseEnter={(e) => {
                          if (!settings.enable_offer2) {
                            e.currentTarget.style.boxShadow = '0 8px 16px 0 rgba(0, 0, 0, 0.12)';
                          }
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = settings.enable_offer2 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)";
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        {settings.enable_offer2 && (
                          <div style={{ position: "absolute", top: "-15px", right: "6px", zIndex: "100" }}>
                            <Badge size="large" tone="success">
                              Activée
                            </Badge>
                          </div>
                        )}
                        <Card>
                          <BlockStack gap="400">
                            <BlockStack gap="200" align="start">
                              <Text as="h3" variant="headingLg">
                                Offre 2
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {settings.enable_offer2 ? 
                                  (settings.offer2_type === 'shipping' ? 'Livraison gratuite' : 'Cadeau offert')
                                  : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <InlineStack blockAlign="end" gap="100" align="start">
                              <Text as="h2" variant="heading2xl">
                                {settings.enable_offer2 ? `${settings.offer2_threshold}€` : '–'}
                              </Text>
                              <Box paddingBlockEnd="200">
                                <Text variant="bodySm">seuil</Text>
                              </Box>
                            </InlineStack>
                            <BlockStack gap="100">
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Type :</strong> {settings.enable_offer2 ? 
                                  (settings.offer2_type === 'shipping' ? 'Livraison offerte' : 'Cadeau offert') 
                                  : 'Non configuré'}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Bénéfice :</strong> {settings.enable_offer2 ? 
                                  (settings.offer2_type === 'shipping' ? 
                                    `Livraison gratuite dès ${settings.offer2_threshold}€` : 
                                    'Cadeau offert'
                                  ) : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <Box paddingBlockStart="200" paddingBlockEnd="200">
                              <ButtonGroup fullWidth>
                                <Button 
                                  variant={settings.enable_offer2 ? "primary" : "secondary"}
                                  onClick={() => scrollToOffer(2)}
                                >
                                  {settings.enable_offer2 ? 'Modifier' : 'Configurer'}
                                </Button>
                              </ButtonGroup>
                            </Box>
                          </BlockStack>
                        </Card>
                      </div>

                      {/* Offre 3 */}
                      <div
                        style={{
                          width: "18rem",
                          boxShadow: settings.enable_offer3 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
                          borderRadius: ".75rem",
                          position: "relative",
                          zIndex: "0",
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => scrollToOffer(3)}
                        onMouseEnter={(e) => {
                          if (!settings.enable_offer3) {
                            e.currentTarget.style.boxShadow = '0 8px 16px 0 rgba(0, 0, 0, 0.12)';
                          }
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = settings.enable_offer3 ? "0px 0px 15px 4px #E8F5E8" : "0 1px 3px 0 rgba(0, 0, 0, 0.1)";
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        {settings.enable_offer3 && (
                          <div style={{ position: "absolute", top: "-15px", right: "6px", zIndex: "100" }}>
                            <Badge size="large" tone="success">
                              Activée
                            </Badge>
                          </div>
                        )}
                        <Card>
                          <BlockStack gap="400">
                            <BlockStack gap="200" align="start">
                              <Text as="h3" variant="headingLg">
                                Offre 3
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {settings.enable_offer3 ? 
                                  (settings.offer3_type === 'shipping' ? 'Livraison gratuite' : 'Cadeau offert')
                                  : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <InlineStack blockAlign="end" gap="100" align="start">
                              <Text as="h2" variant="heading2xl">
                                {settings.enable_offer3 ? `${settings.offer3_threshold}€` : '–'}
                              </Text>
                              <Box paddingBlockEnd="200">
                                <Text variant="bodySm">seuil</Text>
                              </Box>
                            </InlineStack>
                            <BlockStack gap="100">
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Type :</strong> {settings.enable_offer3 ? 
                                  (settings.offer3_type === 'shipping' ? 'Livraison offerte' : 'Cadeau offert') 
                                  : 'Non configuré'}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodyMd">
                                <strong>Bénéfice :</strong> {settings.enable_offer3 ? 
                                  (settings.offer3_type === 'shipping' ? 
                                    `Livraison gratuite dès ${settings.offer3_threshold}€` : 
                                    'Cadeau offert'
                                  ) : 'Non configuré'}
                              </Text>
                            </BlockStack>
                            <Box paddingBlockStart="200" paddingBlockEnd="200">
                              <ButtonGroup fullWidth>
                                <Button 
                                  variant={settings.enable_offer3 ? "primary" : "secondary"}
                                  onClick={() => scrollToOffer(3)}
                                >
                                  {settings.enable_offer3 ? 'Modifier' : 'Configurer'}
                                </Button>
                              </ButtonGroup>
                            </Box>
                          </BlockStack>
                        </Card>
                      </div>
                    </InlineStack>
                  </div>
                  
                  <Box paddingBlockStart="5">
                    <Text variant="bodyMd" color="subdued" alignment="center">
                      Cliquez sur une carte pour configurer l'offre correspondante
                    </Text>
                  </Box>
                </Box>
              </Card>
            </Layout.Section>

            {/* Offre 1 */}
            <Layout.Section>
              <div id="offer-1">
                <Card>
                  <Box padding="5">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <Text variant="headingMd" fontWeight="bold">Offre 1</Text>
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
                  
                  {settings.enable_offer1 && (
                    <Box paddingBlockEnd="4">
                      <Text variant="bodyMd" color="subdued" fontStyle="italic">
                        {settings.offer1_type === 'shipping' 
                          ? `Livraison offerte dès ${settings.offer1_threshold}€`
                          : `Cadeau offert dès ${settings.offer1_threshold}€`
                        }
                      </Text>
                    </Box>
                  )}
                  
                  {settings.enable_offer1 && (
                    <BlockStack gap="5">
                      <FormLayout>
                        <Select
                          label="Type d'offre"
                          options={[
                            { label: "Livraison offerte", value: "shipping" },
                            { label: "Cadeau offert", value: "gift" }
                          ]}
                          value={settings.offer1_type}
                          onChange={(value) => handleSettingChange('offer1_type', value)}
                        />
                        
                        <TextField
                          label="Seuil (TTC, en €)"
                          type="number"
                          value={String(settings.offer1_threshold)}
                          onChange={(value) => handleSettingChange('offer1_threshold', value)}
                          placeholder="55,00"
                          helpText="Exemple : 55,00 €"
                        />
                        
                        {settings.offer1_type === "gift" && (
                          <TextField
                            label="Produit à offrir"
                            value={settings.offer1_product_url}
                            onChange={(value) => handleSettingChange('offer1_product_url', value)}
                            placeholder="Sélectionner un produit"
                            helpText="Ce produit sera automatiquement ajouté au panier lorsque le seuil est atteint."
                          />
                        )}
                        
                        <Box paddingBlockStart="3">
                          <Text variant="headingSm" color="subdued">Messages affichés</Text>
                          <Box paddingBlockStart="3">
                            <BlockStack gap="4">
                              <TextField
                                label="Avant activation"
                                value={settings.offer1_text_before}
                                onChange={(value) => handleSettingChange('offer1_text_before', value)}
                                multiline={2}
                                helpText="Utilisez [amount_left] pour afficher le montant restant"
                              />
                              
                              <TextField
                                label="Après activation"
                                value={settings.offer1_text_after}
                                onChange={(value) => handleSettingChange('offer1_text_after', value)}
                                multiline={2}
                              />
                            </BlockStack>
                          </Box>
                        </Box>
                        
                        <Box paddingBlockStart="3">
                          <Banner status="info">
                            <BlockStack gap="2">
                              <Text variant="bodyMd">
                                <strong>Aperçu :</strong>
                              </Text>
                              <Text variant="bodyMd">
                                À <strong>{settings.offer1_threshold}€</strong>, le client bénéficie de{" "}
                                <strong>
                                  {settings.offer1_type === 'shipping' ? 'la livraison offerte' : 'un cadeau offert'}
                                </strong>.
                              </Text>
                              <Text variant="bodyMd">
                                Avec un panier simulé à <strong>42,00 €</strong>, il manque{" "}
                                <strong>{Math.max(0, settings.offer1_threshold - 42).toFixed(2)} €</strong>.
                              </Text>
                            </BlockStack>
                          </Banner>
                        </Box>
                        
                        <Box paddingBlockStart="4">
                          <InlineStack gap="3">
                            <Button
                              primary
                              onClick={handleSubmit}
                              loading={isSubmitting}
                            >
                              Enregistrer uniquement l'offre 1
                            </Button>
                            <Button
                              onClick={() => {
                                setSettings(prev => ({
                                  ...prev,
                                  enable_offer1: false,
                                  offer1_type: "shipping",
                                  offer1_threshold: 55,
                                  offer1_text_before: "Encore [amount_left]€ pour obtenir l'offre 1",
                                  offer1_text_after: "Offre 1 activée !",
                                  offer1_product_url: ""
                                }));
                              }}
                            >
                              Réinitialiser l'offre 1
                            </Button>
                          </InlineStack>
                        </Box>
                      </FormLayout>
                    </BlockStack>
                  )}
                  </Box>
                </Card>
              </div>
            </Layout.Section>

            {/* Offre 2 */}
            <Layout.Section>
              <div id="offer-2">
                <Card>
                  <Box padding="5">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <Text variant="headingMd" fontWeight="bold">Offre 2</Text>
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
                  
                  {settings.enable_offer2 && (
                    <Box paddingBlockEnd="4">
                      <Text variant="bodyMd" color="subdued" fontStyle="italic">
                        {settings.offer2_type === 'shipping' 
                          ? `Livraison offerte dès ${settings.offer2_threshold}€`
                          : `Cadeau offert dès ${settings.offer2_threshold}€`
                        }
                      </Text>
                    </Box>
                  )}
                  
                  {settings.enable_offer2 && (
                    <BlockStack gap="5">
                      <FormLayout>
                        <Select
                          label="Type d'offre"
                          options={[
                            { label: "Livraison offerte", value: "shipping" },
                            { label: "Cadeau offert", value: "gift" }
                          ]}
                          value={settings.offer2_type}
                          onChange={(value) => handleSettingChange('offer2_type', value)}
                        />
                        
                        <TextField
                          label="Seuil (TTC, en €)"
                          type="number"
                          value={String(settings.offer2_threshold)}
                          onChange={(value) => handleSettingChange('offer2_threshold', value)}
                          placeholder="75,00"
                          helpText="Exemple : 75,00 €"
                        />
                        
                        {settings.offer2_type === "gift" && (
                          <TextField
                            label="Produit à offrir"
                            value={settings.offer2_product_url}
                            onChange={(value) => handleSettingChange('offer2_product_url', value)}
                            placeholder="Sélectionner un produit"
                            helpText="Ce produit sera automatiquement ajouté au panier lorsque le seuil est atteint."
                          />
                        )}
                        
                        <Box paddingBlockStart="3">
                          <Text variant="headingSm" color="subdued">Messages affichés</Text>
                          <Box paddingBlockStart="3">
                            <BlockStack gap="4">
                              <TextField
                                label="Avant activation"
                                value={settings.offer2_text_before}
                                onChange={(value) => handleSettingChange('offer2_text_before', value)}
                                multiline={2}
                                helpText="Utilisez [amount_left] pour afficher le montant restant"
                              />
                              
                              <TextField
                                label="Après activation"
                                value={settings.offer2_text_after}
                                onChange={(value) => handleSettingChange('offer2_text_after', value)}
                                multiline={2}
                              />
                            </BlockStack>
                          </Box>
                        </Box>
                        
                        <Box paddingBlockStart="3">
                          <Banner status="info">
                            <BlockStack gap="2">
                              <Text variant="bodyMd">
                                <strong>Aperçu :</strong>
                              </Text>
                              <Text variant="bodyMd">
                                À <strong>{settings.offer2_threshold}€</strong>, le client bénéficie de{" "}
                                <strong>
                                  {settings.offer2_type === 'shipping' ? 'la livraison offerte' : 'un cadeau offert'}
                                </strong>.
                              </Text>
                              <Text variant="bodyMd">
                                Avec un panier simulé à <strong>42,00 €</strong>, il manque{" "}
                                <strong>{Math.max(0, settings.offer2_threshold - 42).toFixed(2)} €</strong>.
                              </Text>
                            </BlockStack>
                          </Banner>
                        </Box>
                        
                        <Box paddingBlockStart="4">
                          <InlineStack gap="3">
                            <Button
                              primary
                              onClick={handleSubmit}
                              loading={isSubmitting}
                            >
                              Enregistrer uniquement l'offre 2
                            </Button>
                            <Button
                              onClick={() => {
                                setSettings(prev => ({
                                  ...prev,
                                  enable_offer2: false,
                                  offer2_type: "gift",
                                  offer2_threshold: 75,
                                  offer2_text_before: "Encore [amount_left]€ pour obtenir l'offre 2",
                                  offer2_text_after: "Offre 2 activée !",
                                  offer2_product_url: ""
                                }));
                              }}
                            >
                              Réinitialiser l'offre 2
                            </Button>
                          </InlineStack>
                        </Box>
                      </FormLayout>
                    </BlockStack>
                  )}
                  </Box>
                </Card>
              </div>
            </Layout.Section>

            {/* Offre 3 */}
            <Layout.Section>
              <div id="offer-3">
                <Card>
                  <Box padding="5">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <Text variant="headingMd" fontWeight="bold">Offre 3</Text>
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
                  
                  {settings.enable_offer3 && (
                    <Box paddingBlockEnd="4">
                      <Text variant="bodyMd" color="subdued" fontStyle="italic">
                        {settings.offer3_type === 'shipping' 
                          ? `Livraison offerte dès ${settings.offer3_threshold}€`
                          : `Cadeau offert dès ${settings.offer3_threshold}€`
                        }
                      </Text>
                    </Box>
                  )}
                  
                  {settings.enable_offer3 && (
                    <BlockStack gap="5">
                      <FormLayout>
                        <Select
                          label="Type d'offre"
                          options={[
                            { label: "Livraison offerte", value: "shipping" },
                            { label: "Cadeau offert", value: "gift" }
                          ]}
                          value={settings.offer3_type}
                          onChange={(value) => handleSettingChange('offer3_type', value)}
                        />
                        
                        <TextField
                          label="Seuil (TTC, en €)"
                          type="number"
                          value={String(settings.offer3_threshold)}
                          onChange={(value) => handleSettingChange('offer3_threshold', value)}
                          placeholder="100,00"
                          helpText="Exemple : 100,00 €"
                        />
                        
                        {settings.offer3_type === "gift" && (
                          <TextField
                            label="Produit à offrir"
                            value={settings.offer3_product_url}
                            onChange={(value) => handleSettingChange('offer3_product_url', value)}
                            placeholder="Sélectionner un produit"
                            helpText="Ce produit sera automatiquement ajouté au panier lorsque le seuil est atteint."
                          />
                        )}
                        
                        <Box paddingBlockStart="3">
                          <Text variant="headingSm" color="subdued">Messages affichés</Text>
                          <Box paddingBlockStart="3">
                            <BlockStack gap="4">
                              <TextField
                                label="Avant activation"
                                value={settings.offer3_text_before}
                                onChange={(value) => handleSettingChange('offer3_text_before', value)}
                                multiline={2}
                                helpText="Utilisez [amount_left] pour afficher le montant restant"
                              />
                              
                              <TextField
                                label="Après activation"
                                value={settings.offer3_text_after}
                                onChange={(value) => handleSettingChange('offer3_text_after', value)}
                                multiline={2}
                              />
                            </BlockStack>
                          </Box>
                        </Box>
                        
                        <Box paddingBlockStart="3">
                          <Banner status="info">
                            <BlockStack gap="2">
                              <Text variant="bodyMd">
                                <strong>Aperçu :</strong>
                              </Text>
                              <Text variant="bodyMd">
                                À <strong>{settings.offer3_threshold}€</strong>, le client bénéficie de{" "}
                                <strong>
                                  {settings.offer3_type === 'shipping' ? 'la livraison offerte' : 'un cadeau offert'}
                                </strong>.
                              </Text>
                              <Text variant="bodyMd">
                                Avec un panier simulé à <strong>42,00 €</strong>, il manque{" "}
                                <strong>{Math.max(0, settings.offer3_threshold - 42).toFixed(2)} €</strong>.
                              </Text>
                            </BlockStack>
                          </Banner>
                        </Box>
                        
                        <Box paddingBlockStart="4">
                          <InlineStack gap="3">
                            <Button
                              primary
                              onClick={handleSubmit}
                              loading={isSubmitting}
                            >
                              Enregistrer uniquement l'offre 3
                            </Button>
                            <Button
                              onClick={() => {
                                setSettings(prev => ({
                                  ...prev,
                                  enable_offer3: false,
                                  offer3_type: "gift",
                                  offer3_threshold: 100,
                                  offer3_text_before: "Encore [amount_left]€ pour obtenir l'offre 3",
                                  offer3_text_after: "Offre 3 activée !",
                                  offer3_product_url: ""
                                }));
                              }}
                            >
                              Réinitialiser l'offre 3
                            </Button>
                          </InlineStack>
                        </Box>
                      </FormLayout>
                    </BlockStack>
                  )}
                  </Box>
                </Card>
              </div>
            </Layout.Section>
          </Layout>
        </Page>
      </div>

      {/* Barre de sauvegarde persistante */}
      {isDirty() && (
        <ContextualSaveBar
          message="Vous avez des modifications non enregistrées"
          saveAction={{
            content: 'Enregistrer toutes les offres',
            onAction: handleSubmit,
            loading: isSubmitting,
          }}
          discardAction={{
            content: 'Annuler les modifications',
            onAction: handleCancel,
            disabled: isSubmitting,
          }}
        />
      )}
    </Frame>
  );
}