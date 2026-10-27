import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconBox, IconCalendarEvent, IconDatabase, IconFileSettings, IconKey, IconNetwork, IconPackages, IconShield, IconSitemap } from "@tabler/icons-react";
import { clusterSections, type ClusterSectionId } from "./navigation";
import { destinationDescriptions } from "./destinationDescriptions";

export type Destination = { id: ClusterSectionId; label: string };
export type DestinationGridProps = { clusterId: string; title: string; destinations: readonly Destination[] };
const concreteIcons: Partial<Record<ClusterSectionId, IconType>> = {
  pods: IconBox, jobs: IconCalendarEvent, "cron-jobs": IconCalendarEvent,
  secrets: IconKey, "config-maps": IconFileSettings, "network-policies": IconShield,
  "service-accounts": IconKey, "role-bindings": IconSitemap, "cluster-role-bindings": IconSitemap,
  "helm-charts": IconPackages, "helm-releases": IconBox,
  "persistent-volume-claims": IconDatabase, "persistent-volumes": IconDatabase, services: IconNetwork,
};
function destinationIcon(id: ClusterSectionId): IconType {
  const parent = clusterSections.find(section => section.id === id || "children" in section && section.children.some(child => child.id === id));
  return concreteIcons[id] ?? parent!.icon;
}

export function DestinationGrid({ clusterId, title, destinations }: DestinationGridProps) {
  return <VStack as="nav" aria-label={`${title} destinations`} padding={4} gap={4}
    style={{ flex: "1 1 0", minHeight: 0, minWidth: 0, overflow: "auto" }}>
    <Grid columns={{ minWidth: 256, max: 6 }} gap={4}>
      {destinations.map(destination => <Card key={destination.id} padding={0}>
        <Link isStandalone display="block" color="primary" href={`#/cluster/${encodeURIComponent(clusterId)}?section=${destination.id}`}
          aria-labelledby={`destination-${destination.id}`} aria-describedby={`description-${destination.id}`}
          style={{ padding: "var(--spacing-4)", height: "100%", boxSizing: "border-box", textDecoration: "none" }}>
          <VStack gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <HStack gap={3} vAlign="center"><Icon icon={destinationIcon(destination.id)} color="secondary" /><Text id={`destination-${destination.id}`} type="label">{destination.label}</Text></HStack>
            <Text id={`description-${destination.id}`} type="supporting" color="secondary">{destinationDescriptions[destination.id]}</Text>
          </VStack>
        </Link>
      </Card>)}
    </Grid>
  </VStack>;
}
