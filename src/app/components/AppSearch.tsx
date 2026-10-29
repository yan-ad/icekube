import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { CommandPalette, CommandPaletteFooter, CommandPaletteInput, useCommandPaletteContext } from "@astryxdesign/core/CommandPalette";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { destinationPermission, usePermissions, usePermissionRevision } from "../cluster/PermissionProvider";
import { resourceView } from "../cluster/resourceViews";
import { createAppSearchSource, indexSearchClusters, type SearchAccess } from "./appSearchSource";

function SearchInput({ source }: { source: object }) {
  const context = useCommandPaletteContext();
  const latest = useRef(context);
  latest.current = context;
  // Astryx bootstraps only on open, so rerun the current query when its cached source changes.
  useEffect(() => {
    const palette = latest.current;
    if (palette?.isOpen) palette.setSearch(palette.search);
  }, [source]);
  return <CommandPaletteInput placeholder="Search clusters, contexts, or menus…" />;
}

export function AppSearch({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { clusterId } = useParams({ strict: false });
  const catalog = useCatalog();
  const permissions = usePermissions();
  const revision = usePermissionRevision();
  const index = useMemo(() => indexSearchClusters(catalog.snapshot?.clusters ?? []), [catalog.snapshot?.clusters]);
  const searchSource = useMemo(() => createAppSearchSource(index, clusterId, (id, section): SearchAccess => {
    if (!permissions.ownsCluster(id)) return "unverified";
    const check = destinationPermission(section);
    if (!check) return "unverified";
    const decision = permissions.decision(check);
    if (resourceView(section)?.namespaced) return decision === "allowed" ? "allowed" : decision === "denied" ? "namespace" : "unverified";
    if (!permissions.navigationVisible(check, id)) return "hidden";
    return decision === "allowed" ? "allowed" : "unverified";
  }), [index, clusterId, permissions, revision]);
  const notice = !catalog.available ? "Open the desktop app to search saved clusters." : catalog.loading ? "Loading saved clusters…"
    : catalog.error ? `${catalog.error}${catalog.snapshot ? " Searching previously loaded clusters." : ""}`
    : !index.length ? "No saved clusters. Add a kubeconfig in Catalog." : null;

  return (
    <CommandPalette
      label="Search Iceon"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      searchSource={searchSource}
      input={<SearchInput source={searchSource} />}
      footer={<VStack gap={0}>
        <VStack padding={3} gap={1} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {notice && <Text type="supporting" role={catalog.error ? "alert" : "status"}>{notice}</Text>}
          <Text type="supporting">Up to 60 matches. Refine by cluster, context, or menu.</Text>
        </VStack>
        <CommandPaletteFooter />
      </VStack>}
      renderItem={item => <HStack gap={3} vAlign="center" style={{ minWidth: 0, width: "100%" }}>
        <Icon icon={item.auxiliaryData.icon} />
        <VStack gap={1} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <Text>{item.label}</Text>
          <Text type="supporting">{item.auxiliaryData.description}</Text>
        </VStack>
      </HStack>}
      emptySearchText="No matching pages, clusters, or accessible cluster menus."
      onValueChange={(value) => {
        const destination = searchSource.resolve(value);
        if (destination) {
          onOpenChange(false);
          if (destination.type === "page") void navigate({ to: destination.path, search: {} });
          else void navigate({ to: "/cluster/$clusterId", params: { clusterId: destination.clusterId }, search: { section: destination.section } });
        }
      }}
    />
  );
}
