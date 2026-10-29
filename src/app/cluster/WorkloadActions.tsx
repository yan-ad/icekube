import { useLayoutEffect, useRef, useState } from "react";
import { InspectorAction } from "./InspectorActions";
import { IconArrowsVertical, IconPlayerPause, IconPlayerPlay, IconPlayerPlayFilled, IconRotateClockwise } from "@tabler/icons-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { usePermissionChecks } from "./PermissionProvider";
import type { PermissionCheck } from "./permissionsApi";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { cancelWorkloadAction, parseReplicas, validWorkloadRequest, workloadAction, type WorkloadAction, type WorkflowRequest } from "./workloadActionsApi";

type Props = SessionRequest & { detail: ResourceDetail; onChanged: () => void };
const icons = { scale: IconArrowsVertical, restart: IconRotateClockwise, suspend: IconPlayerPause, resume: IconPlayerPlay, trigger: IconPlayerPlayFilled };
const labels: Record<WorkloadAction, string> = { scale: "Scale", restart: "Restart", suspend: "Suspend", resume: "Resume", trigger: "Trigger" };
export function workloadActions(detail: ResourceDetail): WorkloadAction[] {
  const kind = detail.reference.kind;
  const actions: WorkloadAction[] = [];
  if (["deployments", "statefulSets", "replicaSets", "replicationControllers"].includes(kind)) actions.push("scale");
  if (["deployments", "daemonSets", "statefulSets"].includes(kind)) actions.push("restart");
  if (["jobs", "cronJobs"].includes(kind)) {
    if (detail.item.columns.suspend === "true") actions.push("resume");
    if (detail.item.columns.suspend === "false") actions.push("suspend");
  }
  if (kind === "cronJobs") actions.push("trigger");
  return actions;
}
export function WorkloadActions(props: Props) {
  const key = JSON.stringify([props.clusterId, props.sessionId, props.detail.reference, props.detail.item.resourceVersion]);
  return <GuardedActions key={key} {...props} />;
}
function GuardedActions({ clusterId, sessionId, detail, onChanged }: Props) {
  const actions = workloadActions(detail);
  const { reference, item } = detail;
  const checks = (action: WorkloadAction): PermissionCheck[] => [
    { kind: reference.kind, namespace: reference.namespace, name: reference.name, action: "get" },
    { kind: action === "trigger" ? "jobs" : reference.kind, namespace: reference.namespace, name: action === "trigger" ? null : reference.name, action: action === "trigger" ? "create" : "patch" },
  ];
  const permissions = usePermissionChecks(actions.flatMap(checks));
  const [confirm, setConfirm] = useState<WorkloadAction | null>(null);
  const [replicas, setReplicas] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef<WorkflowRequest | null>(null);
  useUpdateBlocker(confirm !== null || busy, "A workload action is pending.");
  useLayoutEffect(() => {
    setConfirm(null); setBusy(false); setStopping(false); setRefreshRequired(false);
    return () => {
      const request = active.current; active.current = null;
      if (request) void cancelWorkloadAction({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }).catch(() => {});
    };
  }, [clusterId, sessionId, detail.readId]);
  const requestFor = (action: WorkloadAction, operationId: number): WorkflowRequest => ({ clusterId, sessionId, operationId,
    reference: { ...reference }, resourceVersion: item.resourceVersion ?? "", action, replicas: action === "scale" ? parseReplicas(replicas) : null });
  const hasIdentity = detail.clusterId === clusterId && detail.sessionId === sessionId && reference.uid === item.uid
    && reference.name === item.name && reference.namespace === item.namespace;
  const validIdentity = hasIdentity && actions.some(action => validWorkloadRequest({ ...requestFor(action, 1), replicas: action === "scale" ? 0 : null }));
  const allowed = (action: WorkloadAction) => !permissions.loading && checks(action).every(check => permissions.decision(check) === "allowed");
  const canSubmit = confirm !== null && hasIdentity && validWorkloadRequest(requestFor(confirm, 1)) && allowed(confirm) && !busy && !refreshRequired;
  const submit = async () => {
    if (!confirm || !canSubmit || active.current) return;
    const request = requestFor(confirm, nextReadId());
    active.current = request; setBusy(true); setMessage(null);
    let accepted = false;
    try {
      const result = await workloadAction(request);
      if (active.current !== request) return;
      accepted = true;
      setMessage(`${labels[result.action]} action accepted.${result.created ? ` Job ${result.created.namespace}/${result.created.name} created.` : ""} This does not confirm rollout or workload completion.`);
    } catch (reason) {
      if (active.current !== request) return;
      setMessage(`${connectionMessage(errorCode(reason))} The write may have reached the API server. Refresh details before another action; do not replay this request.`);
    } finally {
      if (active.current === request) {
        active.current = null; setBusy(false); setStopping(false); setConfirm(null); setRefreshRequired(true);
        if (accepted) onChanged();
      }
    }
  };
  const stop = async () => {
    const request = active.current;
    if (!request || stopping) return;
    setStopping(true);
    try { await cancelWorkloadAction({ clusterId: request.clusterId, sessionId: request.sessionId, operationId: request.operationId }); }
    catch { if (active.current === request) setMessage("Stop could not be confirmed. The write may have reached the API server; refresh after this operation settles."); }
  };
  if (!actions.length) return null;
  return <VStack gap={2}>
    <HStack gap={2} wrap="wrap" aria-label="Workload actions">
      {actions.map(action => <InspectorAction key={action} label={labels[action]} icon={icons[action]} pending={confirm !== null || busy}
        disabled={busy || refreshRequired || !hasIdentity || !allowed(action) || !validWorkloadRequest({ ...requestFor(action, 1), replicas: action === "scale" ? 0 : null })}
        onClick={() => { setReplicas(/^\d+$/.test(item.columns.replicas ?? "") ? item.columns.replicas : ""); setMessage(null); setConfirm(action); }} />)}
    </HStack>
    {actions.some(action => !allowed(action)) && <Text size="sm" type="supporting">Actions require verified get and patch access to this resource; Trigger requires get access and create access to Jobs in this namespace.</Text>}
    {!validIdentity && <Text role="alert">Refresh details to obtain a valid matching UID and resource version.</Text>}
    {message && <Text role="status" size="sm">{message}</Text>}
    {refreshRequired && <Text role="alert" size="sm">Refresh details before another workload action.</Text>}
    <Dialog isOpen={confirm !== null} purpose={busy ? "required" : "form"} onOpenChange={open => { if (!open && !busy) setConfirm(null); }} width="min(38rem, 100%)">
      <Layout header={<DialogHeader title={`${confirm ? labels[confirm] : "Update"} ${reference.name}?`} />}
        content={<LayoutContent><VStack gap={3}>
          <Text as="p">Cluster: {clusterId}. Namespace: {reference.namespace}. Resource: {reference.kind}/{reference.name}. UID: {reference.uid}. Resource version: {item.resourceVersion}.</Text>
          {confirm === "scale" && <TextInput label="Replicas" size="sm" value={replicas} onChange={setReplicas} isReadOnly={busy} description="Whole number from 0 to 2147483647. Zero stops all replicas." status={parseReplicas(replicas) === null ? { type: "error", message: "Enter a whole number from 0 to 2147483647." } : undefined} />}
          {confirm === "restart" && <Text as="p">Updates the Pod template restart annotation. OnDelete controllers do not immediately replace existing Pods; those Pods must be replaced separately.</Text>}
          {confirm === "trigger" && <Text as="p">Creates one Job from this CronJob. It may start running immediately.</Text>}
          {(confirm === "suspend" || confirm === "resume") && <Text as="p">Changes spec.suspend on this resource. Suspending a Job can terminate its active Pods; suspending a CronJob prevents future scheduled Jobs, not Jobs already running.</Text>}
          {busy && <Text role="status">{stopping ? "Stop requested. A dispatched write cannot be undone." : "Submitting action…"}</Text>}
        </VStack></LayoutContent>}
        footer={<LayoutFooter><HStack gap={2}>
          {busy ? <Button label={stopping ? "Stopping…" : "Stop"} variant="ghost" isDisabled={stopping} onClick={() => void stop()} /> : <Button label="Cancel" variant="ghost" onClick={() => setConfirm(null)} />}
          <Button label="Confirm action" isDisabled={!canSubmit} onClick={() => void submit()} />
        </HStack></LayoutFooter>} />
    </Dialog>
  </VStack>;
}
