import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { StatusBadge } from "../cluster/StatusBadge";
import { Icon } from "@astryxdesign/core/Icon";
import { IconPin, IconPinnedOff, IconSearch, IconTrash } from "@tabler/icons-react";
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
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { ContentLoading } from "../components/ContentLoading";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCatalog } from "../catalog/CatalogProvider";
import { catalogError } from "../catalog/api";
import { CatalogForms } from "../catalog/CatalogForms";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { RecordIcon, kindIcons, type CatalogKind } from "../catalog/RecordIcon";
import { TableActionOverlay, TableToolbar, tableViewport } from "../cluster/TableToolbar";

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

const CatalogTable = memo(Table) as typeof Table;

export default function CatalogPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const selectedItem = useRouterState({
    select: (state) => state.location.search.item,
  });
  const navigate = useNavigate();
  const { snapshot, loading, busy, error, available, run, openWebLink, connectionStates, refreshConnectionStates } = useCatalog();
  const hasRuntimeState = Object.values(connectionStates).some(status => status !== "disconnected");
  useEffect(() => {
    if (!hasRuntimeState || !available) return;
    const refresh = () => { if (document.visibilityState === "visible") void refreshConnectionStates(); };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [hasRuntimeState, available, refreshConnectionStates]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [remove, setRemove] = useState<CatalogRow | null>(null);
  const kind =
    pathname === "/catalog/clusters"
      ? "Clusters"
      : pathname === "/catalog/web-links"
        ? "Web Links"
        : "All Categories";
  const rows = useMemo<CatalogRow[]>(() => [
    ...(snapshot?.clusters ?? []).map((item) => ({
      ...item,
      category: "Clusters" as const,
      status: ({ disconnected: "Disconnected", connecting: "Connecting…", connected: "Connected", error: "Connection error", disconnecting: "Disconnecting…", unknown: "Unknown" })[connectionStates[item.id] ?? item.status],
    })),
    ...(snapshot?.webLinks ?? []).map((item) => ({
      ...item,
      category: "Web Links" as const,
      status: "Not checked",
    })),
  ]
    .filter((item) => kind === "All Categories" || item.category === kind)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [snapshot, kind, connectionStates]);
  const searchable = useMemo(() => rows.map(item => ({ item, text:
    `${item.name} ${item.category} ${item.source} ${item.labels.join(" ")} ${item.url ?? ""}`.toLowerCase(),
  })), [rows]);
  const needle = deferredQuery.toLowerCase();
  const filtered = useMemo(() => searchable.filter(
    ({ item, text }) =>
      (!selectedItem || item.id === selectedItem) && text.includes(needle),
  ).map(({ item }) => item), [searchable, selectedItem, needle]);
  const activate = useCallback((item: CatalogRow) => {
    if (busy) return;
    if (item.category === "Clusters") void navigate({ to: "/cluster/$clusterId", params: { clusterId: item.id }, search: {} });
    else void openWebLink(item.id);
  }, [busy, navigate, openWebLink]);
  const activation = useMemo<TablePlugin<CatalogRow>>(() => ({
    transformBodyRow: (props, item) => ({ ...props, htmlProps: {
      ...props.htmlProps,
      tabIndex: 0,
      "aria-label": `Open ${item.category === "Clusters" ? "cluster" : "web link"} ${item.name}`,
      "aria-disabled": busy,
      style: { ...props.htmlProps.style, cursor: busy ? "wait" : "pointer" },
      onClick: (event) => {
        if (!(event.target as Element).closest("button, a, input, select, textarea, [role='button']")) activate(item);
      },
      onKeyDown: (event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          activate(item);
        }
      },
    } }),
  }), [busy, activate]);
  const columns = useMemo<TableColumn<CatalogRow>[]>(() => [
    {
      key: "name",
      header: "Name",
      width: proportional(2),
      renderCell: (item) => (
        <HStack gap={2} vAlign="center">
          <RecordIcon kind={item.category} color={item.color} />
          <VStack gap={1}>
            <Text color="accent">{item.name}</Text>
            {item.url && (
              <Text type="supporting" color="accent" style={{ overflowWrap: "anywhere" }}>
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
      renderCell: (item) => <StatusBadge status={item.status} variant={item.status === "Connection error" ? "error" : item.status.startsWith("Connecting") || item.status.startsWith("Disconnecting") ? "warning" : undefined} />,
    },
    {
      key: "actions",
      header: "Actions",
      width: proportional(1.5),
      renderCell: (item) => (
        <HStack gap={1} wrap="wrap">
          <IconButton
            label={`${item.pinned ? "Unpin" : "Pin"} ${item.name}`}
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
            label={`Remove ${item.name}`}
            variant="destructive"
            icon={<Icon icon={IconTrash} />}
            isDisabled={busy}
            onClick={() => setRemove(item)}
          />
        </HStack>
      ),
    },
  ], [busy, run]);
  const emptyTitle = loading
    ? "Loading catalog…"
    : !available
      ? "Desktop engine required"
      : !snapshot
        ? "Catalog unavailable"
        : selectedItem || (deferredQuery && rows.length)
          ? "No matching items"
          : kind === "Clusters"
            ? "No clusters imported"
            : kind === "Web Links"
              ? "No web links saved"
              : "Your catalog is empty";
  const plugins = useMemo(() => ({ activation, viewport: tableViewport<CatalogRow>() }), [activation]);
  const emptyState = useMemo(() => <VStack padding={6} gap={2} hAlign="center">
    <Heading level={2}>{emptyTitle}</Heading>
    <Text color="secondary" justify="center">{deferredQuery && rows.length ? "Try a different filter." : !available
      ? "Open the desktop app to import cluster contexts and save web links."
      : "Import a kubeconfig or add a web link to populate the catalog."}</Text>
  </VStack>, [emptyTitle, !!deferredQuery, rows.length, available]);

  return (
    <>
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0} isScrollable={false}>
            <VStack gap={0} style={{ position: "relative", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <VisuallyHidden><Heading level={1}>{kind}</Heading></VisuallyHidden>
              <TableToolbar label="Catalog" count={snapshot ? `${filtered.length} items` : loading ? undefined : "Unavailable"}>
                <TextInput
                  label="Filter catalog"
                  isLabelHidden
                  value={query}
                  onChange={setQuery}
                  hasClear
                  size="sm"
                  startIcon={IconSearch}
                  width="min(17rem, 100%)"
                  placeholder="Filter catalog…"
                />
              <TableActionOverlay label="Catalog actions"><CatalogForms /></TableActionOverlay>
              </TableToolbar>
              <ContentLoading label="Loading catalog…" refreshing active={!!snapshot && (loading || busy)} />
              {error && (
                <Text role="alert">
                  {error}
                  {snapshot
                    ? " Previously loaded records are still shown."
                    : ""}
                </Text>
              )}
              {loading && !snapshot && <ContentLoading label="Loading catalog…" />}
              {snapshot?.discoveryError && <Text role="alert">Could not refresh file=~/.kube/config. {catalogError(snapshot.discoveryError)} Previously saved records are kept. Use Refresh to retry.</Text>}
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
              {!(loading && !snapshot) && <CatalogTable
                data={filtered}
                columns={columns}
                idKey="id"
                density="compact"
                hasHover
                plugins={plugins}
                aria-label={kind === "Web Links" ? "Web links" : kind}
                aria-busy={busy}
                emptyState={emptyState}
              />}
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
