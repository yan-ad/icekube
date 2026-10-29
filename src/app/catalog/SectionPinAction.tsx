import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { IconPin, IconPinnedOff } from "@tabler/icons-react";
import type { ClusterSectionId } from "../cluster/navigation";
import type { ClusterSummary } from "./api";
import { useCatalog } from "./CatalogProvider";

export function SectionPinAction({ cluster, section, label }: { cluster: ClusterSummary; section: ClusterSectionId; label: string }) {
  const { available, loading, busy, run } = useCatalog();
  const pinned = section === "overview" ? cluster.pinned : cluster.pinnedSections.includes(section);
  return <IconButton label={`${pinned ? "Unpin" : "Pin"} ${label} for ${cluster.name}`}
    tooltip={pinned ? "Unpin from Sidebar" : "Pin to Sidebar"}
    className="section-pin-action"
    data-section-pin-action="true"
    data-pinned={pinned ? "true" : "false"}
    aria-pressed={pinned} icon={<Icon icon={pinned ? IconPinnedOff : IconPin} />}
    variant="ghost" isDisabled={!available || loading || busy}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      void (section === "overview"
        ? run("catalog_set_pin", { id: cluster.id, pinned: !pinned })
        : run("catalog_set_section_pin", { clusterId: cluster.id, section, pinned: !pinned }));
    }} />;
}
