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
  Checkbox
} from "@shopify/polaris";
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
    <Card sectioned title={`Offre ${offerNumber}`}>
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
        />
        
        <TextField
          label="Message après activation"
          value={textAfter}
          onChange={(value) => onChange(`offer${offerNumber}_text_after`, value)}
          disabled={!enabled}
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
      </FormLayout>
    </Card>
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
    event.preventDefault();
    
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
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [actionData]);
  
  return (
    <Page
      title="Paramètres des offres"
      subtitle="Configurez les offres à afficher dans votre panier personnalisé"
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
      
      <Form method="post" onSubmit={handleSubmit}>
        <Layout>
          {/* Offre 1 */}
          <Layout.Section>
            <OfferForm
              index={0}
              settings={settings}
              onChange={handleSettingChange}
            />
          </Layout.Section>
          
          {/* Offre 2 */}
          <Layout.Section>
            <OfferForm
              index={1}
              settings={settings}
              onChange={handleSettingChange}
            />
          </Layout.Section>
          
          {/* Offre 3 */}
          <Layout.Section>
            <OfferForm
              index={2}
              settings={settings}
              onChange={handleSettingChange}
            />
          </Layout.Section>
          
          <Layout.Section>
            <Card sectioned>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  primary
                  submit
                  loading={isSubmitting}
                >
                  Enregistrer les offres
                </Button>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Form>
    </Page>
  );
}