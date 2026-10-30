import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Table, useTableSortable, type TableSortState } from "@astryxdesign/core/Table";
import { Icon } from "@astryxdesign/core/Icon";
import { IconSquareFilled } from "@tabler/icons-react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { SupportingSection } from "./SupportingSection";
import { SectionInfo } from "./SectionInfo";
import { Button } from "@astryxdesign/core/Button";
import { NamespaceSelector, useNamespaceSelection } from "./NamespaceScope";
import { useResourceInspector } from "./ResourceInspector";
import { useRowContextMenu } from "./RowContextMenu";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceItem, type ResourceRequest, type SessionRequest } from "./api";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { useAutoRefresh } from "./useAutoRefresh";
import { ContentLoading } from "../components/ContentLoading";
import { ResourceAge } from "./ResourceAge";

const MAX_PAGES = 5;
const MAX_RESOURCES = 500;
const MAX_EVENTS = 10;
const MAX_EVENT_PAGES = 20;
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
type Status = "Running" | "Pending" | "Failed" | "Succeeded" | "Scheduled" | "Suspended" | "Terminating" | "Unknown";
const colors: Record<Status, string> = {
  Running: "var(--color-success)", Succeeded: "var(--color-success)", Scheduled: "var(--color-success)",
  Pending: "var(--color-warning)", Suspended: "var(--color-warning)", Terminating: "var(--color-text-secondary)",
  Failed: "var(--color-error)", Unknown: "var(--color-text-secondary)",
};
function count(value: string | undefined) { return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }

export function workloadStatus(kind: WorkloadKind, item: ResourceItem): Status {
  const { status, columns } = item;
  if (kind === "pods") {
    if (columns.health === "terminating" || status === "Terminating") return "Terminating";
    if (status === "Succeeded" || columns.health === "completed") return "Succeeded";
    if (["Failed", "Evicted", "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull"].includes(status)) return "Failed";
    if (status === "Pending") return "Pending";
    if (status === "Running") return "Running";
    return "Unknown";
  }
  if (kind === "cronJobs") return columns.suspend === "true" ? "Suspended" : columns.schedule ? "Scheduled" : "Unknown";
  if (kind === "jobs") {
    if (status === "Completed" || status === "Complete" || status === "Succeeded") return "Succeeded";
    if (status === "Failed") return "Failed";
    if (columns.suspend === "true") return "Suspended";
    const desired = count(columns.desiredCompletions), succeeded = count(columns.completions);
    if (desired !== null && desired > 0 && succeeded !== null && succeeded >= desired) return "Succeeded";
    if ((count(columns.active) ?? 0) > 0) return "Running";
    return "Unknown";
  }
  const desired = count(columns.desired), ready = count(columns.ready);
  if (desired === null) return "Unknown";
  // Kubernetes omits zero replica counters. An omitted ready count is not a missing desired count.
  return (ready ?? 0) >= desired ? "Running" : "Pending";
}

type EventSortKey = "createdAt" | "lastSeen" | "count" | "namespace" | "type" | "message" | "involvedObject" | "source";
function eventSortValue(item: ResourceItem, key: string): string | number | null {
  if (key === "createdAt" || key === "lastSeen") {
    const value = key === "createdAt" ? item.createdAt : item.columns.lastSeen;
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? time : null;
  }
  if (key === "count") return count(item.columns.count);
  if (key === "namespace") return item.namespace;
  if (key === "type") return item.columns.type || item.status || null;
  return item.columns[key] || null;
}
export function compareEvents(a: ResourceItem, b: ResourceItem, key: EventSortKey, direction: "ascending" | "descending") {
  const left = eventSortValue(a, key), right = eventSortValue(b, key);
  if (left === null || right === null) return left === right ? a.name.localeCompare(b.name) : left === null ? 1 : -1;
  const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
  return (direction === "ascending" ? result : -result) || a.name.localeCompare(b.name);
}
function StatusDonut({ kind, label, items, href }: { kind: WorkloadKind; label: string; items: ResourceItem[]; href: string }) {
  const [hidden, setHidden] = useState<Status[]>([]);
  const segments = useMemo(() => {
    const counts = new Map<Status, number>();
    for (const item of items) { const status = workloadStatus(kind, item); counts.set(status, (counts.get(status) ?? 0) + 1); }
    return [...counts];
  }, [items, kind]);
  const visibleTotal = segments.reduce((total, [status, amount]) => total + (hidden.includes(status) ? 0 : amount), 0);
  let offset = 0;
  return <VStack gap={2}>
    <Link href={href} aria-label={`Open ${label}`} isStandalone>
      <svg width="6rem" height="6rem" viewBox="0 0 42 42" role="img" aria-label={`${label}: ${items.length} loaded${segments.map(([status, amount]) => `, ${status}: ${amount}`).join("")}`}>
        <circle cx="21" cy="21" r="15.5" fill="none" stroke="var(--color-border)" strokeWidth="5" />
        {segments.filter(([status]) => !hidden.includes(status)).map(([status, amount]) => {
          const length = amount / visibleTotal * 100;
          const segment = <circle key={status} cx="21" cy="21" r="15.5" fill="none" stroke={colors[status]} strokeWidth="5" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)"><title>{`${status}: ${amount} (${(amount / items.length * 100).toFixed(1)}%)`}</title></circle>;
          offset += length; return segment;
        })}
        <text x="21" y="22" textAnchor="middle" dominantBaseline="middle" fill="var(--color-text-primary)" fontSize="8">{items.length}</text>
      </svg>
    </Link>
    <VStack gap={1}>{segments.map(([status, amount]) => <Tooltip key={status} content={`${status}: ${amount} (${(amount / items.length * 100).toFixed(1)}%). Toggle chart segment.`}>
      <Button label={`${status}: ${amount}`} variant="ghost" size="sm" className="workload-status-toggle" aria-pressed={!hidden.includes(status)}
        icon={<Icon icon={IconSquareFilled} size="xsm" style={{ color: colors[status] }} />}
        style={{ textDecoration: hidden.includes(status) ? "line-through" : undefined }}
        onClick={() => setHidden(previous => previous.includes(status) ? previous.filter(value => value !== status) : [...previous, status])}><Text size="sm" hasTabularNumbers style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{status}: {amount}</Text></Button>
    </Tooltip>)}</VStack>
  </VStack>;
}

