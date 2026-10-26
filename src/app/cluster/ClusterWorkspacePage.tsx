import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Table } from "@astryxdesign/core/Table";
import { Link } from "@astryxdesign/core/Link";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError, type ClusterSummary } from "../catalog/api";
import { connectionMessage } from "./api";
import { ClusterResources } from "./ClusterResources";
import { clusterDestinations, clusterSections } from "./navigation";
import { resourceView } from "./resourceViews";
import { ResourceTablePage } from "./ResourceTablePage";
import { PodDock, PodDockProvider } from "./PodDock";
import { HelmTablePage } from "./HelmTablePage";
import { PortForwardTablePage } from "./PortForwardTablePage";
import { NamespaceScopeProvider } from "./NamespaceScope";
import { ResourceInspectorLayout, ResourceInspectorProvider } from "./ResourceInspector";
import { useClusterSession } from "./useClusterSession";
import { useRegisterClusterActions, useRegisterWorkspaceRefresh, useWorkspaceRefresh } from "./WorkspaceRefresh";

function ClusterSession({ cluster, section, onReopen, dockOutlet }: { cluster: ClusterSummary; section: string; onReopen: () => void; dockOutlet: HTMLElement | null }) {
  const session = useClusterSession(cluster.id);
  const workspaceRefresh = useWorkspaceRefresh();
  const [showMetadata, setShowMetadata] = useState(false);
  const selected = clusterDestinations.find((item) => item.id === section);
  const connection = session.snapshot;
  const connected = connection?.status === "connected";
  const failure = session.error ?? connection?.error ?? (connection?.status === "error" ? "connectionFailed" : null);
  const replacement = section !== "nodes" ? resourceView(section) : undefined;
  const resourceKind = section === "nodes" ? section : replacement?.kind ?? null;
  const serviceView = !!replacement && !replacement.kind;
  const refreshSection = replacement ? section : resourceKind ?? "cluster";
  const category = clusterSections.find((item) => item.id === (section === "workloads-overview" ? "workloads" : section));
  const destinations = category && "children" in category ? category.children.filter((item) => item.id !== "workloads-overview")
    : section === "overview" ? clusterSections.filter((item) => item.id !== "overview") : [];
  const busy = ["opening", "connecting", "releasing"].includes(session.phase);
  const status = session.phase === "opening" ? "Opening…" : session.phase === "releasing" ? "Disconnecting…"
    : session.phase === "connecting" ? "Connecting…" : connected ? "Connected" : failure ? "Connection error" : "Disconnected";
  useRegisterWorkspaceRefresh({ clusterId: cluster.id, section: refreshSection, enabled: !busy, refresh: () => {
    if (session.phase === "failed") onReopen();
    else if (connected) void session.reconnect();
    else void session.connect();
  } }, !connected || (!resourceKind && !serviceView));
  useRegisterClusterActions({ clusterId: cluster.id, section: refreshSection, items: [
    ...(session.phase === "failed" ? [{ label: "Reopen workspace", run: onReopen }] : []),
    ...(!connected && !busy ? [{ label: "Connect to cluster", run: () => void session.connect() }] : []),
    ...(session.canRelease ? [{ label: session.phase === "connecting" ? "Cancel connection" : "Disconnect", enabled: session.phase !== "releasing", run: () => void session.disconnect() }] : []),
    { label: showMetadata ? "Hide saved metadata" : "Show saved metadata", run: () => setShowMetadata(value => !value) },
  ] });
  return <>
    <VisuallyHidden><Heading level={1}>{cluster.name} · {selected?.label ?? "Cluster"}</Heading></VisuallyHidden>
    {!connected && <Text role="status">{status}</Text>}
    {failure && <Text as="p" role="alert">Connection error [{failure}]: {connectionMessage(failure)}</Text>}
    {showMetadata && <VStack gap={2}>
      <Text weight="semibold">Saved metadata</Text>
      <Text>Context: {cluster.contextName}</Text>
      <Text>Source: {cluster.source}</Text>
      {cluster.labels.length ? cluster.labels.map((label) => <Text key={label}>{label}</Text>) : <Text color="secondary">No labels saved.</Text>}
    </VStack>}
    {section === "overview" && connected && <Text color="secondary">Choose a resource view from the cluster navigation.</Text>}
    {connected && <ResourceInspectorProvider key={`${cluster.id}:${connection.sessionId}`} clusterId={cluster.id}>
    <PodDockProvider clusterId={cluster.id} sessionId={connection.sessionId} outlet={dockOutlet}
      onMutation={() => { if (workspaceRefresh.action?.section === "pods") workspaceRefresh.action.refresh(); }}>
    <NamespaceScopeProvider clusterId={cluster.id} sessionId={connection.sessionId}>
    <ResourceInspectorLayout clusterId={cluster.id} sessionId={connection.sessionId}>
    {replacement && (section === "helm-charts" || section === "helm-releases" ?
      <HelmTablePage key={section} clusterId={cluster.id} sessionId={connection.sessionId} view={section === "helm-charts" ? "charts" : "releases"} /> :
      section === "port-forwarding" ? <PortForwardTablePage clusterId={cluster.id} sessionId={connection.sessionId} /> :
      <ResourceTablePage key={`${cluster.id}:${connection.sessionId}:${section}`} clusterId={cluster.id} sessionId={connection.sessionId} view={replacement} />)}
    {connected && resourceKind && !replacement && <ClusterResources key={`${cluster.id}:${connection.sessionId}:${resourceKind}`} clusterId={cluster.id} sessionId={connection.sessionId} kind={resourceKind} />}
    {destinations.length > 0 && <Table aria-label={`${selected?.label ?? "Cluster"} destinations`} data={destinations.map((item) => ({ ...item }))} idKey="id" density="compact"
      columns={[{ key: "label", header: "View", renderCell: (item) => <Link isStandalone href={`#/cluster/${encodeURIComponent(cluster.id)}?section=${item.id}`}>{item.label}</Link> }]} />}
    </ResourceInspectorLayout>
    <PodDock />
    </NamespaceScopeProvider>
    </PodDockProvider></ResourceInspectorProvider>}
    {!connected && replacement && !busy && <Text color="secondary">{selected?.label} unavailable while disconnected. Refresh to reconnect.</Text>}
    {!connected && resourceKind && !replacement && !busy && <Text color="secondary">{selected?.label} unavailable while disconnected. Refresh to reconnect.</Text>}
    {selected && section !== "overview" && !resourceKind && !replacement && !destinations.length && <Text as="p">Live {selected.label.toLowerCase()} data is not implemented yet.</Text>}
  </>;
}

