import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { IconDots } from "@tabler/icons-react";

type Action = { id: string; label: string; icon: ComponentProps<typeof Icon>["icon"]; disabled?: boolean; pending?: boolean; destructive?: boolean; onClick: () => void; triggerRef?: Ref<HTMLButtonElement> };
type ActionsContext = { actions: Action[]; upsert: (action: Action) => void; remove: (id: string) => void };
const Context = createContext<ActionsContext | null>(null);
function assignRef(ref: Ref<HTMLButtonElement> | undefined, node: HTMLButtonElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
export function InspectorActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<Action[]>([]);
  const upsert = useCallback((action: Action) => {
    setActions(previous => previous.some(item => item.id === action.id) ? previous.map(item => item.id === action.id ? action : item) : [...previous, action]);
  }, []);
  const remove = useCallback((id: string) => setActions(previous => previous.filter(item => item.id !== id)), []);
  return <Context.Provider value={{ actions, upsert, remove }}>{children}</Context.Provider>;
}
export function useInspectorPending() { return useContext(Context)?.actions.some(action => action.pending) ?? false; }
export function InspectorAction({ label, icon, disabled, pending, destructive, onClick, triggerRef }: Omit<Action, "id">) {
  const context = useContext(Context);
  const upsert = context?.upsert;
  const remove = context?.remove;
  const id = useId();
  const current = useRef({ disabled, onClick });
  const active = useRef(false);
  useLayoutEffect(() => { current.current = { disabled, onClick }; });
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; remove?.(id); };
  }, [remove, id]);
  useLayoutEffect(() => {
    upsert?.({ id, label, icon, disabled, pending, destructive, triggerRef,
      onClick: () => { if (active.current && !current.current.disabled) current.current.onClick(); } });
  }, [upsert, id, label, icon, disabled, pending, destructive, triggerRef]);
  return context ? null : <Button ref={triggerRef} label={label} size="sm" variant="ghost" isDisabled={disabled} onClick={onClick} />;
}
export function InspectorToolbar({ primary = [], children }: { primary?: Action[]; children: ReactNode }) {
  const context = useContext(Context);
  const actions = [...primary, ...(context?.actions ?? [])];
  const container = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const restore = useRef<{ trigger: HTMLElement | null; sawDialog: boolean } | null>(null);
  useLayoutEffect(() => {
    const header = container.current?.parentElement;
    if (!header) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const touch = matchMedia("(pointer: coarse)").matches;
      const required = (actions.length + 3) * (touch ? 3 : 2) + 10;
      const next = header.getBoundingClientRect().width < required * rem;
      setCompact(next);
      if (!next) setMenuOpen(false);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(header);
    return () => observer.disconnect();
  }, [actions.length]);
  useLayoutEffect(() => {
    let frame: number | null = null;
    const usable = (node: HTMLElement | null | undefined): node is HTMLElement => !!node?.isConnected && node.getClientRects().length > 0
      && getComputedStyle(node).visibility !== "hidden" && !node.matches(':disabled, [aria-disabled="true"]');
    const observer = new MutationObserver(() => {
      const saved = restore.current;
      if (!saved) return;
      const open = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]')].some(usable);
      if (open) { saved.sawDialog = true; return; }
      if (!saved.sawDialog || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (restore.current !== saved || !container.current?.isConnected) return;
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== document.body && focused !== saved.trigger
          && !focused.closest('dialog, [role="dialog"]') && usable(focused)) { restore.current = null; return; }
        const target = [saved.trigger, more.current, ...container.current.querySelectorAll<HTMLButtonElement>('button')].find(usable);
        if (target) { restore.current = null; target.focus(); }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "style", "disabled", "aria-disabled"] });
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, []);
  const activate = (action: Action, trigger: HTMLElement | null) => {
    if (action.disabled) return;
    restore.current = { trigger, sawDialog: false };
    action.onClick();
  };
  return <HStack ref={container} gap={1} wrap="wrap" className="resource-inspector-actions" role="group" aria-label="Resource actions">
    {!compact && actions.map(action => <IconButton key={action.id} ref={action.triggerRef} label={action.label} tooltip={action.label}
      icon={<Icon icon={action.icon} />} size="sm" variant="ghost" isDisabled={action.disabled}
      onClick={event => activate(action, event.currentTarget)} />)}
    {compact && actions.length > 0 && <DropdownMenu presentation="popover" alignment="end" hasChevron={false} isMenuOpen={menuOpen} onOpenChange={setMenuOpen}
      renderTrigger={props => <IconButton {...props} ref={node => { props.ref(node); more.current = node; actions.forEach(action => assignRef(action.triggerRef, node)); }} label="More actions" tooltip="More actions" icon={<Icon icon={IconDots} />} size="sm" variant="ghost" />}
      items={actions.map(action => ({ id: action.id, label: action.label, icon: action.icon, isDisabled: action.disabled,
        variant: action.destructive ? "destructive" as const : undefined, onClick: () => activate(action, more.current) }))} />}
    {children}
  </HStack>;
}
