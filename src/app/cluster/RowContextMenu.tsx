import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { IconDots } from "@tabler/icons-react";
import { pixel, type TablePlugin } from "@astryxdesign/core/Table";
import type { ResourceItem, ResourceKind, SessionRequest } from "./api";
import { hasDeleteIdentity, resourceRowKey } from "./deleteApi";
import type { ResourceReference } from "./detailApi";
import { showNativeContextMenu, type NativeContextTarget, type RowAction } from "./nativeContextMenu";
import type { PodMode } from "./podApi";
import { usePermissions, usePermissionRevision } from "./PermissionProvider";
import { permissionCheck, type PermissionCheck, type PermissionAction } from "./permissionsApi";

const labels: Record<RowAction, string> = { details: "Details", edit: "Edit YAML", logs: "Logs", shell: "Shell", attach: "Attach", forward: "Port forward", delete: "Delete…", stop: "Stop", remove: "Remove", install: "Install…" };
export type RowMenuAction = { action: RowAction; disabled?: boolean };
type Options<T> = SessionRequest & { rows: T[]; scope: string; rowKey: (item: T) => string; rowLabel: (item: T) => string;
  target: (item: T) => NativeContextTarget; actions: (item: T) => RowMenuAction[]; onAction: (item: T, action: RowAction) => void;
  beforeOpen?: (item: T, signal: AbortSignal) => Promise<void>;
  authorizationFingerprint?: (item: T) => string };

/** Row transforms preserve table semantics; the browser menu is anchored to the Actions cell. */
export function useRowContextMenu<T extends Record<string, unknown>>(options: Options<T>): TablePlugin<T> {
  const rowsFingerprint = useMemo(() => JSON.stringify(options.rows), [options.rows]);
  const actionFingerprint = useMemo(() => options.beforeOpen ? "review-on-open" : JSON.stringify(options.rows.map(item => options.actions(item))), [options.rows, options.actions, options.beforeOpen]);
  const fingerprint = useMemo(() => ({ clusterId: options.clusterId, sessionId: options.sessionId, scope: options.scope, rowsFingerprint,
    actionFingerprint }), [options.clusterId, options.sessionId, options.scope, rowsFingerprint, actionFingerprint]);
  const latest = useRef(options);
  latest.current = options;
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const active = useRef<AbortController | null>(null);
  const activeItem = useRef<T | null>(null);
  const authorization = activeItem.current ? options.authorizationFingerprint?.(activeItem.current) : undefined;
  const activeAuthorization = useRef<string | undefined>(undefined);
  const [fallback, setFallback] = useState<{ key: string; fingerprint: typeof fingerprint; item: T; actions: RowMenuAction[]; controller: AbortController } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setFallback(null);
    setError(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [fingerprint]);
  useLayoutEffect(() => {
    if (activeAuthorization.current !== undefined && activeAuthorization.current !== authorization) close();
  }, [authorization]);
  function close() { active.current?.abort(); active.current = null; activeItem.current = null; activeAuthorization.current = undefined; setFallback(null); }

  async function open(item: T) {
    const options = latest.current;
    const fingerprint = current.current;
    close(); setError(null);
    const controller = new AbortController();
    active.current = controller;
    const captured = structuredClone(item);
    activeItem.current = captured;
    if (options.beforeOpen) await options.beforeOpen(captured, controller.signal);
    if (controller.signal.aborted || current.current !== fingerprint) return;
    const expiry = setTimeout(() => controller.abort(), 30_000);
    controller.signal.addEventListener("abort", () => clearTimeout(expiry), { once: true });
    const capturedAuthorization = latest.current.authorizationFingerprint?.(captured);
    activeAuthorization.current = capturedAuthorization;
    const valid = () => !controller.signal.aborted && current.current === fingerprint
      && latest.current.authorizationFingerprint?.(captured) === capturedAuthorization;
    const actions = latest.current.actions(captured).map(action => ({ ...action }));
    const run = (action: RowAction) => {
      if (!valid() || !actions.some(entry => entry.action === action && !entry.disabled)
        || !latest.current.actions(captured).some(entry => entry.action === action && !entry.disabled)) return;
      close();
      latest.current.onAction(captured, action);
    };
    void showNativeContextMenu({ clusterId: options.clusterId, sessionId: options.sessionId,
      target: options.target(captured), actions: actions.filter(entry => !entry.disabled).map(entry => entry.action) }, run, controller.signal)
      .then(handle => {
        if (!valid()) { handle.dispose(); return; }
        if (!handle.supported) setFallback({ key: options.rowKey(captured), fingerprint, item: captured, actions, controller });
      }).catch(() => {
        if (!controller.signal.aborted && current.current === fingerprint) {
          controller.abort();
          setError("Could not open row actions. Try again.");
        }
      });
  }
  return useMemo<TablePlugin<T>>(() => ({
    transformColumns: columns => [...columns.filter(column => column.key !== "actions"), {
      key: "actions", header: "Actions", width: pixel(80), renderCell: item => {
        const options = latest.current;
        const menu = fallback?.fingerprint === current.current && fallback.key === options.rowKey(item) ? fallback : null;
        return <DropdownMenu presentation="popover" alignment="end" hasChevron={false} isMenuOpen={!!menu}
          onOpenChange={value => { if (!value) close(); }}
          renderTrigger={() => <IconButton label={`Actions for ${options.rowLabel(item)}`} tooltip="Row actions" size="sm" variant="ghost"
            icon={<Icon icon={IconDots} />} onClick={event => { event.stopPropagation(); open(item); }} />}
          items={(menu?.actions ?? options.actions(item)).map(entry => ({ label: labels[entry.action], isDisabled: entry.disabled,
            onClick: () => {
              if (!menu || menu.controller.signal.aborted || current.current !== menu.fingerprint || entry.disabled
                || latest.current.authorizationFingerprint?.(menu.item) !== activeAuthorization.current
                || !latest.current.actions(menu.item).some(action => action.action === entry.action && !action.disabled)) return;
              close(); latest.current.onAction(menu.item, entry.action);
            } }))} />;
      },
    }],
    transformBodyRow: (props, item) => ({ ...props, htmlProps: { ...props.htmlProps, tabIndex: props.htmlProps.tabIndex ?? 0,
      onContextMenu: event => { event.preventDefault(); event.stopPropagation(); open(item); },
      onKeyDown: event => {
        if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") { event.preventDefault(); event.stopPropagation(); open(item); }
        else props.htmlProps.onKeyDown?.(event);
      },
    } }),
    transformTableContext: children => <>{children}{error && <Text role="alert">{error}</Text>}</>,
  }), [fallback, error]);
}

