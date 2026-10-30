import type { ComponentProps } from "react";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { VStack } from "@astryxdesign/core/Stack";

export function UsageBar({ resource, ...props }: Omit<ComponentProps<typeof ProgressBar>, "variant"> & { resource: "cpu" | "memory" }) {
  return <VStack gap={0} className={resource === "memory" ? "memory-usage-bar" : undefined}>
    <ProgressBar {...props} variant={resource === "cpu" ? "accent" : "neutral"} />
  </VStack>;
}
