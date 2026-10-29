import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { IconHexagons, IconWorldWww } from "@tabler/icons-react";

export type CatalogKind = "Clusters" | "Web Links";
export const kindIcons = { Clusters: IconHexagons, "Web Links": IconWorldWww };

function displayColor(color: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const luminance = (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) / 255;
  if (luminance >= 0.42) return color;
  const amount = Math.min(0.72, 0.42 - luminance);
  const lifted = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${lifted.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function RecordIcon({ kind, color, icon }: { kind: CatalogKind; color: string; icon?: IconType }) {
  return <HStack hAlign="center" vAlign="center" aria-hidden="true" data-record-color={color}
    style={{ color: displayColor(color), flexShrink: 0 }}>
    <Icon icon={icon ?? kindIcons[kind]} size="sm" />
  </HStack>;
}
