import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { connectionMessage, errorCode, nextReadId, type SessionRequest, type ResourceKind } from "./api";
import { cancelResourceDetail, loadResourceDetail, type ResourceDetail, type ResourceReference } from "./detailApi";
import { resourceViews } from "./resourceViews";
import { PodTab } from "./PodDock";
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
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const timer = requestAnimationFrame(() => panel.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('dialog[open], [role="menu"]')) return;
      event.preventDefault(); closeInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(timer); window.removeEventListener("keydown", onKeyDown); };
  }, [isOpen, closeInspector]);
  if (!isOpen || !selection) return null;
  const title = selection?.type === "summary" ? selection.summary.title : selection ? `${resourceKindLabel(selection.reference.kind)}: ${selection.reference.name}` : "Resource details";
  return <VStack as="aside" role="region" aria-label="Resource details" ref={panel} tabIndex={-1} gap={0}
    style={{ flex: "0 0 min(42rem, 54%)", minWidth: 0, minHeight: 0, overflow: "hidden", borderInlineStart: "var(--border-width-thin) solid var(--color-border-subtle)", background: "var(--color-background-primary)" }}>
    <Layout height="fill" header={<HStack padding={3} gap={2} vAlign="center" hAlign="between"><Heading level={2} wordBreak="break-all">{title}</Heading><Button label="Close" size="sm" variant="ghost" onClick={closeInspector} /></HStack>} content={<LayoutContent isScrollable padding={0}>
      {selection && isOpen && (selection.type === "summary" ? <VStack padding={4} gap={3}>
        {selection.summary.status && <StatusBadge status={selection.summary.status} />}
        <MetadataList label={{ position: "top" }}>{selection.summary.facts.map((fact, index) => <MetadataListItem key={`${fact.label}-${index}`} label={fact.label}>{fact.value}</MetadataListItem>)}</MetadataList>
      </VStack> : selection.reference.kind === "pods" && !selection.relatedColumn && selection.reference.namespace ?
        <InspectedPod key={JSON.stringify([clusterId, sessionId, selection.reference])} clusterId={clusterId} sessionId={sessionId} reference={selection.reference} edit={selection.edit} /> :
        <ResourceDetails key={selection.serial} clusterId={clusterId} sessionId={sessionId} selection={selection} />)}
    </LayoutContent>} />
  </VStack>;
}

export function ResourceInspectorLayout({ clusterId, sessionId, children }: SessionRequest & { children: ReactNode }) {
  return <HStack gap={0} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
    <VStack gap={0} aria-label="Resource workspace" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>{children}</VStack>
    <ResourceInspector clusterId={clusterId} sessionId={sessionId} />
  </HStack>;
}
function InspectedPod({ clusterId, sessionId, reference, edit }: SessionRequest & { reference: ResourceReference; edit: boolean }) {
  const pod = useMemo(() => ({ clusterId, sessionId, namespace: reference.namespace!, name: reference.name, ...(reference.uid ? { uid: reference.uid } : {}) }),
    [clusterId, sessionId, reference.namespace, reference.name, reference.uid]);
  return <PodTab tab={{ id: "resource-inspector", mode: edit ? "edit" : "details", pod }} visible />;
}
function ResourceDetails({ clusterId, sessionId, selection }: SessionRequest & { selection: Extract<Selection, { type: "resource" }> }) {
  const { navigateResource } = useResourceInspector();
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    const request = { clusterId, sessionId, reference: selection.reference, readId: nextReadId() };
    setLoading(true); setError(null);
    void loadResourceDetail(request).then(next => {
      if (disposed) return;
      if (selection.relatedColumn) {
        const target = next.related[selection.relatedColumn];
        if (!target) throw "resourceUnavailable";
        navigateResource(target);
      } else setDetail(next);
    }).catch(reason => {
      if (!disposed) setError(reason === "conflict" ? "This resource was replaced. Close details and select its current row." : reason === "resourceUnavailable" || reason === "notFound" ? "This resource or relationship is no longer available. Refresh the list and try again." : connectionMessage(errorCode(reason)));
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; void cancelResourceDetail(request).catch(() => {}); };
  }, [clusterId, sessionId, selection, revision, navigateResource]);
  const view = resourceViews.find(view => view.kind === selection.reference.kind);
  const labels = new Map(view?.columns.map(column => [column.key, column.label]) ?? []);
  return <VStack padding={4} gap={4} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <HStack gap={2}><Button label="Refresh details" variant="ghost" size="sm" isDisabled={loading} onClick={() => setRevision(value => value + 1)} /></HStack>
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
