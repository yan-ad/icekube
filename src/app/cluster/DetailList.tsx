import type { ComponentProps } from "react";
import { MetadataList } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";
import { SupportingSection } from "./SupportingSection";

type Props = Omit<ComponentProps<typeof MetadataList>, "columns" | "orientation">;

export function DetailList({ className, title, label = { position: "top" }, ...props }: Props) {
  const content = <VStack gap={0} className="detail-list-container">
    <MetadataList {...props} columns={2} label={label} className={["detail-list", className].filter(Boolean).join(" ")} />
  </VStack>;
  return title ? <SupportingSection title={title}>{content}</SupportingSection> : content;
}
