import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

export default function WelcomePage() {
  const navigate = useNavigate();
  return (
    <Layout height="fill" contentWidth="64rem"
      header={<LayoutHeader hasDivider><Heading level={1}>Welcome to Icekube</Heading></LayoutHeader>}
      content={<LayoutContent padding={6}>
        <VStack gap={5} maxWidth="42rem">
          <Heading level={2}>Your Kubernetes workspace</Heading>
          <Text as="p">Browse clusters in Catalog and pin the pages you use to the app rail.</Text>
          <Text as="p" color="secondary">This is the app shell. Cluster discovery, kubeconfig import, and Kubernetes connections are not connected yet.</Text>
          <Button label="Open Catalog" variant="primary" onClick={() => void navigate({ to: "/catalog" })} />
        </VStack>
      </LayoutContent>} />
  );
}
