import type { ReactNode } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { Text } from "@astryxdesign/core/Text";
import { IconInfoCircle } from "@tabler/icons-react";

export function SectionInfo({ label, children }: { label: string; children: ReactNode }) {
  return <Popover label={label} width="22rem" content={<Text size="sm" style={{ overflowWrap: "anywhere" }}>{children}</Text>}>
    <IconButton label={label} tooltip={label} icon={<Icon icon={IconInfoCircle} />} size="sm" variant="ghost" />
  </Popover>;
}
