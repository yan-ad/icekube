import type { IconType } from "@astryxdesign/core/Icon";
import {
  IconCategory2,
  IconListDetails,
  IconHexagons,
  IconWorldWww,
} from "@tabler/icons-react";

export const destinations = [
  { path: "/catalog", label: "Catalog", icon: IconCategory2, description: "Browse clusters and web links together." },
  { path: "/catalog/all", label: "All Categories", icon: IconListDetails, description: "All clusters and web links in one list." },
  { path: "/catalog/clusters", label: "Clusters", icon: IconHexagons, description: "Kubernetes clusters and pinned connections." },
  { path: "/catalog/web-links", label: "Web Links", icon: IconWorldWww, description: "Cluster-related web links." },
] as const satisfies readonly { path: string; label: string; icon: IconType; description: string }[];

export type DestinationPath = (typeof destinations)[number]["path"];
export const categories = destinations.slice(1);
