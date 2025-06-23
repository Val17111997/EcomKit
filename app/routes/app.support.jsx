import { Page, Layout, Card, Text, Link } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function SupportPage() {
  return (
    <Page>
      <TitleBar title="Support client" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Text variant="bodyMd" as="p">
              Besoin d’aide ? Voici comment nous contacter :
            </Text>
            <Text variant="bodyMd" as="p">
              📧 Email :{" "}
              <Link url="mailto:valentin@checks-studio.com" external>
                valentin@checks-studio.com
              </Link>
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
