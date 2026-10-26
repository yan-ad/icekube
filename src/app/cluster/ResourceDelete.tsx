import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconTrash } from "@tabler/icons-react";
import { useCatalog } from "../catalog/CatalogProvider";
import { nextReadId, type ResourceItem, type ResourceKind, type SessionRequest } from "./api";
import { cancelResourceDelete, deleteMessage, deleteResource, hasDeleteIdentity, resourceRowKey, type DeleteCancelRequest, type DeleteTarget } from "./deleteApi";
import { resourceCreation } from "./resourceViews";

type Props = SessionRequest & { kind: ResourceKind; selected: ResourceItem[]; disabled: boolean;
  onAccepted: (keys: Set<string>) => void; onRefresh: () => void; onNotice: (notice: string) => void;
  contextTarget?: ResourceItem | null; onContextClose?: () => void };
type Outcome = { key: string; label: string; state: "accepted" | "deleted" | "failed"; message: string };
const uncertainty = "A deletion may already have reached the API server. Stopping does not undo it. Refresh before retrying; remaining items were not submitted.";

export function ResourceDelete(props: Props) {
  const { snapshot } = useCatalog();
  const cluster = snapshot?.clusters.find(item => item.id === props.clusterId);
  const [confirmation, setConfirmation] = useState<{ targets: DeleteTarget[]; contextTarget?: ResourceItem } | null>(null);
  const consumedContext = useRef<ResourceItem | null>(null);
  useLayoutEffect(() => {
    const target = props.contextTarget;
    if (!target || consumedContext.current === target) return;
    consumedContext.current = target;
    if (!confirmation && hasDeleteIdentity(target) && !props.disabled) {
      setConfirmation({ targets: [{ name: target.name, namespace: target.namespace, uid: target.uid, resourceVersion: target.resourceVersion }], contextTarget: target });
    }
  }, [props.contextTarget, props.disabled, confirmation]);
  return <>
    {props.selected.length > 0 && <IconButton label="Delete selected resources" tooltip={`Delete selected resources (${props.selected.length})`}
      icon={<Icon icon={IconTrash} />} size="lg" variant="secondary" elevation="med"
      style={{ pointerEvents: "auto", borderRadius: "var(--radius-container)" }} isDisabled={props.disabled || !cluster}
      onClick={() => setConfirmation({ targets: props.selected.filter(hasDeleteIdentity).map(({ name, namespace, uid, resourceVersion }) => ({ name, namespace, uid, resourceVersion })) })} />}
    {confirmation && cluster && <DeleteConfirmation {...props} targets={confirmation.targets}
      invalidated={!!confirmation.contextTarget && props.contextTarget !== confirmation.contextTarget}
      clusterName={cluster.name} contextName={cluster.contextName} onClose={() => { setConfirmation(null); props.onContextClose?.(); }} />}
  </>;
}
function DeleteConfirmation({ clusterId, sessionId, kind, targets, clusterName, contextName, disabled, invalidated, onAccepted, onRefresh, onNotice, onClose }: Props & {
  targets: DeleteTarget[]; invalidated: boolean; clusterName: string; contextName: string; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [progress, setProgress] = useState<Outcome[]>([]);
  const completed = useRef<Outcome[]>([]);
  const unavailable = useRef(disabled || invalidated);
  unavailable.current = disabled || invalidated;
  const alive = useRef(false);
  const running = useRef(false);
  const active = useRef<DeleteCancelRequest | null>(null);
  const submitted = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) void cancelResourceDelete(active.current).catch(() => {});
      active.current = null;
    };
  }, []);
  const close = () => {
    alive.current = false;
    if (active.current) void cancelResourceDelete(active.current).catch(() => {});
    active.current = null;
    if (running.current && submitted.current) {
      const known = completed.current.map(result => `${result.label}: ${result.message}`).join(" ");
      onNotice(`${known ? `${known} ` : ""}${uncertainty}`);
      onRefresh();
    }
    onClose();
  };
  useLayoutEffect(() => {
    if ((disabled || invalidated) && !outcomes) {
      if (!running.current) onNotice("Inventory changed or became unavailable. Refresh and review the selection before deleting.");
      close();
    }
  }, [disabled, invalidated, outcomes]);
  const submit = async () => {
    if (!alive.current || unavailable.current || running.current || outcomes) return;
    running.current = true;
    setBusy(true);
    const results: Outcome[] = [];
    for (const target of targets) {
      if (!alive.current || unavailable.current) return;
      const key = resourceRowKey({ ...target, status: "", createdAt: null, columns: {}, node: null });
      const label = target.namespace ? `${target.namespace}/${target.name}` : target.name;
      let request: DeleteCancelRequest | null = null;
      try {
        request = { clusterId, sessionId, kind, readId: nextReadId() };
        active.current = request;
        submitted.current = true;
        const result = await deleteResource({ ...request, ...target });
        if (!alive.current) return;
        results.push({ key, label, state: result.deleted ? "deleted" : "accepted", message: result.deleted ? "Deleted" : "Deletion accepted; grace periods or finalizers may still apply." });
        onAccepted(new Set([key]));
      } catch (reason) {
        if (!alive.current) return;
        results.push({ key, label, state: "failed", message: `${deleteMessage(reason)} The outcome is not assumed; refresh before retrying.` });
      } finally {
        if (active.current === request) active.current = null;
      }
      completed.current = [...results];
      setProgress(completed.current);
    }
    if (!alive.current) return;
    running.current = false;
    setBusy(false);
    setOutcomes(results);
    onRefresh();
  };
  return <Dialog isOpen purpose="form" width="min(38rem, 100%)" onOpenChange={open => { if (!open) close(); }}>
    <DialogHeader title={`Delete ${targets.length} ${resourceCreation[kind].kind} resource${targets.length === 1 ? "" : "s"}?`} onOpenChange={open => { if (!open) close(); }} />
    <VStack gap={3} padding={4} style={{ overflowY: "auto", overflowWrap: "anywhere", minHeight: 0 }}>
      <VStack gap={1} aria-label="Deletion target"><Text>Cluster: {clusterName}</Text><Text>Cluster ID: {clusterId}</Text><Text>Context: {contextName}</Text></VStack>
      {!outcomes && <>
        <Text>Only these selected resources will be deleted. Kubernetes may also remove their dependents. This cannot be undone.</Text>
        <VStack gap={1} role="list" aria-label="Resources to delete">{targets.map(target => <Text role="listitem" key={resourceRowKey({ ...target, status: "", createdAt: null, columns: {}, node: null })}>
          {target.namespace ? `${target.namespace}/${target.name}` : target.name}
        </Text>)}</VStack>
        <Text type="supporting">UID and resource-version checks reject replaced or changed resources. Normal grace periods and finalizers are respected.</Text>
      </>}
      {busy && <Text role="status">Submitting deletions one at a time. Stopping does not roll back submitted requests.</Text>}
      {progress.length > 0 && <VStack gap={2} aria-label="Deletion results">
        <Text role="status">{progress.filter(result => result.state !== "failed").length} accepted or deleted; {progress.filter(result => result.state === "failed").length} failed. {busy ? "Submitting remaining resources…" : "Refreshing inventory…"}</Text>
        {progress.map(result => <Text key={result.key} role={result.state === "failed" ? "alert" : "status"}>{result.label}: {result.message}</Text>)}
      </VStack>}
      <HStack gap={2} wrap="wrap">
        <Button label={busy ? "Stop deleting" : outcomes ? "Close" : "Cancel"} variant="ghost" onClick={close} />
        {!outcomes && <Button label={`Delete ${targets.length} resource${targets.length === 1 ? "" : "s"}`} variant="secondary" isDisabled={disabled} isLoading={busy} onClick={() => void submit()} />}
      </HStack>
    </VStack>
  </Dialog>;
}
