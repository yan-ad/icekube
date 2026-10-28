import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Stack";
export function ReadOnlyNotice({ readOnly = false, unverified = false }: { readOnly?: boolean; unverified?: boolean }) {
  if (!readOnly && !unverified) return null;
  return <HStack role="status" gap={2} padding={2} vAlign="center" wrap="wrap"><Badge label={unverified ? "Access unverified" : "Read-only"} variant={unverified ? "warning" : "neutral"} /><Text type="supporting">{unverified ? "Access unverified. Permission review is unavailable; Kubernetes still checks each request. Changes are disabled until access is verified." : "Read-only access. Your Kubernetes permissions allow viewing these resources, but not changing them."}</Text></HStack>;
}
