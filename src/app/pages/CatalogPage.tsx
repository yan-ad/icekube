import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { CatalogForms } from "../catalog/CatalogForms";
import { useCatalog } from "../catalog/CatalogProvider";

type CatalogRow = { id: string; name: string; category: string; source: string; status: string; pinned: boolean };

export default function CatalogPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const selectedItem = useRouterState({ select: (state) => state.location.search.item });
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run } = useCatalog();
  const [query, setQuery] = useState("");
  const [remove, setRemove] = useState<CatalogRow | null>(null);
  const kind = pathname === "/catalog/clusters" ? "Clusters" : pathname === "/catalog/web-links" ? "Web Links" : "All Categories";
  const rows: CatalogRow[] = [
    ...(snapshot?.clusters ?? []).map((item) => ({ ...item, category: "Clusters", status: "Disconnected" })),
    ...(snapshot?.webLinks ?? []).map((item) => ({ ...item, category: "Web Links", source: item.url, status: "Not checked" })),
  ].filter((item) => kind === "All Categories" || item.category === kind)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const filtered = rows.filter((item) => (!selectedItem || item.id === selectedItem)
    && `${item.name} ${item.category} ${item.source}`.toLowerCase().includes(query.toLowerCase()));
  const columns: TableColumn<CatalogRow>[] = [
    { key: "name", header: "Name" },
    ...(kind === "All Categories" ? [{ key: "category", header: "Category" }] : []),
    { key: "source", header: kind === "Web Links" ? "URL" : "Source" },
    { key: "status", header: "Status" },
    { key: "actions", header: "Actions", renderCell: (item) => <HStack gap={1} wrap="wrap">
      <Button label={item.pinned ? "Unpin" : "Pin"} aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.name}`} aria-pressed={item.pinned} variant="ghost" isDisabled={busy} onClick={() => void run("catalog_set_pin", { id: item.id, pinned: !item.pinned })} />
      <Button label="Remove" aria-label={`Remove ${item.name}`} variant="ghost" isDisabled={busy} onClick={() => setRemove(item)} />
    </HStack> },
  ];
  const emptyTitle = loading ? "Loading catalog…" : !available ? "Desktop engine required" : !snapshot ? "Catalog unavailable" : selectedItem || (query && rows.length) ? "No matching items" : kind === "Clusters" ? "No clusters imported" : kind === "Web Links" ? "No web links saved" : "Your catalog is empty";

  return <>
    <Layout height="fill"
      header={<LayoutHeader hasDivider><HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
        <Heading level={1}>{kind}</Heading><CatalogForms />
      </HStack></LayoutHeader>}
      content={<LayoutContent padding={6}><VStack gap={4}>
        <Text type="supporting">Imported clusters are disconnected. Web links are not contacted. No kubeconfig discovery, credentials, or network access runs automatically.</Text>
        {error && <Text role="alert">{error}{snapshot ? " Previously loaded records are still shown." : ""}</Text>}
        {loading && <Text role="status">Loading catalog…</Text>}
        <TextInput label="Filter catalog" value={query} onChange={setQuery} hasClear placeholder="Filter by name, category, or source" />
        {selectedItem && <HStack gap={2} vAlign="center" wrap="wrap"><Text type="supporting">Showing the selected pinned item.</Text><Button label={`Show all ${kind.toLowerCase()}`} variant="ghost" onClick={() => void navigate({ to: pathname, search: {} })} /></HStack>}
        <Table data={filtered} columns={columns} idKey="id" density="compact" aria-label={kind === "Web Links" ? "Web links" : kind} aria-busy={busy}
          emptyState={<VStack padding={6} gap={2} hAlign="center"><Heading level={2}>{emptyTitle}</Heading>
            <Text color="secondary" justify="center">{query && rows.length ? "Try a different filter." : !available ? "Open the desktop app to import cluster contexts and save web links." : "Import a kubeconfig or add a web link to populate the catalog."}</Text>
          </VStack>} />
      </VStack></LayoutContent>} />
    <Dialog isOpen={remove !== null} onOpenChange={(open) => { if (!open && !busy) setRemove(null); }} purpose={busy ? "required" : "form"}>
      <Layout header={<DialogHeader title={`Remove ${remove?.name ?? "item"}?`} onOpenChange={busy ? undefined : () => setRemove(null)} />}
        content={<LayoutContent><VStack gap={3}><Text as="p">Remove this item and its pin from Icekube's local catalog only? The kubeconfig, cluster, and website will not be changed.</Text>{error && <Text role="alert">{error}</Text>}</VStack></LayoutContent>}
        footer={<LayoutFooter hasDivider><HStack gap={2} hAlign="end"><Button label="Cancel" variant="ghost" isDisabled={busy} onClick={() => setRemove(null)} />
          <Button label="Remove from catalog" isDisabled={busy} onClick={() => { if (remove) void run("catalog_remove", { id: remove.id }).then((saved) => { if (saved) setRemove(null); }); }} />
        </HStack></LayoutFooter>} />
    </Dialog>
  </>;
}
