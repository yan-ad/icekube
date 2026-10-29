import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { EventDiagnostic } from "./eventDiagnostic";

export function EventDiagnosticView({ diagnostic }: { diagnostic: EventDiagnostic }) {
  const textStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
  return <VStack gap={2} aria-label="Cluster diagnostic text" style={{ minWidth: 0 }}>
    <Text as="h3" size="sm" weight="semibold">Cluster diagnostic text</Text>
    <Text size="sm">Cluster-provided text may contain sensitive information. Recognizable credential syntax is redacted, not all sensitive data.</Text>
    {diagnostic.source && <Text size="sm" style={textStyle}>{`Source: ${diagnostic.source}`}</Text>}
    {diagnostic.fieldPath && <Text size="sm" style={textStyle}>{`Field path: ${diagnostic.fieldPath}`}</Text>}
    <Text style={textStyle}>{diagnostic.message || "No diagnostic message provided."}</Text>
    {diagnostic.truncated && <Text size="sm">Diagnostic text truncated to the display limit.</Text>}
  </VStack>;
}
