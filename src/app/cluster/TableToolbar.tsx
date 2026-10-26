import type { ReactNode } from "react";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TablePlugin } from "@astryxdesign/core/Table";

export function TableToolbar({ label, count, children }: { label: string; count?: ReactNode; children?: ReactNode }) {
  return <HStack role="region" aria-label={`${label} filters`} gap={3} paddingInline={3} paddingBlock={2} vAlign="center" wrap="wrap"
    style={{ flexShrink: 0, minWidth: 0, background: "var(--color-background-surface)" }}>
    <Text weight="semibold">{label}</Text>
    {count !== undefined && <Text role="status" type="supporting" style={{ whiteSpace: "nowrap" }}>{count}</Text>}
    <StackItem size="fill" />
    <HStack gap={2} vAlign="center" wrap="wrap" style={{ minWidth: 0, maxWidth: "100%" }}>{children}</HStack>
  </HStack>;
}

export function tableViewport<T extends Record<string, unknown>>(): TablePlugin<T> {
  return {
    transformScrollWrapper: props => ({ ...props, htmlProps: { ...props.htmlProps,
      style: { ...props.htmlProps?.style, flex: "1 1 auto", minHeight: 0, overflow: "auto", overscrollBehavior: "none" },
    } }),
    transformHeaderCell: props => ({ ...props, htmlProps: { ...props.htmlProps,
      style: { ...props.htmlProps?.style, position: "sticky", top: 0, zIndex: 1, background: "var(--color-background-surface)" },
    } }),
  };
}
