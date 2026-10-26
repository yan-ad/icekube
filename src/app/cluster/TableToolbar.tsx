import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TablePlugin } from "@astryxdesign/core/Table";

export function TableToolbar({ label, count, children }: { label: string; count?: ReactNode; children?: ReactNode }) {
  return <HStack role="region" aria-label={`${label} filters`} tabIndex={0} className="table-toolbar" gap={3} paddingInline={3} paddingBlock={2} vAlign="center"
    style={{ flexShrink: 0, minWidth: 0, background: "var(--color-background-surface)" }}>
    <HStack gap={3} vAlign="center" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
      <Text weight="semibold">{label}</Text>
      {count !== undefined && <Text role="status" type="supporting">{count}</Text>}
    </HStack>
    <HStack className="table-toolbar-controls" gap={2} vAlign="center">{Children.map(children, child =>
      isValidElement<ComponentProps<typeof TextInput>>(child) && child.type === TextInput
        ? cloneElement(child, { width: undefined, containerStyle: { ...child.props.containerStyle, flex: "1 1 18rem", minWidth: "10rem" } })
        : child,
    )}</HStack>
  </HStack>;
}

export function tableViewport<T extends Record<string, unknown>>(): TablePlugin<T> {
  return {
    transformScrollWrapper: props => ({ ...props, htmlProps: { ...props.htmlProps,
      "data-icekube-table-viewport": "",
      tabIndex: 0,
      style: { ...props.htmlProps?.style, flex: "1 1 auto", minHeight: 0, minWidth: 0 },
    } }),
    transformHeaderCell: props => ({ ...props, htmlProps: { ...props.htmlProps,
      style: { ...props.htmlProps?.style, position: "sticky", top: 0, zIndex: 1, background: "var(--color-background-surface)" },
    } }),
  };
}
