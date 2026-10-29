import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { IconDots } from "@tabler/icons-react";

type Action = { id: string; label: string; icon: ComponentProps<typeof Icon>["icon"]; disabled?: boolean; pending?: boolean; destructive?: boolean; onClick: () => void; triggerRef?: Ref<HTMLButtonElement> };
type ActionsContext = { actions: Action[]; register: (action: Action) => () => void };
const Context = createContext<ActionsContext | null>(null);
function assignRef(ref: Ref<HTMLButtonElement> | undefined, node: HTMLButtonElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
export function InspectorActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<Action[]>([]);
  const register = useCallback((action: Action) => {
    setActions(previous => previous.some(item => item.id === action.id) ? previous.map(item => item.id === action.id ? action : item) : [...previous, action]);
    return () => setActions(previous => previous.filter(item => item.id !== action.id));
  }, []);
  return <Context.Provider value={{ actions, register }}>{children}</Context.Provider>;
}
export function useInspectorPending() { return useContext(Context)?.actions.some(action => action.pending) ?? false; }
export function InspectorAction({ label, icon, disabled, pending, destructive, onClick, triggerRef }: Omit<Action, "id">) {
  const context = useContext(Context);
  const register = context?.register;
  const id = useId();
  const current = useRef({ disabled, onClick });
  useLayoutEffect(() => { current.current = { disabled, onClick }; });
  useLayoutEffect(() => {
    if (!register) return;
    let active = true;
    const unregister = register({ id, label, icon, disabled, pending, destructive, triggerRef,
      onClick: () => { if (active && !current.current.disabled) current.current.onClick(); } });
    return () => { active = false; unregister(); };
  }, [register, id, label, icon, disabled, pending, destructive, triggerRef]);
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
    const observer = new MutationObserver(() => {
      const saved = restore.current;
      if (!saved) return;
      const open = [...document.querySelectorAll('dialog[open], [role="dialog"]')].some(element => element.getClientRects().length > 0);
      if (open) { saved.sawDialog = true; return; }
      if (!saved.sawDialog) return;
      restore.current = null;
      requestAnimationFrame(() => {
        if (!container.current?.isConnected) return;
        const target = saved.trigger?.isConnected && !saved.trigger.matches(':disabled, [aria-disabled="true"]') ? saved.trigger : more.current ?? container.current.querySelector<HTMLButtonElement>('button:not(:disabled)');
        target?.focus();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "style"] });
    return () => observer.disconnect();
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
