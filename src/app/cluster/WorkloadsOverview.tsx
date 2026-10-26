import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Table } from "@astryxdesign/core/Table";
import { Button } from "@astryxdesign/core/Button";
import { NamespaceSelector } from "./NamespaceScope";
import { useResourceInspector } from "./ResourceInspector";
import { useRowContextMenu } from "./RowContextMenu";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceRequest, type SessionRequest } from "./api";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { useAutoRefresh } from "./useAutoRefresh";

const MAX_PAGES = 5;
const MAX_RESOURCES = 500;
const MAX_EVENTS = 10;
const categories = [
  { kind: "pods", label: "Pods", section: "pods" },
  { kind: "deployments", label: "Deployments", section: "deployments" },
  { kind: "daemonSets", label: "DaemonSets", section: "daemon-sets" },
  { kind: "statefulSets", label: "StatefulSets", section: "stateful-sets" },
  { kind: "replicaSets", label: "ReplicaSets", section: "replica-sets" },
  { kind: "jobs", label: "Jobs", section: "jobs" },
  { kind: "cronJobs", label: "CronJobs", section: "cron-jobs" },
] as const;
type WorkloadKind = typeof categories[number]["kind"];
type Inventory = { items: ResourceItem[] | null; loading: boolean; error: ConnectionErrorCode | null; partial: boolean; stale: boolean };
type Inventories = Record<WorkloadKind | "events", Inventory>;
const emptyInventory = (): Inventory => ({ items: null, loading: true, error: null, partial: false, stale: false });
const initialState = () => Object.fromEntries([...categories.map(({ kind }) => kind), "events"].map(kind => [kind, emptyInventory()])) as Inventories;
type Status = "Ready" | "Not ready" | "Pending" | "Failed" | "Completed" | "Active" | "Suspended" | "Unknown";
const colors: Record<Status, string> = {
  Ready: "var(--color-success)", "Not ready": "var(--color-warning)", Pending: "var(--color-warning)",
  Failed: "var(--color-error)", Completed: "var(--color-success)", Active: "var(--color-text-secondary)",
  Suspended: "var(--color-warning)", Unknown: "var(--color-text-secondary)",
};
function count(value: string | undefined) { return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }

