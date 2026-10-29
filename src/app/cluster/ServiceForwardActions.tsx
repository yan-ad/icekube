import { useLayoutEffect, useRef, useState } from "react";
import { InspectorAction } from "./InspectorActions";
import { IconPlug } from "@tabler/icons-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import type { ResourceDetail } from "./detailApi";
import { usePermissionChecks } from "./PermissionProvider";
import type { PermissionCheck } from "./permissionsApi";
import { podForwardStop } from "./podApi";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { parseLocalPort, serviceForwardCancel, serviceForwardStart, servicePorts, validServiceForwardRequest, type ServiceForwardRequest, type ServiceForwardResult } from "./serviceForwardApi";

type Props = SessionRequest & { detail: ResourceDetail };
export function ServiceForwardActions(props: Props) {
  return <ForwardActions key={JSON.stringify([props.clusterId, props.sessionId, props.detail.readId, props.detail.reference, props.detail.item.resourceVersion])} {...props} />;
}
function ForwardActions({ clusterId, sessionId, detail }: Props) {
  const { reference, item } = detail;
  const ports = servicePorts(detail);
  const checks: PermissionCheck[] = [
    { kind: "services", action: "get", namespace: reference.namespace, name: reference.name },
    { kind: "pods", action: "list", namespace: reference.namespace, name: null },
  ];
  const permissions = usePermissionChecks(reference.kind === "services" ? checks : []);
  const [port, setPort] = useState<number | null>(null);
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ServiceForwardResult | null>(null);
  const active = useRef<{ request: ServiceForwardRequest; cancelled: boolean } | null>(null);
  useUpdateBlocker(port !== null || busy, "A Service forward is pending.");
  useLayoutEffect(() => () => {
    const operation = active.current; active.current = null;
    if (operation) { operation.cancelled = true; void serviceForwardCancel({ clusterId, sessionId, operationId: operation.request.operationId }).catch(() => {}); }
  }, [clusterId, sessionId]);
  const allowed = !permissions.loading && checks.every(c => permissions.decision(c) === "allowed");
  const identity = detail.clusterId === clusterId && detail.sessionId === sessionId && reference.uid === item.uid && reference.name === item.name && reference.namespace === item.namespace;
  const requestFor = (servicePort: number, operationId: number): ServiceForwardRequest => ({ clusterId, sessionId, operationId, reference: { ...reference }, resourceVersion: item.resourceVersion ?? "", servicePort, localPort: parseLocalPort(local) ?? -1 });
  const ready = identity && allowed && !busy;
  const stop = async () => {
    const operation = active.current; if (!operation || stopping) return;
    operation.cancelled = true; setStopping(true);
    try { await serviceForwardCancel({ clusterId, sessionId, operationId: operation.request.operationId }); }
    catch { if (active.current === operation) setMessage("Cancellation could not be confirmed. Any late listener will be stopped when its response arrives."); }
  };
  const submit = async () => {
    if (port === null || !ready || !validServiceForwardRequest(requestFor(port, 1)) || active.current) return;
    const operation = { request: requestFor(port, nextReadId()), cancelled: false };
    active.current = operation; setBusy(true); setMessage(null); setResult(null);
    try {
      const next = await serviceForwardStart(operation.request);
      if (operation.cancelled || active.current !== operation) {
        await podForwardStop({ clusterId, sessionId, id: next.forward.id });
        if (active.current === operation) setMessage("Forward cancelled.");
      } else setResult(next);
    } catch (reason) {
      if (active.current === operation) setMessage(connectionMessage(errorCode(reason)));
    } finally {
      if (active.current === operation) { active.current = null; setBusy(false); setStopping(false); setPort(null); }
    }
  };
  if (reference.kind !== "services") return null;
  return <VStack gap={2}>
    <HStack gap={2} wrap="wrap" aria-label="Service forwarding">
      <InspectorAction label="Forward Service port" icon={IconPlug} pending={port !== null || busy} disabled={!ready || !ports.some(p => validServiceForwardRequest({ ...requestFor(p, 1), localPort: 0 }))} onClick={() => { setLocal(""); setPort(ports[0] ?? null); setMessage(null); }} />
    </HStack>
    {!ports.length && <Text size="sm" type="supporting">No reviewed TCP Service ports are available. Refresh details.</Text>}
    {!allowed && <Text size="sm" type="supporting">Forwarding requires verified Service get and Pod list access. Rust checks get and port-forward access for the selected Pod.</Text>}
    {!identity && <Text role="alert">Refresh details to obtain a matching Service UID and resource version.</Text>}
    {message && <Text role="status" size="sm">{message}</Text>}
    {result && <VStack gap={1}><Text role="status">Local address: 127.0.0.1:{result.forward.localPort}</Text><Text size="sm">Service {result.reference.namespace}/{result.reference.name}:{result.servicePort} forwards to Pod {result.pod.name}:{result.forward.remotePort}. Remote connection begins when a local client connects. Manage the listener in Port forwarding.</Text></VStack>}
    <Dialog isOpen={port !== null} purpose={busy ? "required" : "form"} onOpenChange={open => { if (!open) { if (busy) void stop(); else setPort(null); } }} width="min(38rem, 100%)">
      <Layout header={<DialogHeader title={`Forward Service ${reference.name}`} />}
        content={<LayoutContent><VStack gap={3}>
          <Text>Cluster: {clusterId}. Namespace: {reference.namespace}. UID: {reference.uid}. Resource version: {item.resourceVersion}.</Text>
          <Selector label="Service port" value={String(port ?? "")} onChange={value => setPort(Number(value))} isDisabled={busy} options={ports.map(value => ({ value: String(value), label: String(value) }))} />
          <TextInput label="Local port" value={local} onChange={setLocal} isReadOnly={busy} description="Leave blank to allocate an IPv4 loopback port. Otherwise enter 0 to 65535." status={parseLocalPort(local) === null ? { type: "error", message: "Enter a whole number from 0 to 65535." } : undefined} />
          <Text size="sm">Rust selects a Running, Ready Pod from this Service's selector. Remote connection begins when a local client connects.</Text>
          {busy && <Text role="status">{stopping ? "Cancelling forward…" : "Resolving Service and starting listener…"}</Text>}
        </VStack></LayoutContent>}
        footer={<LayoutFooter><HStack gap={2}><Button label={stopping ? "Cancelling…" : "Cancel"} variant="ghost" isDisabled={stopping} onClick={() => { if (busy) void stop(); else setPort(null); }} /><Button label="Start forward" isDisabled={port === null || !ready || !validServiceForwardRequest(requestFor(port ?? 0, 1))} onClick={() => void submit()} /></HStack></LayoutFooter>} />
    </Dialog>
  </VStack>;
}
