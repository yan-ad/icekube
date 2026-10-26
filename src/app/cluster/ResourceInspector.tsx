import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { IconX, IconArrowsMaximize, IconArrowsMinimize, IconRefresh, IconList, IconTerminal2, IconPlug, IconLogin } from "@tabler/icons-react";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { connectionMessage, errorCode, nextReadId, type SessionRequest, type ResourceKind } from "./api";
import { cancelResourceDetail, loadResourceDetail, type ResourceDetail, type ResourceReference } from "./detailApi";
import { resourceViews } from "./resourceViews";
import { PodTab, usePodDock } from "./PodDock";
import { StatusBadge, NodeConditionBadge } from "./StatusBadge";
import { clusterDestinations } from "./navigation";

export type ResourceSummary = { title: string; facts: { label: string; value: string }[]; status?: string };
type Selection = { type: "resource"; reference: ResourceReference; edit: boolean; relatedColumn?: string; serial: number }
  | { type: "summary"; summary: ResourceSummary; serial: number };
type InspectorApi = {
  selection: Selection | null; isOpen: boolean; closeInspector: () => void;
  openResource: (reference: ResourceReference) => void;
  openPodDetails: (reference: ResourceReference, edit: boolean) => void;
  openSummary: (summary: ResourceSummary) => void;
  openRelated: (reference: ResourceReference, column: string) => void;
  navigateResource: (reference: ResourceReference) => void;
};
const Context = createContext<InspectorApi | null>(null);
export function resourceSection(kind: ResourceKind) {
  return kind === "nodes" ? "nodes" : resourceViews.find(view => view.kind === kind)?.section;
}
export function resourceKindLabel(kind: ResourceKind) {
  return kind === "nodes" ? "Node" : resourceViews.find(view => view.kind === kind)?.label ?? kind;
}
export function ResourceInspectorProvider({ clusterId, children }: { clusterId: string; children: ReactNode }) {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isOpen, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const closeInspector = useCallback(() => {
    setOpen(false);
    const previous = trigger.current;
    requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); });
  }, []);
  const serial = useRef(0);
  const openPodDetails = useCallback((reference: ResourceReference, edit: boolean) => {
    if (!document.activeElement?.closest('[aria-label="Resource details"]')) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ type: "resource", reference: { ...reference }, edit, serial: ++serial.current }); setOpen(true);
  }, []);
  const openResource = useCallback((reference: ResourceReference) => openPodDetails(reference, false), [openPodDetails]);
  const navigateResource = useCallback((reference: ResourceReference) => {
    const section = clusterDestinations.find(item => item.id === resourceSection(reference.kind))?.id;
    if (!section) return;
    void navigate({ to: "/cluster/$clusterId", params: { clusterId }, search: { section } });
    openResource(reference);
  }, [clusterId, navigate, openResource]);
  const openSummary = useCallback((summary: ResourceSummary) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ type: "summary", summary, serial: ++serial.current }); setOpen(true);
  }, []);
  const openRelated = useCallback((reference: ResourceReference, column: string) => {
    if (!document.activeElement?.closest('[aria-label="Resource details"]')) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ type: "resource", reference: { ...reference }, edit: false, relatedColumn: column, serial: ++serial.current }); setOpen(true);
  }, []);
  return <Context.Provider value={{ selection, isOpen, closeInspector, openResource, openPodDetails, openSummary, openRelated, navigateResource }}>{children}</Context.Provider>;
}
export function useResourceInspector() {
  const context = useContext(Context);
  if (!context) throw new Error("ResourceInspectorProvider is required");
  return context;
}
export function ResourceRelationLink({ reference, children, navigate = true }: { reference: ResourceReference; children: string; navigate?: boolean }) {
  const inspector = useResourceInspector();
  return <Button label={children} size="sm" variant="ghost" onClick={() => navigate ? inspector.navigateResource(reference) : inspector.openResource(reference)} />;
}
export function ResourceInspector({ clusterId, sessionId }: SessionRequest) {
  const { selection, isOpen, closeInspector } = useResourceInspector();
  const { openPod } = usePodDock();
  const panel = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(54);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [minimum, setMinimum] = useState(20);
  const onLoadingChange = useCallback((next: boolean) => setLoading(next), []);
  const drag = useRef<{ id: number; target: HTMLElement; x: number; width: number; parent: number } | null>(null);
  const endDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    setDragging(false);
  }, []);
  useEffect(() => {
    if (!isOpen) { endDrag(); setExpanded(false); }
  }, [isOpen, endDrag]);
  useEffect(() => {
    const parent = panel.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const parentWidth = parent.getBoundingClientRect().width;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (parentWidth > 0) setMinimum(Math.min(45, 14 * rem / parentWidth * 100));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => { observer.disconnect(); const current = drag.current; drag.current = null;
      if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id); };
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    const timer = requestAnimationFrame(() => panel.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || [...document.querySelectorAll('dialog[open], [role="menu"]')].some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")) return;
      if (event.composedPath().some(target => target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"], [role="terminal"]')))) return;
      event.preventDefault(); closeInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(timer); window.removeEventListener("keydown", onKeyDown); };
  }, [isOpen, closeInspector]);
  const boundedWidth = Math.max(minimum, Math.min(75, width));
  const resize = (next: number) => { setExpanded(false); setWidth(Math.max(minimum, Math.min(75, next))); };
  const title = selection?.type === "summary" ? selection.summary.title : selection ? selection.reference.name : "Resource details";
  const podReference = selection?.type === "resource" && selection.reference.kind === "pods" && !selection.relatedColumn && selection.reference.namespace ? selection.reference : null;
  return <VStack as="aside" role={isOpen ? "region" : undefined} aria-label={isOpen ? "Resource details" : undefined}
    aria-hidden={!isOpen} inert={!isOpen} ref={panel} tabIndex={isOpen ? -1 : undefined} gap={0}
    className="resource-inspector" data-open={isOpen} data-dragging={dragging} data-expanded={expanded}
    style={{ "--inspector-width": `${expanded ? 75 : boundedWidth}%` } as CSSProperties}>
    {isOpen && selection && <>
    <HStack role="separator" aria-label="Resize resource details" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={Math.ceil(minimum)} aria-valuemax={75} aria-valuenow={Math.round(expanded ? 75 : boundedWidth)} aria-valuetext={`${Math.round(expanded ? 75 : boundedWidth)}% of workspace`}
      className="resource-inspector-resize"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus();
        const parent = panel.current!.parentElement!.getBoundingClientRect().width;
        drag.current = { id: event.pointerId, target: event.currentTarget, x: event.clientX, width: panel.current!.getBoundingClientRect().width, parent };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => { const current = drag.current; if (current?.id === event.pointerId) resize((current.width + current.x - event.clientX) / current.parent * 100); }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onKeyDown={event => {
        const current = expanded ? 75 : boundedWidth;
        const next = event.key === "Home" ? minimum : event.key === "End" ? 75 : event.key === "ArrowLeft" ? current - 2 : event.key === "ArrowRight" ? current + 2 : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }} />
    <HStack padding={2} gap={2} vAlign="center" hAlign="between" className="resource-inspector-header">
      <Text role="heading" aria-level={2} size="sm" weight="semibold" maxLines={1} className="resource-inspector-title">{title}</Text>
      <HStack gap={1} wrap="wrap" className="resource-inspector-actions">
        {podReference && ([{ mode: "logs", label: "Logs", icon: IconList }, { mode: "shell", label: "Shell", icon: IconTerminal2 }, { mode: "attach", label: "Attach", icon: IconLogin }, { mode: "forward", label: "Port forward", icon: IconPlug }] as const).map(action =>
          <IconButton key={action.mode} label={action.label} tooltip={action.label} icon={<Icon icon={action.icon} />} size="sm" variant="ghost" isDisabled={loading || !podReference.uid}
            onClick={() => openPod({ namespace: podReference.namespace!, name: podReference.name, uid: podReference.uid ?? undefined }, action.mode)} />)}
        {selection.type === "resource" && <IconButton label="Refresh details" tooltip="Refresh details" icon={<Icon icon={IconRefresh} />} size="sm" variant="ghost" isDisabled={loading} onClick={() => setRevision(value => value + 1)} />}
        <IconButton label={expanded ? "Restore inspector width" : "Expand inspector"} tooltip={expanded ? "Restore inspector width" : "Expand inspector"} icon={<Icon icon={expanded ? IconArrowsMinimize : IconArrowsMaximize} />} size="sm" variant="ghost" onClick={() => { endDrag(); setExpanded(value => !value); }} />
        <IconButton label="Close inspector" tooltip="Close inspector" icon={<Icon icon={IconX} />} size="sm" variant="ghost" onClick={closeInspector} />
      </HStack>
    </HStack>
    <VStack gap={0} className="resource-inspector-body">
      {selection && isOpen && (selection.type === "summary" ? <VStack padding={4} gap={3}>
        {selection.summary.status && <StatusBadge status={selection.summary.status} />}
        <MetadataList label={{ position: "top" }}>{selection.summary.facts.map((fact, index) => <MetadataListItem key={`${fact.label}-${index}`} label={fact.label}>{fact.value}</MetadataListItem>)}</MetadataList>
      </VStack> : selection.reference.kind === "pods" && !selection.relatedColumn && selection.reference.namespace ?
        <InspectedPod key={JSON.stringify([clusterId, sessionId, selection.serial])} clusterId={clusterId} sessionId={sessionId} reference={selection.reference} edit={selection.edit} revision={revision} onLoadingChange={onLoadingChange} /> :
        <ResourceDetails key={selection.serial} clusterId={clusterId} sessionId={sessionId} selection={selection} revision={revision} onLoadingChange={onLoadingChange} />)}
    </VStack>
    </>}
  </VStack>;
}

