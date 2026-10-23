import { useNavigate } from "@tanstack/react-router";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { MobileNavToggle } from "@astryxdesign/core/MobileNav";
import { IconCategory2, IconArrowLeft, IconArrowRight, IconSearch } from "@tabler/icons-react";
import { useNavigationHistory } from "../layouts/use-navigation-history";
import { WindowToolbar } from "../layouts/WindowFrame";
import { getWindowLayout } from "../layouts/window-layout";

export function AppToolbar({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  const history = useNavigationHistory();
  const layout = getWindowLayout();
  const draggable = layout.seamless && layout.platform !== "browser";

  return (
    <WindowToolbar {...layout}>
        <HStack gap={1} paddingInline={1} vAlign="center" style={{ flexShrink: 0 }}>
          <IconButton label="Home" tooltip="Home" variant="ghost" icon={<Icon icon={IconCategory2} />} onClick={() => void navigate({ to: "/catalog" })} />
          <IconButton label="Go back" tooltip="Go back" variant="ghost" icon={<Icon icon={IconArrowLeft} />} isDisabled={!history.canGoBack} onClick={history.back} />
          <IconButton label="Go forward" tooltip="Go forward" variant="ghost" icon={<Icon icon={IconArrowRight} />} isDisabled={!history.canGoForward} onClick={history.forward} />
        </HStack>
        <StackItem size="fill" aria-hidden="true" data-tauri-drag-region={draggable || undefined}
          style={{ alignSelf: "stretch", minWidth: "var(--spacing-4)" }} />
        <IconButton label="Search" tooltip="Search" variant="ghost" icon={<Icon icon={IconSearch} />} onClick={onSearch} aria-keyshortcuts="Control+k Meta+k" />
        <MobileNavToggle />
    </WindowToolbar>
  );
}
