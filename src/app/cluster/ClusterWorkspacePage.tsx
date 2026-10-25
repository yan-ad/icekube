import { useEffect, useState } from "react";
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
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import { Link } from "@astryxdesign/core/Link";
import { IconDots, IconPlugConnected, IconPlugConnectedX, IconRefresh, IconInfoCircle, IconX } from "@tabler/icons-react";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError, type ClusterSummary } from "../catalog/api";
import { RecordIcon } from "../catalog/RecordIcon";
import { connectionMessage } from "./api";
import { ClusterResources } from "./ClusterResources";
import { clusterDestinations, clusterSections } from "./navigation";
import { resourceView } from "./resourceViews";
import { ResourceTablePage } from "./ResourceTablePage";
import { PodDock, PodDockProvider } from "./PodDock";
import { HelmTablePage } from "./HelmTablePage";
import { PortForwardTablePage } from "./PortForwardTablePage";
import { useClusterSession } from "./useClusterSession";
import { useRegisterWorkspaceRefresh, useWorkspaceRefresh } from "./WorkspaceRefresh";

function ClusterSession({ cluster, section, onReopen, dockOutlet }: { cluster: ClusterSummary; section: string; onReopen: () => void; dockOutlet: HTMLElement | null }) {
  const session = useClusterSession(cluster.id);
  const workspaceRefresh = useWorkspaceRefresh();
  const [showMetadata, setShowMetadata] = useState(false);
  const [tableViews, setTableViews] = useState(() => {
    try { return localStorage.getItem("icekube.resource-tables.v1") === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("icekube.resource-tables.v1", String(tableViews)); } catch { /* Preference persistence is optional. */ }
  }, [tableViews]);
  const selected = clusterDestinations.find((item) => item.id === section);
  const connection = session.snapshot;
  const connected = connection?.status === "connected";
  const failure = session.error ?? connection?.error ?? (connection?.status === "error" ? "connectionFailed" : null);
  const replacement = tableViews && section !== "nodes" ? resourceView(section) : undefined;
  const resourceKind = section === "nodes" || (section === "namespaces" && !tableViews) ? section : replacement?.kind ?? null;
  const serviceView = !!replacement && !replacement.kind;
  const refreshSection = replacement ? section : resourceKind ?? "cluster";
  const category = clusterSections.find((item) => item.id === (section === "workloads-overview" ? "workloads" : section));
  const destinations = category && "children" in category ? category.children.filter((item) => item.id !== "workloads-overview")
    : section === "overview" ? clusterSections.filter((item) => item.id !== "overview") : [];
  const rowRefresh = workspaceRefresh.action?.clusterId === cluster.id && workspaceRefresh.action.section === refreshSection
    ? workspaceRefresh.action : null;
  const busy = ["opening", "connecting", "releasing"].includes(session.phase);
  const status = session.phase === "opening" ? "Opening…" : session.phase === "releasing" ? "Disconnecting…"
    : session.phase === "connecting" ? "Connecting…" : connected ? "Connected" : failure ? "Connection error" : "Disconnected";
  useRegisterWorkspaceRefresh({ clusterId: cluster.id, section: refreshSection, enabled: !busy, refresh: () => {
    if (session.phase === "failed") onReopen();
    else if (connected) void session.reconnect();
    else void session.connect();
  } }, !connected || (!resourceKind && !serviceView));
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
      <IconButton label={`Refresh ${serviceView ? section : resourceKind ?? "cluster"}`} tooltip={`Refresh ${serviceView ? section : resourceKind ?? "cluster"} (⌘R / Ctrl+R)`}
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
      <Switch label="Resource tables" size="sm" value={tableViews} onChange={setTableViews}
        labelTooltip="Opt in to resource tables and Pod sessions. Nodes is unchanged; resource creation controls remain disabled." />
    </HStack>
    {failure && <Text as="p" role="alert">Connection error [{failure}]: {connectionMessage(failure)}</Text>}
    {showMetadata && <VStack gap={2}>
      <Text weight="semibold">Saved metadata</Text>
      <Text>Context: {cluster.contextName}</Text>
      <Text>Source: {cluster.source}</Text>
      {cluster.labels.length ? cluster.labels.map((label) => <Text key={label}>{label}</Text>) : <Text color="secondary">No labels saved.</Text>}
    </VStack>}
    {section === "overview" && connected && !tableViews && <Text color="secondary">Choose Nodes or Namespaces to inspect resources.</Text>}
    {connected && <PodDockProvider key={`${cluster.id}:${connection.sessionId}`} clusterId={cluster.id} sessionId={connection.sessionId} outlet={dockOutlet}
      onMutation={() => { if (workspaceRefresh.action?.section === "pods") workspaceRefresh.action.refresh(); }}>
    {replacement && (section === "helm-charts" || section === "helm-releases" ?
      <HelmTablePage key={section} clusterId={cluster.id} sessionId={connection.sessionId} view={section === "helm-charts" ? "charts" : "releases"} /> :
      section === "port-forwarding" ? <PortForwardTablePage clusterId={cluster.id} sessionId={connection.sessionId} /> :
      <ResourceTablePage key={`${cluster.id}:${connection.sessionId}:${section}`} clusterId={cluster.id} sessionId={connection.sessionId} view={replacement} />)}
    {connected && resourceKind && !replacement && <ClusterResources key={`${cluster.id}:${connection.sessionId}:${resourceKind}`} clusterId={cluster.id} sessionId={connection.sessionId} kind={resourceKind} />}
    {tableViews && destinations.length > 0 && <Table aria-label={`${selected?.label ?? "Cluster"} destinations`} data={destinations.map((item) => ({ ...item }))} idKey="id" density="compact"
      columns={[{ key: "label", header: "View", renderCell: (item) => <Link isStandalone href={`#/cluster/${encodeURIComponent(cluster.id)}?section=${item.id}`}>{item.label}</Link> }]} />}
    <PodDock />
    </PodDockProvider>}
    {!connected && replacement && !busy && <Text color="secondary">{selected?.label} unavailable while disconnected. Refresh to reconnect.</Text>}
    {!connected && resourceKind && !replacement && !busy && <Text color="secondary">{selected?.label} unavailable while disconnected. Refresh to reconnect.</Text>}
    {selected && section !== "overview" && !resourceKind && !replacement && !(tableViews && destinations.length) && <Text as="p">Live {selected.label.toLowerCase()} data is not implemented yet.</Text>}
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
  return <Layout height="fill" footer={<VStack ref={setDockOutlet} gap={0} style={{ minWidth: 0 }} />} content={<LayoutContent padding={4}>
    <VStack gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
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
