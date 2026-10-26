import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Switch } from "@astryxdesign/core/Switch";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch } from "@tabler/icons-react";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId,
  type ConnectionErrorCode, type ResourceItem, type ResourcePage, type SessionRequest } from "./api";
import type { ResourceView } from "./resourceViews";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { usePodDock } from "./PodDock";
import type { PodMode } from "./podApi";
import { openPodSync, readPodSync, closePodSync, type PodSyncStatus } from "./podSyncApi";
import { HelmTablePage } from "./HelmTablePage";
import { PortForwardTablePage } from "./PortForwardTablePage";
import { NamespaceSelector } from "./NamespaceScope";

function age(timestamp: string | null, now: number) {
  if (!timestamp) return "N/A";
  const seconds = Math.floor((now - Date.parse(timestamp)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "N/A";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function columns(view: ResourceView, now: number, openPod?: (item: ResourceItem, mode: PodMode) => void): TableColumn<ResourceItem>[] {
  return [
    { key: "name", header: "Name", width: proportional(2), renderCell: (item) => openPod
      ? <Button label={item.name} variant="ghost" size="sm" onClick={() => openPod(item, "details")} />
      : <Text maxLines={1}>{item.name}</Text> },
    ...(view.namespaced ? [{ key: "namespace", header: "Namespace", renderCell: (item: ResourceItem) => <Text maxLines={1}>{item.namespace ?? "N/A"}</Text> }] : []),
    ...view.columns.map((column) => ({ key: column.key, header: column.label,
      renderCell: (item: ResourceItem) => <Text maxLines={1}>{item.columns[column.key] || "N/A"}</Text> })),
    { key: "age", header: "Age", renderCell: (item) => <Text hasTabularNumbers>{age(item.createdAt, now)}</Text> },
    { key: "status", header: "Status", renderCell: (item) => <Text maxLines={1}>{item.status}</Text> },
    ...(openPod ? [{ key: "actions", header: "Actions", renderCell: (item: ResourceItem) => <HStack gap={1}>
      <Button label="Details" size="sm" variant="ghost" onClick={() => openPod(item, "details")} />
      <DropdownMenu presentation="popover" alignment="end"
        renderTrigger={(props) => <Button {...props} label={`Actions for ${item.name}`} size="sm" variant="ghost" />}
        items={([
          ["details", "Details"], ["logs", "Logs"], ["shell", "Shell"], ["attach", "Attach"], ["edit", "Edit YAML"], ["forward", "Port forward"],
        ] as [PodMode, string][]).map(([mode, label]) => ({ label, onClick: () => openPod(item, mode) }))} />
    </HStack> }] : []),
  ];
}

export function ResourceTablePage({ view, clusterId, sessionId }: SessionRequest & { view: ResourceView }) {
  const [namespace, setNamespace] = useState("");
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const [index, setIndex] = useState(0);
  const scope = (next: string) => { setNamespace(next); setTokens([null]); setIndex(0); };
  return <VStack gap={3} style={{ minWidth: 0 }}>
    {view.createLabel && <HStack gap={2} wrap="wrap" vAlign="center">
      <Button label={view.createLabel} size="sm" isDisabled tooltip="Creation is not implemented. This view is read-only." />
      <Text type="supporting">Creation is not available yet.</Text>
    </HStack>}
    {view.namespaced && view.kind && <NamespaceSelector value={namespace} onChange={scope} />}
    {!view.kind ? view.service === "port-forwarding" ? <PortForwardTablePage clusterId={clusterId} sessionId={sessionId} /> :
      <HelmTablePage clusterId={clusterId} sessionId={sessionId} view={view.service === "helm-charts" ? "charts" : "releases"} /> : <ResourceSnapshot key={`${view.section}:${namespace}`}
      clusterId={clusterId} sessionId={sessionId} view={view} namespace={namespace} token={tokens[index]} index={index}
      previous={() => setIndex((value) => value - 1)} next={(token) => {
        setTokens((previous) => [...previous.slice(0, index + 1), token]); setIndex((value) => value + 1);
      }} />}
  </VStack>;
}

type SnapshotProps = SessionRequest & {
  view: ResourceView; namespace: string; token: string | null; index: number; previous: () => void; next: (token: string) => void;
};
function ResourceSnapshot(props: SnapshotProps) {
  return props.view.kind === "pods" ? <PodSnapshot {...props} /> : <ResourceSnapshotContent {...props} />;
}
function PodSnapshot(props: SnapshotProps) {
  const { openPod } = usePodDock();
  return <ResourceSnapshotContent {...props} openPod={(item, mode) => {
    if (item.namespace) openPod({ namespace: item.namespace, name: item.name }, mode);
  }} />;
}
function ResourceSnapshotContent({ view, clusterId, sessionId, namespace, token, index, previous, next, openPod }: SnapshotProps & {
  openPod?: (item: ResourceItem, mode: PodMode) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [snapshotIndex, setSnapshotIndex] = useState(index);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState("");
  const [live, setLive] = useState(false);
  const [syncStatus, setSyncStatus] = useState<PodSyncStatus>("stopped");
  const syncing = live && view.kind === "pods" && token === null;
  useRegisterWorkspaceRefresh({ clusterId, section: view.section, enabled: true, refresh: () => setRevision((value) => value + 1) });
  useEffect(() => {
    if (!view.kind || syncing) return;
    let disposed = false;
    const request = { clusterId, sessionId, kind: view.kind, readId: nextReadId(), namespace: namespace || null, continueToken: token };
    setLoading(true); setError(null);
    void loadResources(request).then((result) => { if (!disposed) { setPage(result); setSnapshotIndex(index); } })
      .catch((reason) => { if (!disposed) setError(errorCode(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; void cancelResources(request).catch(() => {}); };
  }, [clusterId, sessionId, view.kind, namespace, token, index, revision, syncing]);
  useEffect(() => {
    if (!syncing) return;
    let disposed = false;
    let syncId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sequence = -1;
    const request = { clusterId, sessionId, kind: "pods" as const, readId: nextReadId(), namespace: namespace || null, continueToken: null };
    const close = (id: string) => { void closePodSync({ clusterId, sessionId, syncId: id }).catch(() => {}); };
    const accept = (snapshot: Awaited<ReturnType<typeof openPodSync>>) => {
      if (snapshot.sequence < sequence) throw "invalidResponse";
      sequence = snapshot.sequence;
      setSyncStatus(snapshot.status); setError(snapshot.error);
      if (snapshot.page) { setPage(snapshot.page); setSnapshotIndex(index); }
      setLoading(snapshot.status === "opening" && snapshot.page === null);
    };
    const poll = async () => {
      if (disposed || !syncId) return;
      try {
        const snapshot = await readPodSync({ clusterId, sessionId, syncId, readId: nextReadId() }, request);
        if (disposed) return;
        accept(snapshot);
        if (snapshot.status === "stopped" || snapshot.status === "error") { close(syncId); return; }
        timer = setTimeout(() => void poll(), 500);
      } catch (reason) {
        if (!disposed) { setError(errorCode(reason)); setSyncStatus("error"); setLoading(false); if (syncId) close(syncId); }
      }
    };
    setLoading(true); setError(null); setSyncStatus("opening");
    void openPodSync(request).then((snapshot) => {
      if (disposed) { close(snapshot.syncId); return; }
      syncId = snapshot.syncId; accept(snapshot);
      if (snapshot.status === "stopped" || snapshot.status === "error") close(syncId);
      else timer = setTimeout(() => void poll(), 500);
    }).catch((reason) => {
      if (!disposed) { setError(errorCode(reason)); setSyncStatus("error"); setLoading(false); if (syncId) close(syncId); }
    });
    return () => { disposed = true; clearTimeout(timer); if (syncId) close(syncId); };
  }, [syncing, clusterId, sessionId, namespace, index, revision]);
  const needle = query.trim().toLocaleLowerCase();
  const rows = page?.items ?? [];
  const filtered = !!(needle || status || group);
  const items = rows.filter((item) => (!status || item.status === status) && (!group || item.columns.group === group)
    && (!needle || [item.name, item.namespace, item.status, ...Object.values(item.columns)].join(" ").toLocaleLowerCase().includes(needle)));
  const statuses = [...new Set([...rows.map((item) => item.status), ...(status ? [status] : [])])].sort();
  const groups = [...new Set([...rows.map((item) => item.columns.group).filter(Boolean), ...(group ? [group] : [])])].sort();
  const shown = items.map((item) => ({ ...item, rowId: JSON.stringify([item.namespace, item.name]) }));
  return <VStack gap={3} style={{ minWidth: 0 }}>
    <HStack gap={3} wrap="wrap" vAlign="end">
      <TextInput label={`Search ${view.label}`} value={query} onChange={setQuery} placeholder={`Search ${view.label}…`}
        startIcon={IconSearch} hasClear size="sm" width="min(18rem, 100%)" />
      <Selector label="Status" value={status} onChange={setStatus} size="sm" presentation="adaptive"
        options={[{ value: "", label: "All statuses" }, ...statuses.map((value) => ({ value, label: value }))]} />
      {view.kind === "customResourceDefinitions" && <Selector label="Group" value={group} onChange={setGroup} size="sm" presentation="adaptive" hasSearch
        options={[{ value: "", label: "All groups" }, ...groups.map((value) => ({ value, label: value }))]} />}
      {filtered && <Button label="Clear filters" size="sm" variant="ghost" onClick={() => { setQuery(""); setStatus(""); setGroup(""); }} />}
      {view.kind === "pods" && <Switch label="Live sync" value={live} onChange={setLive} size="sm" isDisabled={token !== null}
        labelTooltip={token !== null ? "Return to the first page to enable live sync. Continuation pages cannot be synced." : "Keep this Pod page updated through the desktop engine."} />}
    </HStack>
    {view.kind === "pods" && token !== null && <Text type="supporting">Live sync is unavailable on continuation pages. Return to the first page to enable it.</Text>}
    {syncing && <HStack gap={2} vAlign="center"><Text role="status">Live sync: {syncStatus}</Text><Button label="Pause live sync" size="sm" variant="ghost" onClick={() => setLive(false)} /></HStack>}
    <Text type="supporting" role="status">{page ? `${items.length} of ${rows.length} loaded items · page ${snapshotIndex + 1}${namespace ? ` · namespace ${namespace}` : view.namespaced ? " · all namespaces" : " · cluster scope"}` : loading ? `Loading ${view.label.toLowerCase()}…` : "No snapshot loaded."}</Text>
    {loading && page && <Text role="status">Loading {view.label.toLowerCase()}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error || syncing && syncStatus !== "syncing") && <Text role="status">Previously fetched {view.label.toLowerCase()} are shown and may be stale.</Text>}
    {page?.truncated && <Text role="status">This is a partial page of at most 100 items, not the total. Filters apply to this loaded page.</Text>}
    {(view.kind === "secrets" || view.kind === "configMaps") && <Text type="supporting">Metadata only. Data values and key names are not loaded.</Text>}
    {page && <Table aria-label={view.label} data={shown} columns={columns(view, Date.now(), openPod)} density="compact" idKey="rowId" hasHover textOverflow="truncate" aria-busy={loading}
      emptyState={<VStack gap={2} padding={6}><Text>{filtered ? `No ${view.label.toLowerCase()} match your filters.` : `No ${view.label.toLowerCase()} were returned.`}</Text>
        <Text color="secondary">{filtered ? "Clear or change the filters to see loaded items." : "Refresh to check again."}</Text></VStack>} />}
    {page && <HStack gap={2} wrap="wrap" vAlign="center">
      <Button label="Previous page" variant="ghost" size="sm" isDisabled={index === 0 || loading} onClick={previous} />
      <Button label="Next page" variant="ghost" size="sm" isDisabled={syncing || !page.continueToken || loading || !!error} onClick={() => { if (page.continueToken) next(page.continueToken); }} />
      <Text type="supporting">Fetched {new Date(page.fetchedAt).toLocaleString()}</Text>
    </HStack>}
  </VStack>;
}
