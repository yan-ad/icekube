import { SupportingSection } from "./SupportingSection";
import { Text } from "@astryxdesign/core/Text";
import type { EventDiagnostic } from "./eventDiagnostic";

export function EventDiagnosticView({ diagnostic }: { diagnostic: EventDiagnostic }) {
  const textStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
  return <SupportingSection title="Cluster diagnostic text">
    <Text size="sm">Cluster-provided text may contain sensitive information. Recognizable credential syntax is redacted, not all sensitive data.</Text>
    {diagnostic.source && <Text size="sm" style={textStyle}>{`Source: ${diagnostic.source}`}</Text>}
    {diagnostic.fieldPath && <Text size="sm" style={textStyle}>{`Field path: ${diagnostic.fieldPath}`}</Text>}
    <Text style={textStyle}>{diagnostic.message || "No diagnostic message provided."}</Text>
    {diagnostic.truncated && <Text size="sm">Diagnostic text truncated to the display limit.</Text>}
  </SupportingSection>;
}
