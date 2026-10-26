import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { TableToolbar, tableViewport } from "./TableToolbar";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceKind, type ResourcePage, type SessionRequest } from "./api";
import { ResourceActions } from "./ResourceActions";
import { ResourceSelectionSummary, useResourceSelection } from "./ResourceSelection";
import { resourceRowKey } from "./deleteApi";
import { NodesTable } from "./NodesTable";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";

const columns: TableColumn<ResourceItem>[] = [{ key: "name", header: "Name", renderCell: (item) => <Text style={{ overflowWrap: "anywhere" }}>{item.name}</Text> }, { key: "status", header: "Status" }];
const metricMessages = {
  unavailable: "Usage metrics unavailable; inventory is shown.",
  denied: "Usage metrics denied. Check metrics-server permissions.",
  stale: "Stale usage samples are omitted.",
  partial: "Partial usage metrics; missing samples show N/A.",
  error: "Could not load usage metrics; inventory is shown.",
};

export function ClusterResources({ clusterId, sessionId, kind }: SessionRequest & { kind: ResourceKind }) {
  return <ResourceSnapshot key={`${clusterId}:${sessionId}:${kind}`} clusterId={clusterId} sessionId={sessionId} kind={kind} />;
}

function ResourceSnapshot({ clusterId, sessionId, kind }: SessionRequest & { kind: ResourceKind }) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now);
  const needle = query.trim();
  const token = tokens[index];
  useRegisterWorkspaceRefresh({ clusterId, section: kind, enabled: true, refresh: () => {
    setTokens([null]); setIndex(0); setLoading(true); setRevision((value) => value + 1);
  } });
  useEffect(() => {
    if (kind !== "nodes") return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [kind]);
  useEffect(() => {
    let disposed = false;
    let started = false;
    const request = { clusterId, sessionId, kind, readId: nextReadId(), continueToken: token,
      ...(kind === "nodes" ? { query: needle || null } : {}) };
    setLoading(true); setError(null);
    const timer = window.setTimeout(() => {
      started = true;
      void loadResources(request).then((next) => {
        if (!disposed) { setPage(next); setNow(Date.now()); }
      }).catch((reason) => { if (!disposed) setError(errorCode(reason)); })
        .finally(() => { if (!disposed) setLoading(false); });
    }, kind === "nodes" ? 150 : 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (started) void cancelResources(request).catch(() => {});
    };
  }, [clusterId, sessionId, kind, revision, query, needle, token, index]);
  const items = page?.items ?? [];
  const metricState = kind === "nodes" ? page?.metrics : null;
  const selectionScope = JSON.stringify([clusterId, sessionId, kind, token, index, query]);
  const selection = useResourceSelection(items, selectionScope, !loading && !error);
  return <VStack gap={0} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", paddingBottom: "calc(var(--spacing-10) + var(--spacing-8))" }}>
    {kind === "nodes" && <TableToolbar label="Nodes" count={page ? `${items.length}${page.truncated ? "+" : ""} items · Page ${index + 1}` : loading ? "Loading…" : "Unavailable"}>
      <TextInput label="Search nodes" isLabelHidden value={query} onChange={(value) => {
        setQuery(value); setTokens([null]); setIndex(0); setLoading(true);
      }} placeholder="Search Nodes…"
        startIcon={IconSearch} hasClear size="sm" width="min(17rem, 100%)" />
      <IconButton label="Previous nodes page" tooltip="Previous page" icon={<Icon icon={IconChevronLeft} />} size="sm" variant="ghost"
        isDisabled={loading || index === 0} onClick={() => { setLoading(true); setIndex((value) => value - 1); }} />
      <IconButton label="Next nodes page" tooltip="Next page" icon={<Icon icon={IconChevronRight} />} size="sm" variant="ghost"
        isDisabled={loading || !!error || !page?.continueToken} onClick={() => {
          if (!page?.continueToken) return;
          setLoading(true); setTokens((previous) => [...previous.slice(0, index + 1), page.continueToken]); setIndex((value) => value + 1);
        }} />
      <ResourceSelectionSummary count={selection.selected.length} clear={selection.clear} />
    </TableToolbar>}
    {loading && <Text role="status">Loading {kind}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error) && <Text role="status">Previously fetched {kind} are shown and may be stale.</Text>}
    {metricState && metricState !== "available" && <Text role="status" color="secondary">{metricMessages[metricState]}</Text>}
    {page?.truncated && !loading && !error && kind === "nodes" && <Text type="supporting">{page.continueToken
      ? "More nodes may match. Continue to the next page." : "Results are limited; no continuation is available."}</Text>}
    {page && (kind === "nodes" ? <NodesTable items={items} loading={loading} filtered={!!needle} now={now} selection={selection.plugin} /> :
      <Table data={page.items} columns={columns} idKey={resourceRowKey} density="compact" aria-label="Namespaces" aria-busy={loading} plugins={{ viewport: tableViewport<ResourceItem>(), selection: selection.plugin }}
        emptyState={<VStack padding={6} gap={2}><Text>No namespaces were returned.</Text><Text color="secondary">Refresh to check again.</Text></VStack>} />)}
    {page && <Text type="supporting">Fetched {new Date(page.fetchedAt).toLocaleString()}</Text>}
    <ResourceActions key={selectionScope} clusterId={clusterId} sessionId={sessionId} kind={kind} selected={selection.selected} disabled={loading || !!error} onAccepted={selection.remove} onRefresh={() => {
      setTokens([null]); setIndex(0); setRevision(value => value + 1);
    }} />
  </VStack>;
}
