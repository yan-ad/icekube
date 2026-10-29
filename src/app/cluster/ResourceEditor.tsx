import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { YamlEditor } from "../components/YamlEditor";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { usePermissionChecks } from "./PermissionProvider";
import { cancelResourceEdit, editResource, resourceEditable, type EditRequest, type EditMode } from "./resourceEditApi";

type Props = SessionRequest & { detail: ResourceDetail; onChanged: () => void };
const uncertainty = "The write may have reached the API server. Cancellation does not undo it. Reload the baseline and inspect the resource before another write; do not replay the request.";
export function ResourceEditor(props: Props) {
  return <ScopedEditor key={JSON.stringify([props.clusterId, props.sessionId, props.detail.reference, props.detail.item.resourceVersion])} {...props} />;
}
function ScopedEditor({ clusterId, sessionId, detail, onChanged }: Props) {
  const { reference, item } = detail;
  const checks = ["get", "patch"].map(action => ({ kind: reference.kind, namespace: reference.namespace, name: reference.name, action: action as "get" | "patch" }));
  const permissions = usePermissionChecks(resourceEditable(reference.kind) ? checks : []);
  const allowed = !permissions.loading && checks.every(check => permissions.decision(check) === "allowed");
  const identity = detail.clusterId === clusterId && detail.sessionId === sessionId && reference.uid === item.uid && !!reference.uid
    && reference.name === item.name && reference.namespace === item.namespace;
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState("");
  const [version, setVersion] = useState("");
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef<EditRequest | null>(null);
  const alive = useRef(false);
  useUpdateBlocker(open || busy, "Resource editing is open.");
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; const request = active.current; active.current = null; if (request) void cancelResourceEdit(request).catch(() => {}); };
  }, []);
  const submit = async (mode: EditMode) => {
    if (!allowed || !identity || active.current || (mode !== "read" && (!version || reloadRequired)) || (mode === "apply" && reviewed !== yaml)) return;
    const request: EditRequest = { clusterId, sessionId, operationId: nextReadId(), reference: { ...reference }, mode,
      ...(mode === "read" ? {} : { resourceVersion: version, yaml }) };
    active.current = request; setBusy(true); setMessage(null); setReviewed(null);
    try {
      const result = await editResource(request);
      if (!alive.current || active.current !== request) return;
      if (mode === "read") { setYaml(result.yaml!); setVersion(result.resourceVersion); setReloadRequired(false); }
      else if (mode === "dryRun") { setReviewed(request.yaml!); setMessage("Server dry-run passed for this exact reduced YAML. Confirm to apply these reviewed field changes."); }
      else { setReloadRequired(true); setMessage("Changes accepted by the API server. This does not confirm rollout or workload completion. Reload the baseline before another edit."); onChanged(); }
    } catch (reason) {
      if (!alive.current || active.current !== request) return;
      setMessage(`${connectionMessage(errorCode(reason))}${mode === "apply" ? ` ${uncertainty}` : " Reload the baseline if the object has changed."}`);
      if (mode === "apply") setReloadRequired(true);
      if (mode === "read") { setYaml(""); setVersion(""); }
    } finally {
      if (alive.current && active.current === request) { active.current = null; setBusy(false); }
    }
  };
  const close = () => {
    const request = active.current; active.current = null;
    if (request) { void cancelResourceEdit(request).catch(() => {}); if (request.mode === "apply") { setReloadRequired(true); setMessage(uncertainty); } }
    setBusy(false); setOpen(false); setYaml(""); setVersion(""); setReviewed(null);
  };
  if (!resourceEditable(reference.kind)) return null;
  return <VStack gap={2}>
    <Button label="Edit YAML" size="sm" variant="ghost" isDisabled={!allowed || !identity || busy} onClick={() => { setOpen(true); void submit("read"); }} />
    {!allowed && <Text size="sm" type="supporting">Editing requires verified get and patch access to this resource. Unknown access does not permit editing.</Text>}
    {!open && message && <Text role="status">{message}</Text>}
    <Dialog isOpen={open} purpose="form" width="min(48rem, 100%)" onOpenChange={value => { if (!value) close(); }}>
      <DialogHeader title={`Edit ${reference.name}`} onOpenChange={value => { if (!value) close(); }} />
      <VStack gap={3} padding={4} style={{ minHeight: 0, overflowY: "auto", overflowWrap: "anywhere" }}>
        <Text>Cluster: {clusterId}. Namespace: {reference.namespace ?? "Cluster-scoped"}. Resource: {reference.kind}/{reference.name}. UID: {reference.uid}. Resource version: {version || "Loading"}.</Text>
        <Text>This is reduced YAML, not the full raw resource. Only the displayed reviewed operational fields can be edited. Omitted server fields, including credentials and container environment, are preserved. Container names, order and count cannot change. Removing a displayed scalar removes that field; new fields and null values are not accepted.</Text>
        {busy && <Text role="status">{active.current?.mode === "read" ? "Loading reviewed fields…" : "Submitting request…"}</Text>}
        {!busy && !version && <Text>No baseline is loaded. Reload the baseline before editing.</Text>}
        {version && <YamlEditor label="Reviewed resource YAML" value={yaml} rows={16} isReadOnly={busy || reloadRequired} onChange={value => { if (!active.current && !reloadRequired) { setYaml(value); setReviewed(null); setMessage(null); } }} />}
        {message && <Text role="status">{message}</Text>}
        {reloadRequired && <Text role="alert">Reload the baseline and inspect the resource before another edit.</Text>}
        {!allowed && <Text role="alert">Access is unverified or denied. Editing is disabled.</Text>}
        <HStack gap={2} wrap="wrap">
          <Button label={busy ? "Cancel request and close" : "Close"} variant="ghost" onClick={close} />
          <Button label="Reload baseline" variant="ghost" isDisabled={busy || !allowed || !identity} onClick={() => void submit("read")} />
          <Button label="Server dry-run" isDisabled={busy || !allowed || !version || reloadRequired || !yaml.trim()} onClick={() => void submit("dryRun")} />
          <Button label="Confirm apply" isDisabled={busy || !allowed || reloadRequired || reviewed !== yaml || !version} onClick={() => void submit("apply")} />
        </HStack>
      </VStack>
    </Dialog>
  </VStack>;
}
