import type { IconType } from "@astryxdesign/core/Icon";
import {
  IconActivity, IconBox, IconCalendarEvent, IconDatabase, IconFileSettings,
  IconHexagons, IconKey, IconNetwork, IconPackages, IconServer, IconSitemap,
} from "@tabler/icons-react";

export const clusterSections = [
  { id: "overview", label: "Cluster", icon: IconHexagons },
  { id: "nodes", label: "Nodes", icon: IconServer },
  { id: "workloads", label: "Workloads", icon: IconPackages },
  { id: "config", label: "Config", icon: IconFileSettings },
  { id: "network", label: "Network", icon: IconNetwork },
  { id: "storage", label: "Storage", icon: IconDatabase },
  { id: "namespaces", label: "Namespaces", icon: IconSitemap },
  { id: "events", label: "Events", icon: IconCalendarEvent },
  { id: "helm", label: "Helm", icon: IconBox },
  { id: "access-control", label: "Access Control", icon: IconKey },
  { id: "custom-resources", label: "Custom Resources", icon: IconActivity },
] as const satisfies readonly { id: string; label: string; icon: IconType }[];

export type ClusterSectionId = (typeof clusterSections)[number]["id"];
