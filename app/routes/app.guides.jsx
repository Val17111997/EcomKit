import { useState, useCallback, useEffect, useId } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
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
  Image,
  BlockStack,
  ButtonGroup,
  Popover,
  ActionList,
  ProgressBar,
  Tooltip,
  Spinner,
  Collapsible,
  Icon
} from "@shopify/polaris";
import { MenuHorizontalIcon, ChevronDownIcon, ChevronUpIcon, CheckIcon, XIcon } from '@shopify/polaris-icons';
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

// Composant SetupGuide adapté pour BoostCart
const BoostCartSetupGuide = ({ onDismiss, onStepComplete, items }) => {
  const [expanded, setExpanded] = useState(items.findIndex((item) => !item.complete));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [popoverActive, setPopoverActive] = useState(false);
  const accessId = useId();
  const completedItemsLength = items.filter((item) => item.complete).length;

  return (
    <Card padding='0'>
      <Box padding='400' paddingBlockEnd='400'>
        <BlockStack>
          <InlineStack align='space-between' blockAlign='center'>
            <Text as='h3' variant='headingMd'>
              Guide de configuration BoostCart
            </Text>
            <ButtonGroup gap='tight' noWrap>
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive((prev) => !prev)}
                activator={
                  <Button
                    onClick={() => setPopoverActive((prev) => !prev)}
                    variant='tertiary'
                    icon={MenuHorizontalIcon}
                  />
                }
              >
                <ActionList
                  actionRole='menuitem'
                  items={[
                    {
                      content: 'Masquer le guide',
                      onAction: onDismiss,
                      prefix: (
                        <div
                          style={{
                            height: '1rem',
                            width: '1rem',
                            paddingTop: '.05rem'
                          }}
                        >
                          <Icon tone='subdued' source={XIcon} />
                        </div>
                      )
                    }
                  ]}
                />
              </Popover>

              <Button
                variant='tertiary'
                icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => {
                  setIsGuideOpen((prev) => {
                    if (!prev) setExpanded(items.findIndex((item) => !item.complete));
                    return !prev;
                  });
                }}
                ariaControls={accessId}
              />
            </ButtonGroup>
          </InlineStack>
          <Text as='p' variant='bodyMd'>
            Suivez ces étapes pour configurer et activer votre BoostCart.
          </Text>
          <div style={{ marginTop: '.8rem' }}>
            <InlineStack blockAlign='center' gap='200'>
              {completedItemsLength === items.length ? (
                <div style={{ maxHeight: '1rem' }}>
                  <InlineStack wrap={false} gap='100'>
                    <Icon
                      source={CheckIcon}
                      tone='subdued'
                      accessibilityLabel='Check icon to indicate completion of Setup Guide'
                    />
                    <Text as='p' variant='bodySm' tone='subdued'>
                      Configuration terminée
                    </Text>
                  </InlineStack>
                </div>
              ) : (
                <Text as='span' variant='bodySm'>
                  {`${completedItemsLength} / ${items.length} étapes complétées`}
                </Text>
              )}

              {completedItemsLength !== items.length ? (
                <div style={{ width: '100px' }}>
                  <ProgressBar
                    progress={(items.filter((item) => item.complete).length / items.length) * 100}
                    size='small'
                    tone='primary'
                    animated
                  />
                </div>
              ) : null}
            </InlineStack>
          </div>
        </BlockStack>
      </Box>
      <Collapsible open={isGuideOpen} id={accessId}>
        <Box padding='200'>
          <BlockStack gap='100'>
            {items.map((item) => {
              return (
                <SetupItem
                  key={item.id}
                  expanded={expanded === item.id}
                  setExpanded={() => setExpanded(item.id)}
                  onComplete={onStepComplete}
                  {...item}
                />
              );
            })}
          </BlockStack>
        </Box>
      </Collapsible>
      {completedItemsLength === items.length ? (
        <Box
          background='bg-surface-secondary'
          borderBlockStartWidth='025'
          borderColor='border-secondary'
          padding='300'
        >
          <InlineStack align='end'>
            <Button onClick={onDismiss}>Masquer le guide</Button>
          </InlineStack>
        </Box>
      ) : null}
    </Card>
  );
};

// Composant SetupGuide adapté pour Ultimate Pack
const UltimatePackSetupGuide = ({ onDismiss, onStepComplete, items }) => {
  const [expanded, setExpanded] = useState(items.findIndex((item) => !item.complete));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [popoverActive, setPopoverActive] = useState(false);
  const accessId = useId();
  const completedItemsLength = items.filter((item) => item.complete).length;

  return (
    <Card padding='0'>
      <Box padding='400' paddingBlockEnd='400'>
        <BlockStack>
          <InlineStack align='space-between' blockAlign='center'>
            <Text as='h3' variant='headingMd'>
              Guide de configuration Ultimate Pack
            </Text>
            <ButtonGroup gap='tight' noWrap>
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive((prev) => !prev)}
                activator={
                  <Button
                    onClick={() => setPopoverActive((prev) => !prev)}
                    variant='tertiary'
                    icon={MenuHorizontalIcon}
                  />
                }
              >
                <ActionList
                  actionRole='menuitem'
                  items={[
                    {
                      content: 'Masquer le guide',
                      onAction: onDismiss,
                      prefix: (
                        <div
                          style={{
                            height: '1rem',
                            width: '1rem',
                            paddingTop: '.05rem'
                          }}
                        >
                          <Icon tone='subdued' source={XIcon} />
                        </div>
                      )
                    }
                  ]}
                />
              </Popover>

              <Button
                variant='tertiary'
                icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => {
                  setIsGuideOpen((prev) => {
                    if (!prev) setExpanded(items.findIndex((item) => !item.complete));
                    return !prev;
                  });
                }}
                ariaControls={accessId}
              />
            </ButtonGroup>
          </InlineStack>
          <Text as='p' variant='bodyMd'>
            Suivez ces étapes pour configurer et activer Ultimate Pack.
          </Text>
          <div style={{ marginTop: '.8rem' }}>
            <InlineStack blockAlign='center' gap='200'>
              {completedItemsLength === items.length ? (
                <div style={{ maxHeight: '1rem' }}>
                  <InlineStack wrap={false} gap='100'>
                    <Icon
                      source={CheckIcon}
                      tone='subdued'
                      accessibilityLabel='Check icon to indicate completion of Setup Guide'
                    />
                    <Text as='p' variant='bodySm' tone='subdued'>
                      Configuration terminée
                    </Text>
                  </InlineStack>
                </div>
              ) : (
                <Text as='span' variant='bodySm'>
                  {`${completedItemsLength} / ${items.length} étapes complétées`}
                </Text>
              )}

              {completedItemsLength !== items.length ? (
                <div style={{ width: '100px' }}>
                  <ProgressBar
                    progress={(items.filter((item) => item.complete).length / items.length) * 100}
                    size='small'
                    tone='primary'
                    animated
                  />
                </div>
              ) : null}
            </InlineStack>
          </div>
        </BlockStack>
      </Box>
      <Collapsible open={isGuideOpen} id={accessId}>
        <Box padding='200'>
          <BlockStack gap='100'>
            {items.map((item) => {
              return (
                <UltimatePackSetupItem
                  key={item.id}
                  expanded={expanded === item.id}
                  setExpanded={() => setExpanded(item.id)}
                  onComplete={onStepComplete}
                  {...item}
                />
              );
            })}
          </BlockStack>
        </Box>
      </Collapsible>
      {completedItemsLength === items.length ? (
        <Box
          background='bg-surface-secondary'
          borderBlockStartWidth='025'
          borderColor='border-secondary'
          padding='300'
        >
          <InlineStack align='end'>
            <Button onClick={onDismiss}>Masquer le guide</Button>
          </InlineStack>
        </Box>
      ) : null}
    </Card>
  );
};