function InventoryState({ label, inventory }: { label: string; inventory: Inventory }) {
  return <>
    {inventory.loading && inventory.items === null && <Text role="status" type="supporting">Loading {label}…</Text>}
    {inventory.loading && inventory.stale && <Text role="status" type="supporting">Refreshing {label}… Retained data is stale.</Text>}
    {inventory.error && <Text role="alert" type="supporting">{inventory.items !== null ? "Retained data is stale. " : "Could not load this inventory. "}{connectionMessage(inventory.error)}</Text>}
    {inventory.partial && <Text type="supporting">Partial loaded counts; the bounded inventory is incomplete.</Text>}
    {inventory.items?.length === 0 && <Text type="supporting">No {label.toLowerCase()} returned{inventory.partial ? " in loaded pages" : ""}.</Text>}
  </>;
}

export function WorkloadsOverview({ clusterId, sessionId }: SessionRequest) {
  const [namespace, setNamespace] = useNamespaceSelection();
  const [revision, setRevision] = useState(0);
  const scope = JSON.stringify([clusterId, sessionId, namespace]);
  const [stateScope, setStateScope] = useState(scope);
  const [inventories, setState] = useState<Inventories>(initialState);
  const state = stateScope === scope ? inventories : initialState();
  const previousScope = useRef("");
  const { openRelated, openResource } = useResourceInspector();
  const [eventSort, setEventSort] = useState<TableSortState>([{ sortKey: "createdAt", direction: "descending" }]);
  const [eventPage, setEventPage] = useState(0);
  const eventSorting = useTableSortable<ResourceItem & { id: string }>({ sort: eventSort, onSortChange: next => { setEventSort(next); setEventPage(0); }, allowUnsortedState: false });
  useEffect(() => setEventPage(0), [scope]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const loading = Object.values(state).some(inventory => inventory.loading);
  const auto = useAutoRefresh({ scope, interval: 30_000, busy: loading, refresh });
  useRegisterWorkspaceRefresh({ clusterId, section: "workloads-overview", enabled: !loading, refresh });
  useEffect(() => {
    let disposed = false;
    let activeRequest: ResourceRequest | null = null;
    const sameScope = previousScope.current === scope; previousScope.current = scope;
    setStateScope(scope);
    setState(current => sameScope ? Object.fromEntries(Object.entries(current).map(([kind, inventory]) => [kind, { ...inventory, loading: true, error: null, stale: inventory.items !== null }])) as Inventories : initialState());
    const read = async () => {
      let failure: ConnectionErrorCode | undefined;
      // LIST reads share engine capacity. Only one overview page is in flight at a time.
      for (const kind of [...categories.map(category => category.kind), "events"] as const) {
        const items: ResourceItem[] = [], identities = new Set<string>(), tokens = new Set<string>();
        let token: string | null = null, partial = false;
        try {
          for (let pageNumber = 0; pageNumber < (kind === "events" ? MAX_EVENT_PAGES : MAX_PAGES); pageNumber += 1) {
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
            if (items.length >= (kind === "events" ? MAX_EVENT_PAGES * 100 : MAX_RESOURCES)) break;
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
  }, [clusterId, sessionId, namespace, scope, revision]);
  const events = state.events;
  const eventPageIndex = Math.min(eventPage, Math.max(0, Math.ceil((events.items?.length ?? 0) / MAX_EVENTS) - 1));
  const eventRows = useMemo(() => {
    const [{ sortKey, direction }] = eventSort;
    return (events.items ?? []).slice().sort((a, b) => compareEvents(a, b, sortKey as EventSortKey, direction))
      .slice(eventPageIndex * MAX_EVENTS, (eventPageIndex + 1) * MAX_EVENTS).map(item => ({ ...item, id: JSON.stringify([item.namespace, item.name]) }));
  }, [events.items, eventSort, eventPageIndex]);
  const eventMenu = useRowContextMenu({ clusterId, sessionId, rows: eventRows,
    scope: JSON.stringify([namespace, events.error]), rowKey: item => item.id, rowLabel: item => item.name,
    target: item => ({ type: "resource", reference: { kind: "events", namespace: item.namespace, name: item.name, uid: item.uid } }),
    actions: () => [{ action: "details" }],
    onAction: (item, action) => { if (action === "details") openResource({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid }); },
  });
  return <VStack gap={3} padding={4} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "auto", overflowWrap: "anywhere" }}>
    <VStack gap={0}><HStack gap={3} hAlign="between" vAlign="center" wrap="wrap"><HStack gap={2} vAlign="center"><Heading level={2}>Workloads overview</Heading><SectionInfo label="About workloads overview">Loaded resource counts, not live totals. Workloads are limited to {MAX_PAGES} pages ({MAX_RESOURCES} resources) per kind; events to {MAX_EVENT_PAGES} pages ({MAX_EVENT_PAGES * 100} resources). Updates run while this view is active. Lifecycle labels are separate from readiness. Controller states use observed replica counters, not child-Pod health.</SectionInfo></HStack><NamespaceSelector value={namespace} onChange={setNamespace} /></HStack>
    <ContentLoading
      label="Refreshing workloads overview…"
      refreshing
      active={loading && Object.values(state).some(inventory => inventory.items !== null)}
    /></VStack>
    <SupportingSection title="Workload status" level={2}><Grid columns={{ minWidth: 140, max: 7 }} gap={4}>{categories.map(category => <VStack key={category.kind} as="section" aria-label={`${category.label} inventory`} gap={2} padding={3} style={{ minWidth: 0 }}>
      <Link isStandalone href={`#/cluster/${encodeURIComponent(clusterId)}?section=${category.section}`}>{category.label}</Link>
      {state[category.kind].items !== null && <StatusDonut kind={category.kind} label={category.label} items={state[category.kind].items!} href={`#/cluster/${encodeURIComponent(clusterId)}?section=${category.section}`} />}
      <InventoryState label={category.label} inventory={state[category.kind]} />
    </VStack>)}</Grid></SupportingSection>
    <SupportingSection title="Latest events" level={2} info={<SectionInfo label="About event ordering">Showing {MAX_EVENTS} of {events.items?.length ?? 0} loaded events, sorted by the selected column before taking the displayed subset. Default: newest creation first. These are not cluster-wide latest events when the inventory is partial. Age is since creation; Last seen is since the last reported occurrence.</SectionInfo>}>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <Text type="supporting" hasTabularNumbers>{events.items ? `${eventRows.length} of ${events.items.length} loaded events` : "Waiting for events"}</Text>
        <HStack gap={2}><Button label="Previous events" size="sm" variant="ghost" isDisabled={eventPageIndex === 0} onClick={() => setEventPage(eventPageIndex - 1)} />
          <Text type="supporting" hasTabularNumbers>Page {eventPageIndex + 1}</Text>
          <Button label="Next events" size="sm" variant="ghost" isDisabled={(eventPageIndex + 1) * MAX_EVENTS >= (events.items?.length ?? 0)} onClick={() => setEventPage(eventPageIndex + 1)} /></HStack>
      </HStack>
      <InventoryState label="events" inventory={events} />
      {eventRows.length > 0 && <Table aria-label="Latest events" data={eventRows} idKey="id" density="compact" hasHover plugins={{ sort: eventSorting, rowContext: eventMenu }} columns={[
        { key: "type", header: "Type", sortable: true, renderCell: item => item.columns.type || item.status },
         { key: "message", header: "Message", sortable: true, renderCell: item => item.columns.message
           ? <Button label={item.columns.message} style={{ color: (item.columns.type || item.status) === "Warning" ? "var(--color-text-red)" : undefined }} size="sm" variant="ghost" onClick={() => openResource({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid })} />
           : "Unknown" },
         { key: "namespace", header: "Namespace", sortable: true, renderCell: item => item.namespace
           ? <Button label={item.namespace} aria-label={`Filter workloads to namespace ${item.namespace}`} size="sm" variant="ghost" onClick={() => setNamespace(item.namespace!)} /> : "Unknown" },
        { key: "involvedObject", header: "Involved object", sortable: true, renderCell: item => item.columns.involvedObject
          ? <Button label={item.columns.involvedObject} size="sm" variant="ghost" onClick={() => openRelated({ kind: "events", namespace: item.namespace, name: item.name, uid: item.uid }, "involvedObject")} /> : "Unknown" },
        { key: "source", header: "Source", sortable: true, renderCell: item => item.columns.source || "Unknown" },
        { key: "count", header: "Count", sortable: true, renderCell: item => count(item.columns.count) ?? "Unknown" },
        { key: "createdAt", header: "Age", sortable: true, renderCell: item => <ResourceAge timestamp={item.createdAt} fallback="Unknown" /> },
        { key: "lastSeen", header: "Last seen", sortable: true, renderCell: item => <ResourceAge timestamp={item.columns.lastSeen} fallback="Unknown" /> },
      ]} />}
    </SupportingSection>
  </VStack>;
}
