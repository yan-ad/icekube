import { Spinner } from "@astryxdesign/core/Spinner";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";

export function ContentLoading({ label, refreshing = false, active = true }: { label: string; refreshing?: boolean; active?: boolean }) {
  if (refreshing) return <VStack className="content-loading-refresh" gap={0}>
    {active && <VStack className="content-loading-bar" role="progressbar" aria-label={label} gap={0}>
      <VisuallyHidden><Text>{label}</Text></VisuallyHidden>
    </VStack>}
  </VStack>;
  return <VStack className="content-loading-initial" gap={0} hAlign="center" vAlign="center">
    <Spinner size="lg" aria-label={label} />
    <VisuallyHidden><Text>{label}</Text></VisuallyHidden>
  </VStack>;
}
