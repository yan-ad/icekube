import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { UsageBar } from "./UsageBar";
import { SupportingSection } from "./SupportingSection";
import { SectionInfo } from "./SectionInfo";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Card } from "@astryxdesign/core/Card";
import {
  cancelResources,
  connectionMessage,
  errorCode,
  loadResources,
  nextReadId,
  type ConnectionErrorCode,
  type ResourceItem,
  type ResourcePage,
  type ResourceRequest,
  type SessionRequest,
} from "./api";
import { useResourceInspector } from "./ResourceInspector";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { useAutoRefresh } from "./useAutoRefresh";
import { ResourceAge } from "./ResourceAge";

type Inventory = {
  page: ResourcePage | null;
  loading: boolean;
  error: ConnectionErrorCode | null;
  stale: boolean;
};
type Snapshot = { scope: string; nodes: Inventory; events: Inventory };
const inventory = (): Inventory => ({
  page: null,
  loading: true,
  error: null,
  stale: false,
});
const initial = (scope: string): Snapshot => ({
  scope,
  nodes: inventory(),
  events: inventory(),
});

export function aggregateUsage(
  page: ResourcePage | null,
  resource: "cpu" | "memory",
) {
  if (
    !page ||
    page.metrics !== "available" ||
    page.truncated ||
    page.continueToken ||
    page.items.length === 0
  )
    return null;
  const usages = page.items.map((item) => item.node?.[resource]);
  const denominator = usages.every(
    (usage) => usage?.allocatable != null && usage.allocatable > 0,
  )
    ? "allocatable"
    : "capacity";
  let used = 0,
    total = 0;
  for (const usage of usages) {
    const limit = usage?.[denominator];
    if (
      !usage ||
      usage.used === null ||
      !Number.isFinite(usage.used) ||
      usage.used < 0 ||
      limit == null ||
      !Number.isFinite(limit) ||
      limit <= 0
    )
      return null;
    used += usage.used;
    total += limit;
  }
  if (!Number.isFinite(used) || !Number.isFinite(total)) return null;
  return { used, total, denominator, percent: (used / total) * 100 };
}
function formatUsage(value: number, resource: "cpu" | "memory") {
  if (resource === "cpu") return `${value.toFixed(2)} cores`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}
