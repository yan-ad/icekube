import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TablePlugin } from "@astryxdesign/core/Table";

export function TableToolbar({ label, count, context, feedback, children }: { label: string; count?: ReactNode; context?: ReactNode; feedback?: ReactNode; children?: ReactNode }) {
  return <VStack role="region" aria-label={`${label} filters`} tabIndex={0} className="table-toolbar" gap={2} paddingInline={3} paddingBlock={2}
    style={{ flexShrink: 0, minWidth: 0, background: "var(--color-background-surface)" }}>
    <HStack className="table-toolbar-row" gap={3} vAlign="center" wrap="wrap">
      <HStack className="table-toolbar-context" gap={3} vAlign="center" wrap="wrap">
        <HStack gap={3} vAlign="center" wrap="wrap" style={{ minWidth: 0 }}>
          <Text weight="semibold">{label}</Text>
          {count !== undefined && <Text role="status" type="supporting">{count}</Text>}
        </HStack>
        {context}
      </HStack>
      {children && <HStack className="table-toolbar-controls" gap={2} vAlign="center" wrap="wrap">{Children.map(children, child =>
        isValidElement<ComponentProps<typeof TextInput>>(child) && child.type === TextInput
          ? cloneElement(child, { width: "18rem", containerStyle: { ...child.props.containerStyle, flex: "0 1 auto", minWidth: "min(10rem, 100%)", maxWidth: "100%" } })
          : child,
      )}</HStack>}
    </HStack>
    {feedback}
  </VStack>;
}

export function TableActionOverlay({ children, label }: { children: ReactNode; label: string }) {
  return <HStack role="group" aria-label={label} gap={2} hAlign="end" vAlign="end" padding={4}
    style={{ position: "absolute", insetInline: 0, bottom: 0, zIndex: 2,
      paddingTop: "var(--spacing-10)", pointerEvents: "none",
      background: "linear-gradient(to top, var(--color-background-surface), transparent)" }}>
    <HStack gap={2} style={{ pointerEvents: "auto" }}>{children}</HStack>
  </HStack>;
}

export function tableViewport<T extends Record<string, unknown>>(): TablePlugin<T> {
  return {
    transformScrollWrapper: props => ({ ...props, htmlProps: { ...props.htmlProps,
      "data-iceon-table-viewport": "",
      tabIndex: 0,
      // Scrollable clearance lets the final row rise above the floating actions.
      style: { ...props.htmlProps?.style, flex: "1 1 auto", minHeight: 0, minWidth: 0, paddingBottom: "calc(var(--spacing-10) * 2 + var(--spacing-4))", scrollPaddingBottom: "calc(var(--spacing-10) * 2 + var(--spacing-4))" },
    } }),
    transformHeaderCell: props => ({ ...props, htmlProps: { ...props.htmlProps,
      style: { ...props.htmlProps?.style, position: "sticky", top: 0, zIndex: 1, background: "var(--color-background-surface)" },
    } }),
  };
}
