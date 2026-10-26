import { VStack } from "@astryxdesign/core/Stack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { ResourceItem } from "./api";
import type { Usage } from "./nodeContract";

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
function age(value: string | null, now: number): string {
  if (!value) return "N/A";
  const elapsed = now - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "N/A";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 48 * 3600) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function NodesTable({ items, loading, filtered, now }: { items: ResourceItem[]; loading: boolean; filtered: boolean; now: number }) {
  const columns: TableColumn<ResourceItem>[] = [
    { key: "name", header: "Name", width: proportional(2), renderCell: (item) => <Text maxLines={1}>{item.name}</Text> },
    { key: "cpu", header: "CPU", width: proportional(1), renderCell: (item) => <UsageCell name={item.name} resource="CPU" usage={item.node?.cpu} /> },
    { key: "memory", header: "Memory", width: proportional(1.2), renderCell: (item) => <UsageCell name={item.name} resource="memory" usage={item.node?.memory} /> },
    { key: "disk", header: "Disk", renderCell: (item) => <Tooltip content={`Disk usage unavailable${item.node?.diskAllocatable ? `; allocatable: ${item.node.diskAllocatable}` : ""}`}><Text color="secondary">N/A</Text></Tooltip> },
    { key: "roles", header: "Roles", width: proportional(1), renderCell: (item) => <Text maxLines={1}>{item.node?.roles.join(", ") || "—"}</Text> },
    { key: "taints", header: "Taints", renderCell: (item) => <Text hasTabularNumbers>{item.node?.taints ?? "N/A"}</Text> },
    { key: "version", header: "Version", width: proportional(1.1), renderCell: (item) => <Text maxLines={1}>{item.node?.version ?? "N/A"}</Text> },
    { key: "internalIp", header: "Internal IP", width: proportional(1.1), renderCell: (item) => <Text maxLines={1}>{item.node?.internalIps.join(", ") || "N/A"}</Text> },
    { key: "age", header: "Age", renderCell: (item) => <Tooltip content={item.createdAt ? `Created ${item.createdAt}` : "Creation time unavailable"}><Text hasTabularNumbers>{age(item.createdAt, now)}</Text></Tooltip> },
    { key: "schedulable", header: "Schedulable", width: proportional(1), renderCell: (item) => <Text>{item.node ? item.node.schedulable ? "True" : "False" : "N/A"}</Text> },
    { key: "conditions", header: "Conditions", width: proportional(2), renderCell: (item) => {
      const node = item.node;
      if (!node?.conditions.length) return <Text>{item.status}</Text>;
      return <Text maxLines={1}>{node.conditions.map((condition) =>
        condition.type === "Ready" && condition.status === "True" ? "Ready" : `${condition.type}: ${condition.status}`).join(" · ")}</Text>;
    } },
  ];
  return <Table data={items} columns={columns} idKey="name" density="compact" hasHover textOverflow="truncate"
    aria-label="Nodes" aria-busy={loading}
    emptyState={<VStack padding={6} gap={2}>
      <Text>{filtered ? "No nodes match your search." : "No nodes were returned."}</Text>
      <Text color="secondary">{filtered ? "Clear or change the search to see loaded nodes." : "Refresh to check again."}</Text>
    </VStack>} />;
}
