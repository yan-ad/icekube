import { useId } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconRefresh } from "@tabler/icons-react";

type ContentErrorProps = {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
  retained?: boolean;
};

export function ContentError({ title, message, onRetry, retryLabel = "Refresh", disabled = false, retained = false }: ContentErrorProps) {
  const titleId = useId();
  const retry = onRetry && <VStack gap={1} hAlign={retained ? "start" : "center"}>
    <Button label={retryLabel} icon={<Icon icon={IconRefresh} />} variant="ghost" isDisabled={disabled} onClick={onRetry} />
    {!disabled && <Text type="supporting" color="secondary">Cmd/Ctrl+R</Text>}
  </VStack>;
  return <VStack role="alert" aria-labelledby={titleId} data-content-error={retained ? "retained" : "blocking"}
    gap={3} padding={retained ? 3 : 6} hAlign={retained ? "stretch" : "center"} vAlign="center"
    style={{ flex: retained ? "0 0 auto" : "1 1 0", minHeight: retained ? undefined : "calc(var(--spacing-10) * 4)", minWidth: 0, overflowWrap: "anywhere" }}>
    <HStack gap={3} vAlign={retained ? "start" : "center"} hAlign={retained ? "start" : "center"}
      style={{ width: "100%", maxWidth: "36rem", flexDirection: retained ? "row" : "column" }}>
      <Icon icon="error" color="error" size={retained ? "md" : "lg"} />
      <VStack gap={2} hAlign={retained ? "start" : "center"} style={{ minWidth: 0 }}>
        <Heading id={titleId} level={2} justify={retained ? "start" : "center"}>{title}</Heading>
        <Text justify={retained ? "start" : "center"} style={{ color: "var(--color-error)" }}>{message}</Text>
        {retained && <Text role="status" type="supporting" color="secondary">Updates unavailable. Showing the last successful snapshot, which may be stale.</Text>}
        {retry}
      </VStack>
    </HStack>
  </VStack>;
}
