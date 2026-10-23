import type { IconType } from "@astryxdesign/core/Icon";
import {
  IconCategory2,
  IconListDetails,
  IconSettings,
  IconHexagons,
  IconWorldWww,
} from "@tabler/icons-react";

export const destinations = [
  { path: "/", label: "Welcome Page", icon: IconCategory2, description: "Start here and browse the catalog." },
  { path: "/catalog", label: "Catalog", icon: IconListDetails, description: "Browse available catalog categories." },
  { path: "/catalog/general", label: "General", icon: IconSettings, description: "Catalog information and local setup." },
  { path: "/catalog/clusters", label: "Clusters", icon: IconHexagons, description: "Kubernetes clusters and pinned connections." },
  { path: "/catalog/web-links", label: "Web Links", icon: IconWorldWww, description: "Cluster-related web links." },
] as const satisfies readonly { path: string; label: string; icon: IconType; description: string }[];

export type DestinationPath = (typeof destinations)[number]["path"];
export const categories = destinations.slice(2);
export type PinnablePath = (typeof categories)[number]["path"];
export const PIN_STORAGE_KEY = "icekube.pinned-pages.v1";

export function parsePinnedPages(raw: string | null): PinnablePath[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((path): path is PinnablePath =>
      categories.some((category) => category.path === path),
    ))];
  } catch {
    return [];
  }
}