export function ClusterWorkspacePage() {
  const { clusterId } = useParams({ strict: false }) as { clusterId?: string };
  const { section = "overview" } = useSearch({ strict: false }) as { section?: string };
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run } = useCatalog();
  const [attempt, setAttempt] = useState(0);
  const [dockOutlet, setDockOutlet] = useState<HTMLElement | null>(null);
  const cluster = snapshot?.clusters.find((item) => item.id === clusterId);
  const missingTitle = !available ? "Desktop engine required" : loading ? "Loading cluster…"
    : !snapshot ? "Cluster metadata unavailable" : "Cluster not found";
  return <Layout height="fill" footer={<VStack ref={setDockOutlet} gap={0} style={{ minWidth: 0 }} />} content={<LayoutContent padding={0} isScrollable={false}>
    <VStack gap={0} height="100%" style={{ minWidth: 0, minHeight: 0, overflow: "hidden", overflowWrap: "anywhere" }}>
      {error && available && <Text role="alert">{error}{snapshot ? " Previously loaded metadata is still shown." : ""}</Text>}
      {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved metadata is kept.</Text>}
      {cluster && available ? <ClusterSession key={`${cluster.id}:${attempt}`} cluster={cluster} section={section} dockOutlet={dockOutlet} onReopen={() => setAttempt((value) => value + 1)} />
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
