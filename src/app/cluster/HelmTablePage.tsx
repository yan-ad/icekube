import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch } from "@tabler/icons-react";
import { TableToolbar, tableViewport } from "./TableToolbar";
import { nextReadId, type SessionRequest } from "./api";
import { cancelHelm, helmMessage, loadHelm, type HelmItem, type HelmPage, type HelmView } from "./helmApi";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { HelmInstall } from "./HelmInstall";
import { NamespaceSelector } from "./NamespaceScope";

export function HelmTablePage({ clusterId, sessionId, view }: SessionRequest & { view: HelmView }) {
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
  useRegisterWorkspaceRefresh({ clusterId, section: `helm-${view}`, enabled: true, refresh: () => setRevision((value) => value + 1) });
  useEffect(() => {
    let disposed = false;
    let readId: number;
    try { readId = nextReadId(); } catch (reason) { setError({ scope, message: helmMessage(reason) }); setLoading(false); return; }
    const request = { clusterId, sessionId, view, namespace: selectedNamespace, readId };
    setLoading(true); setError(null);
    setPage((previous) => previous?.clusterId === clusterId && previous.sessionId === sessionId && previous.view === view && previous.namespace === selectedNamespace ? previous : null);
    void loadHelm(request)
      .then((result) => { if (!disposed) setPage(result); })
      .catch((reason) => { if (!disposed) setError({ scope, message: helmMessage(reason) }); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; void cancelHelm({ clusterId, sessionId, view, readId }).catch(() => {}); };
  }, [clusterId, sessionId, view, selectedNamespace, scope, revision]);
  const rows = scopedPage?.items ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const items = rows.filter((item) => (!status || item.status === status) && (!needle || [item.name, item.namespace, item.version, item.appVersion, item.description, item.status].join(" ").toLocaleLowerCase().includes(needle)));
  const statuses = [...new Set(rows.flatMap((item) => item.status ? [item.status] : []))].sort();
  const columns: TableColumn<HelmItem>[] = [
    { key: "name", header: "Name", width: proportional(2), renderCell: (item) => <Text maxLines={1}>{item.name}</Text> },
    ...(view === "releases" ? [{ key: "namespace", header: "Namespace", renderCell: (item: HelmItem) => <Text>{item.namespace}</Text> }] : []),
    { key: "version", header: view === "charts" ? "Version" : "Chart", renderCell: (item) => <Text maxLines={1}>{item.version}</Text> },
    { key: "appVersion", header: "App version", renderCell: (item) => <Text maxLines={1}>{item.appVersion || "N/A"}</Text> },
    ...(view === "charts" ? [{ key: "description", header: "Description", width: proportional(3), renderCell: (item: HelmItem) => <Text maxLines={1}>{item.description || "N/A"}</Text> }] : [
      { key: "status", header: "Status", renderCell: (item: HelmItem) => <Text>{item.status}</Text> },
      { key: "revision", header: "Revision", renderCell: (item: HelmItem) => <Text>{item.revision}</Text> },
      { key: "updated", header: "Updated", renderCell: (item: HelmItem) => <Text maxLines={1}>{item.updated || "N/A"}</Text> },
    ]),
  ];
  return <VStack gap={3} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", paddingBottom: "calc(var(--spacing-10) + var(--spacing-8))" }}>
    <TableToolbar label={label} count={scopedPage ? `${items.length} / ${rows.length}` : undefined}>
      <TextInput label={`Search ${label}`} isLabelHidden placeholder={`Search ${label}…`} startIcon={IconSearch} value={query} onChange={setQuery} hasClear size="sm" width="min(18rem, 100%)" />
      {view === "releases" && <Selector label="Status" isLabelHidden value={status} onChange={setStatus} size="sm" options={[{ value: "", label: "All statuses" }, ...statuses.map((value) => ({ value, label: value }))]} />}
      {view === "releases" && <NamespaceSelector value={namespace} onChange={setNamespace} />}
    </TableToolbar>
    {loading && <Text role="status">Loading Helm {view}…</Text>}
    {error?.scope === scope && <Text role="alert">{error.message}</Text>}
    {scopedPage && (loading || error?.scope === scope) && <Text role="status">Showing the previous Helm inventory. It may be stale.</Text>}
    {scopedPage && <>
      {scopedPage.truncated && <Text role="status">This inventory may be partial. At most 500 rows are displayed; Helm may apply its own list limit. Filters apply only to loaded rows.</Text>}
      <Table aria-label={`Helm ${label}`} data={items} columns={columns} idKey="id" density="compact" hasHover textOverflow="truncate" plugins={{ viewport: tableViewport<HelmItem>() }}
        emptyState={<VStack gap={2} padding={6}><Text>{query || status ? `No ${view} match your filters.` : `No ${view} were returned.`}</Text>
          <Text color="secondary">{view === "charts" ? "Check configured repositories and their cached indexes with your trusted Helm CLI, then reload." : "Change the namespace or reload to check again."}</Text></VStack>} />
    </>}
    <HelmInstall clusterId={clusterId} sessionId={sessionId} namespace={namespace} charts={view === "charts" ? rows : []} onInstalled={() => setRevision(value => value + 1)} />
  </VStack>;
}