// Composant SetupGuide adapté pour Bundle Cards
const BundleCardsSetupGuide = ({ onDismiss, onStepComplete, items }) => {
  const [expanded, setExpanded] = useState(items.findIndex((item) => !item.complete));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [popoverActive, setPopoverActive] = useState(false);
  const accessId = useId();
  const completedItemsLength = items.filter((item) => item.complete).length;

  return (
    <Card padding='0'>
      <Box padding='400' paddingBlockEnd='400'>
        <BlockStack>
          <InlineStack align='space-between' blockAlign='center'>
            <Text as='h3' variant='headingMd'>
              Guide de configuration Bundle Cards
            </Text>
            <ButtonGroup gap='tight' noWrap>
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive((prev) => !prev)}
                activator={
                  <Button
                    onClick={() => setPopoverActive((prev) => !prev)}
                    variant='tertiary'
                    icon={MenuHorizontalIcon}
                  />
                }
              >
                <ActionList
                  actionRole='menuitem'
                  items={[
                    {
                      content: 'Masquer le guide',
                      onAction: onDismiss,
                      prefix: (
                        <div
                          style={{
                            height: '1rem',
                            width: '1rem',
                            paddingTop: '.05rem'
                          }}
                        >
                          <Icon tone='subdued' source={XIcon} />
                        </div>
                      )
                    }
                  ]}
                />
              </Popover>

              <Button
                variant='tertiary'
                icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => {
                  setIsGuideOpen((prev) => {
                    if (!prev) setExpanded(items.findIndex((item) => !item.complete));
                    return !prev;
                  });
                }}
                ariaControls={accessId}
              />
            </ButtonGroup>
          </InlineStack>
          <Text as='p' variant='bodyMd'>
            Suivez ces étapes pour configurer et activer vos Bundle Cards.
          </Text>
          <div style={{ marginTop: '.8rem' }}>
            <InlineStack blockAlign='center' gap='200'>
              {completedItemsLength === items.length ? (
                <div style={{ maxHeight: '1rem' }}>
                  <InlineStack wrap={false} gap='100'>
                    <Icon
                      source={CheckIcon}
                      tone='subdued'
                      accessibilityLabel='Check icon to indicate completion of Setup Guide'
                    />
                    <Text as='p' variant='bodySm' tone='subdued'>
                      Configuration terminée
                    </Text>
                  </InlineStack>
                </div>
              ) : (
                <Text as='span' variant='bodySm'>
                  {`${completedItemsLength} / ${items.length} étapes complétées`}
                </Text>
              )}

              {completedItemsLength !== items.length ? (
                <div style={{ width: '100px' }}>
                  <ProgressBar
                    progress={(items.filter((item) => item.complete).length / items.length) * 100}
                    size='small'
                    tone='primary'
                    animated
                  />
                </div>
              ) : null}
            </InlineStack>
          </div>
        </BlockStack>
      </Box>
      <Collapsible open={isGuideOpen} id={accessId}>
        <Box padding='200'>
          <BlockStack gap='100'>
            {items.map((item) => {
              return (
                <BundleSetupItem
                  key={item.id}
                  expanded={expanded === item.id}
                  setExpanded={() => setExpanded(item.id)}
                  onComplete={onStepComplete}
                  {...item}
                />
              );
            })}
          </BlockStack>
        </Box>
      </Collapsible>
      {completedItemsLength === items.length ? (
        <Box
          background='bg-surface-secondary'
          borderBlockStartWidth='025'
          borderColor='border-secondary'
          padding='300'
        >
          <InlineStack align='end'>
            <Button onClick={onDismiss}>Masquer le guide</Button>
          </InlineStack>
        </Box>
      ) : null}
    </Card>
  );
};

