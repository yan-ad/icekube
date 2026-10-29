import { useEffect, useState } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ContentError } from "../components/ContentError";
import { ContentLoading } from "../components/ContentLoading";
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
import { WorkloadsOverview } from "./WorkloadsOverview";
import { NamespaceScopeProvider } from "./NamespaceScope";
import { ResourceInspectorLayout, ResourceInspectorProvider } from "./ResourceInspector";
import { useClusterSession } from "./useClusterSession";
import { useRegisterClusterActions, useRegisterWorkspaceRefresh, useWorkspaceRefresh } from "./WorkspaceRefresh";
import { CustomResourcesDiscovery } from "./CustomResourcesProvider";
import { CustomResourceTable } from "./CustomResourceTable";
import { DestinationGrid } from "./DestinationGrid";
import { ClusterOverview } from "./ClusterOverview";
import { PermissionSession } from "./PermissionProvider";
import { PermissionGate } from "./PermissionGate";
import { ManagedUsersPage } from "./ManagedUsersPage";

function ClusterSession({ cluster, section, onReopen, dockOutlet }: { cluster: ClusterSummary; section: string; onReopen: () => void; dockOutlet: HTMLElement | null }) {
  const session = useClusterSession(cluster.id);
  const { definition } = useSearch({ strict: false }) as { definition?: string };
  const workspaceRefresh = useWorkspaceRefresh();
  const [showMetadata, setShowMetadata] = useState(false);
  useEffect(() => { setShowMetadata(false); }, [session.snapshot?.sessionId, session.phase === "releasing"]);
  const selected = clusterDestinations.find((item) => item.id === section);
  const connection = session.snapshot;
  const connected = connection?.status === "connected";
  const failure = session.error ?? connection?.error ?? (connection?.status === "error" ? "connectionFailed" : null);
  const replacement = section !== "nodes" ? resourceView(section) : undefined;
  const resourceKind = section === "nodes" ? section : replacement?.kind ?? null;
  const serviceView = !!replacement && !replacement.kind;
  const workloadsOverview = section === "workloads-overview";
  const clusterOverview = section === "overview";
  const customInstances = section === "custom-resource-instances";
  const users = section === "users";
  const refreshSection = workloadsOverview || clusterOverview || customInstances || users ? section : replacement ? section : resourceKind ?? "cluster";
  const category = clusterSections.find((item) => item.id === (section === "workloads-overview" ? "workloads" : section));
  const destinations = !workloadsOverview && category && "children" in category ? category.children.filter((item) => item.id !== "workloads-overview")
    : [];
  const busy = ["opening", "connecting", "releasing"].includes(session.phase);
  const status = session.phase === "opening" ? "Opening…" : session.phase === "releasing" ? "Disconnecting…"
    : session.phase === "connecting" ? "Connecting…" : connected ? "Connected" : failure ? "Connection error" : "Disconnected";
  const refreshConnection = () => {
    if (session.phase === "failed") onReopen();
    else if (connected) void session.reconnect();
    else void session.connect();
  };
  useRegisterWorkspaceRefresh({ clusterId: cluster.id, section: refreshSection, enabled: !busy, refresh: refreshConnection },
    !connected || (!resourceKind && !serviceView && !workloadsOverview && !clusterOverview && !customInstances && !users));
  useRegisterClusterActions({ clusterId: cluster.id, section: refreshSection, status, items: [
    ...(session.phase === "failed" ? [{ label: "Reopen workspace", run: onReopen }] : []),
    ...(!connected && !busy ? [{ label: "Connect to cluster", run: () => void session.connect() }] : []),
    ...(session.canRelease ? [{ label: session.phase === "connecting" ? "Cancel connection" : "Disconnect", enabled: session.phase !== "releasing", run: () => void session.disconnect() }] : []),
    { label: "Show saved metadata", run: () => setShowMetadata(true) },
  ] });
  return <>
    <VisuallyHidden><Heading level={1}>{cluster.name} · {selected?.label ?? "Cluster"}</Heading></VisuallyHidden>
    {!connected && (busy ? <ContentLoading label={status} /> : <ContentError title={failure ? "Connection error" : "Cluster disconnected"}
      message={failure ? `Connection error [${failure}]: ${connectionMessage(failure)}` : "Live resources are unavailable while disconnected. Refresh to reconnect."}
      onRetry={refreshConnection} disabled={busy} />)}
    <Dialog isOpen={showMetadata} onOpenChange={setShowMetadata} purpose="info">
      <Layout header={<DialogHeader title="Saved metadata" onOpenChange={setShowMetadata} />}
        content={<LayoutContent><MetadataList label={{ position: "top" }} style={{ overflowWrap: "anywhere" }}>
          <MetadataListItem label="Cluster">{cluster.name}</MetadataListItem>
          <MetadataListItem label="Context">{cluster.contextName}</MetadataListItem>
          <MetadataListItem label="Source">{cluster.source}</MetadataListItem>
          <MetadataListItem label="Labels">{cluster.labels.length ? cluster.labels.join(", ") : "No labels saved."}</MetadataListItem>
        </MetadataList></LayoutContent>} />
    </Dialog>
    {connected && <PermissionSession key={`${cluster.id}:${connection.sessionId}`} clusterId={cluster.id} sessionId={connection.sessionId}><ResourceInspectorProvider clusterId={cluster.id}>
    <PodDockProvider clusterId={cluster.id} sessionId={connection.sessionId} outlet={dockOutlet}
      onMutation={() => { if (workspaceRefresh.action?.section === "pods") workspaceRefresh.action.refresh(); }}>
    <NamespaceScopeProvider clusterId={cluster.id} sessionId={connection.sessionId}>
    <PermissionGate quiet check={{ kind: "customResourceDefinitions", action: "list" }}><CustomResourcesDiscovery clusterId={cluster.id} sessionId={connection.sessionId} active={section.startsWith("custom-resource")} /></PermissionGate>
    <ResourceInspectorLayout clusterId={cluster.id} sessionId={connection.sessionId}>
    {clusterOverview && <ClusterOverview clusterId={cluster.id} sessionId={connection.sessionId} />}
     {users && <ManagedUsersPage clusterId={cluster.id} sessionId={connection.sessionId} />}
    {section === "custom-resource-instances" && <PermissionGate check={{ kind: "customResourceDefinitions", action: "list" }}><CustomResourceTable clusterId={cluster.id} sessionId={connection.sessionId} definitionName={definition} /></PermissionGate>}
    {workloadsOverview && <WorkloadsOverview clusterId={cluster.id} sessionId={connection.sessionId} />}
    {replacement && (section === "helm-charts" || section === "helm-releases" ?
      <HelmTablePage key={section} clusterId={cluster.id} sessionId={connection.sessionId} view={section === "helm-charts" ? "charts" : "releases"} /> :
      section === "port-forwarding" ? <PortForwardTablePage clusterId={cluster.id} sessionId={connection.sessionId} /> :
      replacement.kind && <ResourceTablePage key={`${cluster.id}:${connection.sessionId}:${section}`} clusterId={cluster.id} sessionId={connection.sessionId} view={replacement} />)}
    {connected && resourceKind && !replacement && <PermissionGate check={{ kind: resourceKind, action: "list" }}><ClusterResources key={`${cluster.id}:${connection.sessionId}:${resourceKind}`} clusterId={cluster.id} sessionId={connection.sessionId} kind={resourceKind} /></PermissionGate>}
    {destinations.length > 0 && <DestinationGrid clusterId={cluster.id} title={selected?.label ?? "Cluster"} destinations={destinations} />}
    </ResourceInspectorLayout>
    <PodDock clusterId={cluster.id} sessionId={connection.sessionId} onResourceCreated={() => {
      const action = workspaceRefresh.action;
      if (action?.clusterId === cluster.id && action.section !== "cluster" && action.enabled) action.refresh();
    }} />
    </NamespaceScopeProvider>
    </PodDockProvider></ResourceInspectorProvider></PermissionSession>}
    {connected && selected && !users && !clusterOverview && !workloadsOverview && !resourceKind && !replacement && !destinations.length && <Text as="p">Live {selected.label.toLowerCase()} data is not implemented yet.</Text>}
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
  useRegisterWorkspaceRefresh({ clusterId: clusterId ?? "", section: "saved-metadata", enabled: available && !busy && !loading,
    refresh: () => void run("catalog_list") }, !cluster && !!clusterId);
  const missingTitle = !available ? "Desktop engine required" : loading ? "Loading cluster…"
    : !snapshot ? "Cluster metadata unavailable" : "Cluster not found";
  return <Layout height="fill" footer={<VStack ref={setDockOutlet} gap={0} style={{ minWidth: 0 }} />} content={<LayoutContent padding={0} isScrollable={false}>
    <VStack gap={0} height="100%" style={{ minWidth: 0, minHeight: 0, overflow: "hidden", overflowWrap: "anywhere" }}>
      {error && available && <Text role="alert">{error}{snapshot ? " Previously loaded metadata is still shown." : ""}</Text>}
      {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved metadata is kept.</Text>}
      {cluster && available ? <ClusterSession key={`${cluster.id}:${attempt}`} cluster={cluster} section={section} dockOutlet={dockOutlet} onReopen={() => setAttempt((value) => value + 1)} />
        : <VStack gap={3} vAlign="center" hAlign="center" style={{ flex: "1 1 0", minHeight: 0, minWidth: 0 }}>
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