function ResourceState({ label, state }: { label: string; state: Inventory }) {
  return (
    <>
      {state.loading && (
        <Text role="status" type="supporting">
          {state.page ? `Refreshing ${label}…` : `Loading ${label}…`}
        </Text>
      )}
      {state.stale && state.page && (
        <Text type="supporting">Retained {label} are stale.</Text>
      )}
      {state.error && (
        <Text role="alert" type="supporting">
          {connectionMessage(state.error)}
        </Text>
      )}
      {state.page && (state.page.truncated || state.page.continueToken) && (
        <Text type="supporting">
          Partial {label}: only the first page (up to 100 resources) is loaded.
        </Text>
      )}
    </>
  );
}
function Utilization({
  resource,
  state,
}: {
  resource: "cpu" | "memory";
  state: Inventory;
}) {
  const label = resource === "cpu" ? "CPU" : "Memory";
  const usage = aggregateUsage(state.page, resource);
  return (
    <Card>
      <Section>
        <VStack gap={3} as="section" aria-label={`${label} utilization`}>
          <Heading level={2}>{label}</Heading>
          {usage ? (
            <>
              <Text hasTabularNumbers>{usage.percent.toFixed(1)}% used</Text>
              <UsageBar
                label={`${label} utilization`}
                value={Math.min(usage.used, usage.total)}
                max={usage.total}
                formatValueLabel={() => `${usage.percent.toFixed(1)}% used`}
                resource={resource}
              />
              <Text type="supporting">
                {formatUsage(usage.used, resource)} /{" "}
                {formatUsage(usage.total, resource)} {usage.denominator}
              </Text>
            </>
          ) : (
            <Text type="supporting">
              {state.loading && !state.page
                ? "Waiting for node metrics."
                : `Current ${label} utilization unavailable. Complete node metrics and valid capacity are required.`}
            </Text>
          )}
          {!usage &&
            state.page &&
            state.page.items.length > 0 &&
            state.page.metrics === "available" && (
              <Text type="supporting">
                Partial utilization data: the loaded nodes or their metrics are
                incomplete.
              </Text>
            )}
          {state.page?.metrics && state.page.metrics !== "available" && (
            <Text type="supporting">Metrics Server: {state.page.metrics}.</Text>
          )}
          {state.stale && (
            <Text type="supporting">This utilization snapshot is stale.</Text>
          )}
        </VStack>
      </Section>
    </Card>
  );
}
function eventTime(item: ResourceItem) {
  for (const value of [item.columns.lastSeen, item.createdAt]) {
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return -Infinity;
}

export function ClusterOverview({ clusterId, sessionId }: SessionRequest) {
  const scope = JSON.stringify([clusterId, sessionId]);
  const [state, setState] = useState<Snapshot>(() => initial(scope));
  const [revision, setRevision] = useState(0);
  const previousScope = useRef(scope);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const current = state.scope === scope ? state : initial(scope);
  const busy = current.nodes.loading || current.events.loading;
  const auto = useAutoRefresh({ scope, interval: 30_000, busy, refresh });
  const { openRelated, openResource } = useResourceInspector();
  useRegisterWorkspaceRefresh({
    clusterId,
    section: "overview",
    enabled: !busy,
    refresh,
  });
  useEffect(() => {
    let disposed = false;
    let active: ResourceRequest | null = null;
    const sameScope = previousScope.current === scope;
    previousScope.current = scope;
    setState((value) =>
      sameScope && value.scope === scope
        ? {
            scope,
            nodes: {
              ...value.nodes,
              loading: true,
              error: null,
              stale: value.nodes.page !== null,
            },
            events: {
              ...value.events,
              loading: true,
              error: null,
              stale: value.events.page !== null,
            },
          }
        : initial(scope),
    );
    void (async () => {
      let failure: ConnectionErrorCode | undefined;
      for (const kind of ["nodes", "events"] as const) {
        if (disposed) return;
        active = {
          clusterId,
          sessionId,
          kind,
          readId: nextReadId(),
          ...(kind === "events" ? { status: "Warning" } : {}),
        };
        try {
          const page = await loadResources(active);
          active = null;
          if (disposed) return;
          if (
            page.items.length > 100 ||
            new Set(
              page.items.map((item) =>
                JSON.stringify([item.namespace, item.name]),
              ),
            ).size !== page.items.length
          )
            throw "invalidResponse";
          setState((value) =>
            value.scope !== scope
              ? value
              : {
                  ...value,
                  [kind]: { page, loading: false, error: null, stale: false },
                },
          );
        } catch (reason) {
          active = null;
          if (disposed) return;
          failure = errorCode(reason);
          setState((value) =>
            value.scope !== scope
              ? value
              : {
                  ...value,
                  [kind]: {
                    ...value[kind],
                    loading: false,
                    error: failure!,
                    stale: value[kind].page !== null,
                  },
                },
          );
        }
      }
      if (!disposed) auto.complete(failure);
    })();
    return () => {
      disposed = true;
      if (active) void cancelResources(active).catch(() => {});
    };
  }, [clusterId, sessionId, scope, revision]);
  const nodes = current.nodes,
    events = current.events;
  const nodeWarnings = (nodes.page?.items ?? []).flatMap((item) =>
    (item.node?.conditions ?? [])
      .filter((condition) => condition.status === "True" && !["Ready", "HostUpgrades", "SchedulingDisabled"].includes(condition.type))
      .map((condition) => ({
        id: JSON.stringify([item.name, condition.type]),
        item,
        condition: condition.type,
      })),
  );
  const eventRows = (events.page?.items ?? [])
    .filter((item) => (item.columns.type || item.status) === "Warning")
    .slice()
    .sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, 10)
    .map((item) => ({
      ...item,
      id: JSON.stringify([item.namespace, item.name]),
    }));
  return (
    <VStack
      gap={5}
      padding={4}
      style={{
        flex: "1 1 0",
        minHeight: 0,
        minWidth: 0,
        overflow: "auto",
        overflowWrap: "anywhere",
      }}
    >
      <HStack gap={2} vAlign="center" wrap="wrap"><Heading level={2}>Cluster overview</Heading>
      <SectionInfo label="About cluster overview">
        Current snapshot from Metrics Server. Reads are limited to one page of
        100 nodes and 100 warning events; updates run while this view is active.
        Historical charts unavailable: no Prometheus integration is configured.
        Metrics Server supplies current utilization, not a time series.
      </SectionInfo></HStack>
      <ResourceState label="nodes" state={nodes} />
      {nodes.page && (
        <HStack gap={4} wrap="wrap">
          <Text hasTabularNumbers>Nodes loaded: {nodes.page.items.length}</Text>
          <Text hasTabularNumbers>
            Ready nodes:{" "}
            {
              nodes.page.items.filter((item) =>
                item.node?.conditions.some(
                  (condition) =>
                    condition.type === "Ready" && condition.status === "True",
                ),
              ).length
            }
          </Text>
          <Text hasTabularNumbers>
            Nodes with metrics:{" "}
            {
              nodes.page.items.filter(
                (item) =>
                  item.node?.cpu.used != null && item.node?.memory.used != null,
              ).length
            }
          </Text>
        </HStack>
      )}
      {nodes.page?.items.length === 0 && <Text>No nodes returned.</Text>}
      <Grid columns={{ minWidth: 256, max: 2 }} gap={4}>
        <Utilization resource="cpu" state={nodes} />
        <Utilization resource="memory" state={nodes} />
      </Grid>
      <SupportingSection title="Node condition warnings" level={2} info={<SectionInfo label="About node condition warnings">
          Condition messages are not available. Events below are separate observations,
          not grouped or checked for recovery.
        </SectionInfo>}>
        <Text type="supporting">{nodes.page ? `Active warning conditions in the loaded node snapshot: ${nodeWarnings.length}.` : "Node warning coverage unavailable until nodes load."}</Text>
        <ResourceState label="nodes" state={nodes} />
        {nodeWarnings.length > 0 && <Table
          aria-label="Node condition warnings"
          density="compact"
          data={nodeWarnings}
          idKey="id"
          columns={[
            { key: "condition", header: "Condition", renderCell: ({ item, condition }) => <Button
              label={`${condition}: True`}
              variant="ghost"
              size="sm"
              onClick={() => openResource({ kind: "nodes", namespace: null, name: item.name, uid: item.uid })}
            /> },
            { key: "node", header: "Node", renderCell: ({ item }) => item.name },
          ]}
        />}
      </SupportingSection>
      <SupportingSection title="Latest warning events" level={2} info={<SectionInfo label="About warning event ordering">
          Latest 10 within the loaded warning events, ordered by last occurrence
          with creation time as fallback. This is not a cluster-wide
          latest-events guarantee. Age is since that occurrence.
        </SectionInfo>}>
        <ResourceState label="warning events" state={events} />
        {events.page && eventRows.length === 0 && (
          <Text>
            No warning events returned
            {events.page.truncated || events.page.continueToken
              ? " in the loaded page"
              : ""}
            .
          </Text>
        )}
        {eventRows.length > 0 && (
          <Table
            aria-label="Latest warning events"
            density="compact"
            data={eventRows}
            idKey="id"
            columns={[
              {
                key: "message",
                header: "Event message",
                renderCell: (item) => item.columns.message ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    label={item.columns.message}
                    style={{ color: "var(--color-text-red)" }}
                    onClick={() => openRelated(
                      {
                        kind: "events",
                        namespace: item.namespace,
                        name: item.name,
                        uid: item.uid,
                      },
                      "involvedObject",
                    )}
                  />
                ) : "Unknown",
              },
              {
                key: "involvedObject",
                header: "Involved object",
                renderCell: (item) =>
                  item.columns.involvedObject ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      label={item.columns.involvedObject}
                      onClick={() =>
                        openRelated(
                          {
                            kind: "events",
                            namespace: item.namespace,
                            name: item.name,
                            uid: item.uid,
                          },
                          "involvedObject",
                        )
                      }
                    />
                  ) : (
                    "Unknown"
                  ),
              },
              {
                key: "namespace",
                header: "Namespace",
                renderCell: (item) =>
                  item.namespace ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      label={item.namespace}
                      onClick={() =>
                        openRelated(
                          {
                            kind: "events",
                            namespace: item.namespace,
                            name: item.name,
                            uid: item.uid,
                          },
                          "namespace",
                        )
                      }
                    />
                  ) : (
                    "Unknown"
                  ),
              },
              { key: "age", header: "Age", renderCell: (item) => <ResourceAge timestamp={eventTime(item)} fallback="Unknown" /> },
              {
                key: "source",
                header: "Source",
                renderCell: (item) => item.columns.source || "Unknown",
              },
              {
                key: "count",
                header: "Count",
                renderCell: (item) => item.columns.count || "Unknown",
              },
            ]}
          />
        )}
      </SupportingSection>
    </VStack>
  );
}
