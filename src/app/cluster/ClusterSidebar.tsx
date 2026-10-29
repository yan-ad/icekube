import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { NavLink } from "../components/NavLink";
import { clusterSections } from "./navigation";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { useCustomResources, customDiscoveryMessage } from "./CustomResourcesProvider";
import { useNavigationPermissions } from "./PermissionProvider";
import { SectionPinAction } from "../catalog/SectionPinAction";

export function ClusterSidebar({ clusterId, onNavigate, id = "cluster-sidebar", isExiting = false }: {
  clusterId: string;
  onNavigate: () => void;
  id?: string;
  isExiting?: boolean;
}) {
  const { section = "overview", definition } = useSearch({ strict: false }) as { section?: string; definition?: string };
  const custom = useCustomResources();
  const permissions = useNavigationPermissions(clusterId);
  const definitions = custom.snapshot?.clusterId === clusterId ? custom.snapshot : null;
  const { snapshot, loading, available, error } = useCatalog();
  const cluster = snapshot?.clusters.find((item) => item.id === clusterId);
  const { isMobile } = useAppShellMobile();
  const selectedParent = section === "custom-resource-instances" ? "custom-resources" : clusterSections.find((item) => "children" in item && item.children.some((child) => child.id === section))?.id;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed((previous) => selectedParent ? { ...previous, [selectedParent]: false } : previous);
  }, [clusterId, section, selectedParent]);
  const customExpanded = !(collapsed["custom-resources"] ?? selectedParent !== "custom-resources");
  useEffect(() => {
    if (customExpanded && !isExiting && permissions.visible("custom-resources") && !permissions.loading) custom.request(clusterId);
    return () => { if (customExpanded && !isExiting) custom.request(null); };
  }, [clusterId, customExpanded, isExiting, custom.request, permissions.loading, permissions.visible("custom-resources")]);
  const groups = [...new Set(definitions?.items.map(item => item.group) ?? [])];

  return (
    <SideNav aria-label="Cluster navigation" id={id} className="cluster-sidebar" style={{ width: isMobile ? "100%" : "clamp(11rem, 18vw, 16rem)", minWidth: 0, minHeight: 0, flexShrink: 0 }}>
      {!cluster && <VStack padding={4} gap={2} style={{ minWidth: 0 }}>
        <Text role="status">{!available ? "Desktop engine required" : loading ? "Loading cluster…" : error ? "Cluster metadata unavailable" : "Cluster not found"}</Text>
      </VStack>}
      {cluster && <>
        <SideNavSection title="Workspace">
          {clusterSections.filter(item => "children" in item ? item.children.some(child => permissions.visible(child.id)) : permissions.visible(item.id)).map((item) => "children" in item ? (
            <SideNavItem key={item.id} label={item.label} icon={item.icon}
              data-testid={`cluster-nav-${item.id}`}
              actions={<SectionPinAction cluster={cluster} section={item.id} label={item.label} />}
              aria-label={`${(collapsed[item.id] ?? selectedParent !== item.id) ? "Expand" : "Collapse"} ${item.label}`}
              collapsible={{
                isCollapsed: collapsed[item.id] ?? selectedParent !== item.id,
                onCollapsedChange: (isCollapsed) => setCollapsed((previous) => ({ ...previous, [item.id]: isCollapsed })),
              }}>
              {item.children.filter(child => permissions.visible(child.id)).map((child) => <NavLink key={child.id} to="/cluster/$clusterId" params={{ clusterId }}
                data-testid={`cluster-nav-${child.id}`}
                actions={<SectionPinAction cluster={cluster} section={child.id} label={child.label} />}
                search={{ section: child.id }} label={child.label} isSelected={!isExiting && section === child.id}
                onClick={onNavigate} />)}
              {item.id === "custom-resources" && <>
                {definitions?.loading && <Text role="status" type="supporting">Loading definitions…</Text>}
                {definitions?.error && <VStack gap={1}><Text role="status" type="supporting">{customDiscoveryMessage(definitions.error)}</Text><Button label="Retry discovery" variant="ghost" size="sm" onClick={custom.refresh} /></VStack>}
                {definitions && !definitions.loading && !definitions.error && !groups.length && <Text role="status" type="supporting">No custom resource definitions returned.</Text>}
                {groups.map(group => <VStack key={group} gap={0} style={{ minWidth: 0 }}>
                  <Button label={group} variant="ghost" size="sm" aria-expanded={!collapsed[`group:${group}`]} onClick={() => setCollapsed(previous => ({ ...previous, [`group:${group}`]: !previous[`group:${group}`] }))} />
                  {!collapsed[`group:${group}`] && definitions?.items.filter(item => item.group === group).map(item => <NavLink key={item.uid} to="/cluster/$clusterId" params={{ clusterId }} search={{ section: "custom-resource-instances", definition: item.name }} label={item.kind} isSelected={!isExiting && section === "custom-resource-instances" && definition === item.name} onClick={onNavigate} />)}
                </VStack>)}
                {definitions?.partial && <Text role="status" type="supporting">Discovery is partial. {definitions.items.length} definitions loaded.{definitions.items.length >= 1_000 ? " The 1,000-definition limit was reached." : ""}</Text>}
                {definitions && custom.canLoadMore && <Button label="Load more definitions" variant="ghost" size="sm" isDisabled={definitions.loading} onClick={custom.loadMore} />}
              </>}
            </SideNavItem>
          ) : (
            <NavLink key={item.id} to="/cluster/$clusterId" params={{ clusterId }}
              data-testid={`cluster-nav-${item.id}`}
              actions={<SectionPinAction cluster={cluster} section={item.id} label={item.label} />}
              search={{ section: item.id }} label={item.label} icon={item.icon}
              isSelected={!isExiting && section === item.id} onClick={onNavigate} />
          ))}
        </SideNavSection>
      </>}
    </SideNav>
  );
}
