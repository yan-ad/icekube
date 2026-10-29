import type { SearchSource } from "@astryxdesign/core/Typeahead";
import type { IconType } from "@astryxdesign/core/Icon";
import type { ClusterSummary } from "../catalog/api";
import { clusterSections, type ClusterSectionId } from "../cluster/navigation";
import { destinations, type DestinationPath } from "../navigation";

export const SEARCH_RESULT_LIMIT = 60;
export type SearchAccess = "allowed" | "hidden" | "unverified" | "namespace";
export type SearchTarget = { type: "page"; path: DestinationPath }
  | { type: "cluster"; clusterId: string; section: ClusterSectionId };
export type AppSearchItem = {
  id: string;
  label: string;
  auxiliaryData: { group: string; description: string; icon: IconType };
};
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const menus = clusterSections.flatMap(parent => [
  { id: parent.id, label: parent.label, icon: parent.icon, text: normalize(`${parent.id} ${parent.label}`),
    children: "children" in parent ? parent.children.map(child => child.id) : [] },
  ...("children" in parent ? parent.children.map(child => ({ ...child, icon: parent.icon,
    label: `${parent.label} › ${child.label}`, text: normalize(`${parent.label} ${child.id} ${child.label}`), children: [] })) : []),
]).filter(menu => menu.id !== "overview");
const menuById = new Map(menus.map(menu => [menu.id, menu]));
const pages = destinations.map(page => ({ ...page, text: normalize(`${page.label} ${page.path}`) }));
const clusterKey = (clusterId: string, section: ClusterSectionId) => JSON.stringify([clusterId, section]);

export function indexSearchClusters(clusters: readonly ClusterSummary[]) {
  return clusters.map(cluster => ({ cluster, text: normalize(`${cluster.name} ${cluster.contextName} ${cluster.labels.join(" ")}`) }));
}

export function createAppSearchSource(index: ReturnType<typeof indexSearchClusters>, activeClusterId: string | undefined,
  access: (clusterId: string, section: ClusterSectionId) => SearchAccess): SearchSource<AppSearchItem> & { resolve: (id: string) => SearchTarget | null } {
  const clusters = activeClusterId ? [...index.filter(item => item.cluster.id === activeClusterId), ...index.filter(item => item.cluster.id !== activeClusterId)] : index;
  const byId = new Map(clusters.map(item => [item.cluster.id, item.cluster]));
  const menuAccess = (clusterId: string, menu: typeof menus[number]): SearchAccess => {
    if (menu.children.length && menu.children.every(id => access(clusterId, id) === "hidden")) return "hidden";
    return access(clusterId, menu.id);
  };
  function clusterItem(cluster: ClusterSummary, menu?: typeof menus[number]): AppSearchItem | null {
    const permission = menu ? menuAccess(cluster.id, menu) : "allowed";
    if (permission === "hidden") return null;
    const status = permission === "unverified" ? " · Access unverified" : permission === "namespace" ? " · Choose a namespace to check access" : "";
    return { id: clusterKey(cluster.id, menu?.id ?? "overview"), label: menu ? `${cluster.name} › ${menu.label}` : cluster.name,
      auxiliaryData: { group: menu ? "Cluster menus" : "Clusters", description: `Context: ${cluster.contextName}${status}`, icon: menu?.icon ?? clusterSections[0].icon } };
  }
  function search(query: string): AppSearchItem[] {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    const result: AppSearchItem[] = [];
    for (const page of pages) if (tokens.every(token => page.text.includes(token))) result.push({ id: page.path, label: page.label,
      auxiliaryData: { group: "Pages", description: page.description, icon: page.icon } });
    for (const { cluster, text } of clusters) {
      if (result.length >= SEARCH_RESULT_LIMIT) return result;
      if (tokens.every(token => text.includes(token))) result.push(clusterItem(cluster)!);
    }
    // Match metadata and menu templates separately instead of allocating 60,000 joined records.
    for (const { cluster, text } of clusters) {
      if (result.length >= SEARCH_RESULT_LIMIT) break;
      if (!tokens.length && cluster.id !== activeClusterId) continue;
      const remaining = tokens.filter(token => !text.includes(token));
      for (const menu of menus) {
        if (result.length >= SEARCH_RESULT_LIMIT) break;
        if (!remaining.every(token => menu.text.includes(token))) continue;
        const item = clusterItem(cluster, menu);
        if (item) result.push(item);
      }
    }
    return result;
  }
  return { search, bootstrap: () => search(""), resolve: id => {
    const page = destinations.find(page => page.path === id);
    if (page) return { type: "page", path: page.path };
    try {
      const value: unknown = JSON.parse(id);
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string" || !byId.has(value[0])) return null;
      const [clusterId, section] = value;
      if (section === "overview") return { type: "cluster", clusterId, section };
      const menu = menuById.get(section as ClusterSectionId);
      return menu && menuAccess(clusterId, menu) !== "hidden" ? { type: "cluster", clusterId, section: menu.id } : null;
    } catch { return null; }
  } };
}
