import { useState } from "react";
import { TableActionOverlay } from "./TableToolbar";
import { Text } from "@astryxdesign/core/Text";
import type { ResourceItem, ResourceKind, SessionRequest } from "./api";
import { ResourceCreate } from "./ResourceCreate";
import { ResourceDelete } from "./ResourceDelete";

type Props = SessionRequest & { kind: ResourceKind; namespace?: string; createLabel?: string;
  selected: ResourceItem[]; disabled: boolean; onAccepted: (keys: Set<string>) => void; onRefresh: () => void;
  contextTarget?: ResourceItem | null; onContextClose?: () => void };
export function ResourceActions(props: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  return <>
    {notice && <Text role="status">{notice}</Text>}
    <TableActionOverlay label="Resource actions">
      <ResourceDelete {...props} onNotice={setNotice} />
      <ResourceCreate clusterId={props.clusterId} sessionId={props.sessionId} kind={props.kind} namespace={props.namespace}
        label={props.createLabel} inline onNotice={setNotice} onCreated={props.onRefresh} />
    </TableActionOverlay>
  </>;
}