const SetupItem = ({
  complete,
  onComplete,
  expanded,
  setExpanded,
  title,
  description,
  image,
  primaryButton,
  secondaryButton,
  id
}) => {
  const [loading, setLoading] = useState(false);

  const completeItem = async () => {
    setLoading(true);
    await onComplete(id);
    setLoading(false);
  };

  const outlineSvg = (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M21.9147 13.3062L19.9315 13.0475C19.9761 12.7056 19.9993 12.3561 19.9993 12.0001C19.9993 11.6442 19.9761 11.2946 19.9315 10.9527L21.9147 10.694C21.9705 11.1215 21.9993 11.5575 21.9993 12.0001C21.9993 12.4428 21.9705 12.8787 21.9147 13.3062ZM21.2405 8.17224L19.393 8.93835C19.1238 8.28906 18.7709 7.68206 18.3474 7.13093L19.9333 5.91228C20.4621 6.6004 20.9033 7.35927 21.2405 8.17224ZM18.0871 4.06613L16.8685 5.65197C16.3173 5.22845 15.7103 4.87563 15.061 4.60638L15.8271 2.75893C16.6401 3.09605 17.399 3.53734 18.0871 4.06613ZM13.3054 2.08464L13.0467 4.06784C12.7048 4.02324 12.3552 4.00012 11.9993 4.00012C11.6433 4.00012 11.2938 4.02324 10.9519 4.06784L10.6932 2.08464C11.1206 2.02889 11.5566 2.00012 11.9993 2.00012C12.4419 2.00012 12.8779 2.02889 13.3054 2.08464ZM8.17139 2.75893L8.9375 4.60638C8.2882 4.87563 7.6812 5.22845 7.13008 5.65197L5.91143 4.06613C6.59954 3.53734 7.35841 3.09606 8.17139 2.75893ZM4.06527 5.91228L5.65111 7.13093C5.22759 7.68206 4.87478 8.28906 4.60552 8.93835L2.75807 8.17225C3.0952 7.35927 3.53648 6.6004 4.06527 5.91228ZM2.08379 10.694C2.02803 11.1215 1.99927 11.5575 1.99927 12.0001C1.99927 12.4428 2.02803 12.8787 2.08379 13.3062L4.06699 13.0475C4.02239 12.7056 3.99927 12.3561 3.99927 12.0001C3.99927 11.6442 4.02239 11.2946 4.06699 10.9527L2.08379 10.694ZM2.75807 15.828L4.60553 15.0619C4.87478 15.7112 5.22759 16.3182 5.65111 16.8693L4.06527 18.088C3.53648 17.3998 3.0952 16.641 2.75807 15.828ZM5.91143 19.9341L7.13008 18.3483C7.68121 18.7718 8.28821 19.1246 8.9375 19.3939L8.17139 21.2413C7.35841 20.9042 6.59955 20.4629 5.91143 19.9341ZM10.6932 21.9156L10.9519 19.9324C11.2938 19.977 11.6433 20.0001 11.9993 20.0001C12.3552 20.0001 12.7048 19.977 13.0467 19.9324L13.3054 21.9156C12.8779 21.9714 12.4419 22.0001 11.9993 22.0001C11.5566 22.0001 11.1206 21.9714 10.6932 21.9156ZM15.8271 21.2413L15.061 19.3939C15.7103 19.1246 16.3173 18.7718 16.8685 18.3483L18.0871 19.9341C17.399 20.4629 16.6401 20.9042 15.8271 21.2413ZM19.9333 18.088L18.3474 16.8693C18.7709 16.3182 19.1238 15.7112 19.393 15.0619L21.2405 15.828C20.9033 16.641 20.4621 17.3998 19.9333 18.088Z'
        fill='#8C9196'
        style={{ display: 'none' }}
      ></path>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.5334 2.10692C11.0126 2.03643 11.5024 2 12 2C12.4976 2 12.9874 2.03643 13.4666 2.10692C14.013 2.18729 14.3908 2.6954 14.3104 3.2418C14.23 3.78821 13.7219 4.166 13.1755 4.08563C12.7924 4.02927 12.3999 4 12 4C11.6001 4 11.2076 4.02927 10.8245 4.08563C10.2781 4.166 9.76995 3.78821 9.68958 3.2418C9.6092 2.6954 9.987 2.18729 10.5334 2.10692ZM7.44122 4.17428C7.77056 4.61763 7.67814 5.24401 7.23479 5.57335C6.603 6.04267 6.04267 6.603 5.57335 7.23479C5.24401 7.67814 4.61763 7.77056 4.17428 7.44122C3.73094 7.11188 3.63852 6.4855 3.96785 6.04216C4.55386 5.25329 5.25329 4.55386 6.04216 3.96785C6.4855 3.63852 7.11188 3.73094 7.44122 4.17428ZM16.5588 4.17428C16.8881 3.73094 17.5145 3.63852 17.9578 3.96785C18.7467 4.55386 19.4461 5.25329 20.0321 6.04216C20.3615 6.4855 20.2691 7.11188 19.8257 7.44122C19.3824 7.77056 18.756 7.67814 18.4267 7.23479C17.9573 6.603 17.397 6.04267 16.7652 5.57335C16.3219 5.24401 16.2294 4.61763 16.5588 4.17428ZM3.2418 9.68958C3.78821 9.76995 4.166 10.2781 4.08563 10.8245C4.02927 11.2076 4 11.6001 4 12C4 12.3999 4.02927 12.7924 4.08563 13.1755C4.166 13.7219 3.78821 14.23 3.2418 14.3104C2.6954 14.3908 2.18729 14.013 2.10692 13.4666C2.03643 12.9874 2 12.4976 2 12C2 11.5024 2.03643 11.0126 2.10692 10.5334C2.18729 9.987 2.6954 9.6092 3.2418 9.68958ZM20.7582 9.68958C21.3046 9.6092 21.8127 9.987 21.8931 10.5334C21.9636 11.0126 22 11.5024 22 12C22 12.4976 21.9636 12.9874 21.8931 13.4666C21.8127 14.013 21.3046 14.3908 20.7582 14.3104C20.2118 14.23 19.834 13.7219 19.9144 13.1755C19.9707 12.7924 20 12.3999 20 12C20 11.6001 19.9707 11.2076 19.9144 10.8245C19.834 10.2781 20.2118 9.76995 20.7582 9.68958ZM4.17428 16.5588C4.61763 16.2294 5.24401 16.3219 5.57335 16.7652C6.04267 17.397 6.603 17.9573 7.23479 18.4267C7.67814 18.756 7.77056 19.3824 7.44122 19.8257C7.11188 20.2691 6.4855 20.3615 6.04216 20.0321C5.25329 19.4461 4.55386 18.7467 3.96785 17.9578C3.63852 17.5145 3.73094 16.8881 4.17428 16.5588ZM19.8257 16.5588C20.2691 16.8881 20.3615 17.5145 20.0321 17.9578C19.4461 18.7467 18.7467 19.4461 17.9578 20.0321C17.5145 20.3615 16.8881 20.2691 16.5588 19.8257C16.2294 19.3824 16.3219 18.756 16.7652 18.4267C17.397 17.9573 17.9573 17.397 18.4267 16.7652C18.756 16.3219 19.3824 16.2294 19.8257 16.5588ZM9.68958 20.7582C9.76995 20.2118 10.2781 19.834 10.8245 19.9144C11.2076 19.9707 11.6001 20 12 20C12.3999 20 12.7924 19.9707 13.1755 19.9144C13.7219 19.834 14.23 20.2118 14.3104 20.7582C14.3908 21.3046 14.013 21.8127 13.4666 21.8931C12.9874 21.9636 12.4976 22 12 22C11.5024 22 11.0126 21.9636 10.5334 21.8931C9.987 21.8127 9.6092 21.3046 9.68958 20.7582Z'
        fill='#8A8A8A'
      ></path>
      <circle cx='12' cy='12' r='12' fill='#DBDDDF' style={{ display: 'none' }}></circle>
      <circle
        cx='12'
        cy='12'
        r='9'
        fill='#F6F6F7'
        stroke='#999EA4'
        strokeWidth='2'
        style={{ display: 'none' }}
      ></circle>
    </svg>
  );

  return (
    <Box borderRadius='200' background={expanded && 'bg-surface-active'}>
      <div style={{ padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
        <InlineStack gap='200' align='start' blockAlign='start' wrap={false}>
          <Tooltip content={complete ? 'Marquer comme non terminé' : 'Marquer comme terminé'} activatorWrapper='div'>
            <Button onClick={completeItem} variant='monochromePlain'>
              <div style={{
                width: '1.5rem',
                height: '1.5rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: '#303030'
              }}>
                {loading ? (
                  <Spinner size='small' />
                ) : complete ? (
                  <CheckIcon
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      borderRadius: '100%',
                      background: '#303030',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      fill: 'white'
                    }}
                  />
                ) : (
                  outlineSvg
                )}
              </div>
            </Button>
          </Tooltip>
          <div
            style={{
              cursor: expanded ? 'default' : 'pointer',
              paddingTop: '.15rem',
              width: '100%',
              display: 'flex',
              gap: '8rem',
              justifyContent: 'space-between'
            }}
          >
            <div 
              onClick={expanded ? () => null : setExpanded}
              style={{ width: '100%' }}
            >
              <BlockStack gap='300' id={id}>
                <Text as='h4' variant={expanded ? 'headingSm' : 'bodyMd'}>
                  {title}
                </Text>
                <Collapsible open={expanded} id={id}>
                  <Box paddingBlockEnd='150' paddingInlineEnd='150'>
                    <BlockStack gap='400'>
                      <Text as='p' variant='bodyMd'>
                        {description}
                      </Text>
                      
                      {/* Liste d'étapes si présente */}
                      {expanded && (
                        <List type="number">
                          {id === 0 && (
                            <>
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
                            </>
                          )}
                          {id === 1 && (
                            <>
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
                            </>
                          )}
                          {id === 2 && (
                            <>
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
                            </>
                          )}
                        </List>
                      )}

                      {/* Banner d'astuce pour l'étape 2 */}
                      {expanded && id === 1 && (
                        <Banner status="info">
                          <Text variant="bodyMd">
                            <strong>💡 Astuce pour les produits offerts :</strong> Créez un produit avec le nom du produit suivi de "offert" (ex: "Magnésium marin offert"), définissez le prix à 0€ et renseignez le prix avant réduction (ex: prix avant réduction 14€, prix final 0€). Cela permettra d'afficher la valeur du cadeau tout en l'offrant gratuitement.
                          </Text>
                        </Banner>
                      )}
                      
                      {primaryButton || secondaryButton ? (
                        <ButtonGroup gap='loose'>
                          {primaryButton ? (
                            <Button variant='primary' {...primaryButton.props}>
                              {primaryButton.content}
                            </Button>
                          ) : null}
                          {secondaryButton ? (
                            <Button variant='tertiary' {...secondaryButton.props}>
                              {secondaryButton.content}
                            </Button>
                          ) : null}
                        </ButtonGroup>
                      ) : null}
                    </BlockStack>
                  </Box>
                </Collapsible>
              </BlockStack>
            </div>
            {image && expanded ? (
              <div style={{ flexShrink: 0 }}>
                <Image
                  source={image.url}
                  alt={image.alt}
                  style={{ maxHeight: '7.75rem', borderRadius: '8px', border: '1px solid #e1e3e5' }}
                />
              </div>
            ) : null}
          </div>
        </InlineStack>
      </div>
    </Box>
  );
};

