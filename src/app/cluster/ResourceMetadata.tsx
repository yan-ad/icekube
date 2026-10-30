import { useId, useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { DetailMetadata } from "./detailMetadata";
import { DetailList } from "./DetailList";
import { SupportingSection } from "./SupportingSection";

function list(title: string, items: { key: string; value: string }[]) {
  if (items.length === 0) return null;
  return <DetailList title={title}>{items.map(item => <MetadataListItem key={item.key} label={item.key}><Text type="body" wordBreak="break-word">{item.value}</Text></MetadataListItem>)}</DetailList>;
}
export function DetailMetadataView({ metadata }: { metadata: DetailMetadata }) {
  const managedId = useId();
  const [showManaged, setShowManaged] = useState(false);
  return <VStack gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {list("Labels", metadata.labels)}
    {list("Annotations", metadata.annotations)}
    {metadata.finalizers.length > 0 && <DetailList title="Finalizers">{metadata.finalizers.map(value => <MetadataListItem key={value} label="Finalizer"><Text type="code" wordBreak="break-word">{value}</Text></MetadataListItem>)}</DetailList>}
    {metadata.deletionTimestamp && <DetailList title="Deletion"><MetadataListItem label="Timestamp"><Text type="code">{metadata.deletionTimestamp}</Text></MetadataListItem></DetailList>}
    {metadata.managedFields.length > 0 && <SupportingSection title="Managed fields" actions={<IconButton label={showManaged ? "Hide managed fields" : "Show managed fields"} tooltip={showManaged ? "Hide managed fields" : "Show managed fields"} icon={<Icon icon={showManaged ? IconChevronUp : IconChevronDown} />} variant="ghost" size="sm" aria-expanded={showManaged} aria-controls={managedId} onClick={() => setShowManaged(value => !value)} />}>
      <VStack id={managedId} hidden={!showManaged} style={{ display: showManaged ? undefined : "none" }} gap={0}>{showManaged && <MetadataList aria-label="Managed fields" label={{ position: "top" }}>{metadata.managedFields.map((field, index) => <MetadataListItem key={`${field.manager}-${index}`} label={`${field.manager} (${field.operation})`}>
        <VStack gap={1}>
          {field.apiVersion && <Text type="supporting">API version: {field.apiVersion}</Text>}
          {field.time && <Text type="supporting">Time: {field.time}</Text>}
          {field.subresource && <Text type="supporting">Subresource: {field.subresource}</Text>}
          <Text type="code" wordBreak="break-word">{field.fields}</Text>
        </VStack>
      </MetadataListItem>)}</MetadataList>}</VStack>
    </SupportingSection>}
    {metadata.partial && <Text type="supporting">Some metadata is unavailable or redacted.</Text>}
    {!metadata.partial && !metadata.labels.length && !metadata.annotations.length && !metadata.finalizers.length && !metadata.managedFields.length && !metadata.deletionTimestamp && <Text type="supporting">No additional metadata.</Text>}
  </VStack>;
}
