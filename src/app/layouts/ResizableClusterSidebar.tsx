import type { CSSProperties } from "react";
import { Divider } from "@astryxdesign/core/Divider";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { percent, pixel } from "@astryxdesign/core/Resizable/utils";
import { HStack } from "@astryxdesign/core/Stack";
import { ClusterSidebar } from "../cluster/ClusterSidebar";

export function ResizableClusterSidebar({ clusterId, isOpen, onNavigate }: {
  clusterId: string;
  isOpen: boolean;
  onNavigate: () => void;
}) {
  const region = useResizable({
    defaultSize: percent(18, { max: pixel(256) }),
    minSize: 176,
    maxSize: percent(35, { max: pixel(480) }),
    autoSaveId: "iceon.cluster-sidebar-width.v1",
  });

  return <HStack gap={0} height="100%" className="cluster-sidebar-motion"
    style={{ "--cluster-sidebar-width": `${region.size}px` } as CSSProperties}
    data-open={isOpen} inert={!isOpen} aria-hidden={!isOpen}>
    <Divider orientation="vertical" />
    <ClusterSidebar clusterId={clusterId} isExiting={!isOpen} onNavigate={onNavigate} />
    {isOpen && <ResizeHandle direction="horizontal" position="overlay"
      label="Resize workspace sidebar" aria-controls="cluster-sidebar"
      resizable={region.props} isAlwaysVisible={false} pillPlacement="end"
      className="cluster-sidebar-resize" />}
  </HStack>;
}
