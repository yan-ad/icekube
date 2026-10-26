import { useState } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ResourceItem, ResourceKind, SessionRequest } from "./api";
import { ResourceCreate } from "./ResourceCreate";
import { ResourceDelete } from "./ResourceDelete";

type Props = SessionRequest & { kind: ResourceKind; namespace?: string; createLabel?: string;
  selected: ResourceItem[]; disabled: boolean; onAccepted: (keys: Set<string>) => void; onRefresh: () => void };
export function ResourceActions(props: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  return <>
    {notice && <Text role="status">{notice}</Text>}
    <HStack gap={2} role="group" aria-label="Resource actions" style={{ position: "absolute", right: "var(--spacing-4)", bottom: "var(--spacing-4)" }}>
      <ResourceDelete {...props} onNotice={setNotice} />
      <ResourceCreate clusterId={props.clusterId} sessionId={props.sessionId} kind={props.kind} namespace={props.namespace}
        label={props.createLabel} inline onNotice={setNotice} onCreated={props.onRefresh} />
    </HStack>
  </>;
}
