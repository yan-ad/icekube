import { useEffect, useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconSearch } from "@tabler/icons-react";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceKind, type ResourcePage, type SessionRequest } from "./api";
import type { NodeInfo, Usage } from "./nodeContract";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";

function formatNumber(value: number | null, digits = 1) {
  return value === null ? "N/A" : value.toFixed(digits).replace(/\.0$/, "");
}
function formatBytes(value: string | null) {
  return value ?? "N/A";
}
function usageText(usage: Usage, unit: string) {
  const used = usage.used === null ? "N/A" : `${formatNumber(usage.used)}${unit}`;
  const capacity = usage.capacity === null ? "N/A" : `${formatNumber(usage.capacity)}${unit}`;
  return `${used} / ${capacity}`;
}
function usageBar(usage: Usage, label: string, unit: string) {
  const max = usage.capacity ?? usage.allocatable;
  const value = usage.used;
  if (max === null || max === undefined || value === null) {
    return <Text type="supporting" aria-label={`${label}: ${usageText(usage, unit)}`}>{usageText(usage, unit)}</Text>;
  }
  return <VStack gap={1} style={{ minWidth: "7rem" }}>
    <ProgressBar label={label} isLabelHidden value={Math.min(value, max)} max={max} variant="accent"
      formatValueLabel={() => usageText(usage, unit)} hasValueLabel />
  </VStack>;
}
function age(value: string | null) {
  if (!value) return "N/A";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "N/A";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function ready(node: NodeInfo) {
  return node.conditions.find((condition) => condition.type === "Ready")?.status;
}
function nodeConditionText(node: NodeInfo) {
  return node.conditions.map((condition) => `${condition.type}: ${condition.status}`).join(", ") || "N/A";
}
function nodeColumns(): TableColumn<ResourceItem>[] {
  return [
    { key: "name", header: "Name", width: proportional(1.5, { minWidth: 220 }), renderCell: (item) => <Text maxLines={1}>{item.name}</Text> },
    { key: "cpu", header: "CPU", width: pixel(150), renderCell: (item) => item.node && usageBar(item.node.cpu, `${item.name} CPU`, "") },
    { key: "memory", header: "Memory", width: pixel(150), renderCell: (item) => item.node && usageBar(item.node.memory, `${item.name} memory`, "") },
    { key: "disk", header: "Disk", width: pixel(110), renderCell: (item) => <Text type="supporting">{item.node ? formatBytes(item.node.diskAllocatable) : "N/A"}</Text> },
    { key: "roles", header: "Roles", width: proportional(1, { minWidth: 120 }), renderCell: (item) => <Text maxLines={1}>{item.node?.roles.join(", ") || "N/A"}</Text> },
    { key: "taints", header: "Taints", width: pixel(80), align: "end", renderCell: (item) => <Text hasTabularNumbers>{item.node?.taints ?? "N/A"}</Text> },
    { key: "version", header: "Version", width: proportional(1, { minWidth: 140 }), renderCell: (item) => <Text maxLines={1}>{item.node?.version ?? "N/A"}</Text> },
    { key: "internalIp", header: "Internal IP", width: proportional(1, { minWidth: 130 }), renderCell: (item) => <Text maxLines={1} type="code">{item.node?.internalIps.join(", ") || "N/A"}</Text> },
    { key: "age", header: "Age", width: pixel(80), renderCell: (item) => <Text hasTabularNumbers>{age(item.createdAt)}</Text> },
    { key: "schedulable", header: "Schedulable", width: pixel(110), renderCell: (item) => item.node ? <Badge variant={item.node.schedulable ? "green" : "neutral"} label={item.node.schedulable ? "True" : "False"} /> : <Text>N/A</Text> },
    { key: "conditions", header: "Conditions", width: proportional(1.3, { minWidth: 190 }), renderCell: (item) => {
      const status = item.node && ready(item.node);
      return <HStack gap={1} vAlign="center" style={{ minWidth: 0 }}>
        <Text color={status === "True" ? "accent" : "primary"} maxLines={1}>{status === "True" ? "Ready" : status ?? "N/A"}</Text>
        {item.node && <Text type="supporting" maxLines={1}>{nodeConditionText(item.node)}</Text>}
      </HStack>;
    } },
  ];
}

export function ClusterResources({ clusterId, sessionId, kind }: SessionRequest & { kind: ResourceKind }) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [query, setQuery] = useState("");
  useRegisterWorkspaceRefresh({ clusterId, section: kind, enabled: true, refresh: () => setRevision((value) => value + 1) });
  useEffect(() => {
    let disposed = false;
    const request = { clusterId, sessionId, kind, readId: nextReadId() };
    setLoading(true); setError(null);
    void loadResources(request).then((next) => {
      if (!disposed) setPage(next);
    }).catch((reason) => { if (!disposed) setError(errorCode(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => {
      disposed = true;
      void cancelResources(request).catch(() => {});
    };
  }, [clusterId, sessionId, kind, revision]);
  const visibleItems = useMemo(() => {
    if (!page || !query.trim()) return page?.items ?? [];
    const needle = query.trim().toLocaleLowerCase();
    return page.items.filter((item) => [item.name, item.status, item.node?.roles.join(" "), item.node?.version, item.node?.internalIps.join(" ")]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
  }, [page, query]);
  const metricsMessage = kind === "nodes" && page?.metrics && page.metrics !== "available"
    ? `Node usage is ${page.metrics}; inventory facts remain available.` : null;
  return <VStack gap={3} style={{ minWidth: 0 }}>
    <HStack gap={3} wrap="wrap" vAlign="end" style={{ justifyContent: "space-between" }}>
      <Text type="supporting" role="status">{visibleItems.length} {visibleItems.length === 1 ? "item" : "items"}{query ? " shown" : ""}</Text>
      <TextInput label={`Search ${kind}`} isLabelHidden value={query} onChange={setQuery} placeholder={`Search ${kind === "nodes" ? "Nodes" : "Namespaces"}…`} startIcon={IconSearch} hasClear size="sm" width="min(17rem, 100%)" />
    </HStack>
    {metricsMessage && <Text role="status" color="secondary">{metricsMessage}</Text>}
    {loading && <Text role="status">Loading {kind}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error) && <Text role="status">Previously fetched {kind} are shown and may be stale.</Text>}
    {page?.truncated && <Text role="status">Only the first {page.items.length} {kind} are shown. This is not the total.</Text>}
    {page && query && visibleItems.length === 0 && <Text role="status">No {kind} match “{query}”.</Text>}
    {page && <Table data={visibleItems} columns={kind === "nodes" ? nodeColumns() : [
      { key: "name", header: "Name", renderCell: (item) => <Text maxLines={1}>{item.name}</Text> },
      { key: "status", header: "Status", renderCell: (item) => <Text>{item.status}</Text> },
    ]} idKey="name" density="compact" dividers="rows" hasHover textOverflow="truncate" aria-label={kind === "nodes" ? "Nodes" : "Namespaces"} aria-busy={loading}
      emptyState={<VStack padding={6} gap={2}><Text>{query ? `No ${kind} match your search.` : `No ${kind} were returned.`}</Text><Text color="secondary">Refresh to check again.</Text></VStack>} />}
  </VStack>;
}
