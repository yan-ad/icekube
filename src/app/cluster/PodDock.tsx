import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { IconChevronDown, IconChevronUp, IconDots, IconFileText, IconList, IconMaximize, IconMinimize, IconPlug, IconRefresh, IconTerminal2, IconX } from "@tabler/icons-react";
import { podDetail, podForwardList, podForwardStart, podForwardStop, podMessage, podMutate, podStreamClose, podStreamOpen, type PodDetails, type PodForward, type PodIdentity, type PodMode, type PodMutation, type PodRequest, type PodStreamSnapshot } from "./podApi";
import { PodDetailsView } from "./PodDetailsView";
import { TerminalView } from "./TerminalView";
import { useResourceInspector } from "./ResourceInspector";

type Tab = { id: string; pod: PodRequest; mode: PodMode };
const modeIcons = { details: IconFileText, edit: IconFileText, logs: IconList, shell: IconTerminal2, attach: IconTerminal2, forward: IconPlug };
type DockApi = { openPod: (pod: PodIdentity, mode: PodMode) => void; tabs: Tab[]; active: string | null; minimized: boolean; setMinimized: (value: boolean) => void; setActive: (id: string) => void; close: (id: string) => void; onMutation?: () => void; error: string | null; outlet?: HTMLElement | null };
const Context = createContext<DockApi | null>(null);
export function PodDockProvider({ clusterId, sessionId, children, onMutation, outlet }: { clusterId: string; sessionId: string; children: ReactNode; onMutation?: () => void; outlet?: HTMLElement | null }) {
  const { openPodDetails, closeInspector } = useResourceInspector();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const tabsRef = useRef(tabs);
  const [active, setActive] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback((id: string) => {
    const closing = tabsRef.current.find(t => t.id === id);
    const index = tabsRef.current.findIndex(t => t.id === id);
    const next = tabsRef.current.filter(t => t.id !== id);
    const neighbor = next[Math.min(index, next.length - 1)];
    const focusWasInside = document.activeElement?.closest(`[id="pod-panel-${id}"]`) || document.activeElement?.closest("[role=tablist]");
    tabsRef.current = next; setTabs(next);
    setActive(current => current === id ? neighbor?.id ?? null : current);
    setError(null);
    if (focusWasInside) requestAnimationFrame(() => {
      if (!alive.current) return;
      const selected = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const fallback = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === closing?.pod.name) ?? document.querySelector<HTMLButtonElement>('button');
      (selected ?? fallback)?.focus();
    });
  }, []);
  const openPod = useCallback((identity: PodIdentity, mode: PodMode) => {
    if (mode === "details" || mode === "edit") {
      openPodDetails({ kind: "pods", namespace: identity.namespace, name: identity.name, uid: identity.uid }, mode === "edit");
      return;
    }
    closeInspector();
    const current = tabsRef.current;
    if (current.length >= 12) { setError("Close a Pod tab before opening another. The dock supports 12 tabs."); setMinimized(false); return; }
    const tab: Tab = { id: crypto.randomUUID(), pod: { namespace: identity.namespace, name: identity.name, ...(identity.uid ? { uid: identity.uid } : {}), clusterId, sessionId }, mode };
    const next = [...current, tab]; tabsRef.current = next; setTabs(next); setActive(tab.id); setMinimized(false); setError(null);
  }, [clusterId, sessionId, openPodDetails, closeInspector]);
  return <Context.Provider value={{ openPod, tabs, active, minimized, setMinimized, setActive, close, onMutation, error, outlet }}>{children}</Context.Provider>;
}
export function usePodDock() { const value = useContext(Context); if (!value) throw new Error("usePodDock must be used inside PodDockProvider"); return value; }
export function PodDock() {
  const dock = usePodDock();
  const [height, setHeight] = useState(40);
  const [maximized, setMaximized] = useState(false);
  const root = useRef<HTMLElement>(null);
  const select = (id: string) => { dock.setActive(id); dock.setMinimized(false); };
  if (!dock.tabs.length && !dock.error) return null;
  const panel = <VStack as="aside" ref={root} aria-label="Pod dock" gap={0} style={{ flex: "0 0 auto", minHeight: 0, height: dock.minimized ? "auto" : `${maximized ? 80 : height}dvh`, maxHeight: "85dvh", overflow: "hidden", borderBlockStart: "var(--spacing-px, thin) solid var(--color-border)" }} onKeyDown={e => {
    if (e.shiftKey && e.key === "Escape") { e.preventDefault(); dock.setMinimized(true); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w" && dock.active) { e.preventDefault(); dock.close(dock.active); }
  }}>
    {!dock.minimized && <HStack role="separator" aria-label="Resize Pod dock" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={80} aria-valuenow={maximized ? 80 : height} tabIndex={0} style={{ cursor: "ns-resize", minHeight: "var(--spacing-2)", flexShrink: 0 }} onKeyDown={e => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) { e.preventDefault(); setMaximized(false); setHeight(h => e.key === "Home" ? 20 : e.key === "End" ? 80 : Math.max(20, Math.min(80, h + (e.key === "ArrowUp" ? 5 : -5)))); } }} onPointerDown={e => {
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { setMaximized(false); setHeight(Math.max(20, Math.min(80, (window.innerHeight - e.clientY) / window.innerHeight * 100))); } }} onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />}
    <HStack gap={1} paddingInline={2} vAlign="center" style={{ flexShrink: 0, minWidth: 0, borderBlockEnd: "var(--spacing-px, thin) solid var(--color-border)" }}>
      <HStack role="tablist" aria-label="Pod sessions" gap={1} style={{ flex: 1, minWidth: 0, overflowX: "auto" }} onKeyDown={e => {
        const index = dock.tabs.findIndex(t => t.id === dock.active);
        let target: Tab | undefined;
        if (e.key === "ArrowRight") target = dock.tabs[(index + 1) % dock.tabs.length];
        if (e.key === "ArrowLeft") target = dock.tabs[(index - 1 + dock.tabs.length) % dock.tabs.length];
        if (e.key === "Home") target = dock.tabs[0];
        if (e.key === "End") target = dock.tabs[dock.tabs.length - 1];
        if (e.key === "Delete" && dock.active) { e.preventDefault(); dock.close(dock.active); }
        if (target) { e.preventDefault(); select(target.id); document.getElementById(`pod-tab-${target.id}`)?.focus(); }
      }}>{dock.tabs.map(t => <HStack key={t.id} gap={0} vAlign="center" style={{ flexShrink: 0, minWidth: 0, maxWidth: "min(70vw, calc(var(--spacing-10) * 9))", borderBlockEnd: `var(--spacing-0-5) solid ${dock.active === t.id ? "var(--color-text-primary)" : "transparent"}` }}><Button id={`pod-tab-${t.id}`} role="tab" aria-selected={dock.active === t.id} aria-controls={`pod-panel-${t.id}`} tabIndex={dock.active === t.id ? 0 : -1} label={`${t.pod.name} · ${t.mode}`} tooltip={`${t.pod.namespace}/${t.pod.name} · ${t.mode}`} icon={<Icon icon={modeIcons[t.mode]} />} size="sm" variant="ghost" style={{ minWidth: 0 }} onClick={() => select(t.id)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); dock.close(t.id); } }} /><IconButton label={`Close ${t.pod.name} ${t.mode}`} tooltip="Close tab" icon={<Icon icon={IconX} />} size="sm" variant="ghost" onClick={() => dock.close(t.id)} /></HStack>)}</HStack>
      <DropdownMenu presentation="popover" alignment="end" hasChevron={false} renderTrigger={props => <IconButton {...props} label="Tab actions" tooltip="Tab actions" icon={<Icon icon={IconDots} />} size="sm" variant="ghost" />}
        items={[
          { label: "Close active tab", onClick: () => { if (dock.active) dock.close(dock.active); } },
          { label: "Close other tabs", onClick: () => dock.tabs.filter(tab => tab.id !== dock.active).forEach(tab => dock.close(tab.id)) },
          { label: "Close tabs to the right", onClick: () => dock.tabs.slice(dock.tabs.findIndex(tab => tab.id === dock.active) + 1).forEach(tab => dock.close(tab.id)) },
          { label: "Close all tabs", onClick: () => dock.tabs.forEach(tab => dock.close(tab.id)) },
        ]} />
      {!dock.minimized && <IconButton label={maximized ? "Restore dock" : "Maximize dock"} tooltip={maximized ? "Restore dock" : "Maximize dock"} icon={<Icon icon={maximized ? IconMinimize : IconMaximize} />} size="sm" variant="ghost" onClick={() => setMaximized(!maximized)} />}
      <IconButton label={dock.minimized ? "Show dock" : "Minimize dock"} tooltip={dock.minimized ? "Show dock" : "Minimize dock"} icon={<Icon icon={dock.minimized ? IconChevronUp : IconChevronDown} />} size="sm" variant="ghost" onClick={() => dock.setMinimized(!dock.minimized)} />
    </HStack>
    {dock.error && <Text role="alert">{dock.error}</Text>}
    {dock.tabs.map(t => <VStack key={t.id} id={`pod-panel-${t.id}`} role="tabpanel" aria-labelledby={`pod-tab-${t.id}`} style={{ display: !dock.minimized && dock.active === t.id ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden" }}><PodTab tab={t} visible={!dock.minimized && dock.active === t.id} /></VStack>)}
  </VStack>;
  return dock.outlet ? createPortal(panel, dock.outlet) : panel;
}
export function PodTab({ tab, visible, embedded = false, refreshRevision = 0, onLoadingChange }: { tab: Tab; visible: boolean; embedded?: boolean; refreshRevision?: number; onLoadingChange?: (loading: boolean) => void }) {
  const { openPod, onMutation } = usePodDock();
  const [details, setDetails] = useState<PodDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirm, setConfirm] = useState<{ action: PodMutation; yaml?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { onLoadingChange?.(loading || busy); }, [loading, busy, onLoadingChange]);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let disposed = false; setError(null); setLoading(true);
    void podDetail(tab.pod).then(d => { if (!disposed) setDetails(d); }).catch(e => { if (!disposed) setError(podMessage(e)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [tab.pod, revision, refreshRevision]);
  async function mutate() {
    if (!details || !confirm || busy) return;
    setBusy(true); setError(null);
    try { await podMutate(details, confirm.action, confirm.yaml); if (!alive.current) return; setConfirm(null); onMutation?.(); setRevision(r => r + 1); }
    catch (e) { if (alive.current) setError(podMessage(e)); } finally { if (alive.current) setBusy(false); }
  }
  const streaming = tab.mode === "logs" || tab.mode === "shell" || tab.mode === "attach";
  const reload = <IconButton label="Reload details" tooltip="Reload Pod details" icon={<Icon icon={IconRefresh} />} size="sm" variant="ghost" isDisabled={busy} onClick={() => setRevision(r => r + 1)} />;
  return <VStack gap={0} height={embedded ? "auto" : "100%"} style={{ minHeight: 0, minWidth: 0, flexShrink: embedded ? 0 : undefined, overflow: embedded ? "visible" : "hidden" }}>
    {!embedded && (!streaming || !details) && <HStack gap={2} paddingInline={3} vAlign="center" style={{ flexShrink: 0, minWidth: 0 }}><Text as="p" maxLines={1} style={{ flex: 1, minWidth: 0 }}>{tab.pod.namespace}/{tab.pod.name}</Text>{reload}</HStack>}
    {error && <Text role="alert">{details ? "Retained details may be stale. " : ""}{error}</Text>}
    {!details ? <Text as="p">{error ? "Pod details unavailable." : "Loading Pod…"}</Text> : tab.mode === "logs" || tab.mode === "shell" || tab.mode === "attach" ? <StreamPanel details={details} mode={tab.mode} visible={visible} reload={reload} /> : tab.mode === "forward" ? <ForwardPanel details={details} /> : <PodDetailsView key={details.resourceVersion} details={details} edit={tab.mode === "edit"} embedded={embedded} onEdit={() => openPod({ ...tab.pod, uid: details.uid }, "edit")} onOpen={mode => openPod({ ...tab.pod, uid: details.uid }, mode)} onAction={(action, yaml) => setConfirm({ action, yaml })} />}
    <Dialog isOpen={confirm !== null} onOpenChange={open => { if (!open && !busy) setConfirm(null); }} purpose={busy ? "required" : "form"}><Layout header={<DialogHeader title={`${confirm?.action === "replace" ? "Save YAML for" : confirm?.action ?? "Update"} ${tab.pod.name}?`} />} content={<LayoutContent><VStack gap={3}><Text as="p">Cluster: {tab.pod.clusterId}. Namespace: {tab.pod.namespace}. Pod: {tab.pod.name}. UID: {details?.uid}. Resource version: {details?.resourceVersion}.</Text><Text as="p">{confirm?.action === "forceDelete" ? "Danger: force deletion removes the API record without waiting for the process to stop. The workload may continue running." : confirm?.action === "finalize" ? "Danger: removing finalizers bypasses cleanup and may leave resources behind. Only continue if you understand the finalizer's purpose." : confirm?.action === "replace" ? "This updates the live Pod. Protected server fields are preserved by the engine; immutable edits may be rejected." : "This deletes the live Pod. A workload controller may create a replacement."}</Text>{error && <Text role="alert">{error}</Text>}</VStack></LayoutContent>} footer={<LayoutFooter><HStack gap={2}><Button label="Cancel" variant="ghost" isDisabled={busy} onClick={() => setConfirm(null)} /><Button label={busy ? "Working…" : "Confirm mutation"} isDisabled={busy} onClick={() => void mutate()} /></HStack></LayoutFooter>} /></Dialog>
  </VStack>;
}
function StreamPanel({ details, mode, visible, reload }: { details: PodDetails; mode: "logs" | "shell" | "attach"; visible: boolean; reload: ReactNode }) {
  const containers = details.containers.filter(c => mode === "logs" || c.state === "running");
  const [selection, setContainer] = useState("");
  const container = containers.find(c => c.name === selection)?.name ?? containers.find(c => c.kind === "container")?.name ?? containers[0]?.name ?? "";
  const [revision, setRevision] = useState(0);
  const [previous, setPrevious] = useState(false);
  const [timestamps, setTimestamps] = useState(true);
  const [shell, setShell] = useState("sh");
  const [snapshot, setSnapshot] = useState<PodStreamSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false; let owned: PodStreamSnapshot | null = null;
    setSnapshot(null); setError(null);
    if (!container) { setError(mode === "logs" ? "This Pod has no selectable containers." : "This Pod has no running containers."); return; }
    void podStreamOpen({ clusterId: details.clusterId, sessionId: details.sessionId, namespace: details.namespace, name: details.name, uid: details.uid, container, mode, previous, timestamps, tailLines: 500, shell: mode === "shell" ? shell : null }).then(next => {
      if (disposed) { void podStreamClose(next).catch(() => {}); return; }
      owned = next; setSnapshot(next);
    }).catch(e => { if (!disposed) setError(podMessage(e)); });
    return () => { disposed = true; if (owned) void podStreamClose(owned).catch(() => {}); };
  }, [details.clusterId, details.sessionId, details.namespace, details.name, details.uid, container, mode, previous, timestamps, shell, revision]);
  const toolbar = <>
    <Text as="p" color="secondary" maxLines={1} style={{ minWidth: 0, maxWidth: "calc(var(--spacing-10) * 4)" }}>{details.namespace}</Text>
    <Selector label="Container" isLabelHidden size="sm" width="calc(var(--spacing-10) * 5)" value={container} onChange={setContainer} options={containers.map(c => ({ value: c.name, label: `${c.name} (${c.kind})` }))} />
    {mode === "shell" && <Selector label="Shell" isLabelHidden size="sm" width="calc(var(--spacing-10) * 3)" value={shell} onChange={setShell} options={["sh", "bash", "ash", "powershell", "cmd"]} />}
    {reload}
  </>;
  const options = mode === "logs" ? <>
    <Switch label="Timestamps" size="sm" value={timestamps} onChange={setTimestamps} />
    <Switch label="Previous" labelTooltip="Show previous terminated container" size="sm" value={previous} onChange={setPrevious} />
  </> : mode === "attach" ? <Text as="p" color="secondary">Attach sends input to the container's existing process.</Text> : null;
  return <VStack gap={0} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
    {!snapshot && <HStack gap={2} padding={2} vAlign="center" style={{ flexShrink: 0, minWidth: 0, overflowX: "auto" }}>{toolbar}</HStack>}
    {error && <Text role="alert">{error}</Text>}
    {!snapshot && error && container && <Button label="Restart stream" variant="ghost" onClick={() => setRevision(r => r + 1)} />}
    {snapshot ? <TerminalView key={snapshot.streamId} snapshot={snapshot} logs={mode === "logs"} visible={visible} toolbar={toolbar} options={options} onRestart={() => setRevision(r => r + 1)} /> : !error && <Text as="p">Opening {mode}…</Text>}
  </VStack>;
}
function ForwardPanel({ details }: { details: PodDetails }) {
  const [remote, setRemote] = useState(String(details.containers.flatMap(c => c.ports).find(p => p.protocol === "TCP")?.port ?? ""));
  const [local, setLocal] = useState("0");
  const [items, setItems] = useState<PodForward[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const owned = useRef(new Set<string>());
  const request = { clusterId: details.clusterId, sessionId: details.sessionId };
  const reload = async () => { try { const next = await podForwardList(request); if (alive.current) { setItems(next); setError(null); } } catch (e) { if (alive.current) setError(podMessage(e)); } };
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; for (const id of owned.current) void podForwardStop({ ...request, id }).catch(() => {}); }; }, [details.clusterId, details.sessionId]);
  async function start() {
    setBusy(true); setError(null);
    try {
      if (!/^\d+$/.test(remote) || !/^\d+$/.test(local)) throw "invalidInput";
      const next = await podForwardStart({ ...request, namespace: details.namespace, name: details.name, uid: details.uid, remotePort: Number(remote), localPort: Number(local) });
      if (!alive.current) { void podForwardStop({ ...request, id: next.id }).catch(() => {}); return; }
      owned.current.add(next.id); await reload();
    } catch (e) { if (alive.current) setError(podMessage(e)); } finally { if (alive.current) setBusy(false); }
  }
  async function stop(id: string) { setBusy(true); try { await podForwardStop({ ...request, id }); owned.current.delete(id); await reload(); } catch (e) { if (alive.current) setError(podMessage(e)); } finally { if (alive.current) setBusy(false); } }
  return <VStack gap={3} padding={3} isScrollable><Text as="p">Forwarding binds only to 127.0.0.1. Closing this tab stops forwards started here.</Text><HStack gap={2} wrap="wrap"><TextInput label="Remote port" value={remote} onChange={setRemote} /><TextInput label="Local port (0 chooses an available port)" value={local} onChange={setLocal} /><Button label="Start forward" isDisabled={busy} onClick={() => void start()} /><Button label="Refresh forwards" variant="ghost" isDisabled={busy} onClick={() => void reload()} /></HStack>{error && <Text role="alert">{items ? "Retained forward states may be stale. " : ""}{error}</Text>}{items === null ? !error && <Text as="p">Loading forwards…</Text> : items.length === 0 ? <Text as="p">No active forwards returned by the engine.</Text> : items.map(f => <HStack key={f.id} gap={2} wrap="wrap"><Text as="p">{f.namespace}/{f.name} · 127.0.0.1:{f.localPort} → {f.remotePort} · {f.status}{f.error ? ` · ${podMessage(f.error)}` : ""}</Text><Button label={`Stop forward ${f.localPort}`} isDisabled={busy} variant="ghost" onClick={() => void stop(f.id)} /></HStack>)}</VStack>;
}
