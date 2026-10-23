import { useRouterState } from "@tanstack/react-router";
import { Divider } from "@astryxdesign/core/Divider";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { categories } from "../navigation";
import { useCatalog } from "../catalog/CatalogProvider";
import { RecordIcon } from "../catalog/RecordIcon";
import { NavLink } from "./NavLink";

export function CatalogSidebar({ onNavigate, isCollapsed = false, id = "catalog-sidebar" }: { onNavigate: () => void; isCollapsed?: boolean; id?: string }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { snapshot, loading } = useCatalog();
  const pinned = [
    ...(snapshot?.clusters ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/clusters" as const, kind: "Clusters" as const })),
    ...(snapshot?.webLinks ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/web-links" as const, kind: "Web Links" as const })),
  ];

  return (
    <SideNav
      aria-label="Catalog navigation"
      id={id}
      collapsible={{ isCollapsed, hasButton: false }}
      style={isCollapsed ? undefined : { width: "clamp(11rem, 18vw, 16rem)" }}
    >
      <SideNavSection title="Categories">
        {categories.map((category) => (
          <NavLink
            key={category.path}
            to={category.path}
            label={category.label}
            icon={category.icon}
            isSelected={pathname === category.path || (category.path === "/catalog/all" && pathname === "/catalog")}
            onClick={onNavigate}
          />
        ))}
      </SideNavSection>
      <Divider />
      <SideNavSection title="Pinned items">
        {pinned.length ? pinned.map((item) => <NavLink key={item.id} to={item.path} search={{ item: item.id }} label={item.name} icon={<RecordIcon kind={item.kind} color={item.color} />} onClick={onNavigate} />)
          : !isCollapsed && <VStack paddingInline={4} paddingBlock={2} gap={2}>
            <Text type="supporting">{loading ? "Loading pinned items…" : "No pinned items."}</Text>
            <Text type="supporting">Pin individual clusters or web links from their list rows.</Text>
          </VStack>}
      </SideNavSection>
    </SideNav>
  );
}
