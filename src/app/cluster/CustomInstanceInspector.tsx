import { Button } from "@astryxdesign/core/Button";
import type { CustomInstance, CustomInstancePage } from "./customResourcesApi";
import { useResourceInspector } from "./ResourceInspector";

export function CustomInstanceInspector({ item, page }: { item: CustomInstance; page: CustomInstancePage }) {
  const { openSummary } = useResourceInspector();
  return <Button label={item.name} size="sm" variant="ghost" onClick={() => openSummary({
    title: `${page.kind}:${item.name}`,
    facts: [
      { label: "Snapshot", value: "Metadata-only inventory snapshot, not live details. This captured snapshot does not update when the inventory refreshes. Select the row again to capture its current inventory metadata." },
      { label: "Captured", value: new Date(page.fetchedAt).toLocaleString() },
      { label: "Kind", value: page.kind },
      { label: "Name", value: item.name },
      { label: "Namespace", value: item.namespace ?? "Cluster-scoped" },
      { label: "Created", value: item.createdAt ?? "Unknown" },
      { label: "UID", value: item.uid },
      { label: "Resource version", value: "Not included in the inventory snapshot" },
      { label: "Label count", value: String(item.labelCount) },
      { label: "Labels", value: "Label values are not included in the inventory snapshot" },
      { label: "Definition", value: page.target.definitionName },
      { label: "Definition UID", value: page.target.definitionUid },
      { label: "API group", value: page.group },
      { label: "API version", value: page.version },
      { label: "Scope", value: page.namespaced ? "Namespaced" : "Cluster" },
      { label: "Coverage", value: page.truncated ? "Partial inventory snapshot" : "This inventory page only" },
    ],
  })} />;
}
