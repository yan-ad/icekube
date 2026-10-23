import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError, type ClusterSummary } from "../catalog/api";
import { RecordIcon } from "../catalog/RecordIcon";
import { connectionMessage } from "./api";
import { ClusterResources } from "./ClusterResources";
import { clusterSections } from "./navigation";
import { useClusterSession } from "./useClusterSession";

function ClusterSession({ cluster, section, onReopen }: { cluster: ClusterSummary; section: string; onReopen: () => void }) {
  const session = useClusterSession(cluster.id);
  const selected = clusterSections.find((item) => item.id === section);
  const connection = session.snapshot;
  const connected = connection?.status === "connected";
  const resourceKind = section === "nodes" || section === "namespaces" ? section : null;
  return <>
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <RecordIcon kind="Clusters" color={cluster.color} />
        <Heading level={1} style={{ minWidth: 0, overflowWrap: "anywhere" }}>{cluster.name}</Heading>
      </HStack>
      <Text color="secondary">Context: {cluster.contextName}</Text>
    </VStack>
    <Divider />
    <VStack gap={3}>
      <Heading level={2}>{selected?.label ?? "Section unavailable"}</Heading>
      <Text role="status">{session.phase === "opening" ? "Opening workspace…" : session.phase === "releasing" ? "Disconnecting…"
        : session.phase === "connecting" ? "Connecting…" : connected ? "Connected" : connection?.status === "error" ? "Connection error" : "Disconnected"}</Text>
      {!connected && <Text as="p">This workspace is not connected. Opening it does not contact the cluster. Choose Connect to cluster to connect using the saved context.</Text>}
      {session.error && <Text role="alert">{connectionMessage(session.error)}</Text>}
      <HStack gap={2} wrap="wrap">
        {session.phase === "failed" && <Button label="Reopen workspace" variant="ghost" onClick={onReopen} />}
        {!connected && <Button label={session.phase === "connecting" ? "Connecting…" : "Connect to cluster"}
          isDisabled={session.phase !== "ready" || connection?.status === "connecting"} onClick={() => void session.connect()} />}
        {session.canRelease && <Button label={session.phase === "connecting" ? "Cancel connection" : "Disconnect"} variant="ghost"
          isDisabled={session.phase === "releasing"} onClick={() => void session.disconnect()} />}
      </HStack>
      {!selected && <Text role="alert">This workspace section does not exist. Choose a section from Cluster navigation.</Text>}
    </VStack>
    {section === "overview" && <VStack gap={4}>
      {connected && <VStack gap={2}>
        <Text>Connected context: {connection.contextName}</Text>
        <Text>API version: {connection.apiVersion}</Text>
        <Text>Choose Nodes or Namespaces in Cluster navigation to inspect live resources.</Text>
      </VStack>}
      <Heading level={3}>Saved metadata</Heading>
      <VStack gap={3}>
        <VStack gap={1}><Text weight="semibold">Context</Text><Text>{cluster.contextName}</Text></VStack>
        <VStack gap={1}><Text weight="semibold">Source</Text><Text>{cluster.source}</Text></VStack>
        <VStack gap={1}><Text weight="semibold">Labels</Text>
          {cluster.labels.length ? cluster.labels.map((label) => <Text key={label}>{label}</Text>) : <Text color="secondary">No labels saved.</Text>}
        </VStack>
      </VStack>
    </VStack>}
    {connected && resourceKind && <ClusterResources key={`${cluster.id}:${connection.sessionId}:${resourceKind}`} clusterId={cluster.id} sessionId={connection.sessionId} kind={resourceKind} />}
    {!connected && resourceKind && <Text>Connect to load live {resourceKind}. No resource request is sent before you connect.</Text>}
    {selected && section !== "overview" && !resourceKind && <Text as="p">Live {selected.label.toLowerCase()} data is not implemented yet.</Text>}
  </>;
}

export function ClusterWorkspacePage() {
  const { clusterId } = useParams({ strict: false }) as { clusterId?: string };
  const { section = "overview" } = useSearch({ strict: false }) as { section?: string };
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run } = useCatalog();
  const [attempt, setAttempt] = useState(0);
  const cluster = snapshot?.clusters.find((item) => item.id === clusterId);
  const missingTitle = !available ? "Desktop engine required" : loading ? "Loading cluster…"
    : !snapshot ? "Cluster metadata unavailable" : "Cluster not found";
  return <Layout height="fill" content={<LayoutContent padding={6}>
    <VStack gap={5} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <HStack gap={2} wrap="wrap">
        <Button label="Back to Catalog" variant="ghost" onClick={() => void navigate({ to: "/catalog", search: {} })} />
        {available && <Button label={busy ? "Refreshing metadata…" : "Refresh saved metadata"} variant="ghost" isDisabled={busy || loading} onClick={() => void run("catalog_list")} />}
      </HStack>
      {error && available && <Text role="alert">{error}{snapshot ? " Previously loaded metadata is still shown." : ""}</Text>}
      {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved metadata is kept.</Text>}
      {cluster && available ? <>
        <ClusterSession key={`${cluster.id}:${attempt}`} cluster={cluster} section={section} onReopen={() => setAttempt((value) => value + 1)} />
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
  </LayoutContent>} />;
}
export default ClusterWorkspacePage;
