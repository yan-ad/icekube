import { useRouterState } from "@tanstack/react-router";
import { Divider } from "@astryxdesign/core/Divider";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { categories } from "../navigation";
import { useCatalog } from "../catalog/CatalogProvider";
import { RecordIcon } from "../catalog/RecordIcon";
import { NavLink } from "./NavLink";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { clusterDestinations } from "../cluster/navigation";
import { SectionPinAction } from "../catalog/SectionPinAction";

export function CatalogSidebar({ onNavigate, isCollapsed = false, id = "catalog-sidebar" }: { onNavigate: () => void; isCollapsed?: boolean; id?: string }) {
  const { isMobile } = useAppShellMobile();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { snapshot, loading, busy, openWebLink } = useCatalog();
  const activeClusterId = useRouterState({ select: (state) => state.matches.find((match) => "clusterId" in match.params)?.params as { clusterId?: string } | undefined });
  const activeSection = useRouterState({ select: state => (state.location.search as { section?: string }).section ?? "overview" });
  const sectionPins = (snapshot?.clusters ?? []).flatMap(cluster => clusterDestinations
    .filter(destination => destination.id !== "overview" && cluster.pinnedSections.includes(destination.id))
    .map(destination => ({ cluster, destination })));
  const pinned = [
    ...(snapshot?.clusters ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/clusters" as const, kind: "Clusters" as const })),
    ...(snapshot?.webLinks ?? []).filter((item) => item.pinned).map((item) => ({ ...item, path: "/catalog/web-links" as const, kind: "Web Links" as const })),
  ];

  return (
    <SideNav
      aria-label="Catalog navigation"
      id={id}
      className="catalog-sidebar-motion"
      data-collapsed={isCollapsed}
      collapsible={{ isCollapsed, hasButton: false }}
      style={{ width: isMobile ? "100%" : isCollapsed ? "var(--spacing-12)" : "clamp(11rem, 18vw, 16rem)", minHeight: 0, flexShrink: 0 }}
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
        {pinned.map((item) => item.kind === "Clusters"
          ? <NavLink key={item.id} to="/cluster/$clusterId" params={{ clusterId: item.id }} search={{}} label={item.name} isSelected={activeClusterId?.clusterId === item.id && activeSection === "overview"} icon={<RecordIcon kind={item.kind} color={item.color} />} onClick={onNavigate} />
          : <SideNavItem key={item.id} label={item.name} isDisabled={busy} icon={<RecordIcon kind={item.kind} color={item.color} />} onClick={() => { onNavigate(); void openWebLink(item.id); }} />)}
        {sectionPins.map(({ cluster, destination }) => <NavLink key={`${cluster.id}:${destination.id}`}
          to="/cluster/$clusterId" params={{ clusterId: cluster.id }} search={{ section: destination.id }}
          label={`${cluster.name} · ${destination.label}`}
          icon={<RecordIcon kind="Clusters" color={cluster.color} icon={destination.icon} />}
          isSelected={activeClusterId?.clusterId === cluster.id && activeSection === destination.id}
          actions={<SectionPinAction cluster={cluster} section={destination.id} label={destination.label} />}
          onClick={onNavigate} />)}
        {!pinned.length && !sectionPins.length && !isCollapsed && <VStack paddingInline={4} paddingBlock={2} gap={2}>
            <Text type="supporting">{loading ? "Loading pinned items…" : "No pinned items."}</Text>
            <Text type="supporting">Pin clusters or web links from their list rows, or sections from cluster navigation.</Text>
          </VStack>}
      </SideNavSection>
    </SideNav>
  );
}
