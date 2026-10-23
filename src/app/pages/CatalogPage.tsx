import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { IconPin, IconPinnedOff, IconTrash } from "@tabler/icons-react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import {
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import {
  Table,
  proportional,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError } from "../catalog/api";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { RecordIcon, kindIcons, type CatalogKind } from "../catalog/RecordIcon";

type CatalogRow = {
  id: string;
  name: string;
  category: CatalogKind;
  source: string;
  labels: string[];
  color: string;
  status: string;
  pinned: boolean;
  url?: string;
};

export default function CatalogPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const selectedItem = useRouterState({
    select: (state) => state.location.search.item,
  });
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run } = useCatalog();
  const [query, setQuery] = useState("");
  const [remove, setRemove] = useState<CatalogRow | null>(null);
  const kind =
    pathname === "/catalog/clusters"
      ? "Clusters"
      : pathname === "/catalog/web-links"
        ? "Web Links"
        : "All Categories";
  const rows: CatalogRow[] = [
    ...(snapshot?.clusters ?? []).map((item) => ({
      ...item,
      category: "Clusters" as const,
      status: "Disconnected",
    })),
    ...(snapshot?.webLinks ?? []).map((item) => ({
      ...item,
      category: "Web Links" as const,
      status: "Not checked",
    })),
  ]
    .filter((item) => kind === "All Categories" || item.category === kind)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const filtered = rows.filter(
    (item) =>
      (!selectedItem || item.id === selectedItem) &&
      `${item.name} ${item.category} ${item.source} ${item.labels.join(" ")} ${item.url ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const columns: TableColumn<CatalogRow>[] = [
    {
      key: "name",
      header: "Name",
      width: proportional(2),
      renderCell: (item) => (
        <HStack gap={2} vAlign="center">
          <RecordIcon kind={item.category} color={item.color} />
          <VStack gap={1}>
            <Text>{item.name}</Text>
            {item.url && (
              <Text type="supporting" style={{ overflowWrap: "anywhere" }}>
                {item.url}
              </Text>
            )}
          </VStack>
        </HStack>
      ),
    },
    {
      key: "category",
      header: "Kind",
      width: proportional(1.3),
      renderCell: (item) => (
        <HStack gap={2} vAlign="center">
          <Icon icon={kindIcons[item.category]} size="sm" />
          <Text>{item.category}</Text>
        </HStack>
      ),
    },
    { key: "source", header: "Source", width: proportional(1) },
    {
      key: "labels",
      header: "Labels",
      width: proportional(1.7),
      renderCell: (item) =>
        item.labels.length ? (
          <VStack gap={1}>
            {item.labels.map((label) => (
              <Text
                key={label}
                type="supporting"
                style={{ overflowWrap: "anywhere" }}
              >
                {label}
              </Text>
            ))}
          </VStack>
        ) : (
          <Text color="secondary">—</Text>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: proportional(1.3),
      renderCell: (item) => <Badge variant="neutral" label={item.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      width: proportional(1.5),
      renderCell: (item) => (
        <HStack gap={1} wrap="wrap">
          <IconButton
            label={item.pinned ? "Unpin" : "Pin"}
            aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.name}`}
            tooltip={item.pinned ? 'Unpin from Sidebar' : 'Pin to Sidebar'}
            aria-pressed={item.pinned}
            icon={<Icon icon={item.pinned ? IconPinnedOff : IconPin} />}
            variant="ghost"
            isDisabled={busy}
            onClick={() =>
              void run("catalog_set_pin", { id: item.id, pinned: !item.pinned })
            }
          />
          <IconButton
            tooltip="Remove this config"
            label="Remove"
            aria-label={`Remove ${item.name}`}
            variant="destructive"
            icon={<Icon icon={IconTrash} />}
            isDisabled={busy}
            onClick={() => setRemove(item)}
          />
        </HStack>
      ),
    },
  ];
  const emptyTitle = loading
    ? "Loading catalog…"
    : !available
      ? "Desktop engine required"
      : !snapshot
        ? "Catalog unavailable"
        : selectedItem || (query && rows.length)
          ? "No matching items"
          : kind === "Clusters"
            ? "No clusters imported"
            : kind === "Web Links"
              ? "No web links saved"
              : "Your catalog is empty";

  return (
    <>
      <Layout
        height="fill"
        content={
          <LayoutContent padding={6}>
            <VStack gap={4}>
              <VisuallyHidden><Heading level={1}>{kind}</Heading></VisuallyHidden>
              {error && (
                <Text role="alert">
                  {error}
                  {snapshot
                    ? " Previously loaded records are still shown."
                    : ""}
                </Text>
              )}
              {loading && <Text role="status">Loading catalog…</Text>}
              {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved records are kept. Use Refresh to retry.</Text>}
              <TextInput
                label="Filter catalog"
                value={query}
                onChange={setQuery}
                hasClear
                placeholder="Filter by name, kind, source, or label"
              />
              {selectedItem && (
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="supporting">
                    Showing the selected pinned item.
                  </Text>
                  <Button
                    label={`Show all ${kind.toLowerCase()}`}
                    variant="ghost"
                    onClick={() => void navigate({ to: pathname, search: {} })}
                  />
                </HStack>
              )}
              <Table
                data={filtered}
                columns={columns}
                idKey="id"
                density="compact"
                aria-label={kind === "Web Links" ? "Web links" : kind}
                aria-busy={busy}
                emptyState={
                  <VStack padding={6} gap={2} hAlign="center">
                    <Heading level={2}>{emptyTitle}</Heading>
                    <Text color="secondary" justify="center">
                      {query && rows.length
                        ? "Try a different filter."
                        : !available
                          ? "Open the desktop app to import cluster contexts and save web links."
                          : "Import a kubeconfig or add a web link to populate the catalog."}
                    </Text>
                  </VStack>
                }
              />
            </VStack>
          </LayoutContent>
        }
      />
      <Dialog
        isOpen={remove !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null);
        }}
        purpose={busy ? "required" : "form"}
      >
        <Layout
          header={
            <DialogHeader
              title={`Remove ${remove?.name ?? "item"}?`}
              onOpenChange={busy ? undefined : () => setRemove(null)}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={3}>
                <Text as="p">
                  Remove this item and its pin from Icekube's local catalog
                  only? The kubeconfig, cluster, and website will not be
                  changed.
                </Text>
                {remove?.category === "Clusters" &&
                  remove.labels.includes("file=~/.kube/config") && (
                    <Text as="p">
                      This context will return on the
                      next catalog load or Refresh while it remains in
                      ~/.kube/config.
                    </Text>
                  )}
                {error && <Text role="alert">{error}</Text>}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button
                  label="Cancel"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => setRemove(null)}
                />
                <Button
                  label="Remove from catalog"
                  isDisabled={busy}
                  onClick={() => {
                    if (remove)
                      void run("catalog_remove", { id: remove.id }).then(
                        (saved) => {
                          if (saved) setRemove(null);
                        },
                      );
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </>
  );
}