// Composant SetupItem spécialisé pour Bundle Cards
const BundleSetupItem = ({
  complete,
  onComplete,
  expanded,
  setExpanded,
  title,
  description,
  image,
  video,
  primaryButton,
  secondaryButton,
  id
}) => {
  const [loading, setLoading] = useState(false);

  const completeItem = async () => {
    setLoading(true);
    await onComplete(id);
    setLoading(false);
  };

  const outlineSvg = (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.5334 2.10692C11.0126 2.03643 11.5024 2 12 2C12.4976 2 12.9874 2.03643 13.4666 2.10692C14.013 2.18729 14.3908 2.6954 14.3104 3.2418C14.23 3.78821 13.7219 4.166 13.1755 4.08563C12.7924 4.02927 12.3999 4 12 4C11.6001 4 11.2076 4.02927 10.8245 4.08563C10.2781 4.166 9.76995 3.78821 9.68958 3.2418C9.6092 2.6954 9.987 2.18729 10.5334 2.10692ZM7.44122 4.17428C7.77056 4.61763 7.67814 5.24401 7.23479 5.57335C6.603 6.04267 6.04267 6.603 5.57335 7.23479C5.24401 7.67814 4.61763 7.77056 4.17428 7.44122C3.73094 7.11188 3.63852 6.4855 3.96785 6.04216C4.55386 5.25329 5.25329 4.55386 6.04216 3.96785C6.4855 3.63852 7.11188 3.73094 7.44122 4.17428ZM16.5588 4.17428C16.8881 3.73094 17.5145 3.63852 17.9578 3.96785C18.7467 4.55386 19.4461 5.25329 20.0321 6.04216C20.3615 6.4855 20.2691 7.11188 19.8257 7.44122C19.3824 7.77056 18.756 7.67814 18.4267 7.23479C17.9573 6.603 17.397 6.04267 16.7652 5.57335C16.3219 5.24401 16.2294 4.61763 16.5588 4.17428ZM3.2418 9.68958C3.78821 9.76995 4.166 10.2781 4.08563 10.8245C4.02927 11.2076 4 11.6001 4 12C4 12.3999 4.02927 12.7924 4.08563 13.1755C4.166 13.7219 3.78821 14.23 3.2418 14.3104C2.6954 14.3908 2.18729 14.013 2.10692 13.4666C2.03643 12.9874 2 12.4976 2 12C2 11.5024 2.03643 11.0126 2.10692 10.5334C2.18729 9.987 2.6954 9.6092 3.2418 9.68958ZM20.7582 9.68958C21.3046 9.6092 21.8127 9.987 21.8931 10.5334C21.9636 11.0126 22 11.5024 22 12C22 12.4976 21.9636 12.9874 21.8931 13.4666C21.8127 14.013 21.3046 14.3908 20.7582 14.3104C20.2118 14.23 19.834 13.7219 19.9144 13.1755C19.9707 12.7924 20 12.3999 20 12C20 11.6001 19.9707 11.2076 19.9144 10.8245C19.834 10.2781 20.2118 9.76995 20.7582 9.68958ZM4.17428 16.5588C4.61763 16.2294 5.24401 16.3219 5.57335 16.7652C6.04267 17.397 6.603 17.9573 7.23479 18.4267C7.67814 18.756 7.77056 19.3824 7.44122 19.8257C7.11188 20.2691 6.4855 20.3615 6.04216 20.0321C5.25329 19.4461 4.55386 18.7467 3.96785 17.9578C3.63852 17.5145 3.73094 16.8881 4.17428 16.5588ZM19.8257 16.5588C20.2691 16.8881 20.3615 17.5145 20.0321 17.9578C19.4461 18.7467 18.7467 19.4461 17.9578 20.0321C17.5145 20.3615 16.8881 20.2691 16.5588 19.8257C16.2294 19.3824 16.3219 18.756 16.7652 18.4267C17.397 17.9573 17.9573 17.397 18.4267 16.7652C18.756 16.3219 19.3824 16.2294 19.8257 16.5588ZM9.68958 20.7582C9.76995 20.2118 10.2781 19.834 10.8245 19.9144C11.2076 19.9707 11.6001 20 12 20C12.3999 20 12.7924 19.9707 13.1755 19.9144C13.7219 19.834 14.23 20.2118 14.3104 20.7582C14.3908 21.3046 14.013 21.8127 13.4666 21.8931C12.9874 21.9636 12.4976 22 12 22C11.5024 22 11.0126 21.9636 10.5334 21.8931C9.987 21.8127 9.6092 21.3046 9.68958 20.7582Z'
        fill='#8A8A8A'
      ></path>
      <circle cx='12' cy='12' r='12' fill='#DBDDDF' style={{ display: 'none' }}></circle>
      <circle
        cx='12'
        cy='12'
        r='9'
        fill='#F6F6F7'
        stroke='#999EA4'
        strokeWidth='2'
        style={{ display: 'none' }}
      ></circle>
    </svg>
  );

  return (
    <Box borderRadius='200' background={expanded && 'bg-surface-active'}>
      <div style={{ padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
        <InlineStack gap='200' align='start' blockAlign='start' wrap={false}>
          <Tooltip content={complete ? 'Marquer comme non terminé' : 'Marquer comme terminé'} activatorWrapper='div'>
            <Button onClick={completeItem} variant='monochromePlain'>
              <div style={{
                width: '1.5rem',
                height: '1.5rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: '#303030'
              }}>
                {loading ? (
                  <Spinner size='small' />
                ) : complete ? (
                  <CheckIcon
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      borderRadius: '100%',
                      background: '#303030',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      fill: 'white'
                    }}
                  />
                ) : (
                  outlineSvg
                )}
              </div>
            </Button>
          </Tooltip>
          <div
            style={{
              cursor: expanded ? 'default' : 'pointer',
              paddingTop: '.15rem',
              width: '100%',
              display: 'flex',
              gap: '8rem',
              justifyContent: 'space-between'
            }}
          >
            <div 
              onClick={expanded ? () => null : setExpanded}
              style={{ width: '100%' }}
            >
              <BlockStack gap='300' id={id}>
                <Text as='h4' variant={expanded ? 'headingSm' : 'bodyMd'}>
                  {title}
                </Text>
                <Collapsible open={expanded} id={id}>
                  <Box paddingBlockEnd='150' paddingInlineEnd='150'>
                    <BlockStack gap='400'>
                      <Text as='p' variant='bodyMd'>
                        {description}
                      </Text>
                      
                      {/* Liste d'étapes si présente */}
                      {expanded && (
                        <List type="number">
                          {id === 0 && (
                            <>
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
                            </>
                          )}
                          {id === 1 && (
                            <>
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
                                  Cliquez sur Application, puis Bundle Card
                                </Text>
                              </List.Item>
                            </>
                          )}
                          {id === 2 && (
                            <>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Sélectionnez votre produit avec variantes</strong> 
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Personnalisez les titres :</strong> Donnez des noms attractifs à vos packs
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Ajoutez des badges :</strong> Mettez en avant des offres alléchantes
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Messages de livraison :</strong> Ajoutez la livraison offerte si c'est le cas sur certains packs
                                </Text>
                              </List.Item>
                            </>
                          )}
                        </List>
                      )}
                      
                      {primaryButton || secondaryButton ? (
                        <ButtonGroup gap='loose'>
                          {primaryButton ? (
                            <Button variant='primary' {...primaryButton.props}>
                              {primaryButton.content}
                            </Button>
                          ) : null}
                          {secondaryButton ? (
                            <Button variant='tertiary' {...secondaryButton.props}>
                              {secondaryButton.content}
                            </Button>
                          ) : null}
                        </ButtonGroup>
                      ) : null}

                      {/* Vidéo pour l'étape 2 */}
                      {expanded && id === 1 && video && (
                        <div style={{ marginTop: "24px" }}>
                          <video 
                            width="500" 
                            height="auto" 
                            controls
                            preload="metadata"
                            style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
                          >
                            <source src={video.url} type="video/mp4" />
                            Votre navigateur ne supporte pas la lecture vidéo.
                          </video>
                        </div>
                      )}
                    </BlockStack>
                  </Box>
                </Collapsible>
              </BlockStack>
            </div>
            {image && expanded ? (
              <div style={{ flexShrink: 0 }}>
                <Image
                  source={image.url}
                  alt={image.alt}
                  style={{ maxHeight: '7.75rem', borderRadius: '8px', border: '1px solid #e1e3e5' }}
                />
              </div>
            ) : null}
          </div>
        </InlineStack>
      </div>
    </Box>
  );
};

