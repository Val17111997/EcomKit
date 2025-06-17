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
              <Link url="mailto:support@tonapp.com" external>
                support@tonapp.com
              </Link>
            </Text>
            <Text variant="bodyMd" as="p">
              💬 Chat : disponible dans l’application ou sur notre site
            </Text>
            <Text variant="bodyMd" as="p">
              📚 <Link url="https://tonapp.com/docs" external>Documentation en ligne</Link>
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
