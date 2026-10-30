import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";

export function SupportingSection({ title, children, info, actions, level = 3, label = typeof title === "string" ? title : undefined }: {
  title: ReactNode; children: ReactNode; info?: ReactNode; actions?: ReactNode;
  level?: 2 | 3 | 4; label?: string;
}) {
  return <Card elevation="none"><VStack as="section" aria-label={label} gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <HStack gap={2} vAlign="center" wrap="wrap"><Heading level={level}>{title}</Heading>{info}{actions}</HStack>
    {children}
  </VStack></Card>;
}