export function workloadStatus(kind: WorkloadKind, item: ResourceItem): Status {
  const { status, columns } = item;
  if (kind === "pods") {
    if (status === "Succeeded" || columns.health === "completed") return "Completed";
    if (status === "Failed" || ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull"].includes(status)) return "Failed";
    if (status === "Pending") return "Pending";
    if (columns.health === "healthy") return "Ready";
    if (columns.health === "warning" || columns.health === "terminating") return "Not ready";
    return "Unknown";
  }
  if (kind === "cronJobs") return columns.suspend === "true" ? "Suspended" : (count(columns.active) ?? 0) > 0 ? "Active" : "Unknown";
  if (kind === "jobs") {
    if (status === "Completed" || status === "Failed") return status;
    if (columns.suspend === "true") return "Suspended";
    const desired = count(columns.desiredCompletions), succeeded = count(columns.completions);
    if (desired !== null && desired > 0 && succeeded !== null && succeeded >= desired) return "Completed";
    if ((count(columns.active) ?? 0) > 0) return "Active";
    // Failed attempts alone do not prove that a Job has reached its terminal Failed condition.
    return "Unknown";
  }
  const desired = count(columns.desired), ready = count(columns.ready);
  if (desired === null || ready === null) return "Unknown";
  return ready >= desired ? "Ready" : "Not ready";
}

function eventTime(item: ResourceItem) {
  for (const value of [item.columns.lastSeen, item.createdAt]) {
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return -Infinity;
}
function age(value: string | null | undefined) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function StatusDonut({ kind, label, items }: { kind: WorkloadKind; label: string; items: ResourceItem[] }) {
  const segments = useMemo(() => {
    const counts = new Map<Status, number>();
    for (const item of items) { const status = workloadStatus(kind, item); counts.set(status, (counts.get(status) ?? 0) + 1); }
    return [...counts];
  }, [items, kind]);
  let offset = 0;
  return <VStack gap={2}>
    <svg width="6rem" height="6rem" viewBox="0 0 42 42" role="img" aria-label={`${label}: ${items.length} loaded${segments.map(([status, amount]) => `, ${status}: ${amount}`).join("")}`}>
      <circle cx="21" cy="21" r="15.5" fill="none" stroke="var(--color-border)" strokeWidth="5" />
      {segments.map(([status, amount]) => {
        const length = amount / items.length * 100;
        const segment = <circle key={status} cx="21" cy="21" r="15.5" fill="none" stroke={colors[status]} strokeWidth="5" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)" />;
        offset += length; return segment;
      })}
      <text x="21" y="22" textAnchor="middle" dominantBaseline="middle" fill="var(--color-text-primary)" fontSize="8">{items.length}</text>
    </svg>
    <HStack gap={2} wrap="wrap">{segments.map(([status, amount]) => <Text key={status} type="supporting" style={{ borderBlockEnd: `var(--border-width) solid ${colors[status]}` }}>{status}: {amount}</Text>)}</HStack>
  </VStack>;
}

function InventoryState({ label, inventory }: { label: string; inventory: Inventory }) {
  return <>
    {inventory.loading && inventory.items === null && <Text role="status" type="supporting">Loading {label}…</Text>}
    {inventory.error && <Text role="alert" type="supporting">{inventory.items !== null ? "Retained data is stale. " : "Could not load this inventory. "}{connectionMessage(inventory.error)}</Text>}
    {inventory.partial && <Text type="supporting">Partial loaded counts; the bounded inventory is incomplete.</Text>}
    {inventory.items?.length === 0 && <Text type="supporting">No {label.toLowerCase()} returned{inventory.partial ? " in loaded pages" : ""}.</Text>}
  </>;
}

export function WorkloadsOverview({ clusterId, sessionId }: SessionRequest) {
  const [namespace, setNamespace] = useState("");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Inventories>(initialState);
  const previousScope = useRef("");
  const { openRelated, openResource } = useResourceInspector();
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const loading = Object.values(state).some(inventory => inventory.loading);
  const auto = useAutoRefresh({ scope: JSON.stringify([clusterId, sessionId, namespace]), interval: 30_000, busy: loading, refresh });
  useRegisterWorkspaceRefresh({ clusterId, section: "workloads-overview", enabled: !loading, refresh });
  useEffect(() => {
    let disposed = false;
    let activeRequest: ResourceRequest | null = null;
    const scope = JSON.stringify([clusterId, sessionId, namespace]);
    const sameScope = previousScope.current === scope; previousScope.current = scope;
    setState(current => sameScope ? Object.fromEntries(Object.entries(current).map(([kind, inventory]) => [kind, { ...inventory, loading: true, error: null, stale: inventory.items !== null }])) as Inventories : initialState());
    const read = async () => {
      let failure: ConnectionErrorCode | undefined;
      // LIST reads share engine capacity. Only one overview page is in flight at a time.
      for (const kind of [...categories.map(category => category.kind), "events"] as const) {
        const items: ResourceItem[] = [], identities = new Set<string>(), tokens = new Set<string>();
        let token: string | null = null, partial = false;
        try {
          for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
            if (disposed) return;
            activeRequest = { clusterId, sessionId, kind, namespace: namespace || null, continueToken: token, readId: nextReadId() };
            const page = await loadResources(activeRequest); activeRequest = null;
            if (disposed) return;
            if (page.items.length > 100) throw "invalidResponse";
            for (const item of page.items) {
              const identity = JSON.stringify([item.namespace, item.name]);
              if (identities.has(identity)) throw "invalidResponse";
              identities.add(identity); items.push(item);
            }
            token = page.continueToken; partial = page.truncated || token !== null;
            if (items.length >= MAX_RESOURCES) break;
            if (!token) break;
            if (tokens.has(token)) throw "invalidResponse";
            tokens.add(token);
          }
          if (!disposed) setState(current => ({ ...current, [kind]: {
            items: JSON.stringify(current[kind].items) === JSON.stringify(items) ? current[kind].items : items,
            partial, loading: false, error: null, stale: false,
          } }));
        } catch (reason) {
          activeRequest = null;
          if (disposed) return;
          const code = errorCode(reason);
          if (!failure || ["timeout", "network", "busy", "connectionFailed"].includes(failure)) failure = code;
          setState(current => ({ ...current, [kind]: {
            ...current[kind], items: current[kind].items ?? (items.length ? items : null),
            partial: current[kind].items !== null ? current[kind].partial : items.length > 0,
            loading: false, error: errorCode(reason), stale: current[kind].items !== null || items.length > 0,
          } }));
        }
      }
      if (!disposed) auto.complete(failure);
    };
    void read();
    return () => { disposed = true; if (activeRequest) void cancelResources(activeRequest).catch(() => {}); };
  }, [clusterId, sessionId, namespace, revision]);
  const events = state.events;
  const eventRows = useMemo(() => (events.items ?? []).slice().sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, MAX_EVENTS).map(item => ({ ...item, id: JSON.stringify([item.namespace, item.name]) })), [events.items]);
  const eventMenu = useRowContextMenu({ clusterId, sessionId, rows: eventRows,
    scope: JSON.stringify([namespace, events.error]), rowKey: item => item.id, rowLabel: item => item.name,
    target: item => ({ type: "resource", reference: { kind: "events", namespace: item.namespace, name: item.name, uid: item.uid } }),
    actions: () => [{ action: "details" }],
    onAction: (item, action) => { if (action === "details") openResource({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid }); },
  });
  return <VStack gap={5} padding={4} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "auto", overflowWrap: "anywhere" }}>
    <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap"><Heading level={2}>Workloads overview</Heading><NamespaceSelector value={namespace} onChange={setNamespace} /></HStack>
    <Text type="supporting">Loaded resource counts, not live totals. Each kind is limited to {MAX_PAGES} pages ({MAX_RESOURCES} resources). Updates automatically while this view is active.</Text>
    <Grid columns={{ minWidth: 180, max: 7 }} gap={4}>{categories.map(category => <VStack key={category.kind} as="section" aria-label={`${category.label} inventory`} gap={2} padding={3} style={{ minWidth: 0, borderBlockEnd: "var(--border-width) solid var(--color-border)" }}>
      <Link isStandalone href={`#/cluster/${encodeURIComponent(clusterId)}?section=${category.section}`}>{category.label}</Link>
      {state[category.kind].items !== null && <StatusDonut kind={category.kind} label={category.label} items={state[category.kind].items!} />}
      <InventoryState label={category.label} inventory={state[category.kind]} />
    </VStack>)}</Grid>
    <VStack gap={3} style={{ minWidth: 0 }}>
      <Heading level={2}>Latest events</Heading>
      <Text type="supporting">Latest {MAX_EVENTS} within loaded events by last occurrence, falling back to creation time. These are not cluster-wide latest events. Age is since creation; Last seen is since the last reported occurrence.</Text>
      <InventoryState label="events" inventory={events} />
      {eventRows.length > 0 && <Table aria-label="Latest events" data={eventRows} idKey="id" density="compact" plugins={{ rowContext: eventMenu }} columns={[
        { key: "type", header: "Type", renderCell: item => item.columns.type || item.status },
        { key: "message", header: "Message", renderCell: item => item.columns.message || "Unknown" },
        { key: "namespace", header: "Namespace", renderCell: item => item.namespace
          ? <Button label={item.namespace} size="sm" variant="ghost" onClick={() => openRelated({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid }, "namespace")} /> : "Unknown" },
        { key: "involvedObject", header: "Involved object", renderCell: item => item.columns.involvedObject
          ? <Button label={item.columns.involvedObject} size="sm" variant="ghost" onClick={() => openRelated({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid }, "involvedObject")} /> : "Unknown" },
        { key: "source", header: "Source", renderCell: item => item.columns.source || "Unknown" },
        { key: "count", header: "Count", renderCell: item => count(item.columns.count) ?? "Unknown" },
        { key: "createdAt", header: "Age", renderCell: item => age(item.createdAt) },
        { key: "lastSeen", header: "Last seen", renderCell: item => age(item.columns.lastSeen) },
      ]} />}
    </VStack>
  </VStack>;
}