// Composant SetupItem spécialisé pour Ultimate Pack
const UltimatePackSetupItem = ({
  complete,
  onComplete,
  expanded,
  setExpanded,
  title,
  description,
  image,
  video,
  primaryButton,
  secondaryButton,
  id
}) => {
  const [loading, setLoading] = useState(false);

  const completeItem = async () => {
    setLoading(true);
    await onComplete(id);
    setLoading(false);
  };

  const outlineSvg = (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.5334 2.10692C11.0126 2.03643 11.5024 2 12 2C12.4976 2 12.9874 2.03643 13.4666 2.10692C14.013 2.18729 14.3908 2.6954 14.3104 3.2418C14.23 3.78821 13.7219 4.166 13.1755 4.08563C12.7924 4.02927 12.3999 4 12 4C11.6001 4 11.2076 4.02927 10.8245 4.08563C10.2781 4.166 9.76995 3.78821 9.68958 3.2418C9.6092 2.6954 9.987 2.18729 10.5334 2.10692ZM7.44122 4.17428C7.77056 4.61763 7.67814 5.24401 7.23479 5.57335C6.603 6.04267 6.04267 6.603 5.57335 7.23479C5.24401 7.67814 4.61763 7.77056 4.17428 7.44122C3.73094 7.11188 3.63852 6.4855 3.96785 6.04216C4.55386 5.25329 5.25329 4.55386 6.04216 3.96785C6.4855 3.63852 7.11188 3.73094 7.44122 4.17428ZM16.5588 4.17428C16.8881 3.73094 17.5145 3.63852 17.9578 3.96785C18.7467 4.55386 19.4461 5.25329 20.0321 6.04216C20.3615 6.4855 20.2691 7.11188 19.8257 7.44122C19.3824 7.77056 18.756 7.67814 18.4267 7.23479C17.9573 6.603 17.397 6.04267 16.7652 5.57335C16.3219 5.24401 16.2294 4.61763 16.5588 4.17428ZM3.2418 9.68958C3.78821 9.76995 4.166 10.2781 4.08563 10.8245C4.02927 11.2076 4 11.6001 4 12C4 12.3999 4.02927 12.7924 4.08563 13.1755C4.166 13.7219 3.78821 14.23 3.2418 14.3104C2.6954 14.3908 2.18729 14.013 2.10692 13.4666C2.03643 12.9874 2 12.4976 2 12C2 11.5024 2.03643 11.0126 2.10692 10.5334C2.18729 9.987 2.6954 9.6092 3.2418 9.68958ZM20.7582 9.68958C21.3046 9.6092 21.8127 9.987 21.8931 10.5334C21.9636 11.0126 22 11.5024 22 12C22 12.4976 21.9636 12.9874 21.8931 13.4666C21.8127 14.013 21.3046 14.3908 20.7582 14.3104C20.2118 14.23 19.834 13.7219 19.9144 13.1755C19.9707 12.7924 20 12.3999 20 12C20 11.6001 19.9707 11.2076 19.9144 10.8245C19.834 10.2781 20.2118 9.76995 20.7582 9.68958ZM4.17428 16.5588C4.61763 16.2294 5.24401 16.3219 5.57335 16.7652C6.04267 17.397 6.603 17.9573 7.23479 18.4267C7.67814 18.756 7.77056 19.3824 7.44122 19.8257C7.11188 20.2691 6.4855 20.3615 6.04216 20.0321C5.25329 19.4461 4.55386 18.7467 3.96785 17.9578C3.63852 17.5145 3.73094 16.8881 4.17428 16.5588ZM19.8257 16.5588C20.2691 16.8881 20.3615 17.5145 20.0321 17.9578C19.4461 18.7467 18.7467 19.4461 17.9578 20.0321C17.5145 20.3615 16.8881 20.2691 16.5588 19.8257C16.2294 19.3824 16.3219 18.756 16.7652 18.4267C17.397 17.9573 17.9573 17.397 18.4267 16.7652C18.756 16.3219 19.3824 16.2294 19.8257 16.5588ZM9.68958 20.7582C9.76995 20.2118 10.2781 19.834 10.8245 19.9144C11.2076 19.9707 11.6001 20 12 20C12.3999 20 12.7924 19.9707 13.1755 19.9144C13.7219 19.834 14.23 20.2118 14.3104 20.7582C14.3908 21.3046 14.013 21.8127 13.4666 21.8931C12.9874 21.9636 12.4976 22 12 22C11.5024 22 11.0126 21.9636 10.5334 21.8931C9.987 21.8127 9.6092 21.3046 9.68958 20.7582Z'
        fill='#8A8A8A'
      ></path>
      <circle cx='12' cy='12' r='12' fill='#DBDDDF' style={{ display: 'none' }}></circle>
      <circle
        cx='12'
        cy='12'
        r='9'
        fill='#F6F6F7'
        stroke='#999EA4'
        strokeWidth='2'
        style={{ display: 'none' }}
      ></circle>
    </svg>
  );

  return (
    <Box borderRadius='200' background={expanded && 'bg-surface-active'}>
      <div style={{ padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
        <InlineStack gap='200' align='start' blockAlign='start' wrap={false}>
          <Tooltip content={complete ? 'Marquer comme non terminé' : 'Marquer comme terminé'} activatorWrapper='div'>
            <Button onClick={completeItem} variant='monochromePlain'>
              <div style={{
                width: '1.5rem',
                height: '1.5rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: '#303030'
              }}>
                {loading ? (
                  <Spinner size='small' />
                ) : complete ? (
                  <CheckIcon
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      borderRadius: '100%',
                      background: '#303030',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      fill: 'white'
                    }}
                  />
                ) : (
                  outlineSvg
                )}
              </div>
            </Button>
          </Tooltip>
          <div
            style={{
              cursor: expanded ? 'default' : 'pointer',
              paddingTop: '.15rem',
              width: '100%',
              display: 'flex',
              gap: '8rem',
              justifyContent: 'space-between'
            }}
          >
            <div 
              onClick={expanded ? () => null : setExpanded}
              style={{ width: '100%' }}
            >
              <BlockStack gap='300' id={id}>
                <Text as='h4' variant={expanded ? 'headingSm' : 'bodyMd'}>
                  {title}
                </Text>
                <Collapsible open={expanded} id={id}>
                  <Box paddingBlockEnd='150' paddingInlineEnd='150'>
                    <BlockStack gap='400'>
                      <Text as='p' variant='bodyMd'>
                        {description}
                      </Text>
                      
                      {/* Liste d'étapes si présente */}
                      {expanded && (
                        <List type="number">
                          {id === 0 && (
                            <>
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
                            </>
                          )}
                          {id === 1 && (
                            <>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Sélectionnez vos produits :</strong> Choisissez les produits que vous souhaitez proposer en pack
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Définissez vos différents paliers :</strong> Configurez les différents paliers pour vos remises (ex: minimum 3 produits, -5% à partir de 6 produits, -10% à partir de 8 produits)
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Créez vos offres :</strong> Définissez des remises attractives directement sur Shopify dans "réductions" pour encourager l'achat en pack
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text variant="bodyMd">
                                  <strong>Personnalisez l'affichage :</strong> Configurez les titres, badges et messages pour vos packs
                                </Text>
                              </List.Item>
                            </>
                          )}
                        </List>
                      )}
                      
                      {primaryButton || secondaryButton ? (
                        <ButtonGroup gap='loose'>
                          {primaryButton ? (
                            <Button variant='primary' {...primaryButton.props}>
                              {primaryButton.content}
                            </Button>
                          ) : null}
                          {secondaryButton ? (
                            <Button variant='tertiary' {...secondaryButton.props}>
                              {secondaryButton.content}
                            </Button>
                          ) : null}
                        </ButtonGroup>
                      ) : null}

                      {/* Vidéo pour l'étape 2 */}
                      {expanded && id === 1 && video && (
                        <div style={{ marginTop: "24px" }}>
                          <video 
                            width="500" 
                            height="auto" 
                            controls
                            preload="metadata"
                            style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
                          >
                            <source src={video.url} type="video/mp4" />
                            Votre navigateur ne supporte pas la lecture vidéo.
                          </video>
                        </div>
                      )}
                    </BlockStack>
                  </Box>
                </Collapsible>
              </BlockStack>
            </div>
            {image && expanded ? (
              <div style={{ flexShrink: 0 }}>
                <Image
                  source={image.url}
                  alt={image.alt}
                  style={{ maxHeight: '7.75rem', borderRadius: '8px', border: '1px solid #e1e3e5' }}
                />
              </div>
            ) : null}
          </div>
        </InlineStack>
      </div>
    </Box>
  );
};

