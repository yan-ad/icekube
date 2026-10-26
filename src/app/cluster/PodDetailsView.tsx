import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import type { PodDetails, PodMode, PodMutation } from "./podApi";
type Props = { details: PodDetails; edit: boolean; onEdit: () => void; onOpen: (mode: PodMode) => void; onAction: (action: PodMutation, yaml?: string) => void };
function podAge(createdAt: string | null) {
  if (!createdAt) return "Unknown";
  const seconds = Math.floor((Date.now() - Date.parse(createdAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
export function PodDetailsView({ details, edit, onEdit, onOpen, onAction }: Props) {
  const [yaml, setYaml] = useState(details.yaml);
  return <VStack gap={4} padding={4} isScrollable height="100%">
    <HStack gap={2} wrap="wrap"><Text as="h2">{details.namespace}/{details.name}</Text><Button label="Logs" variant="ghost" onClick={() => onOpen("logs")} /><Button label="Shell" variant="ghost" onClick={() => onOpen("shell")} /><Button label="Attach" variant="ghost" onClick={() => onOpen("attach")} /><Button label="Port forward" variant="ghost" onClick={() => onOpen("forward")} /></HStack>
    <Text as="p">Phase: {details.phase} · UID: {details.uid} · Resource version: {details.resourceVersion}</Text>
    <VStack gap={1} aria-label="Pod facts">
      <Text as="p">Node: {details.node ?? "Not scheduled"}</Text>
      <Text as="p">Pod IPs: {details.podIps.join(", ") || "Not assigned"}</Text>
      <Text as="p">Host IPs: {details.hostIps.join(", ") || "Not assigned"}</Text>
      <Text as="p">Service account: {details.serviceAccount ?? "Unknown"}</Text>
      <Text as="p">QoS: {details.qos ?? "Unknown"}</Text>
      <Text as="p">Age: {podAge(details.createdAt)} · Created: {details.createdAt ?? "Unknown"}</Text>
    </VStack>
    <Text as="h3">Containers</Text><VStack gap={1}>{details.containers.map(c => <Text as="p" key={`${c.kind}-${c.name}`}>{c.kind}: {c.name} · {c.image} · {c.state} · {c.ready ? "ready" : "not ready"} · restarts {c.restarts} · ports {c.ports.map(p => `${p.name ?? "unnamed"}:${p.port}/${p.protocol}`).join(", ") || "none"}</Text>)}</VStack>
    <Text as="h3">Conditions and events</Text><VStack gap={1}>{details.conditions.map(c => <Text as="p" key={c.type}>{c.type}: {c.status}</Text>)}{details.events.map((e, i) => <Text as="p" key={`${e.reason}-${i}`}>{e.type}: {e.reason} ({e.count}){e.lastSeen ? ` · ${e.lastSeen}` : ""}</Text>)}</VStack>
    <TextArea label="YAML" value={yaml} onChange={setYaml} isReadOnly={!edit} rows={14} hasSpellCheck={false} />
    <HStack gap={2} wrap="wrap">{edit ? <Button label="Save YAML" onClick={() => onAction("replace", yaml)} /> : <Button label="Edit YAML" variant="ghost" onClick={onEdit} />}<Button label="Delete" variant="ghost" onClick={() => onAction("delete")} /><Button label="Force delete" variant="ghost" onClick={() => onAction("forceDelete")} />{details.deletionTimestamp && <Button label="Finalize" variant="ghost" onClick={() => onAction("finalize")} />}</HStack>
  </VStack>;
}
