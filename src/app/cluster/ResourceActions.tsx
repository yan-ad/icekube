import { useState } from "react";
import { TableActionOverlay } from "./TableToolbar";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import type { ResourceItem, ResourceKind, SessionRequest } from "./api";
import { ResourceCreate } from "./ResourceCreate";
import { ResourceDelete } from "./ResourceDelete";
import { useResourcePermissions } from "./PermissionProvider";
import { ReadOnlyNotice } from "./ReadOnlyNotice";
import { creationNamespaced } from "./createApi";

type Props = SessionRequest & { kind: ResourceKind; namespace?: string; createLabel?: string;
  selected: ResourceItem[]; disabled: boolean; onAccepted: (keys: Set<string>) => void; onRefresh: () => void;
  contextTarget?: ResourceItem | null; onContextClose?: () => void };
export function ResourceActions(props: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = useResourcePermissions(props.kind, props.namespace || null);
  const writes = [
    ...(!creationNamespaced(props.kind) || props.namespace ? [{ kind: props.kind, namespace: props.namespace || null, action: "create" as const }] : []),
    ...(props.contextTarget ? [props.contextTarget] : props.selected).map(target => ({ kind: props.kind, namespace: target.namespace, name: target.name, action: "delete" as const })),
  ];
  const unverified = !permissions.loading && writes.some(check => permissions.observed(check) && permissions.decision(check) === "unknown");
  return <>
    {(permissions.readOnly || unverified || notice) && <VStack gap={0} style={{ flexShrink: 0 }}>
      <ReadOnlyNotice readOnly={permissions.readOnly} unverified={unverified} />
      {notice && <Text role="status">{notice}</Text>}
    </VStack>}
    <TableActionOverlay label="Resource actions">
      <ResourceDelete {...props} onNotice={setNotice} />
      <ResourceCreate clusterId={props.clusterId} sessionId={props.sessionId} kind={props.kind} namespace={props.namespace}
        label={props.createLabel} inline onNotice={setNotice} onCreated={props.onRefresh} />
    </TableActionOverlay>
  </>;
}
