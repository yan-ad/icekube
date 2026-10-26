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

const labels: Record<RowAction, string> = { details: "Details", edit: "Edit YAML", logs: "Logs", shell: "Shell", attach: "Attach", forward: "Port forward", delete: "Delete…", stop: "Stop", remove: "Remove", install: "Install…" };
export type RowMenuAction = { action: RowAction; disabled?: boolean };
type Options<T> = SessionRequest & { rows: T[]; scope: string; rowKey: (item: T) => string; rowLabel: (item: T) => string;
  target: (item: T) => NativeContextTarget; actions: (item: T) => RowMenuAction[]; onAction: (item: T, action: RowAction) => void };

/** Row transforms preserve table semantics; the browser menu is anchored to the Actions cell. */
export function useRowContextMenu<T extends Record<string, unknown>>(options: Options<T>): TablePlugin<T> {
  const rowsFingerprint = useMemo(() => JSON.stringify(options.rows), [options.rows]);
  const actionFingerprint = useMemo(() => JSON.stringify(options.rows.map(item => options.actions(item))), [options.rows, options.actions]);
  const fingerprint = useMemo(() => JSON.stringify([options.clusterId, options.sessionId, options.scope, rowsFingerprint,
    actionFingerprint]), [options.clusterId, options.sessionId, options.scope, rowsFingerprint, actionFingerprint]);
  const latest = useRef(options);
  latest.current = options;
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const active = useRef<AbortController | null>(null);
  const [fallback, setFallback] = useState<{ key: string; fingerprint: string; item: T; actions: RowMenuAction[]; controller: AbortController } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setFallback(null);
    setError(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [fingerprint]);
  function close() { active.current?.abort(); active.current = null; setFallback(null); }
  function open(item: T) {
    close(); setError(null);
    const controller = new AbortController();
    active.current = controller;
    const captured = structuredClone(item);
    const actions = options.actions(captured).map(action => ({ ...action }));
    const run = (action: RowAction) => {
      if (controller.signal.aborted || current.current !== fingerprint || !actions.some(entry => entry.action === action && !entry.disabled)) return;
      close();
      latest.current.onAction(captured, action);
    };
    void showNativeContextMenu({ clusterId: options.clusterId, sessionId: options.sessionId,
      target: options.target(captured), actions: actions.filter(entry => !entry.disabled).map(entry => entry.action) }, run, controller.signal)
      .then(handle => {
        if (controller.signal.aborted || current.current !== fingerprint) { handle.dispose(); return; }
        if (!handle.supported) setFallback({ key: options.rowKey(captured), fingerprint, item: captured, actions, controller });
      }).catch(() => {
        if (!controller.signal.aborted && current.current === fingerprint) setError("Could not open row actions. Try again.");
      });
  }
  return {
    transformColumns: columns => [...columns.filter(column => column.key !== "actions"), {
      key: "actions", header: "Actions", width: pixel(80), renderCell: item => {
        const menu = fallback?.fingerprint === fingerprint && fallback.key === options.rowKey(item) ? fallback : null;
        return <DropdownMenu presentation="popover" alignment="end" hasChevron={false} isMenuOpen={!!menu}
          onOpenChange={value => { if (!value) close(); }}
          renderTrigger={() => <IconButton label={`Actions for ${options.rowLabel(item)}`} tooltip="Row actions" size="sm" variant="ghost"
            icon={<Icon icon={IconDots} />} onClick={event => { event.stopPropagation(); open(item); }} />}
          items={(menu?.actions ?? options.actions(item)).map(entry => ({ label: labels[entry.action], isDisabled: entry.disabled,
            onClick: () => {
              if (!menu || menu.controller.signal.aborted || current.current !== menu.fingerprint || entry.disabled) return;
              close(); options.onAction(menu.item, entry.action);
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
  };
}

export function useResourceRowMenu(options: SessionRequest & { rows: ResourceItem[]; scope: string; kind: ResourceKind; unavailable: boolean;
  openResource: (reference: ResourceReference) => void; openPod?: (item: ResourceItem, mode: PodMode) => void }) {
  const rowsFingerprint = useMemo(() => JSON.stringify(options.rows), [options.rows]);
  const identity = useMemo(() => JSON.stringify([options.scope, options.unavailable, rowsFingerprint]), [options.scope, options.unavailable, rowsFingerprint]);
  const [deletion, setDeletion] = useState<{ identity: string; item: ResourceItem } | null>(null);
  const hasPodActions = !!options.openPod;
  const actions = useCallback((item: ResourceItem): RowMenuAction[] => [
    { action: "details" },
    ...(hasPodActions ? (["edit", "logs", "shell", "attach", "forward"] as const).map(action => ({ action, disabled: options.unavailable || !item.namespace || !item.uid })) : []),
    { action: "delete", disabled: options.unavailable || !hasDeleteIdentity(item) },
  ], [hasPodActions, options.unavailable]);
  const plugin = useRowContextMenu({ ...options, scope: identity, rowKey: resourceRowKey, rowLabel: item => item.name,
    target: item => ({ type: "resource", reference: { kind: options.kind, namespace: item.namespace, name: item.name, uid: item.uid } }),
    actions,
    onAction: (item, action) => {
      if (action === "delete") setDeletion({ identity, item });
      else if (options.openPod) options.openPod(item, action as PodMode);
      else if (action === "details") options.openResource({ kind: options.kind, namespace: item.namespace, name: item.name, uid: item.uid });
    },
  });
  return { plugin, contextTarget: deletion?.identity === identity ? deletion.item : null, onContextClose: () => setDeletion(null) };
}
