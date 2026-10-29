import type { ComponentProps } from "react";
import { MetadataList } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";

type Props = Omit<ComponentProps<typeof MetadataList>, "columns" | "orientation">;

export function DetailList({ className, label = { position: "top" }, ...props }: Props) {
  return <VStack gap={0} className="detail-list-container">
    <MetadataList {...props} columns={2} label={label} className={["detail-list", className].filter(Boolean).join(" ")} />
  </VStack>;
}
