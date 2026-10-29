import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ResourceItem, SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { hasDeleteIdentity } from "./deleteApi";
import { usePermissionChecks } from "./PermissionProvider";
import { ResourceDelete } from "./ResourceDelete";
import { useWorkspaceRefresh } from "./WorkspaceRefresh";

type Props = SessionRequest & { detail: ResourceDetail; disabled: boolean; onChanged: () => void };

export function ResourcePaneDelete({ clusterId, sessionId, detail, disabled, onChanged }: Props) {
  const { item, reference } = detail;
  const { action } = useWorkspaceRefresh();
  const checks = (["get", "delete"] as const).map(action => ({ kind: reference.kind, namespace: reference.namespace, name: reference.name, action }));
  const permissions = usePermissionChecks(checks);
  const [target, setTarget] = useState<ResourceItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acceptedRead, setAcceptedRead] = useState<number | null>(null);
  const refreshNeeded = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const matching = detail.clusterId === clusterId && detail.sessionId === sessionId
    && reference.name === item.name && reference.namespace === item.namespace && reference.uid === item.uid
    && hasDeleteIdentity(item);
  const unavailable = disabled || !matching || (target !== null && target !== item);
  const allowed = !permissions.loading && checks.every(check => permissions.decision(check) === "allowed");
  const blocked = unavailable || !allowed || acceptedRead === detail.readId || target !== null;
  useEffect(() => {
    if (!restoreFocus.current || blocked || !trigger.current?.isConnected) return;
    const frame = requestAnimationFrame(() => {
      if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
      restoreFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [blocked]);
  useEffect(() => {
    if (disabled && target) {
      setNotice("Inventory changed or became unavailable. Refresh and review the resource before deleting.");
      setTarget(null);
    }
  }, [disabled, target]);
  return <VStack gap={2}>
    <HStack gap={2} wrap="wrap">
      <Button ref={trigger} label="Delete resource" size="sm" variant="ghost" isDisabled={blocked} onClick={() => {
        if (blocked) return;
        setNotice(null);
        refreshNeeded.current = false;
        setTarget(item);
      }} />
    </HStack>
    {notice && <Text role="status" size="sm">{notice}</Text>}
    <ResourceDelete clusterId={clusterId} sessionId={sessionId} kind={reference.kind} selected={[]}
      disabled={unavailable} contextTarget={target} onNotice={setNotice}
      onAccepted={() => setAcceptedRead(detail.readId)} onRefresh={() => { refreshNeeded.current = true; }}
      onContextClose={() => {
        restoreFocus.current = true;
        setTarget(null);
        if (!refreshNeeded.current) return;
        refreshNeeded.current = false;
        onChanged();
        if (action?.clusterId === clusterId) action.refresh();
      }} />
  </VStack>;
}
