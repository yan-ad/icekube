import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { IconHexagons, IconWorldWww } from "@tabler/icons-react";

export type CatalogKind = "Clusters" | "Web Links";
export const kindIcons = { Clusters: IconHexagons, "Web Links": IconWorldWww };

// Persisted record colors are data, not theme colors. Pick the higher-contrast glyph.
export function recordForeground(color: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

export function RecordIcon({ kind, color }: { kind: CatalogKind; color: string }) {
  return <HStack padding={1} hAlign="center" vAlign="center" aria-hidden="true" data-record-color={color}
    style={{ backgroundColor: color, color: recordForeground(color), borderRadius: "var(--radius-2)", flexShrink: 0 }}>
    <Icon icon={kindIcons[kind]} size="sm" />
  </HStack>;
}
