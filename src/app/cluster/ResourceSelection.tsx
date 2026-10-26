import { useLayoutEffect, useMemo, useState } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useTableSelection, useTableSelectionState } from "@astryxdesign/core/Table";
import { IconX } from "@tabler/icons-react";
import type { ResourceItem } from "./api";
import { hasDeleteIdentity, resourceRowKey } from "./deleteApi";

export function useResourceSelection(items: ResourceItem[], scope: string, enabled: boolean) {
  const [stored, setStored] = useState({ scope, keys: new Set<string>() });
  const visible = useMemo(() => new Set(items.filter(hasDeleteIdentity).map(resourceRowKey)), [items]);
  const selectedKeys = useMemo(() => new Set(stored.scope === scope ? [...stored.keys].filter(key => visible.has(key)) : []), [stored, scope, visible]);
  useLayoutEffect(() => {
    setStored(previous => previous.scope === scope && previous.keys.size === selectedKeys.size
      && [...previous.keys].every(key => selectedKeys.has(key)) ? previous : { scope, keys: selectedKeys });
  }, [scope, selectedKeys]);
  const { selectionConfig, selectionState } = useTableSelectionState<ResourceItem>({
    data: items, idKey: resourceRowKey, selectedKeys,
    setSelectedKeys: update => setStored(previous => ({ scope, keys: typeof update === "function" ? update(previous.scope === scope ? previous.keys : new Set()) : update })),
    getIsItemEnabled: item => enabled && hasDeleteIdentity(item),
  });
  const plugin = useTableSelection({ ...selectionConfig, getRowLabel: item => item.namespace ? `${item.namespace}/${item.name}` : item.name });
  const selected = items.filter(item => selectedKeys.has(resourceRowKey(item)) && hasDeleteIdentity(item));
  return { plugin, selected, clear: selectionState.clearSelection, remove: (keys: Set<string>) => {
    setStored(previous => ({ scope, keys: new Set([...previous.keys].filter(key => !keys.has(key))) }));
  } };
}
export function ResourceSelectionSummary({ count, clear }: { count: number; clear: () => void }) {
  return count > 0 ? <HStack gap={1} vAlign="center" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
    <Text role="status">{count} selected</Text>
    <IconButton label="Clear selection" tooltip="Clear selection" icon={<Icon icon={IconX} />} size="sm" variant="ghost" onClick={clear} />
  </HStack> : null;
}
