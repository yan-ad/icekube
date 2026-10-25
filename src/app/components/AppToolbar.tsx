import { useEffect } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconArrowLeft,
  IconArrowRight,
  IconSearch,
} from "@tabler/icons-react";
import { useNavigationHistory } from "../layouts/use-navigation-history";
import { WindowToolbar } from "../layouts/WindowFrame";
import { getWindowLayout } from "../layouts/window-layout";
import { CatalogForms } from "../catalog/CatalogForms";
import { useWorkspaceRefresh } from "../cluster/WorkspaceRefresh";

export function AppToolbar({ onSearch, isSidebarCollapsed, onToggleSidebar }: { onSearch: () => void; isSidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const history = useNavigationHistory();
  const layout = getWindowLayout();
  const draggable = layout.seamless && layout.platform !== "browser";
  const isCatalog = useRouterState({ select: (state) => state.location.pathname.startsWith("/catalog") });
  const mobile = useAppShellMobile();
  const expanded = mobile.isMobile ? mobile.isMobileNavOpen : !isSidebarCollapsed;
  const toggleLabel = mobile.isMobile ? "Open sidebar" : isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const workspaceRefresh = useWorkspaceRefresh();
  const { clusterId } = useParams({ strict: false });
  const refresh = workspaceRefresh.action?.clusterId === clusterId ? workspaceRefresh.action : null;
  useEffect(() => {
    function onRefresh(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r" && !event.isComposing && refresh) {
        event.preventDefault();
        if (refresh.enabled && !event.repeat) refresh.refresh();
      }
    }
    window.addEventListener("keydown", onRefresh);
    return () => window.removeEventListener("keydown", onRefresh);
  }, [refresh]);

  return (
    <WindowToolbar {...layout}>
      <HStack
        gap={1}
        paddingInline={1}
        vAlign="center"
        style={{ flexShrink: 0 }}
      >
        <IconButton
          label={toggleLabel}
          tooltip={toggleLabel}
          aria-expanded={expanded}
          aria-controls={mobile.isMobile ? mobile.mobileNavId : "catalog-sidebar"}
          variant="ghost"
          icon={<Icon icon={expanded ? IconLayoutSidebarLeftCollapse : IconLayoutSidebarLeftExpand} />}
          onClick={mobile.isMobile ? mobile.toggleMobileNav : onToggleSidebar}
        />
        <IconButton
          label="Go back"
          tooltip="Go back"
          variant="ghost"
          icon={<Icon icon={IconArrowLeft} />}
          isDisabled={!history.canGoBack}
          onClick={history.back}
        />
        <IconButton
          label="Go forward"
          tooltip="Go forward"
          variant="ghost"
          icon={<Icon icon={IconArrowRight} />}
          isDisabled={!history.canGoForward}
          onClick={history.forward}
        />
      </HStack>
      <StackItem
        size="fill"
        aria-hidden="true"
        data-tauri-drag-region={draggable || undefined}
        style={{ alignSelf: "stretch", minWidth: "var(--spacing-4)" }}
      />
      <IconButton
        label="Search"
        tooltip="Search"
        variant="ghost"
        icon={<Icon icon={IconSearch} />}
        onClick={onSearch}
        aria-keyshortcuts="Control+k Meta+k"
      />
      {isCatalog && <CatalogForms />}
    </WindowToolbar>
  );
}
