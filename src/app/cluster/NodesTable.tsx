import { memo, useMemo } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Table, pixel, type TableColumn, type TablePlugin } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { useResourceInspector } from "./ResourceInspector";
import { NodeConditionBadge, StatusBadge } from "./StatusBadge";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { ResourceItem } from "./api";
import type { NodeCondition, Usage } from "./nodeContract";
import { tableViewport } from "./TableToolbar";
import { resourceRowKey } from "./deleteApi";
import { ResourceAge } from "./ResourceAge";
const MemoTable = memo(Table) as typeof Table;

function cores(value: number): string {
  return value === 0 ? "0" : value < 0.01 ? "<0.01" : value.toFixed(value < 10 ? 2 : 1);
}
function bytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const unit = Math.max(0, index);
  return `${(value / 1024 ** unit).toFixed(1)} ${units[unit]}`;
}
function UsageCell({ usage, name, resource }: { usage: Usage | undefined; name: string; resource: "CPU" | "memory" }) {
  const total = usage?.allocatable ?? usage?.capacity ?? null;
  const used = usage?.used ?? null;
  const denominator = usage?.allocatable !== null && usage?.allocatable !== undefined ? "allocatable" : "capacity";
  const format = resource === "CPU" ? cores : bytes;
  const text = `${used === null ? "N/A" : format(used)} / ${total === null ? "N/A" : format(total)}`;
  const accessible = `${name} ${resource}: ${text}${resource === "CPU" ? " cores" : ""}, used / ${denominator}`;
  return <Tooltip content={accessible}><VStack gap={1} style={{ minWidth: 0 }}>
    {total !== null && total > 0 && used !== null && <ProgressBar label={`${name} ${resource}`} isLabelHidden
      value={used} max={total} variant={resource === "CPU" ? "accent" : "neutral"} formatValueLabel={() => accessible} />}
    <Text type="supporting" hasTabularNumbers maxLines={1}>{text}</Text>
  </VStack></Tooltip>;
}

export const NodesTable = memo(function NodesTable({ items, loading, filtered, selection, rowContext }: { items: ResourceItem[]; loading: boolean; filtered: boolean; selection?: TablePlugin<ResourceItem>; rowContext?: TablePlugin<ResourceItem> }) {
  const { openResource } = useResourceInspector();
  const conditionSummary = (item: ResourceItem) => {
    const conditions = item.node?.conditions ?? [];
    const ready = conditions.find(condition => condition.type === "Ready");
    const active = conditions.filter(condition => condition.type !== "Ready" && condition.status === "True");
    const visible: NodeCondition[] = [ready ?? { type: "Ready", status: "Unknown" }, ...active];
    const hiddenCount = conditions.length - active.length - (ready ? 1 : 0);
    return { visible, hiddenCount };
  };
  const conditionsWidth = useMemo(() => Math.max(250, ...items.map(item => 250 + (conditionSummary(item).visible.length - 1) * 200)), [items]);
  const columns = useMemo<TableColumn<ResourceItem>[]>(() => [
    { key: "name", header: "Name", width: pixel(280), renderCell: (item) => <Button label={item.name} variant="ghost" size="sm" onClick={() => openResource({ kind: "nodes", namespace: null, name: item.name, uid: item.uid })} /> },
    { key: "cpu", header: "CPU", width: pixel(150), renderCell: (item) => <UsageCell name={item.name} resource="CPU" usage={item.node?.cpu} /> },
    { key: "memory", header: "Memory", width: pixel(170), renderCell: (item) => <UsageCell name={item.name} resource="memory" usage={item.node?.memory} /> },
    { key: "disk", header: "Disk", width: pixel(140), renderCell: (item) => <Tooltip content={`Disk usage unavailable${item.node?.diskAllocatable ? `; allocatable: ${item.node.diskAllocatable}` : ""}`}><Text color="secondary">N/A</Text></Tooltip> },
    { key: "roles", header: "Roles", width: pixel(140), renderCell: (item) => <Text maxLines={1}>{item.node?.roles.join(", ") || "—"}</Text> },
    { key: "taints", header: "Taints", width: pixel(90), renderCell: (item) => <Text hasTabularNumbers>{item.node?.taints ?? "N/A"}</Text> },
    { key: "version", header: "Version", width: pixel(190), renderCell: (item) => <Text maxLines={1}>{item.node?.version ?? "N/A"}</Text> },
    { key: "internalIp", header: "Internal IP", width: pixel(190), renderCell: (item) => <Text maxLines={1}>{item.node?.internalIps.join(", ") || "N/A"}</Text> },
    { key: "age", header: "Age", width: pixel(180), renderCell: (item) => <Tooltip content={item.createdAt ? `Created ${item.createdAt}` : "Creation time unavailable"}><ResourceAge timestamp={item.createdAt} /></Tooltip> },
    { key: "schedulable", header: "Schedulable", width: pixel(130), renderCell: (item) => <StatusBadge status={item.node?.schedulable} variant={item.node?.schedulable === false ? "warning" : "neutral"} /> },
    { key: "conditions", header: "Conditions", width: pixel(conditionsWidth), renderCell: (item) => {
      const node = item.node;
      if (!node) return <StatusBadge status={item.status} />;
      const { visible, hiddenCount } = conditionSummary(item);
      return <HStack gap={1} style={{ minWidth: 0, whiteSpace: "nowrap" }}>
        {visible.map((condition) => <NodeConditionBadge key={condition.type} condition={condition} />)}
        {hiddenCount > 0 && <Tooltip content={`Open ${hiddenCount} additional node conditions`}>
          <Button label={`+${hiddenCount} conditions`} variant="ghost" size="sm" onClick={() => openResource({ kind: "nodes", namespace: null, name: item.name, uid: item.uid })} />
        </Tooltip>}
      </HStack>;
    } },
  ], [conditionsWidth, openResource]);
  const plugins = useMemo(() => ({ viewport: tableViewport<ResourceItem>(), ...(selection ? { selection } : {}), ...(rowContext ? { rowContext } : {}) }), [selection, rowContext]);
  const emptyFiltered = items.length === 0 && filtered;
  const emptyState = useMemo(() => <VStack padding={6} gap={2}>
    <Text>{emptyFiltered ? "No matching nodes on this page." : "No nodes were returned."}</Text>
    <Text color="secondary">{emptyFiltered ? "Try the next page if available, or clear or change the search." : "Refresh to check again."}</Text>
  </VStack>, [emptyFiltered]);
  return <MemoTable data={items} columns={columns} idKey={resourceRowKey} density="compact" hasHover textOverflow="truncate" style={tableStyle}
    aria-label="Nodes" aria-busy={loading} plugins={plugins} emptyState={emptyState} />;
});
const tableStyle = { minWidth: "100rem" };
