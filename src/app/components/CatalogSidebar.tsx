import { useRouterState } from "@tanstack/react-router";
import { Divider } from "@astryxdesign/core/Divider";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { categories } from "../navigation";
import { useCatalog } from "../catalog/CatalogProvider";
import { IconHexagons, IconWorldWww } from "@tabler/icons-react";
import { NavLink } from "./NavLink";

export function CatalogSidebar({ onNavigate }: { onNavigate: () => void }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { snapshot, loading } = useCatalog();
  const pinned = [
    ...(snapshot?.clusters ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/clusters" as const, icon: IconHexagons })),
    ...(snapshot?.webLinks ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/web-links" as const, icon: IconWorldWww })),
  ];

  return (
    <SideNav
      aria-label="Catalog navigation"
      style={{ width: "clamp(11rem, 18vw, 16rem)" }}
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
        {pinned.length ? pinned.map((item) => <NavLink key={item.id} to={item.path} search={{ item: item.id }} label={item.name} icon={item.icon} onClick={onNavigate} />)
          : <VStack paddingInline={4} paddingBlock={2} gap={2}>
            <Text type="supporting">{loading ? "Loading pinned items…" : "No pinned items."}</Text>
            <Text type="supporting">Pin individual clusters or web links from their list rows.</Text>
          </VStack>}
      </SideNavSection>
    </SideNav>
  );
}