export default function OffersSettings() {
  const loaderData = useLoaderData();
  const { offersSettings, error } = loaderData;
  const actionData = useActionData();
  
  // État pour le guide de setup BoostCart
  const [showBoostCartGuide, setShowBoostCartGuide] = useState(true);
  const [boostCartItems, setBoostCartItems] = useState([
    {
      id: 0,
      title: "Activez l'extension dans votre thème Shopify",
      description: "Activez BoostCart dans votre thème pour commencer à afficher les offres de panier.",
      image: {
        url: "/images/etape-1-BoostCart.jpg",
        alt: "Guide d'activation BoostCart"
      },
      complete: false,
      primaryButton: {
        content: "Personnaliser le thème",
        props: {
          url: "shopify:admin/themes/current/editor?context=apps",
          external: true
        }
      }
    },
    {
      id: 1,
      title: "Configurez vos offres paniers pour la Progress Bar",
      description: "Définissez les offres qui apparaîtront dans votre panier pour inciter vos clients à acheter plus.",
      complete: false,
      primaryButton: {
        content: "Configurer les offres",
        props: {
          url: "/app/offers-settings",
          external: false
        }
      }
    },
    {
      id: 2,
      title: "Personnalisez l'affichage",
      description: "Découvrez comment personnaliser l'affichage et sélectionner vos produits complémentaires.",
      image: {
        url: "/images/etape-3-BoostCart.jpg",
        alt: "Guide de personnalisation BoostCart"
      },
      complete: false,
      primaryButton: {
        content: "Personnaliser l'affichage",
        props: {
          url: "shopify:admin/themes/current/editor?context=apps",
          external: true
        }
      }
    }
  ]);

  // État pour le guide de setup Bundle Cards
  const [showBundleCardsGuide, setShowBundleCardsGuide] = useState(true);
  const [bundleCardsItems, setBundleCardsItems] = useState([
    {
      id: 0,
      title: "Créez vos produits avec variantes",
      description: "Créez des produits avec différentes variantes pour vos packs (Pack de 1, Pack de 3, Pack de 5, etc.)",
      complete: false,
      primaryButton: {
        content: "Gérer les produits",
        props: {
          url: "shopify:admin/products",
          external: true
        }
      }
    },
    {
      id: 1,
      title: "Intégrez Bundle Card dans votre thème",
      description: "Ajoutez l'extension Bundle Card à votre page produit pour afficher vos variantes sous forme de cartes attractives.",
      complete: false,
      video: {
        url: "/videos/bundle-card-integration.mp4"
      },
      primaryButton: {
        content: "Personnaliser le thème",
        props: {
          url: "shopify:admin/themes/current/editor?context=apps",
          external: true
        }
      }
    },
    {
      id: 2,
      title: "Configurez l'affichage des Bundle Cards",
      description: "Personnalisez l'apparence et les messages de vos Bundle Cards pour maximiser les conversions.",
      complete: false,
      primaryButton: {
        content: "Configurer Bundle Card",
        props: {
          url: "shopify:admin/themes/current/editor?context=apps",
          external: true
        }
      }
    }
  ]);
  
  // Fonction pour marquer une étape BoostCart comme complétée
  const onBoostCartStepComplete = async (id) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setBoostCartItems(prev => 
      prev.map(item => 
        item.id === id 
          ? { ...item, complete: !item.complete }
          : item
      )
    );
  };

  // Fonction pour marquer une étape Bundle Cards comme complétée
  const onBundleCardsStepComplete = async (id) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setBundleCardsItems(prev => 
      prev.map(item => 
        item.id === id 
          ? { ...item, complete: !item.complete }
          : item
      )
    );
  };

