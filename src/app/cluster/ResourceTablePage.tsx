import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch, IconDots, IconInfoCircle, IconX } from "@tabler/icons-react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId,
  type ConnectionErrorCode, type ResourceItem, type ResourcePage, type SessionRequest } from "./api";
import type { ResourceView } from "./resourceViews";
import { useRegisterWorkspacePageActions, useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { usePodDock } from "./PodDock";
import type { PodMode } from "./podApi";
import { openPodSync, readPodSync, closePodSync, type PodSyncStatus } from "./podSyncApi";
import { HelmTablePage } from "./HelmTablePage";
import { PortForwardTablePage } from "./PortForwardTablePage";
import { ResourceCreate } from "./ResourceCreate";
import { NamespaceSelector } from "./NamespaceScope";
import { TableToolbar, tableViewport } from "./TableToolbar";

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
      <IconButton label="Details" tooltip={`Details for ${item.name}`} icon={<Icon icon={IconInfoCircle} />} size="sm" variant="ghost" onClick={() => openPod(item, "details")} />
      <DropdownMenu presentation="popover" alignment="end" hasChevron={false}
        renderTrigger={(props) => <IconButton {...props} label={`Actions for ${item.name}`} tooltip="Pod actions" icon={<Icon icon={IconDots} />} size="sm" variant="ghost" />}
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
  const [filters, setFilters] = useState({ query: "", status: "", group: "" });
  const scope = (next: string) => { setNamespace(next); setTokens([null]); setIndex(0); };
  const filter = (next: Partial<typeof filters>) => { setFilters(current => ({ ...current, ...next })); setTokens([null]); setIndex(0); };
  return <VStack gap={0} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
    {!view.kind ? view.service === "port-forwarding" ? <PortForwardTablePage clusterId={clusterId} sessionId={sessionId} /> :
      <HelmTablePage clusterId={clusterId} sessionId={sessionId} view={view.service === "helm-charts" ? "charts" : "releases"} /> : <ResourceSnapshot key={`${clusterId}:${sessionId}:${view.section}:${namespace}`}
      clusterId={clusterId} sessionId={sessionId} view={view} namespace={namespace} token={tokens[index]} index={index}
      filters={filters} onFilter={filter} onNamespace={scope}
      previous={() => setIndex((value) => value - 1)} next={(token) => {
        setTokens((previous) => [...previous.slice(0, index + 1), token]); setIndex((value) => value + 1);
      }} />}
  </VStack>;
}

type SnapshotProps = SessionRequest & {
  view: ResourceView; namespace: string; token: string | null; index: number; previous: () => void; next: (token: string) => void;
  filters: { query: string; status: string; group: string };
  onFilter: (next: Partial<{ query: string; status: string; group: string }>) => void;
  onNamespace: (namespace: string) => void;
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
function ResourceSnapshotContent({ view, clusterId, sessionId, namespace, token, index, previous, next, openPod, filters, onFilter, onNamespace }: SnapshotProps & {
  openPod?: (item: ResourceItem, mode: PodMode) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const { query, status, group } = filters;
  const [live, setLive] = useState(false);
  const [syncStatus, setSyncStatus] = useState<PodSyncStatus>("stopped");
  const filtered = !!(query.trim() || status || group);
  const syncing = live && view.kind === "pods" && token === null && !filtered;
  useRegisterWorkspacePageActions({ clusterId, section: view.section,
    previous: { enabled: index > 0 && !loading, run: previous },
    next: { enabled: !syncing && !!page?.continueToken && !loading && !error, run: () => { if (page?.continueToken) next(page.continueToken); } },
    live: view.kind === "pods" ? { enabled: token === null && !filtered, checked: live, run: () => setLive(value => !value) } : undefined,
  });
  useRegisterWorkspaceRefresh({ clusterId, section: view.section, enabled: true, refresh: () => setRevision((value) => value + 1) });
  useEffect(() => {
    if (!view.kind || syncing) return;
    let disposed = false;
    const request = { clusterId, sessionId, kind: view.kind, readId: nextReadId(), namespace: namespace || null, continueToken: token,
      ...(filtered ? { query: query.trim() || null, status: status || null, group: group || null } : {}) };
    setLoading(true); setError(null);
    void loadResources(request).then((result) => { if (!disposed) { setPage(result); } })
      .catch((reason) => { if (!disposed) setError(errorCode(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; void cancelResources(request).catch(() => {}); };
  }, [clusterId, sessionId, view.kind, namespace, token, index, revision, syncing, query, status, group, filtered]);
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
      if (snapshot.page) { setPage(snapshot.page); }
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
  const rows = page?.items ?? [];
  const statuses = [...new Set([...rows.map(item => item.status), ...(status ? [status] : [])])].sort();
  const groups = [...new Set([...rows.map(item => item.columns.group).filter(Boolean), ...(group ? [group] : [])])].sort();
  const shown = rows.map(item => ({ ...item, rowId: JSON.stringify([item.namespace, item.name]) }));
  return <VStack gap={0} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", paddingBottom: "calc(var(--spacing-10) + var(--spacing-8))" }}>
    <TableToolbar label={view.label} count={page ? `${rows.length}${page.truncated ? "+" : ""} items` : "Loading…"}>
      {view.namespaced && <NamespaceSelector value={namespace} onChange={onNamespace} isLabelHidden />}
      <TextInput label={`Search ${view.label}`} isLabelHidden value={query} onChange={value => onFilter({ query: value })} placeholder={`Search ${view.label}…`}
        startIcon={IconSearch} hasClear size="sm" width="min(18rem, 100%)" />
      <Selector label="Status" isLabelHidden value={status} onChange={value => onFilter({ status: value })} size="sm" presentation="adaptive"
        options={[{ value: "", label: "All statuses" }, ...statuses.map(value => ({ value, label: value }))]} />
      {view.kind === "customResourceDefinitions" && <Selector label="Group" isLabelHidden value={group} onChange={value => onFilter({ group: value })} size="sm" presentation="adaptive" hasSearch
        options={[{ value: "", label: "All groups" }, ...groups.map(value => ({ value, label: value }))]} />}
      {filtered && <IconButton label="Clear filters" tooltip="Clear filters" icon={<Icon icon={IconX} />} size="sm" variant="ghost" onClick={() => onFilter({ query: "", status: "", group: "" })} />}
    </TableToolbar>
    {syncing && syncStatus !== "syncing" && <Text role="status">Live sync: {syncStatus}</Text>}
    {loading && <Text role="status">Loading {view.label.toLowerCase()}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error || syncing && syncStatus !== "syncing") && <Text role="status">Previously fetched {view.label.toLowerCase()} are shown and may be stale.</Text>}
    {page && <Table aria-label={view.label} data={shown} columns={columns(view, Date.now(), openPod)} density="compact" idKey={(item) => `${item.namespace ?? ""}:${item.name}`} hasHover textOverflow="truncate" aria-busy={loading}
      plugins={{ viewport: tableViewport<ResourceItem>() }}
      emptyState={<VStack gap={2} padding={6}><Text>{filtered ? `No ${view.label.toLowerCase()} match your filters.` : `No ${view.label.toLowerCase()} were returned.`}</Text></VStack>} />}
    {view.kind && <ResourceCreate clusterId={clusterId} sessionId={sessionId} kind={view.kind} namespace={namespace} label={view.createLabel}
      onCreated={() => setRevision(value => value + 1)} />}
  </VStack>;
}
