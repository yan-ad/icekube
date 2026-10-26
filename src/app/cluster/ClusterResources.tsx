import { useEffect, useState } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch } from "@tabler/icons-react";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceKind, type ResourcePage, type SessionRequest } from "./api";
import { NodesTable } from "./NodesTable";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";

const columns: TableColumn<ResourceItem>[] = [{ key: "name", header: "Name", renderCell: (item) => <Text style={{ overflowWrap: "anywhere" }}>{item.name}</Text> }, { key: "status", header: "Status" }];
const metricMessages = {
  unavailable: "Node usage metrics are unavailable. Inventory facts are still shown.",
  denied: "Node usage metrics were denied. Check metrics-server permissions. Inventory facts are still shown.",
  stale: "Node usage metrics are stale. Stale samples are omitted; inventory facts are still shown.",
  partial: "Node usage metrics are partial. Missing or invalid samples show N/A.",
  error: "Node usage metrics could not be loaded. Inventory facts are still shown.",
};

export function ClusterResources({ clusterId, sessionId, kind }: SessionRequest & { kind: ResourceKind }) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  useRegisterWorkspaceRefresh({ clusterId, section: kind, enabled: true, refresh: () => setRevision((value) => value + 1) });
  useEffect(() => {
    if (kind !== "nodes") return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [kind]);
  useEffect(() => {
    let disposed = false;
    const request = { clusterId, sessionId, kind, readId: nextReadId() };
    setLoading(true); setError(null);
    void loadResources(request).then((next) => {
      if (!disposed) { setPage(next); setNow(Date.now()); }
    }).catch((reason) => { if (!disposed) setError(errorCode(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => {
      disposed = true;
      void cancelResources(request).catch(() => {});
    };
  }, [clusterId, sessionId, kind, revision]);
  const needle = query.trim().toLocaleLowerCase();
  const items = page?.items.filter((item) => !needle || [item.name, item.status, item.node?.roles.join(" "),
    item.node?.version, item.node?.internalIps.join(" "), item.node?.conditions.map((condition) => `${condition.type} ${condition.status}`).join(" ")]
    .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)) ?? [];
  const metricState = kind === "nodes" ? page?.metrics : null;
  return <VStack gap={3} style={{ minWidth: 0 }}>
    {kind === "nodes" && <HStack gap={3} wrap="wrap" vAlign="center" hAlign="between">
      <Text type="supporting" role="status">{page ? needle ? `${items.length} of ${page.items.length} loaded items` : `${items.length} ${items.length === 1 ? "item" : "items"}${page.truncated ? " loaded" : ""}` : "Loading items…"}</Text>
      <TextInput label="Search nodes" isLabelHidden value={query} onChange={setQuery} placeholder="Search Nodes…"
        startIcon={IconSearch} hasClear size="sm" width="min(17rem, 100%)" />
    </HStack>}
    {loading && <Text role="status">Loading {kind}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error) && <Text role="status">Previously fetched {kind} are shown and may be stale.</Text>}
    {page?.truncated && <Text role="status">Only the first {page.items.length} {kind} are shown. This is not the total.</Text>}
    {metricState && metricState !== "available" && <Text role="status" color="secondary">{metricMessages[metricState]}</Text>}
    {page && (kind === "nodes" ? <NodesTable items={items} loading={loading} filtered={!!needle} now={now} /> :
      <Table data={page.items} columns={columns} idKey="name" density="compact" aria-label="Namespaces" aria-busy={loading}
        emptyState={<VStack padding={6} gap={2}><Text>No namespaces were returned.</Text><Text color="secondary">Refresh to check again.</Text></VStack>} />)}
    {page && <Text type="supporting">Fetched {new Date(page.fetchedAt).toLocaleString()}</Text>}
  </VStack>;
}
