import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { TopNav } from "@astryxdesign/core/TopNav";
import { IconCategory2, IconArrowLeft, IconArrowRight, IconSearch } from "@tabler/icons-react";
import { useNavigationHistory } from "../layouts/use-navigation-history";

export function AppToolbar({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  const history = useNavigationHistory();

  return (
    <TopNav
      label="App toolbar"
      heading={
        <HStack gap={1} vAlign="center">
          <IconButton label="Home" tooltip="Home" variant="ghost" icon={<Icon icon={IconCategory2} />} onClick={() => void navigate({ to: "/" })} />
          <IconButton label="Go back" tooltip="Go back" variant="ghost" icon={<Icon icon={IconArrowLeft} />} isDisabled={!history.canGoBack} onClick={history.back} />
          <IconButton label="Go forward" tooltip="Go forward" variant="ghost" icon={<Icon icon={IconArrowRight} />} isDisabled={!history.canGoForward} onClick={history.forward} />
        </HStack>
      }
      endContent={
        <Button label="Search" variant="ghost" icon={<Icon icon={IconSearch} />} onClick={onSearch} aria-keyshortcuts="Control+k Meta+k" />
      }
    />
  );
}
