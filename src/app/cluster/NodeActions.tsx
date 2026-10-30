import { useLayoutEffect, useRef, useState } from "react";
import { InspectorAction } from "./InspectorActions";
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { usePermissionChecks } from "./PermissionProvider";
import type { PermissionCheck } from "./permissionsApi";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { cancelNodeAction, nodeAction, validNodeActionRequest, type NodeAction, type NodeActionRequest } from "./nodeActionsApi";

type Props = SessionRequest & { detail: ResourceDetail; onChanged: () => void };
const labels: Record<NodeAction, string> = { cordon: "Cordon", uncordon: "Uncordon" };
export function NodeActions(props: Props) {
  const key = JSON.stringify([props.clusterId, props.sessionId, props.detail.readId, props.detail.reference, props.detail.item.resourceVersion, props.detail.item.node?.schedulable]);
  return <GuardedNodeActions key={key} {...props} />;
}
function GuardedNodeActions({ clusterId, sessionId, detail, onChanged }: Props) {
  const { reference, item } = detail;
  const action: NodeAction | null = typeof item.node?.schedulable === "boolean" ? (item.node.schedulable ? "cordon" : "uncordon") : null;
  const checks: PermissionCheck[] = ["get", "patch"].map(verb => ({ kind: "nodes", namespace: null, name: reference.name, action: verb as "get" | "patch" }));
  const permissions = usePermissionChecks(reference.kind === "nodes" ? checks : []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef<NodeActionRequest | null>(null);
  useUpdateBlocker(confirm || busy, "A Node scheduling action is pending.");
  useLayoutEffect(() => () => {
    const request = active.current; active.current = null;
    if (request) void cancelNodeAction({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }).catch(() => {});
  }, []);
  const requestFor = (operationId: number): NodeActionRequest => ({ clusterId, sessionId, operationId, reference: { ...reference }, resourceVersion: item.resourceVersion ?? "", action: action ?? "cordon" });
  const validIdentity = detail.clusterId === clusterId && detail.sessionId === sessionId && reference.uid === item.uid
    && reference.name === item.name && reference.namespace === item.namespace && action !== null && validNodeActionRequest(requestFor(1));
  const allowed = !permissions.loading && checks.every(check => permissions.decision(check) === "allowed");
  const canSubmit = validIdentity && allowed && !busy && !refreshRequired;
  const submit = async () => {
    if (!confirm || !canSubmit || active.current) return;
    const request = requestFor(nextReadId()); active.current = request; setBusy(true); setMessage(null);
    let accepted = false;
    try {
      const result = await nodeAction(request);
      if (active.current !== request) return;
      accepted = result.accepted;
      setMessage(result.accepted ? `${labels[result.action]} action accepted. Refresh details to inspect scheduling state.` : "The scheduling action was not accepted. Refresh details before another action.");
    } catch (reason) {
      if (active.current !== request) return;
      setMessage(`${connectionMessage(errorCode(reason))} The write may have reached the API server. Refresh details before another action; do not replay this request.`);
    } finally {
      if (active.current === request) {
        active.current = null; setBusy(false); setStopping(false); setConfirm(false); setRefreshRequired(true);
        if (accepted) onChanged();
      }
    }
  };
  const stop = async () => {
    const request = active.current; if (!request || stopping) return;
    setStopping(true);
    try { await cancelNodeAction({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }); }
    catch { if (active.current === request) setMessage("Stop could not be confirmed. The write may have reached the API server; refresh after this operation settles."); }
  };
  if (reference.kind !== "nodes") return null;
  return <>
      <InspectorAction label={action ? labels[action] : "Scheduling unavailable"} icon={action === "uncordon" ? IconLockOpen : IconLock} pending={confirm || busy} disabled={!canSubmit}
        onClick={() => { setMessage(null); setConfirm(true); }} />
    {!allowed && <Text size="sm" type="supporting">Scheduling actions require verified get and patch access to this Node.</Text>}
    {!validIdentity && <Text role="alert">Refresh details to obtain a valid matching UID, resource version, and scheduling state.</Text>}
    {message && <Text role="status" size="sm">{message}</Text>}
    {refreshRequired && <Text role="alert" size="sm">Refresh details before another scheduling action.</Text>}
    <Dialog isOpen={confirm} purpose={busy ? "required" : "form"} onOpenChange={open => { if (!open && !busy) setConfirm(false); }} width="min(38rem, 100%)">
      <Layout header={<DialogHeader title={`${action ? labels[action] : "Update"} ${reference.name}?`} />}
        content={<LayoutContent><VStack gap={3}>
          <Text as="p">Cluster: {clusterId}. Node: {reference.name}. UID: {reference.uid}. Resource version: {item.resourceVersion}.</Text>
          <Text as="p">{action === "cordon" ? "Marks this Node unschedulable to prevent ordinary new Pod scheduling." : "Marks this Node schedulable again. Other scheduling constraints still apply."} This does not evict existing Pods.</Text>
          {busy && <Text role="status">{stopping ? "Stop requested. A dispatched write cannot be undone." : "Submitting scheduling action…"}</Text>}
        </VStack></LayoutContent>}
        footer={<LayoutFooter><HStack gap={2}>
          {busy ? <Button label={stopping ? "Stopping…" : "Stop"} variant="ghost" isDisabled={stopping} onClick={() => void stop()} /> : <Button label="Cancel" variant="ghost" onClick={() => setConfirm(false)} />}
          <Button label="Confirm action" isDisabled={!canSubmit} onClick={() => void submit()} />
        </HStack></LayoutFooter>} />
    </Dialog>
  </>;
}
