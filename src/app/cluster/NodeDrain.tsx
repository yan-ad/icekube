import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconArrowBarDown } from "@tabler/icons-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { List, ListItem } from "@astryxdesign/core/List";
import { InspectorAction } from "./InspectorActions";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { usePermissionChecks } from "./PermissionProvider";
import type { PermissionCheck } from "./permissionsApi";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { cancelNodeDrain, executeNodeDrain, reviewNodeDrain, validDrainReviewRequest, type DrainCancel, type DrainPod, type DrainReview, type DrainResult } from "./nodeDrainApi";

type Props = SessionRequest & { detail: ResourceDetail; onChanged: () => void };
const reasons: Record<DrainPod["reason"], string> = {
  managed: "Managed Pod", daemonSet: "DaemonSet Pod remains", mirror: "Mirror Pod remains", terminating: "Wait for terminating Pod",
  unmanaged: "Unmanaged Pod blocks drain", localData: "Local data blocks drain", unsupportedController: "Unsupported controller blocks drain", controllerUnavailable: "Controller could not be verified",
};
const outcomeReasons = { disruptionBudget: "PodDisruptionBudget or API rate limit blocked eviction", permissionDenied: "Permission denied", conflict: "Resource changed", unavailable: "API unavailable", cancelled: "Cancellation requested", timeout: "Timed out", newPods: "New or changed Pods require a fresh review" };
function cancel(request: DrainCancel) { return cancelNodeDrain({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }); }
export function NodeDrain(props: Props) {
  const key = JSON.stringify([props.clusterId, props.sessionId, props.detail.readId, props.detail.reference, props.detail.item.resourceVersion]);
  return <GuardedNodeDrain key={key} {...props} />;
}
function GuardedNodeDrain({ clusterId, sessionId, detail, onChanged }: Props) {
  const { reference, item } = detail;
  const checks: PermissionCheck[] = [
    { kind: "nodes", namespace: null, name: reference.name, action: "get" },
    { kind: "nodes", namespace: null, name: reference.name, action: "patch" },
    { kind: "pods", namespace: null, name: null, action: "list" },
  ];
  const permissions = usePermissionChecks(reference.kind === "nodes" ? checks : []);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reviewing" | "reviewed" | "executing" | "finished">("idle");
  const [review, setReview] = useState<DrainReview | null>(null);
  const [result, setResult] = useState<DrainResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(Date.now);
  const operation = useRef<DrainCancel | null>(null);
  const plan = useRef<DrainReview | null>(null);
  const epoch = useRef<string | null>(null);
  const alive = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  useUpdateBlocker(open, "A Node drain review or execution is pending.");
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; plan.current = null;
      const request = operation.current; operation.current = null;
      if (request) void cancel(request).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!review || phase !== "reviewed") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [review, phase]);
  const invalidate = (text: string) => {
    plan.current = null; setInvalid(true); setMessage(text);
    const request = operation.current; operation.current = null;
    if (request) void cancel(request).catch(() => {});
  };
  useLayoutEffect(() => {
    if ((phase === "reviewing" || phase === "reviewed") && epoch.current !== permissions.epoch) {
      invalidate("Permissions changed after review. Reload details and review again.");
      if (phase === "reviewing") setPhase("reviewed");
    }
  }, [permissions.epoch, phase]);
  useEffect(() => {
    if (phase === "reviewed" && review?.expiresAt !== null && review?.expiresAt !== undefined && now >= review.expiresAt && !invalid) {
      invalidate("Drain review expired. Reload details and review again.");
    }
  }, [now, review, phase, invalid]);
  const requestFor = (operationId: number) => ({ clusterId, sessionId, operationId, reference: { ...reference }, resourceVersion: item.resourceVersion ?? "" });
  const valid = detail.clusterId === clusterId && detail.sessionId === sessionId && reference.name === item.name && reference.namespace === item.namespace && reference.uid === item.uid && validDrainReviewRequest(requestFor(1));
  const allowed = !permissions.loading && checks.every(check => permissions.decision(check) === "allowed");
  const busy = phase === "reviewing" || phase === "executing";
  const fresh = review?.expiresAt !== null && review?.expiresAt !== undefined && review.expiresAt > now && review.expiresAt - now <= 120000;
  const canExecute = valid && allowed && !invalid && phase === "reviewed" && review?.canDrain === true && fresh && epoch.current === permissions.epoch && confirmation === reference.name;
  const close = () => {
    if (busy) return;
    const request = operation.current; operation.current = null; plan.current = null;
    if (request) void cancel(request).catch(() => {});
    setOpen(false); setReview(null); setConfirmation(""); setPhase("idle"); setMessage(null);
    if (phase === "finished" || invalid) onChanged();
    else requestAnimationFrame(() => trigger.current?.focus());
  };
  const runReview = async () => {
    if (!valid || !allowed || phase !== "idle" || operation.current || invalid) return;
    const request = requestFor(nextReadId()); operation.current = request;
    epoch.current = permissions.authorizationEpoch(); setPhase("reviewing"); setMessage(null); setConfirmation("");
    try {
      const value = await reviewNodeDrain(request);
      if (!alive.current || operation.current !== request) return;
      if (epoch.current !== permissions.authorizationEpoch()) { invalidate("Permissions changed after review. Reload details and review again."); setPhase("reviewed"); return; }
      const time = Date.now(); setNow(time); setReview(value);
      if (value.canDrain && value.expiresAt !== null && value.expiresAt > time && value.expiresAt - time <= 120000) plan.current = value;
      else if (value.canDrain) invalidate("Drain review expired or its clock is invalid. Reload details and review again.");
      setPhase("reviewed");
    } catch (reason) {
      if (!alive.current || operation.current !== request) return;
      setMessage(`${connectionMessage(errorCode(reason))} Reload details before reviewing again.`); setInvalid(true); setPhase("reviewed");
      operation.current = null; void cancel(request).catch(() => {});
    }
  };
  const execute = async () => {
    const reviewed = plan.current;
    if (!canExecute || !reviewed || epoch.current !== permissions.authorizationEpoch() || reviewed.expiresAt === null || Date.now() >= reviewed.expiresAt || reviewed.expiresAt - Date.now() > 120000) return;
    // Consume locally before invoking: an error or cancellation never re-enables this plan.
    plan.current = null;
    const request = { clusterId, sessionId, operationId: nextReadId(), planId: reviewed.planId! };
    operation.current = request; setPhase("executing"); setConfirmation(""); setMessage(null);
    try {
      const value = await executeNodeDrain(request, reviewed);
      if (!alive.current || operation.current !== request) return;
      setResult(value);
    } catch (reason) {
      if (!alive.current || operation.current !== request) return;
      setMessage(`${connectionMessage(errorCode(reason))} The drain outcome is uncertain. Writes may have reached the API server. Do not replay this plan.`);
    } finally {
      if (alive.current && operation.current === request) { operation.current = null; setPhase("finished"); setStopping(false); }
    }
  };
  const stop = async () => {
    const request = operation.current; if (!request || stopping) return;
    setStopping(true);
    try { await cancelNodeDrain({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }); }
    catch { if (alive.current && operation.current === request) setMessage("Stop could not be confirmed. Dispatched writes cannot be undone. Wait for the operation to settle."); }
  };
  if (reference.kind !== "nodes") return null;
  return <VStack gap={2}>
    <InspectorAction label="Drain" icon={IconArrowBarDown} triggerRef={trigger} pending={open} disabled={!valid || !allowed || open || invalid || phase === "finished"}
      onClick={() => { setOpen(true); setResult(null); setMessage(null); }} />
    {!allowed && <Text size="sm" type="supporting">Drain requires verified Node get and patch access and cluster-wide Pod list access.</Text>}
    {!valid && <Text role="alert" size="sm">Reload details to obtain a matching Node UID and resource version before drain.</Text>}
    <Dialog isOpen={open} purpose={busy ? "required" : "form"} width="min(42rem, 100%)" onOpenChange={value => { if (!value) close(); }}>
      <Layout header={<DialogHeader title={`Drain ${reference.name}`} />} content={<LayoutContent><VStack gap={3}>
        <Text as="p">Cluster: {clusterId}. Node: {reference.name}. UID: {reference.uid}. Resource version: {item.resourceVersion}.</Text>
        <Text as="p">Review is read-only. Confirmation cordons this Node and evicts eligible Pods, respecting PodDisruptionBudgets and graceful termination. No force deletion or local-data override is used. Mirror and DaemonSet Pods remain. The Node is not automatically uncordoned. PVC backing storage is not certified as nonlocal.</Text>
        {phase === "reviewing" && <Text role="status">Reviewing Pods and access…</Text>}
        {review && <VStack gap={2}>
          <Text role="status">{review.partial ? "Incomplete inventory. Drain is blocked." : !review.canDrain ? "Drain is blocked. Resolve the reviewed restrictions before a fresh review." : "Review ready. Confirm the Node name before submitting."}</Text>
          {review.pods.length === 0 && <Text>No Pods were observed in this bounded review.</Text>}
          {review.pods.length > 0 && <List density="compact" edge="flush" hasDividers header="Reviewed Pods">
            {review.pods.map(pod => <ListItem key={`${pod.namespace}/${pod.name}/${pod.uid}`}
              label={<Text size="sm">Namespace: {pod.namespace}. Name: {pod.name}.</Text>}
              description={<Text size="sm" type="supporting">{pod.disposition}: {reasons[pod.reason]}</Text>} />)}
          </List>}
        </VStack>}
        {phase === "reviewed" && review?.canDrain && <TextInput label="Confirm Node name" value={confirmation} onChange={setConfirmation} isReadOnly={invalid} description={`Type ${reference.name} exactly. Review expires after at most two minutes.`} />}
        {message && <Text role="alert">{message}</Text>}
        {phase === "executing" && <Text role="status">{stopping ? "Stop requested. Dispatched writes cannot be undone." : "Draining Node. Waiting for reviewed Pods to disappear…"}</Text>}
        {result && <VStack gap={2}>
          <Text role="status">Drain result: {result.state}. Node cordoned: {result.cordoned ? "yes" : "not confirmed"}.</Text>
          {result.state === "complete" && <Text>Reviewed eligible Pods were observed gone. This is not certification that infrastructure can be safely shut down. Skipped Pods remain.</Text>}
          {result.pods.length > 0 && <List density="compact" edge="flush" hasDividers header="Pod outcomes">
            {result.pods.map(pod => <ListItem key={`${pod.namespace}/${pod.name}/${pod.uid}`}
              label={<Text size="sm">Namespace: {pod.namespace}. Name: {pod.name}. {pod.state}.</Text>}
              description={pod.reason ? <Text size="sm">{outcomeReasons[pod.reason]}</Text> : undefined} />)}
          </List>}
        </VStack>}
        {phase === "finished" && <Text>Do not replay this plan. Close this report to reload details before a fresh review. The Node is never automatically uncordoned.</Text>}
      </VStack></LayoutContent>} footer={<LayoutFooter><HStack gap={2} wrap="wrap">
        {phase === "executing" ? <Button label={stopping ? "Stopping…" : "Stop"} variant="ghost" isDisabled={stopping} onClick={() => void stop()} /> : <Button label={phase === "finished" ? "Close and reload details" : "Cancel"} variant="ghost" isDisabled={busy} onClick={close} />}
        {phase === "idle" && <Button label="Review drain" isDisabled={!valid || !allowed || invalid} onClick={() => void runReview()} />}
        {phase === "reviewed" && <Button label="Confirm drain" isDisabled={!canExecute} onClick={() => void execute()} />}
        {phase === "reviewed" && (invalid || !review?.canDrain) && <Button label="Reload details" onClick={() => { close(); if (!invalid) onChanged(); }} />}
      </HStack></LayoutFooter>} />
    </Dialog>
  </VStack>;
}