// Composant SetupGuide adapté pour Pack Builder
const PackBuilderSetupGuide = ({ onDismiss, onStepComplete, items }) => {
  const [expanded, setExpanded] = useState(items.findIndex((item) => !item.complete));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [popoverActive, setPopoverActive] = useState(false);
  const accessId = useId();
  const completedItemsLength = items.filter((item) => item.complete).length;

  return (
    <Card padding='0'>
      <Box padding='400' paddingBlockEnd='400'>
        <BlockStack>
          <InlineStack align='space-between' blockAlign='center'>
            <Text as='h3' variant='headingMd'>
              Guide de configuration Pack Builder
            </Text>
            <ButtonGroup gap='tight' noWrap>
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive((prev) => !prev)}
                activator={
                  <Button
                    onClick={() => setPopoverActive((prev) => !prev)}
                    variant='tertiary'
                    icon={MenuHorizontalIcon}
                  />
                }
              >
                <ActionList
                  actionRole='menuitem'
                  items={[
                    {
                      content: 'Masquer le guide',
                      onAction: onDismiss,
                      prefix: (
                        <div
                          style={{
                            height: '1rem',
                            width: '1rem',
                            paddingTop: '.05rem'
                          }}
                        >
                          <Icon tone='subdued' source={XIcon} />
                        </div>
                      )
                    }
                  ]}
                />
              </Popover>

              <Button
                variant='tertiary'
                icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => {
                  setIsGuideOpen((prev) => {
                    if (!prev) setExpanded(items.findIndex((item) => !item.complete));
                    return !prev;
                  });
                }}
                ariaControls={accessId}
              />
            </ButtonGroup>
          </InlineStack>
          <Text as='p' variant='bodyMd'>
            Suivez ces étapes pour configurer et activer Pack Builder.
          </Text>
          <div style={{ marginTop: '.8rem' }}>
            <InlineStack blockAlign='center' gap='200'>
              {completedItemsLength === items.length ? (
                <div style={{ maxHeight: '1rem' }}>
                  <InlineStack wrap={false} gap='100'>
                    <Icon
                      source={CheckIcon}
                      tone='subdued'
                      accessibilityLabel='Check icon to indicate completion of Setup Guide'
                    />
                    <Text as='p' variant='bodySm' tone='subdued'>
                      Configuration terminée
                    </Text>
                  </InlineStack>
                </div>
              ) : (
                <Text as='span' variant='bodySm'>
                  {`${completedItemsLength} / ${items.length} étapes complétées`}
                </Text>
              )}

              {completedItemsLength !== items.length ? (
                <div style={{ width: '100px' }}>
                  <ProgressBar
                    progress={(items.filter((item) => item.complete).length / items.length) * 100}
                    size='small'
                    tone='primary'
                    animated
                  />
                </div>
              ) : null}
            </InlineStack>
          </div>
        </BlockStack>
      </Box>
      <Collapsible open={isGuideOpen} id={accessId}>
        <Box padding='200'>
          <BlockStack gap='100'>
            {items.map((item) => {
              return (
                <PackBuilderSetupItem
                  key={item.id}
                  expanded={expanded === item.id}
                  setExpanded={() => setExpanded(item.id)}
                  onComplete={onStepComplete}
                  {...item}
                />
              );
            })}
          </BlockStack>
        </Box>
      </Collapsible>
      {completedItemsLength === items.length ? (
        <Box
          background='bg-surface-secondary'
          borderBlockStartWidth='025'
          borderColor='border-secondary'
          padding='300'
        >
          <InlineStack align='end'>
            <Button onClick={onDismiss}>Masquer le guide</Button>
          </InlineStack>
        </Box>
      ) : null}
    </Card>
  );
};

