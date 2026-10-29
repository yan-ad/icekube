import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { DetailMetadata } from "./detailMetadata";

function list(title: string, items: { key: string; value: string }[]) {
  if (items.length === 0) return null;
  return <MetadataList title={title}>{items.map(item => <MetadataListItem key={item.key} label={item.key}><Text type="body" wordBreak="break-word">{item.value}</Text></MetadataListItem>)}</MetadataList>;
}
export function DetailMetadataView({ metadata }: { metadata: DetailMetadata }) {
  const [showManaged, setShowManaged] = useState(false);
  return <VStack gap={3} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {list("Labels", metadata.labels)}
    {list("Annotations", metadata.annotations)}
    {metadata.finalizers.length > 0 && <MetadataList title="Finalizers">{metadata.finalizers.map(value => <MetadataListItem key={value} label="Finalizer"><Text type="code" wordBreak="break-word">{value}</Text></MetadataListItem>)}</MetadataList>}
    {metadata.deletionTimestamp && <MetadataList title="Deletion"><MetadataListItem label="Timestamp"><Text type="code">{metadata.deletionTimestamp}</Text></MetadataListItem></MetadataList>}
    {metadata.managedFields.length > 0 && <VStack gap={2}>
      <Button label={showManaged ? "Hide managed fields" : "Show managed fields"} variant="ghost" size="sm" aria-expanded={showManaged} onClick={() => setShowManaged(value => !value)} />
      {showManaged && <MetadataList title="Managed fields">{metadata.managedFields.map((field, index) => <MetadataListItem key={`${field.manager}-${index}`} label={`${field.manager} (${field.operation})`}>
        <VStack gap={1}>
          {field.apiVersion && <Text type="supporting">API version: {field.apiVersion}</Text>}
          {field.time && <Text type="supporting">Time: {field.time}</Text>}
          {field.subresource && <Text type="supporting">Subresource: {field.subresource}</Text>}
          <Text type="code" wordBreak="break-word">{field.fields}</Text>
        </VStack>
      </MetadataListItem>)}</MetadataList>}
    </VStack>}
    {metadata.partial && <Text type="supporting">Some metadata is unavailable or redacted.</Text>}
    {!metadata.partial && !metadata.labels.length && !metadata.annotations.length && !metadata.finalizers.length && !metadata.managedFields.length && !metadata.deletionTimestamp && <Text type="supporting">No additional metadata.</Text>}
  </VStack>;
}
