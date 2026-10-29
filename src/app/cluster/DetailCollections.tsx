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
function nodeName(value: string | undefined): value is string {
  return !!value && value.length <= 253 && value.split(".").every(part => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part));
}
function CollectionSection({ collection, items, state, error, loading, onRetry }: { collection: ResourceCollection; items: CollectionItem[]; state: string | null; error: string | null; loading: boolean; onRetry: () => void }) {
  const { navigateResource } = useResourceInspector();
  const keys = columns[collection];
  const unavailable = state === "denied" || state === "unavailable";
  const disabled = loading || !!error || unavailable;
  const tableColumns = useMemo<TableColumn<CollectionItem>[]>(() => {
    const link = (label: string, reference: ResourceReference) => <Button label={label} size="sm" variant="ghost" isDisabled={disabled} onClick={() => { if (!disabled) navigateResource(reference); }} />;
    return [
      { key: "name", header: "Name", width: proportional(2), renderCell: item => link(item.reference.name, item.reference) },
      { key: "namespace", header: "Namespace", renderCell: item => item.reference.namespace ? link(item.reference.namespace, { kind: "namespaces", namespace: null, name: item.reference.namespace }) : <Text>N/A</Text> },
      ...keys.map(key => ({ key, header: labels[key] ?? key, renderCell: (item: CollectionItem) => {
        const value = item.columns[key];
        if (collection === "pods" && key === "node" && nodeName(value)) return link(value, { kind: "nodes", namespace: null, name: value });
        if (collection === "events" && key === "message" && value) return link(value, item.reference);
        return <Text maxLines={1}>{value || "N/A"}</Text>;
      } })),
      { key: "status", header: "Status", renderCell: item => <StatusBadge status={item.status} variant={collection === "events" && (item.columns.type || item.status).toLowerCase() === "warning" ? "warning" : undefined} /> },
    ];
  }, [collection, keys, navigateResource, disabled]);
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => `${status}: ${count}`).join(", ");
  }, [items]);
  return <VStack gap={2} aria-label={`${title(collection)} related resources`}>
    <Text as="h3" size="sm" weight="semibold">{title(collection)}</Text>
    {loading && <ContentLoading label={`Loading ${title(collection).toLowerCase()}…`} refreshing={items.length > 0} />}
    {error && <ContentError title={`${title(collection)} unavailable`} message={`${items.length ? "Retained results may be stale. " : ""}${error}`} retained={items.length > 0} />}
    {!loading && !error && state === "partial" && <ContentError title={`${title(collection)} incomplete`} message="Some related resources could not be read." retained />}
    {!loading && !error && state === "denied" && <ContentError title={`${title(collection)} unavailable`} message="Permission denied for this related collection." />}
    {!loading && !error && state === "unavailable" && <ContentError title={`${title(collection)} unavailable`} message="The cluster did not provide this related collection." />}
    {!loading && (error || unavailable) && <Button label="Retry" size="sm" variant="secondary" onClick={onRetry} />}
    {!loading && !error && state === "complete" && items.length === 0 && <Text>No related resources.</Text>}
    {collection === "pods" && !disabled && (state === "complete" || state === "partial") && <Text size="sm">{`Pods Status (returned subset, ${state}): ${statusCounts || "No pods returned"}`}</Text>}
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
