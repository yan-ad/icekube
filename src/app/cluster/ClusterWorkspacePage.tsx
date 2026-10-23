import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconDots, IconPlugConnected, IconPlugConnectedX, IconRefresh, IconInfoCircle, IconX } from "@tabler/icons-react";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError, type ClusterSummary } from "../catalog/api";
import { RecordIcon } from "../catalog/RecordIcon";
import { connectionMessage } from "./api";
import { ClusterResources } from "./ClusterResources";
import { clusterSections } from "./navigation";
import { useClusterSession } from "./useClusterSession";
import { useRegisterWorkspaceRefresh, useWorkspaceRefresh } from "./WorkspaceRefresh";

function ClusterSession({ cluster, section, onReopen }: { cluster: ClusterSummary; section: string; onReopen: () => void }) {
  const session = useClusterSession(cluster.id);
  const workspaceRefresh = useWorkspaceRefresh();
  const [showMetadata, setShowMetadata] = useState(false);
  const selected = clusterSections.find((item) => item.id === section);
  const connection = session.snapshot;
  const connected = connection?.status === "connected";
  const failure = session.error ?? connection?.error ?? (connection?.status === "error" ? "connectionFailed" : null);
  const resourceKind = section === "nodes" || section === "namespaces" ? section : null;
  const rowRefresh = workspaceRefresh.action?.clusterId === cluster.id && workspaceRefresh.action.section === (resourceKind ?? "cluster")
    ? workspaceRefresh.action : null;
  const busy = ["opening", "connecting", "releasing"].includes(session.phase);
  const status = session.phase === "opening" ? "Opening…" : session.phase === "releasing" ? "Disconnecting…"
    : session.phase === "connecting" ? "Connecting…" : connected ? "Connected" : failure ? "Connection error" : "Disconnected";
  useRegisterWorkspaceRefresh({ clusterId: cluster.id, section: resourceKind ?? "cluster", enabled: !busy, refresh: () => {
    if (session.phase === "failed") onReopen();
    else if (connected) void session.reconnect();
    else void session.connect();
  } }, !connected || !resourceKind);
  return <>
    <HStack gap={2} vAlign="center" style={{ minWidth: 0, borderBottom: "1px solid var(--color-border-subtle)", paddingBlock: "var(--spacing-2)" }}>
      <Breadcrumbs label="Cluster breadcrumb" variant="supporting" style={{ flex: 1, minWidth: 0 }}>
        <BreadcrumbItem href="#/catalog">Catalog</BreadcrumbItem>
        <BreadcrumbItem href={section === "overview" ? undefined : `#/cluster/${encodeURIComponent(cluster.id)}`} isCurrent={section === "overview"}
          startIcon={<RecordIcon kind="Clusters" color={cluster.color} />} style={{ minWidth: 0, maxWidth: "min(45vw, 28rem)" }}>
          <Text maxLines={1}>{cluster.name}</Text>
        </BreadcrumbItem>
        {section !== "overview" && <BreadcrumbItem isCurrent>{selected?.label ?? "Unavailable"}</BreadcrumbItem>}
      </Breadcrumbs>
      <IconButton label={`Refresh ${resourceKind ?? "cluster"}`} tooltip={`Refresh ${resourceKind ?? "cluster"} (⌘R / Ctrl+R)`}
        variant="ghost" icon={<Icon icon={IconRefresh} />} isDisabled={busy || !rowRefresh?.enabled}
        onClick={() => rowRefresh?.refresh()}
        aria-keyshortcuts="Control+r Meta+r" />
      <DropdownMenu presentation="popover" alignment="end"
        renderTrigger={(props) => <IconButton {...props} label="Cluster actions" tooltip="Cluster actions" variant="ghost" icon={<Icon icon={IconDots} />} />}
        items={[
          ...(session.phase === "failed" ? [{ label: "Reopen workspace", icon: IconRefresh, onClick: onReopen }] : []),
          ...(!connected && !busy ? [{ label: "Connect to cluster", icon: IconPlugConnected, onClick: () => void session.connect() }] : []),
          ...(session.canRelease ? [{ label: session.phase === "connecting" ? "Cancel connection" : "Disconnect", icon: session.phase === "connecting" ? IconX : IconPlugConnectedX, isDisabled: session.phase === "releasing", onClick: () => void session.disconnect() }] : []),
          { type: "divider" },
          { label: showMetadata ? "Hide saved metadata" : "Show saved metadata", icon: IconInfoCircle, onClick: () => setShowMetadata((value) => !value) },
        ]} />
    </HStack>
    <Heading level={1} className="visually-hidden">{cluster.name}</Heading>
    <HStack gap={3} vAlign="center" wrap="wrap">
      <Heading level={2}>{selected?.label ?? "Section unavailable"}</Heading>
      <Text type="supporting" role="status">{status}</Text>
      {connected && connection.apiVersion && <Text type="supporting">API version: {connection.apiVersion}</Text>}
    </HStack>
    {failure && <Text as="p" role="alert">Connection error [{failure}]: {connectionMessage(failure)}</Text>}
    {showMetadata && <VStack gap={2}>
      <Text weight="semibold">Saved metadata</Text>
      <Text>Context: {cluster.contextName}</Text>
      <Text>Source: {cluster.source}</Text>
      {cluster.labels.length ? cluster.labels.map((label) => <Text key={label}>{label}</Text>) : <Text color="secondary">No labels saved.</Text>}
    </VStack>}
    {section === "overview" && connected && <Text color="secondary">Choose Nodes or Namespaces to inspect resources.</Text>}
    {connected && resourceKind && <ClusterResources key={`${cluster.id}:${connection.sessionId}:${resourceKind}`} clusterId={cluster.id} sessionId={connection.sessionId} kind={resourceKind} />}
    {!connected && resourceKind && !busy && <Text color="secondary">{resourceKind === "nodes" ? "Nodes" : "Namespaces"} unavailable while disconnected. Refresh to reconnect.</Text>}
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
  return <Layout height="fill" content={<LayoutContent padding={4}>
    <VStack gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {error && available && <Text role="alert">{error}{snapshot ? " Previously loaded metadata is still shown." : ""}</Text>}
      {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved metadata is kept.</Text>}
      {cluster && available ? <ClusterSession key={`${cluster.id}:${attempt}`} cluster={cluster} section={section} onReopen={() => setAttempt((value) => value + 1)} />
        : <VStack gap={3}>
          <Heading level={1}>{missingTitle}</Heading>
          <Text as="p" role={loading && available ? "status" : undefined}>
            {!available ? "Open the desktop app to view saved cluster metadata. Browser preview cannot read the local catalog."
              : loading ? "Loading saved cluster metadata from the catalog."
                : !snapshot ? "The saved catalog could not be loaded. Refresh saved metadata to retry."
                  : "No saved cluster matches this address. It may have been removed or its imported context may have changed. Return to Catalog to choose a cluster."}
          </Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Back to Catalog" variant="ghost" onClick={() => void navigate({ to: "/catalog", search: {} })} />
            {available && <Button label="Refresh saved metadata" variant="ghost" isDisabled={busy || loading} onClick={() => void run("catalog_list")} />}
          </HStack>
        </VStack>}
    </VStack>
  </LayoutContent>} />;
}
export default ClusterWorkspacePage;
