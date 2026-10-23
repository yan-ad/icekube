import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceKind, type ResourcePage, type SessionRequest } from "./api";

const columns: TableColumn<ResourceItem>[] = [{ key: "name", header: "Name", renderCell: (item) => <Text style={{ overflowWrap: "anywhere" }}>{item.name}</Text> }, { key: "status", header: "Status" }];

export function ClusterResources({ clusterId, sessionId, kind }: SessionRequest & { kind: ResourceKind }) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
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
  return <VStack gap={3} style={{ minWidth: 0 }}>
    <HStack gap={2} wrap="wrap" vAlign="center">
      <Button label={`Refresh ${kind}`} variant="ghost" onClick={() => setRevision((value) => value + 1)} />
      {page && <Text type="supporting">Fetched {new Date(page.fetchedAt).toLocaleString()}</Text>}
    </HStack>
    {loading && <Text role="status">Loading {kind}…</Text>}
    {error && <Text role="alert">{connectionMessage(error)}</Text>}
    {page && (loading || error) && <Text role="status">Previously fetched {kind} are shown and may be stale.</Text>}
    {page?.truncated && <Text role="status">Only the first {page.items.length} {kind} are shown. This is not the total.</Text>}
    {page && <Table data={page.items} columns={columns} idKey="name" density="compact" aria-label={kind === "nodes" ? "Nodes" : "Namespaces"} aria-busy={loading}
      emptyState={<VStack padding={6} gap={2}><Text>No {kind} were returned.</Text><Text color="secondary">Refresh to check again.</Text></VStack>} />}
  </VStack>;
}
