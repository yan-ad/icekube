import { useSearch } from "@tanstack/react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Divider } from "@astryxdesign/core/Divider";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useCatalog } from "../catalog/CatalogProvider";
import { RecordIcon } from "../catalog/RecordIcon";
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

  return (
    <SideNav aria-label="Cluster navigation" id={id} style={{ width: isMobile ? "100%" : "clamp(11rem, 18vw, 16rem)", minWidth: 0 }}>
      <VStack padding={4} gap={2} style={{ minWidth: 0 }}>
        {cluster ? <>
          <HStack gap={2} vAlign="center">
            <RecordIcon kind="Clusters" color={cluster.color} />
            <Text weight="semibold" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{cluster.name}</Text>
          </HStack>
          <Text type="supporting" style={{ overflowWrap: "anywhere" }}>Context: {cluster.contextName}</Text>
          <Badge variant="neutral" label="Disconnected" />
        </> : <Text role="status">{!available ? "Desktop engine required" : loading ? "Loading cluster…" : error ? "Cluster metadata unavailable" : "Cluster not found"}</Text>}
      </VStack>
      {cluster && <>
        <Divider />
        <SideNavSection title="Workspace">
          {clusterSections.map((item) => (
            <NavLink key={item.id} to="/cluster/$clusterId" params={{ clusterId }}
              search={{ section: item.id }} label={item.label} icon={item.icon}
              isSelected={section === item.id} onClick={onNavigate} />
          ))}
        </SideNavSection>
      </>}
    </SideNav>
  );
}