// Composant SetupItem spécialisé pour Pack Builder
const PackBuilderSetupItem = ({
  complete,
  onComplete,
  expanded,
  setExpanded,
  title,
  description,
  image,
  video,
  primaryButton,
  secondaryButton,
  id
}) => {
  const [loading, setLoading] = useState(false);

  const completeItem = async () => {
    setLoading(true);
    await onComplete(id);
    setLoading(false);
  };

  const outlineSvg = (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.5334 2.10692C11.0126 2.03643 11.5024 2 12 2C12.4976 2 12.9874 2.03643 13.4666 2.10692C14.013 2.18729 14.3908 2.6954 14.3104 3.2418C14.23 3.78821 13.7219 4.166 13.1755 4.08563C12.7924 4.02927 12.3999 4 12 4C11.6001 4 11.2076 4.02927 10.8245 4.08563C10.2781 4.166 9.76995 3.78821 9.68958 3.2418C9.6092 2.6954 9.987 2.18729 10.5334 2.10692ZM7.44122 4.17428C7.77056 4.61763 7.67814 5.24401 7.23479 5.57335C6.603 6.04267 6.04267 6.603 5.57335 7.23479C5.24401 7.67814 4.61763 7.77056 4.17428 7.44122C3.73094 7.11188 3.63852 6.4855 3.96785 6.04216C4.55386 5.25329 5.25329 4.55386 6.04216 3.96785C6.4855 3.63852 7.11188 3.73094 7.44122 4.17428ZM16.5588 4.17428C16.8881 3.73094 17.5145 3.63852 17.9578 3.96785C18.7467 4.55386 19.4461 5.25329 20.0321 6.04216C20.3615 6.4855 20.2691 7.11188 19.8257 7.44122C19.3824 7.77056 18.756 7.67814 18.4267 7.23479C17.9573 6.603 17.397 6.04267 16.7652 5.57335C16.3219 5.24401 16.2294 4.61763 16.5588 4.17428ZM3.2418 9.68958C3.78821 9.76995 4.166 10.2781 4.08563 10.8245C4.02927 11.2076 4 11.6001 4 12C4 12.3999 4.02927 12.7924 4.08563 13.1755C4.166 13.7219 3.78821 14.23 3.2418 14.3104C2.6954 14.3908 2.18729 14.013 2.10692 13.4666C2.03643 12.9874 2 12.4976 2 12C2 11.5024 2.03643 11.0126 2.10692 10.5334C2.18729 9.987 2.6954 9.6092 3.2418 9.68958ZM20.7582 9.68958C21.3046 9.6092 21.8127 9.987 21.8931 10.5334C21.9636 11.0126 22 11.5024 22 12C22 12.4976 21.9636 12.9874 21.8931 13.4666C21.8127 14.013 21.3046 14.3908 20.7582 14.3104C20.2118 14.23 19.834 13.7219 19.9144 13.1755C19.9707 12.7924 20 12.3999 20 12C20 11.6001 19.9707 11.2076 19.9144 10.8245C19.834 10.2781 20.2118 9.76995 20.7582 9.68958ZM4.17428 16.5588C4.61763 16.2294 5.24401 16.3219 5.57335 16.7652C6.04267 17.397 6.603 17.9573 7.23479 18.4267C7.67814 18.756 7.77056 19.3824 7.44122 19.8257C7.11188 20.2691 6.4855 20.3615 6.04216 20.0321C5.25329 19.4461 4.55386 18.7467 3.96785 17.9578C3.63852 17.5145 3.73094 16.8881 4.17428 16.5588ZM19.8257 16.5588C20.2691 16.8881 20.3615 17.5145 20.0321 17.9578C19.4461 18.7467 18.7467 19.4461 17.9578 20.0321C17.5145 20.3615 16.8881 20.2691 16.5588 19.8257C16.2294 19.3824 16.3219 18.756 16.7652 18.4267C17.397 17.9573 17.9573 17.397 18.4267 16.7652C18.756 16.3219 19.3824 16.2294 19.8257 16.5588ZM9.68958 20.7582C9.76995 20.2118 10.2781 19.834 10.8245 19.9144C11.2076 19.9707 11.6001 20 12 20C12.3999 20 12.7924 19.9707 13.1755 19.9144C13.7219 19.834 14.23 20.2118 14.3104 20.7582C14.3908 21.3046 14.013 21.8127 13.4666 21.8931C12.9874 21.9636 12.4976 22 12 22C11.5024 22 11.0126 21.9636 10.5334 21.8931C9.987 21.8127 9.6092 21.3046 9.68958 20.7582Z'
        fill='#8A8A8A'
      ></path>
      <circle cx='12' cy='12' r='12' fill='#DBDDDF' style={{ display: 'none' }}></circle>
      <circle
        cx='12'
        cy='12'
        r='9'
        fill='#F6F6F7'
        stroke='#999EA4'
        strokeWidth='2'
        style={{ display: 'none' }}
      ></circle>
    </svg>
  );

  return (
    <Box borderRadius='200' background={expanded && 'bg-surface-active'}>
      <div style={{ padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
        <InlineStack gap='200' align='start' blockAlign='start' wrap={false}>
          <Tooltip content={complete ? 'Marquer comme non terminé' : 'Marquer comme terminé'} activatorWrapper='div'>
            <Button onClick={completeItem} variant='monochromePlain'>
              <div style={{
                width: '1.5rem',
                height: '1.5rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: '#303030'
              }}>
                {loading ? (
                  <Spinner size='small' />
                ) : complete ? (
                  <CheckIcon
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      borderRadius: '100%',
                      background: '#303030',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      fill: 'white'
                    }}
                  />
                ) : (
                  outlineSvg
                )}
              </div>
            </Button>
          </Tooltip>
          <div
            style={{
              cursor: expanded ? 'default' : 'pointer',
              paddingTop: '.15rem',
              width: '100%',
              display: 'flex',
              gap: '8rem',
              justifyContent: 'space-between'
            }}
          >
            <div 
              onClick={expanded ? () => null : setExpanded}
              style={{ width: '100%' }}
            >
              <BlockStack gap='300' id={id}>
                <Text as='h4' variant={expanded ? 'headingSm' : 'bodyMd'}>
                  {title}
                </Text>
                <Collapsible open={expanded} id={id}>
                  <Box paddingBlockEnd='150' paddingInlineEnd='150'>
                    <BlockStack gap='400'>
                      <Text as='p' variant='bodyMd'>
                        {description}
                      </Text>
                      
                      {/* Liste d'étapes si présente */}
                      {expanded && (
                        <List type="number">
                          {id === 0 && (
                            <>
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
                            </>
                          )}
                          {id === 1 && (
                            <>
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
                            </>
                          )}
                        </List>
                      )}
                      
                      {primaryButton || secondaryButton ? (
                        <ButtonGroup gap='loose'>
                          {primaryButton ? (
                            <Button variant='primary' {...primaryButton.props}>
                              {primaryButton.content}
                            </Button>
                          ) : null}
                          {secondaryButton ? (
                            <Button variant='tertiary' {...secondaryButton.props}>
                              {secondaryButton.content}
                            </Button>
                          ) : null}
                        </ButtonGroup>
                      ) : null}

                      {/* Vidéo pour les étapes */}
                      {expanded && video && (
                        <div style={{ marginTop: "24px" }}>
                          <video 
                            width="500" 
                            height="auto" 
                            controls
                            preload="metadata"
                            style={{ borderRadius: "8px", border: "1px solid #e1e3e5" }}
                          >
                            <source src={video.url} type="video/mp4" />
                            Votre navigateur ne supporte pas la lecture vidéo.
                          </video>
                        </div>
                      )}
                    </BlockStack>
                  </Box>
                </Collapsible>
              </BlockStack>
            </div>
            {image && expanded ? (
              <div style={{ flexShrink: 0 }}>
                <Image
                  source={image.url}
                  alt={image.alt}
                  style={{ maxHeight: '7.75rem', borderRadius: '8px', border: '1px solid #e1e3e5' }}
                />
              </div>
            ) : null}
          </div>
        </InlineStack>
      </div>
    </Box>
  );
};

  // État pour le guide de setup Pack Builder
  const [showPackBuilderGuide, setShowPackBuilderGuide] = useState(true);
  const [packBuilderItems, setPackBuilderItems] = useState([
    {
      id: 0,
      title: "Créez un produit pack avec une variante par produit qui compose le pack",
      description: "Configurez votre produit principal pour le constructeur de packs.",
      video: {
        url: "/videos/tuto5.mp4"
      },
      complete: false,
      primaryButton: {
        content: "Créer un produit",
        props: {
          url: "shopify:admin/products/new",
          external: true
        }
      }
    },
    {
      id: 1,
      title: "Activez Pack Builder sur votre boutique",
      description: "Intégrez le constructeur de packs dans votre thème Shopify.",
      video: {
        url: "/videos/tuto3.mp4"
      },
      complete: false,
      primaryButton: {
        content: "Ouvrir l'éditeur de thème",
        props: {
          url: "shopify:admin/themes/current/editor",
          external: true
        }
      }
    }
  ]);

  // Fonction pour marquer une étape Pack Builder comme complétée
  const onPackBuilderStepComplete = async (id) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setPackBuilderItems(prev => 
      prev.map(item => 
        item.id === id 
          ? { ...item, complete: !item.complete }
          : item
      )
    );
  };

  // État pour le guide de setup Ultimate Pack
  const [showUltimatePackGuide, setShowUltimatePackGuide] = useState(true);
  const [ultimatePackItems, setUltimatePackItems] = useState([
    {
      id: 0,
      title: "Ajoutez l'extension sur votre thème Shopify",
      description: "Découvrez comment ajouter Ultimate Pack dans votre thème Shopify.",
      complete: false,
      primaryButton: {
        content: "Personnaliser le thème",
        props: {
          url: "shopify:admin/themes/current/editor",
          external: true
        }
      }
    },
    {
      id: 1,
      title: "Configurez vos produits et offres pack",
      description: "Choisissez les produits que vous allez proposer en pack et configurez vos offres.",
      video: {
        url: "/videos/tuto2.mp4"
      },
      complete: false
    }
  ]);

  // Fonction pour marquer une étape Ultimate Pack comme complétée
  const onUltimatePackStepComplete = async (id) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setUltimatePackItems(prev => 
      prev.map(item => 
        item.id === id 
          ? { ...item, complete: !item.complete }
          : item
      )
    );
  };
  
  return (
    <div style={{ paddingBottom: '4rem' }}>
      <Page
        title="Guide de configuration EcomKit"
        subtitle="Suivez ces étapes pour configurer et activer vos 4 extensions"
      >

        
        {/* Message de statut */}
        {error && (
          <Box paddingBlockEnd="4">
            <Banner status="critical">
              {error}
            </Banner>
          </Box>
        )}
        
        <Layout>
          {/* Guide de setup BoostCart */}
          {showBoostCartGuide && (
            <Layout.Section>
              <BoostCartSetupGuide
                onDismiss={() => setShowBoostCartGuide(false)}
                onStepComplete={onBoostCartStepComplete}
                items={boostCartItems}
              />
            </Layout.Section>
          )}

          {/* Guide de setup Bundle Cards */}
          {showBundleCardsGuide && (
            <Layout.Section>
              <BundleCardsSetupGuide
                onDismiss={() => setShowBundleCardsGuide(false)}
                onStepComplete={onBundleCardsStepComplete}
                items={bundleCardsItems}
              />
            </Layout.Section>
          )}

          {/* Guide de setup Ultimate Pack */}
          {showUltimatePackGuide && (
            <Layout.Section>
              <UltimatePackSetupGuide
                onDismiss={() => setShowUltimatePackGuide(false)}
                onStepComplete={onUltimatePackStepComplete}
                items={ultimatePackItems}
              />
            </Layout.Section>
          )}

          {/* Guide de setup Pack Builder */}
          {showPackBuilderGuide && (
            <Layout.Section>
              <PackBuilderSetupGuide
                onDismiss={() => setShowPackBuilderGuide(false)}
                onStepComplete={onPackBuilderStepComplete}
                items={packBuilderItems}
              />
            </Layout.Section>
          )}
          
          {/* Espacement entre les sections */}
          <Layout.Section>
            <Box paddingBlockStart="4" />
          </Layout.Section>
        </Layout>
        
        {/* Marge en bas de page */}
        <Box paddingBlockEnd="8" />
      </Page>
    </div>
  );
}