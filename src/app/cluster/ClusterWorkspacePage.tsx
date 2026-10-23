import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError } from "../catalog/api";
import { RecordIcon } from "../catalog/RecordIcon";
import { clusterSections } from "./navigation";

export function ClusterWorkspacePage() {
  const { clusterId } = useParams({ strict: false }) as { clusterId?: string };
  const { section = "overview" } = useSearch({ strict: false }) as { section?: string };
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run } = useCatalog();
  const cluster = snapshot?.clusters.find((item) => item.id === clusterId);
  const selectedSection = clusterSections.find((item) => item.id === section);
  const missingTitle = !available ? "Desktop engine required"
    : loading ? "Loading cluster…"
      : !snapshot ? "Cluster metadata unavailable" : "Cluster not found";

  return (
    <Layout height="fill" content={
      <LayoutContent padding={6}>
        <VStack gap={5} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <HStack gap={2} wrap="wrap">
            <Button label="Back to Catalog" variant="ghost"
              onClick={() => void navigate({ to: "/catalog", search: {} })} />
            {available && <Button label={busy ? "Refreshing metadata…" : "Refresh saved metadata"}
              variant="ghost" isDisabled={busy || loading} onClick={() => void run("catalog_list")} />}
          </HStack>
          {error && available && <Text role="alert">{error}{snapshot ? " Previously loaded metadata is still shown." : ""}</Text>}
          {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved metadata is kept.</Text>}
          {cluster ? <>
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <RecordIcon kind="Clusters" color={cluster.color} />
                <Heading level={1} style={{ minWidth: 0, overflowWrap: "anywhere" }}>{cluster.name}</Heading>
              </HStack>
              <Text color="secondary">Context: {cluster.contextName}</Text>
            </VStack>
            <Divider />
            <VStack gap={3}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Heading level={2}>{selectedSection?.label ?? "Section unavailable"}</Heading>
                <Badge variant="neutral" label="Disconnected" />
              </HStack>
              <Text as="p">
                This workspace is not connected. Cluster connection and live resource support is not implemented yet. Opening a section does not contact the cluster or execute authentication plugins.
              </Text>
              {!selectedSection && <Text role="alert">This workspace section does not exist. Choose a section from Cluster navigation.</Text>}
            </VStack>
            {selectedSection?.id === "overview" && <VStack gap={4}>
              <Heading level={3}>Saved metadata</Heading>
              <VStack gap={3}>
                <VStack gap={1}><Text weight="semibold">Context</Text><Text>{cluster.contextName}</Text></VStack>
                <VStack gap={1}><Text weight="semibold">Source</Text><Text>{cluster.source}</Text></VStack>
                <VStack gap={1}>
                  <Text weight="semibold">Labels</Text>
                  <VStack gap={1}>
                    {cluster.labels.length ? cluster.labels.map((label) => <Text key={label}>{label}</Text>) : <Text color="secondary">No labels saved.</Text>}
                  </VStack>
                </VStack>
              </VStack>
            </VStack>}
          </> : <VStack gap={3}>
            <Heading level={1}>{missingTitle}</Heading>
            <Text as="p" role={loading && available ? "status" : undefined}>
              {!available ? "Open the desktop app to view saved cluster metadata. Browser preview cannot read the local catalog."
                : loading ? "Loading saved cluster metadata from the catalog."
                  : !snapshot ? "The saved catalog could not be loaded. Refresh saved metadata to retry."
                    : "No saved cluster matches this address. It may have been removed or its imported context may have changed. Return to Catalog to choose a cluster."}
            </Text>
          </VStack>}
        </VStack>
      </LayoutContent>
    } />
  );
}

export default ClusterWorkspacePage;