export function ResourceInspectorLayout({ clusterId, sessionId, children }: SessionRequest & { children: ReactNode }) {
  return <HStack gap={0} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
    <VStack gap={0} aria-label="Resource workspace" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>{children}</VStack>
    <ResourceInspector clusterId={clusterId} sessionId={sessionId} />
  </HStack>;
}
function InspectedPod({ clusterId, sessionId, reference, edit, revision, onLoadingChange }: SessionRequest & { reference: ResourceReference; edit: boolean; revision: number; onLoadingChange: (loading: boolean) => void }) {
  const pod = useMemo(() => ({ clusterId, sessionId, namespace: reference.namespace!, name: reference.name, ...(reference.uid ? { uid: reference.uid } : {}) }),
    [clusterId, sessionId, reference.namespace, reference.name, reference.uid]);
  return <PodTab tab={{ id: "resource-inspector", mode: edit ? "edit" : "details", pod }} visible embedded refreshRevision={revision} onLoadingChange={onLoadingChange} />;
}
function ResourceDetails({ clusterId, sessionId, selection, revision, onLoadingChange }: SessionRequest & { selection: Extract<Selection, { type: "resource" }>; revision: number; onLoadingChange: (loading: boolean) => void }) {
  const { navigateResource } = useResourceInspector();
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const request = { clusterId, sessionId, reference: selection.reference, readId: nextReadId() };
    setLoading(true); onLoadingChange(true); setError(null);
    void loadResourceDetail(request).then(next => {
      if (disposed) return;
      if (selection.relatedColumn) {
        const target = next.related[selection.relatedColumn];
        if (!target) throw "resourceUnavailable";
        navigateResource(target);
      } else setDetail(next);
    }).catch(reason => {
      if (!disposed) setError(reason === "conflict" ? "This resource was replaced. Close details and select its current row." : reason === "resourceUnavailable" || reason === "notFound" ? "This resource or relationship is no longer available. Refresh the list and try again." : connectionMessage(errorCode(reason)));
    }).finally(() => { if (!disposed) { setLoading(false); onLoadingChange(false); } });
    return () => { disposed = true; void cancelResourceDetail(request).catch(() => {}); };
  }, [clusterId, sessionId, selection, revision, navigateResource, onLoadingChange]);
  const view = resourceViews.find(view => view.kind === selection.reference.kind);
  const labels = new Map(view?.columns.map(column => [column.key, column.label]) ?? []);
  return <VStack padding={4} gap={4} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {loading && <Text role="status">Loading resource details…</Text>}
    {error && <Text role="alert">{detail ? "Retained details may be stale. " : ""}{error}</Text>}
    {detail && <>
      <StatusBadge status={detail.item.status} />
      <MetadataList label={{ position: "top" }}>
        <MetadataListItem label="Name">{detail.item.name}</MetadataListItem>
        {detail.item.namespace && <MetadataListItem label="Namespace"><ResourceRelationLink reference={{ kind: "namespaces", namespace: null, name: detail.item.namespace }}>{detail.item.namespace}</ResourceRelationLink></MetadataListItem>}
        <MetadataListItem label="Created">{detail.item.createdAt ?? "Unknown"}</MetadataListItem>
        <MetadataListItem label="UID">{detail.item.uid ?? "Unknown"}</MetadataListItem>
        <MetadataListItem label="Resource version">{detail.item.resourceVersion ?? "Unknown"}</MetadataListItem>
        {Object.entries(detail.item.columns).map(([key, value]) => <MetadataListItem key={key} label={labels.get(key) ?? key}>
          {detail.related[key] ? <ResourceRelationLink reference={detail.related[key]}>{value}</ResourceRelationLink> : <Text>{value || "Unknown"}</Text>}
        </MetadataListItem>)}
      </MetadataList>
      {detail.item.node && <VStack gap={2}><Text as="h3">Conditions</Text><HStack gap={2} wrap="wrap">{detail.item.node.conditions.map(condition => <NodeConditionBadge key={condition.type} condition={condition} />)}</HStack></VStack>}
      {detail.sections?.map((section, index) => <MetadataList key={`${section.title}-${index}`} title={section.title} label={{ position: "top" }}>
        {section.facts.map((fact, index) => <MetadataListItem key={`${fact.label}-${index}`} label={fact.label}><Text wordBreak="break-all">{fact.value}</Text></MetadataListItem>)}
      </MetadataList>)}
      <Text type="supporting">Only reviewed inventory metadata is shown. Raw objects, credentials, and configuration contents are not exposed.</Text>
    </>}
  </VStack>;
}
