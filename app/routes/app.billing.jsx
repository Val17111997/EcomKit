import { Banner, Button, Layout, Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";

export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const { appSubscriptions } = await billing.check();
  
  return json({
    subscription: appSubscriptions?.[0],
  });
};

export const action = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const { appSubscriptions } = await billing.check();
  
  await billing.cancel({
    subscriptionId: appSubscriptions?.[0]
  });
  
  return json({
    success: true,
  });
};

export default function Billing() {
  const { subscription } = useLoaderData();
  const submit = useSubmit();
  const actionData = useActionData();
  const shopify = useAppBridge();
  
  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show('Plan successfully cancelled');
    }
  }, [actionData, shopify]);
  
  console.log("subscription: ", subscription);
  
  return (
    <Page title="Billing">
      <Layout>
        <Layout.Section>
          {subscription ? (
            <Banner 
              title={`You are subscribed to the ${subscription.name} plan`}
              tone="success"
              action={{
                content: "Change Plan",
                url: "https://admin.shopify.com/charges/ecom-kit-2/pricing_plans",
                target: "_top",
              }}
              secondaryAction={{
                content: "Cancel Plan", 
                onAction: () => submit({}, {method: 'POST'})
              }}
            />
          ) : (
            <Button
              target="_top"
              url="https://admin.shopify.com/charges/ecom-kit-2/pricing_plans"
            >
              View Plans
            </Button>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}