import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { NavLink } from "../components/NavLink";
import { clusterSections } from "./navigation";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";

export function ClusterSidebar({ clusterId, onNavigate, id = "cluster-sidebar" }: {
  clusterId: string;
  onNavigate: () => void;
  id?: string;
}) {
  const { section = "overview" } = useSearch({ strict: false }) as { section?: string };
  const { snapshot, loading, available, error } = useCatalog();
  const cluster = snapshot?.clusters.find((item) => item.id === clusterId);
  const { isMobile } = useAppShellMobile();
  const selectedParent = clusterSections.find((item) => "children" in item && item.children.some((child) => child.id === section))?.id;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed((previous) => selectedParent ? { ...previous, [selectedParent]: false } : previous);
  }, [clusterId, section, selectedParent]);

  return (
    <SideNav aria-label="Cluster navigation" id={id} style={{ width: isMobile ? "100%" : "clamp(11rem, 18vw, 16rem)", minWidth: 0 }}>
      {!cluster && <VStack padding={4} gap={2} style={{ minWidth: 0 }}>
        <Text role="status">{!available ? "Desktop engine required" : loading ? "Loading cluster…" : error ? "Cluster metadata unavailable" : "Cluster not found"}</Text>
      </VStack>}
      {cluster && <>
        <SideNavSection title="Workspace">
          {clusterSections.map((item) => "children" in item ? (
            <NavLink key={item.id} to="/cluster/$clusterId" params={{ clusterId }}
              search={{ section: item.id }} label={item.label} icon={item.icon}
              isSelected={section === item.id} onClick={onNavigate}
              collapsible={{
                isCollapsed: collapsed[item.id] ?? selectedParent !== item.id,
                onCollapsedChange: (isCollapsed) => setCollapsed((previous) => ({ ...previous, [item.id]: isCollapsed })),
              }}>
              {item.children.map((child) => <NavLink key={child.id} to="/cluster/$clusterId" params={{ clusterId }}
                search={{ section: child.id }} label={child.label} isSelected={section === child.id}
                onClick={onNavigate} />)}
            </NavLink>
          ) : (
            <NavLink key={item.id} to="/cluster/$clusterId" params={{ clusterId }}
              search={{ section: item.id }} label={item.label} icon={item.icon}
              isSelected={section === item.id} onClick={onNavigate} />
          ))}
        </SideNavSection>
      </>}
    </SideNav>
  );
}
