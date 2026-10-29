import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { YamlEditor } from "../components/YamlEditor";
import { ResourceRelationLink } from "./ResourceInspector";
import { StatusBadge } from "./StatusBadge";
import type { PodDetails, PodMode, PodMutation } from "./podApi";
import { usePermissionChecks } from "./PermissionProvider";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { ResourceAge } from "./ResourceAge";

type Props = {
  details: PodDetails;
  edit: boolean;
  embedded?: boolean;
  onEdit: () => void;
  onOpen: (mode: PodMode) => void;
  onAction: (action: PodMutation, yaml?: string) => void;
};

export function PodDetailsView({ details, edit, embedded = false, onEdit, onOpen, onAction }: Props) {
  useUpdateBlocker(edit, "Pod YAML editing is open.");
  const [yaml, setYaml] = useState(details.yaml);
  const permissions = usePermissionChecks([
    { kind: "pods", namespace: details.namespace, name: details.name, action: "get" },
    { kind: "pods", namespace: details.namespace, name: details.name, action: "update" },
    { kind: "pods", namespace: details.namespace, name: details.name, action: "patch" },
    { kind: "pods", namespace: details.namespace, name: details.name, action: "delete" },
  ]);
  const allowed = (action: "get" | "update" | "patch" | "delete") => permissions.decision({ kind: "pods", namespace: details.namespace, name: details.name, action }) === "allowed";
  const canReplace = !permissions.loading && allowed("get") && allowed("update");
  return <VStack gap={5} padding={4} style={{ minWidth: 0, flexShrink: 0, overflowWrap: "anywhere" }}>
    <VStack gap={2}>
      {!embedded && <Heading level={2} wordBreak="break-all">{details.name}</Heading>}
      <HStack gap={2} wrap="wrap">
        <StatusBadge status={details.phase} />
        {details.deletionTimestamp && <StatusBadge status="Terminating" />}
      </HStack>
      {!embedded && <HStack gap={2} wrap="wrap">
        <Button label="Logs" variant="ghost" isDisabled={permissions.loading || !allowed("get")} onClick={() => onOpen("logs")} />
        <Button label="Shell" variant="ghost" isDisabled={permissions.loading || !allowed("get")} onClick={() => onOpen("shell")} />
        <Button label="Attach" variant="ghost" isDisabled={permissions.loading || !allowed("get")} onClick={() => onOpen("attach")} />
        <Button label="Port forward" variant="ghost" isDisabled={permissions.loading || !allowed("get")} onClick={() => onOpen("forward")} />
      </HStack>}
    </VStack>

    <MetadataList title="Pod facts" columns="single" label={{ position: "top" }}>
      <MetadataListItem label="Namespace">
        <ResourceRelationLink reference={{ kind: "namespaces", namespace: null, name: details.namespace }}>{details.namespace}</ResourceRelationLink>
      </MetadataListItem>
      <MetadataListItem label="Phase"><StatusBadge status={details.phase} /></MetadataListItem>
      {details.deletionTimestamp && <MetadataListItem label="Deletion time"><Text wordBreak="break-all">{details.deletionTimestamp}</Text></MetadataListItem>}
      <MetadataListItem label="Created"><Text wordBreak="break-all">{details.createdAt ?? "Unknown"}</Text></MetadataListItem>
      <MetadataListItem label="Age"><ResourceAge timestamp={details.createdAt} fallback="Unknown" /></MetadataListItem>
      <MetadataListItem label="UID"><Text type="code" wordBreak="break-all">{details.uid}</Text></MetadataListItem>
      <MetadataListItem label="Resource version"><Text type="code" wordBreak="break-all">{details.resourceVersion}</Text></MetadataListItem>
      <MetadataListItem label="Node">{details.node
        ? <ResourceRelationLink reference={{ kind: "nodes", namespace: null, name: details.node }}>{details.node}</ResourceRelationLink>
        : "Not scheduled"}</MetadataListItem>
      <MetadataListItem label="Service account">{details.serviceAccount
        ? <ResourceRelationLink reference={{ kind: "serviceAccounts", namespace: details.namespace, name: details.serviceAccount }}>{details.serviceAccount}</ResourceRelationLink>
        : "Unknown"}</MetadataListItem>
      <MetadataListItem label="QoS">{details.qos ?? "Unknown"}</MetadataListItem>
      <MetadataListItem label="Pod IPs"><Text type="code" wordBreak="break-all">{details.podIps.join(", ") || "Not assigned"}</Text></MetadataListItem>
      <MetadataListItem label="Host IPs"><Text type="code" wordBreak="break-all">{details.hostIps.join(", ") || "Not assigned"}</Text></MetadataListItem>
    </MetadataList>

    <VStack gap={3}>
      <Heading level={3}>Conditions</Heading>
      {details.conditions.length === 0 ? <Text type="supporting">No conditions reported.</Text>
        : <MetadataList columns="single" label={{ position: "top" }}>
          {details.conditions.map(condition => <MetadataListItem key={condition.type} label={condition.type}>
            <StatusBadge status={condition.status} />
          </MetadataListItem>)}
        </MetadataList>}
    </VStack>

    <VStack gap={4}>
      <Heading level={3}>Containers</Heading>
      {details.containers.length === 0 && <Text type="supporting">No containers reported.</Text>}
      {details.containers.map(container => <VStack gap={2} key={`${container.kind}-${container.name}`}>
        <Heading level={4} wordBreak="break-all">{container.name}</Heading>
        <MetadataList columns="single" label={{ position: "top" }}>
          <MetadataListItem label="Kind">{container.kind === "init" ? "Init container" : container.kind === "ephemeral" ? "Ephemeral container" : "Container"}</MetadataListItem>
          <MetadataListItem label="Image"><Text type="code" wordBreak="break-all">{container.image}</Text></MetadataListItem>
          <MetadataListItem label="State"><StatusBadge status={container.state} /></MetadataListItem>
          <MetadataListItem label="Readiness"><StatusBadge status={container.ready ? "Ready" : "Not ready"} /></MetadataListItem>
          <MetadataListItem label="Restarts">{container.restarts}</MetadataListItem>
          <MetadataListItem label="Declared ports">{container.ports.length === 0 ? "None reported"
            : <VStack gap={1}>{container.ports.map((port, index) => <Text key={`${port.port}-${port.protocol}-${index}`} type="code" wordBreak="break-all">
              {port.name ? `${port.name}: ` : ""}{port.port}/{port.protocol}
            </Text>)}</VStack>}</MetadataListItem>
        </MetadataList>
      </VStack>)}
    </VStack>

    <VStack gap={3}>
      <Heading level={3}>Events</Heading>
      <Text type="supporting">Bounded event snapshot; not a live event stream.</Text>
      {details.eventsState === "denied" && <Text role="status">Events access denied. Pod facts are still available.</Text>}
      {details.eventsState === "unavailable" && <Text role="status">Events unavailable. Refresh details to try again.</Text>}
      {details.eventsState === "partial" && <Text role="status">Event snapshot is incomplete. More events may be available.</Text>}
      {details.eventsState === "complete" && details.events.length === 0 && <Text type="supporting">No events returned.</Text>}
      {details.events.map((event, index) => <MetadataList key={`${event.reason}-${index}`} columns="single" label={{ position: "top" }}>
        <MetadataListItem label="Reason"><Text wordBreak="break-all">{event.reason}</Text></MetadataListItem>
        <MetadataListItem label="Type"><StatusBadge status={event.type} variant={event.type === "Warning" ? "warning" : "neutral"} /></MetadataListItem>
        <MetadataListItem label="Count">{event.count}</MetadataListItem>
        <MetadataListItem label="Last seen"><Text wordBreak="break-all">{event.lastSeen ?? "Unknown"}</Text></MetadataListItem>
      </MetadataList>)}
    </VStack>

    <VStack gap={3}>
      <Heading level={3}>YAML</Heading>
      <YamlEditor label="YAML" value={yaml} onChange={setYaml} isReadOnly={!edit || !canReplace} rows={14} />
      <HStack gap={2} wrap="wrap">
        {edit ? <Button label="Save YAML" isDisabled={!canReplace} onClick={() => onAction("replace", yaml)} /> : <Button label="Edit YAML" variant="ghost" isDisabled={!canReplace} onClick={onEdit} />}
        <Button label="Delete" variant="ghost" isDisabled={permissions.loading || !allowed("delete")} onClick={() => onAction("delete")} />
        <Button label="Force delete" variant="ghost" isDisabled={permissions.loading || !allowed("delete")} onClick={() => onAction("forceDelete")} />
        {details.deletionTimestamp && <Button label="Finalize" variant="ghost" isDisabled={permissions.loading || !allowed("patch")} onClick={() => onAction("finalize")} />}
        {!permissions.loading && !allowed("get") && <Text role="status">Access denied for this Pod.</Text>}
      </HStack>
    </VStack>
  </VStack>;
}
