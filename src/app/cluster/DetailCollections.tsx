import { useEffect, useMemo, useState } from "react";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { ContentError } from "../components/ContentError";
import { ContentLoading } from "../components/ContentLoading";
import { StatusBadge } from "./StatusBadge";
import { useResourceInspector } from "./ResourceInspector";
import { nextReadId, type SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";
import { cancelResourceCollection, collectionErrorMessage, collectionsFor, loadResourceCollection, type CollectionItem, type ResourceCollection } from "./detailCollectionsApi";

const labels: Record<string, string> = { ready: "Ready", node: "Node", replicas: "Current", desired: "Desired", active: "Active", completions: "Succeeded", failed: "Failed", reason: "Reason", type: "Type", message: "Message", source: "Source", lastSeen: "Last seen", count: "Count", addressType: "Address type", endpoints: "Endpoints", ports: "Ports", cpuUsed: "CPU used", cpuHard: "CPU hard", memoryUsed: "Memory used", memoryHard: "Memory hard", podsUsed: "Pods used", podsHard: "Pods hard", types: "Types", minCpu: "Min CPU", maxCpu: "Max CPU" };
const columns: Record<ResourceCollection, readonly string[]> = { pods: ["ready", "node"], replicaSets: ["ready", "replicas", "desired"], jobs: ["active", "completions", "failed"], endpointSlices: ["addressType", "endpoints", "ports"], events: ["message", "reason", "source", "count", "lastSeen"], resourceQuotas: ["cpuUsed", "cpuHard", "memoryUsed", "memoryHard", "podsUsed", "podsHard"], limitRanges: ["types", "minCpu", "maxCpu"] };
function title(collection: ResourceCollection) { return collection === "replicaSets" ? "Replica Sets" : collection === "endpointSlices" ? "Endpoint Slices" : collection === "resourceQuotas" ? "Resource Quotas" : collection === "limitRanges" ? "Limit Ranges" : collection[0].toUpperCase() + collection.slice(1); }
function CollectionSection({ collection, items, state, error, loading, onRetry }: { collection: ResourceCollection; items: CollectionItem[]; state: string | null; error: string | null; loading: boolean; onRetry: () => void }) {
  const { navigateResource } = useResourceInspector();
  const keys = columns[collection];
  const tableColumns = useMemo<TableColumn<CollectionItem>[]>(() => [
    { key: "name", header: "Name", width: proportional(2), renderCell: item => <Button label={item.reference.name} size="sm" variant="ghost" isDisabled={loading || !!error} onClick={() => { if (!loading && !error) navigateResource(item.reference); }} /> },
    { key: "namespace", header: "Namespace", renderCell: item => <Text>{item.reference.namespace ?? "N/A"}</Text> },
    ...keys.map(key => ({ key, header: labels[key] ?? key, renderCell: (item: CollectionItem) => <Text maxLines={1}>{item.columns[key] || "N/A"}</Text> })),
    { key: "status", header: "Status", renderCell: item => <StatusBadge status={item.status} /> },
  ], [keys, navigateResource, loading, error]);
  return <VStack gap={2} aria-label={`${title(collection)} related resources`}>
    <Text as="h3" size="sm" weight="semibold">{title(collection)}</Text>
    {loading && <ContentLoading label={`Loading ${title(collection).toLowerCase()}…`} refreshing={items.length > 0} />}
    {error && <ContentError title={`${title(collection)} unavailable`} message={`${items.length ? "Retained results may be stale. " : ""}${error}`} retained={items.length > 0} />}
    {!loading && !error && state === "partial" && <ContentError title={`${title(collection)} incomplete`} message="Some related resources could not be read." retained />}
    {!loading && !error && state === "denied" && <ContentError title={`${title(collection)} unavailable`} message="Permission denied for this related collection." />}
    {!loading && !error && state === "unavailable" && <ContentError title={`${title(collection)} unavailable`} message="The cluster did not provide this related collection." />}
    {error && <Button label="Retry" size="sm" variant="secondary" onClick={onRetry} />}
    {!loading && !error && state === "complete" && items.length === 0 && <Text>No related resources.</Text>}
    {items.length > 0 && <Table aria-label={title(collection)} data={items} columns={tableColumns} idKey={item => `${item.reference.kind}:${item.reference.namespace ?? ""}:${item.reference.name}:${item.reference.uid}`} density="compact" textOverflow="truncate" hasHover />}
  </VStack>;
}
export function DetailCollections({ clusterId, sessionId, reference, revision }: SessionRequest & { reference: ResourceReference; revision: number }) {
  const collections = collectionsFor(reference.kind);
  if (!reference.uid || !collections.length) return null;
  return <VStack gap={4}>{collections.map(collection => <CollectionRead key={JSON.stringify([clusterId, sessionId, reference.kind, reference.namespace, reference.name, reference.uid, collection])}
    clusterId={clusterId} sessionId={sessionId} reference={reference} revision={revision} collection={collection} />)}</VStack>;
}
function CollectionRead({ clusterId, sessionId, reference, revision, collection }: SessionRequest & { reference: ResourceReference; revision: number; collection: ResourceCollection }) {
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<{ items: CollectionItem[]; state: string | null; error: string | null; loading: boolean }>({ items: [], state: null, error: null, loading: true });
  const { kind, namespace, name, uid } = reference;
  useEffect(() => {
    let disposed = false;
    const request = { clusterId, sessionId, reference: { kind, namespace, name, uid }, collection, readId: nextReadId() };
    setRead(current => ({ ...current, error: null, loading: true }));
    void loadResourceCollection(request).then(result => {
      if (disposed) return;
      setRead({ items: result.items, state: result.state, error: null, loading: false });
    }).catch(reason => { if (!disposed) setRead(current => ({ ...current, error: collectionErrorMessage(reason), loading: false })); });
    return () => { disposed = true; void cancelResourceCollection(request).catch(() => {}); };
  }, [clusterId, sessionId, kind, namespace, name, uid, revision, collection, retry]);
  return <CollectionSection collection={collection} {...read} onRetry={() => setRetry(value => value + 1)} />;
}
