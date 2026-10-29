import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { ContentLoading } from "../components/ContentLoading";
import { ContentError } from "../components/ContentError";
import { Button } from "@astryxdesign/core/Button";
import { StatusBadge } from "./StatusBadge";
import { useResourceInspector } from "./ResourceInspector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch } from "@tabler/icons-react";
import { TableToolbar, tableViewport } from "./TableToolbar";
import { nextReadId, type SessionRequest } from "./api";
import { cancelHelm, helmMessage, loadHelm, type HelmItem, type HelmPage, type HelmView } from "./helmApi";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { HelmInstall } from "./HelmInstall";
import { useRowContextMenu, type RowMenuAction } from "./RowContextMenu";
import { NamespaceSelector } from "./NamespaceScope";
import { sameInventory, useAutoRefresh } from "./useAutoRefresh";
const HelmTable = memo(Table) as typeof Table;

export function HelmTablePage({ clusterId, sessionId, view }: SessionRequest & { view: HelmView }) {
  const { openResource, openHelm } = useResourceInspector();
  const [installTarget, setInstallTarget] = useState<{ item: HelmItem; identity: object } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [namespace, setNamespace] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<HelmPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const selectedNamespace = view === "releases" ? namespace || null : null;
  const scope = JSON.stringify([clusterId, sessionId, view, selectedNamespace]);
  const scopedPage = page?.clusterId === clusterId && page.sessionId === sessionId && page.view === view && page.namespace === selectedNamespace ? page : null;
  const label = view === "charts" ? "Charts" : "Releases";
  const auto = useAutoRefresh({ scope, interval: 30_000, busy: loading, paused: !!installTarget, refresh: () => setRevision(value => value + 1) });
  useEffect(() => {
    let disposed = false;
    let readId: number;
    try { readId = nextReadId(); } catch (reason) { setError({ scope, message: helmMessage(reason) }); setLoading(false); return; }
    const request = { clusterId, sessionId, view, namespace: selectedNamespace, readId };
    setLoading(true);
    if (!auto.background.current) setError(null);
    setPage((previous) => previous?.clusterId === clusterId && previous.sessionId === sessionId && previous.view === view && previous.namespace === selectedNamespace ? previous : null);
    void loadHelm(request)
      .then((result) => { if (!disposed) auto.deliver(() => {
        if (disposed) return;
        setError(null); setPage(current => sameInventory(current, result) ? current : result);
        auto.complete();
      }); })
      .catch((reason) => { if (!disposed) auto.deliver(() => { if (!disposed) { setError({ scope, message: helmMessage(reason) }); auto.complete(reason); } }); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; void cancelHelm({ clusterId, sessionId, view, readId }).catch(() => {}); };
  }, [clusterId, sessionId, view, selectedNamespace, scope, revision]);
  const rows = useMemo(() => scopedPage?.items ?? [], [scopedPage]);
  const deferredQuery = useDeferredValue(query);
  const pending = query !== deferredQuery;
  useRegisterWorkspaceRefresh({ clusterId, section: `helm-${view}`, enabled: !loading, refresh: () => setRevision((value) => value + 1) });
  const needle = deferredQuery.trim().toLocaleLowerCase();
  const searchable = useMemo(() => rows.map(item => ({ item, text: [item.name, item.namespace, item.version, item.appVersion, item.description, item.status].join(" ").toLocaleLowerCase() })), [rows]);
  const items = useMemo(() => {
    const matches = searchable.filter(({ item, text }) => (!status || item.status === status) && (!needle || text.includes(needle)));
    return matches.length === rows.length ? rows : matches.map(({ item }) => item);
  }, [rows, searchable, status, needle]);
  const statuses = useMemo(() => [...new Set(rows.flatMap((item) => item.status ? [item.status] : []))].sort(), [rows]);
  const inspect = useCallback((item: HelmItem) => openHelm({ view, name: item.name, namespace: item.namespace,
    version: view === "charts" ? item.version : null }), [openHelm, view]);
  const visibleLoading = loading && !auto.background.current;
  const installIdentity = useMemo(() => ({ scope, rows, loading: visibleLoading, error, query, status }), [scope, rows, visibleLoading, error, query, status]);
  const contextChart = installTarget?.identity === installIdentity ? installTarget.item : null;
  const actions = useCallback((): RowMenuAction[] => [{ action: "details" }, ...(view === "charts" ? [{ action: "install" as const, disabled: pending || visibleLoading || !!error }] : [])], [view, pending, visibleLoading, error]);
  const rowMenu = useRowContextMenu({ clusterId, sessionId, rows: items, scope: JSON.stringify([scope, deferredQuery, status]), rowKey: item => item.id, rowLabel: item => item.name,
    target: item => view === "charts" ? { type: "helmChart", id: item.id, name: item.name } : { type: "helmRelease", name: item.name, namespace: item.namespace! },
    actions,
    onAction: (item, action) => { if (action === "details") inspect(item); else if (action === "install") setInstallTarget({ item, identity: installIdentity }); },
  });
  const columns = useMemo<TableColumn<HelmItem>[]>(() => [
    { key: "name", header: "Name", width: proportional(2), renderCell: (item) => <Button label={item.name} variant="ghost" size="sm" onClick={() => inspect(item)} /> },
    ...(view === "releases" ? [{ key: "namespace", header: "Namespace", renderCell: (item: HelmItem) => <Button label={item.namespace || "Unknown"} variant="ghost" size="sm" isDisabled={!item.namespace} onClick={() => { if (item.namespace) openResource({ kind: "namespaces", namespace: null, name: item.namespace }); }} /> }] : []),
    { key: "version", header: view === "charts" ? "Version" : "Chart", renderCell: (item) => <Text maxLines={1}>{item.version}</Text> },
    { key: "appVersion", header: "App version", renderCell: (item) => <Text maxLines={1}>{item.appVersion || "N/A"}</Text> },
    ...(view === "charts" ? [{ key: "description", header: "Description", width: proportional(3), renderCell: (item: HelmItem) => <Text maxLines={1}>{item.description || "N/A"}</Text> }] : [
      { key: "status", header: "Status", renderCell: (item: HelmItem) => <StatusBadge status={item.status} /> },
      { key: "revision", header: "Revision", renderCell: (item: HelmItem) => <Text>{item.revision}</Text> },
      { key: "updated", header: "Updated", renderCell: (item: HelmItem) => <Text maxLines={1}>{item.updated || "N/A"}</Text> },
    ]),
  ], [view, inspect, openResource]);
  const plugins = useMemo(() => ({ viewport: tableViewport<HelmItem>(), rowContext: rowMenu }), [rowMenu]);
  const hasFilters = items.length === 0 && !!(deferredQuery || status);
  const emptyState = useMemo(() => <VStack gap={2} padding={6}><Text>{hasFilters ? `No ${view} match your filters.` : `No ${view} were returned.`}</Text>
    <Text color="secondary">{view === "charts" ? "Check configured repositories and their cached indexes with your trusted Helm CLI, then reload." : "Change the namespace or reload to check again."}</Text></VStack>, [hasFilters, view]);
  return <VStack gap={3} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
    <TableToolbar label={label} count={scopedPage ? `${items.length} / ${rows.length}` : undefined}
      context={view === "releases" && <NamespaceSelector value={namespace} onChange={setNamespace} />}>
      <TextInput label={`Search ${label}`} isLabelHidden placeholder={`Search ${label}…`} startIcon={IconSearch} value={query} onChange={setQuery} hasClear size="sm" width="min(18rem, 100%)" />
      {view === "releases" && <Selector label="Status" isLabelHidden value={status} onChange={setStatus} size="sm" options={[{ value: "", label: "All statuses" }, ...statuses.map((value) => ({ value, label: value }))]} />}
    </TableToolbar>
    <ContentLoading label={`Loading Helm ${view}…`} refreshing active={visibleLoading && !!scopedPage} />
    {loading && !scopedPage && <ContentLoading label={`Loading Helm ${view}…`} />}
    {error?.scope === scope && <ContentError title={`Could not load Helm ${view}`} message={error.message} retained={!!scopedPage}
      disabled={loading || pending} onRetry={() => setRevision(value => value + 1)} />}
    {scopedPage && <>
      {scopedPage.truncated && <Text role="status">This inventory may be partial. At most 500 rows are displayed; Helm may apply its own list limit. Filters apply only to loaded rows.</Text>}
      <HelmTable aria-label={`Helm ${label}`} aria-busy={visibleLoading || pending} data={items} columns={columns} idKey="id" density="compact" hasHover textOverflow="truncate" plugins={plugins}
        emptyState={emptyState} />
    </>}
    <HelmInstall contextChart={contextChart} onContextClose={() => setInstallTarget(null)} clusterId={clusterId} sessionId={sessionId} namespace={namespace} charts={view === "charts" ? rows : []} onInstalled={() => setRevision(value => value + 1)} />
  </VStack>;
}