export function useResourceRowMenu(options: SessionRequest & { rows: ResourceItem[]; scope: string; kind: ResourceKind; unavailable: boolean;
  openResource: (reference: ResourceReference) => void; openPod?: (item: ResourceItem, mode: PodMode) => void }) {
  const identity = useMemo(() => ({}), [options.clusterId, options.sessionId, options.scope, options.kind, options.unavailable, options.rows]);
  const [deletion, setDeletion] = useState<{ identity: typeof identity; item: ResourceItem } | null>(null);
  const hasPodActions = !!options.openPod;
  const permissions = usePermissions();
  usePermissionRevision();
  const check = (item: ResourceItem, action: PermissionAction) => permissionCheck({ kind: options.kind, namespace: item.namespace, name: item.name, action });
  const can = (item: ResourceItem, action: PermissionAction) => permissions.decision(check(item, "get")) === "allowed" && permissions.decision(check(item, action)) === "allowed";
  const podAction = { edit: "update", logs: "logs", shell: "exec", attach: "attach", forward: "portForward" } as const;
  const actions = useCallback((item: ResourceItem): RowMenuAction[] => [
    { action: "details", disabled: permissions.decision(check(item, "get")) === "denied" },
    ...(hasPodActions ? (["edit", "logs", "shell", "attach", "forward"] as const).map(action => ({ action, disabled: options.unavailable || !item.namespace || !item.uid || !can(item, podAction[action]) })) : []),
    { action: "delete", disabled: options.unavailable || !hasDeleteIdentity(item) || !can(item, "delete") },
  ], [hasPodActions, options.unavailable, options.kind, permissions]);
  const plugin = useRowContextMenu({ ...options, scope: JSON.stringify([options.scope, options.kind, options.unavailable]), rowKey: resourceRowKey, rowLabel: item => item.name,
    authorizationFingerprint: item => JSON.stringify([permissions.authorizationEpoch(), permissions.fingerprint([
      check(item, "get"), check(item, "delete"), ...(hasPodActions ? Object.values(podAction).map(action => check(item, action)) : []),
    ])]),
    target: item => ({ type: "resource", reference: { kind: options.kind, namespace: item.namespace, name: item.name, uid: item.uid } }),
    actions,
    beforeOpen: (item, signal) => reviewRowPermissions(permissions, [check(item, "get"), check(item, "delete"), ...(hasPodActions ? Object.values(podAction).map(action => check(item, action)) : [])], signal),
    onAction: (item, action) => {
      if (!actions(item).some(entry => entry.action === action && !entry.disabled)) return;
      if (action === "delete") setDeletion({ identity, item });
      else if (options.openPod) options.openPod(item, action as PodMode);
      else if (action === "details") options.openResource({ kind: options.kind, namespace: item.namespace, name: item.name, uid: item.uid });
    },
  });
  return { plugin, contextTarget: deletion?.identity === identity ? deletion.item : null, onContextClose: () => setDeletion(null) };
}

// Review only the requested row, not every row during table rendering.
function reviewRowPermissions(store: ReturnType<typeof usePermissions>, checks: PermissionCheck[], signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const release = store.request(checks);
    let unsubscribe = () => {};
    let finished = false;
    const finish = () => { if (finished) return; finished = true; unsubscribe(); signal.removeEventListener("abort", finish); release(); resolve(); };
    // Keep these checks subscribed until the menu owner aborts so expiry also revokes an open popup.
    const ready = () => { if (!store.loading(checks)) { unsubscribe(); resolve(); } };
    unsubscribe = store.subscribe(ready);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish(); else ready();
  });
}
