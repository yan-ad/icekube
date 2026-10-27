import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useTableSelection, useTableSelectionState, type TablePlugin } from "@astryxdesign/core/Table";
import { IconX } from "@tabler/icons-react";
import type { ResourceItem } from "./api";
import { hasDeleteIdentity, resourceRowKey } from "./deleteApi";

export function useResourceSelection(items: ResourceItem[], scope: string, enabled: boolean) {
  const [stored, setStored] = useState({ scope, keys: new Set<string>() });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const visible = useMemo(() => new Set(items.filter(hasDeleteIdentity).map(resourceRowKey)), [items]);
  const selectedKeys = useMemo(() => {
    if (stored.scope !== scope || stored.keys.size === 0) return EMPTY_KEYS;
    const keys = new Set([...stored.keys].filter(key => visible.has(key)));
    return keys.size ? keys : EMPTY_KEYS;
  }, [stored, scope, visible]);
  useLayoutEffect(() => {
    setStored(previous => previous.scope === scope && previous.keys.size === selectedKeys.size
      && [...previous.keys].every(key => selectedKeys.has(key)) ? previous : { scope, keys: selectedKeys });
  }, [scope, selectedKeys]);
  const setSelectedKeys = useCallback((update: Set<string> | ((previous: Set<string>) => Set<string>)) => {
    setStored(previous => ({
      scope: scopeRef.current,
      keys: typeof update === "function" ? update(previous.scope === scopeRef.current ? previous.keys : new Set()) : update,
    }));
  }, []);
  const getIsItemEnabled = useCallback((item: ResourceItem) => enabled && hasDeleteIdentity(item), [enabled]);
  const { selectionConfig, selectionState } = useTableSelectionState<ResourceItem>({
    data: items, idKey: resourceRowKey, selectedKeys,
    setSelectedKeys,
    getIsItemEnabled,
  });
  const selectionPlugin = useTableSelection({ ...selectionConfig, getRowLabel: item => item.namespace ? `${item.namespace}/${item.name}` : item.name });
  const selected = useMemo(() => selectedKeys.size === 0 ? EMPTY_SELECTED : items.filter(item => selectedKeys.has(resourceRowKey(item)) && hasDeleteIdentity(item)), [items, selectedKeys]);
  const selectedCount = selected.length;
  const clear = selectionState.clearSelection;
  const plugin = useMemo<TablePlugin<ResourceItem>>(() => ({
    ...selectionPlugin,
    transformHeaderCell: (props, column, index, columns) => {
      const transformed = selectionPlugin.transformHeaderCell?.(props, column, index, columns) ?? props;
      // The injected checkbox column is not a data heading.
      if (!selectedCount || index === 0) return transformed;
      if (index === 1) return { ...transformed, content: <HStack gap={0} vAlign="center" className="table-selection-heading">
        <HStack gap={0} className="table-selection-original-label">{transformed.content}</HStack>
        <ResourceSelectionSummary count={selectedCount} clear={clear} />
      </HStack> };
      return { ...transformed, content: <HStack gap={0} className="table-selection-muted-label">{transformed.content}</HStack> };
    },
  }), [selectionPlugin, selectedCount, clear]);
  const remove = useCallback((keys: Set<string>) => {
    setStored(previous => previous.scope !== scope ? previous : { scope, keys: new Set([...previous.keys].filter(key => !keys.has(key))) });
  }, [scope]);
  return { plugin, selected, clear: selectionState.clearSelection, remove };
}

const EMPTY_SELECTED: ResourceItem[] = [];
const EMPTY_KEYS = new Set<string>();
export function ResourceSelectionSummary({ count, clear }: { count: number; clear: () => void }) {
  return count > 0 ? <HStack gap={1} vAlign="center" className="table-selection-summary" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
    <Text role="status" aria-live="polite" aria-atomic="true">{count} selected</Text>
    <IconButton label="Clear selection" tooltip="Clear selection" icon={<Icon icon={IconX} />} size="sm" variant="ghost" onClick={clear} />
  </HStack> : null;
}
