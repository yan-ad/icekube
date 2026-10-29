// Copyright (c) Meta Platforms, Inc. and affiliates.

import { useCallback, useEffect, useState } from "react";
import { Outlet, useParams, useRouterState } from "@tanstack/react-router";
import { AppShell, useAppShellMobile } from "@astryxdesign/core/AppShell";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { AppSearch } from "../components/AppSearch";
import { AppToolbar } from "../components/AppToolbar";
import { CatalogSidebar } from "../components/CatalogSidebar";
import { WindowFrame } from "./WindowFrame";
import { getWindowLayout } from "./window-layout";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { Divider } from "@astryxdesign/core/Divider";
import { ClusterSidebar } from "../cluster/ClusterSidebar";
import { NativeNavigation } from "./NativeNavigation";

function WorkspaceContent() {
  const { isMobile } = useAppShellMobile();
  return <HStack gap={0} height="100%" style={{ width: "100%", minHeight: 0, minWidth: 0 }}>
    {isMobile && <CatalogSidebar id="catalog-sidebar-narrow" onNavigate={() => {}} />}
    <StackItem size="fill" style={{ width: 0, minWidth: 0, minHeight: 0, height: "100%", overflow: "hidden" }}><Outlet /></StackItem>
  </HStack>;
}

export default function MainLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { clusterId } = useParams({ strict: false });
  const [lastClusterId, setLastClusterId] = useState(clusterId);
  const sidebarClusterId = clusterId ?? lastClusterId;
  useEffect(() => {
    if (clusterId) { setLastClusterId(clusterId); return; }
    const timeout = window.setTimeout(() => setLastClusterId(undefined), 200);
    return () => window.clearTimeout(timeout);
  }, [clusterId]);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => { setMobileNavOpen(false); }, [pathname]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.isComposing) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function closeNavigation() { setMobileNavOpen(false); }

  return (
    <>
      <NativeNavigation onSearch={openSearch} />
      <WindowFrame {...getWindowLayout()}>
      <AppShell
        style={{ height: "100%", minHeight: 0 }}
        variant="section"
        contentPadding={0}
        mobileNav={{ hasToggle: false, isOpen: isMobileNavOpen, onOpenChange: setMobileNavOpen, content: <MobileNav header="Catalog navigation">
          <CatalogSidebar id="catalog-sidebar-drawer" onNavigate={closeNavigation} />
          {clusterId && <ClusterSidebar clusterId={clusterId} id="cluster-sidebar-drawer" onNavigate={closeNavigation} />}
        </MobileNav> }}
        topNav={<AppToolbar onSearch={() => setSearchOpen(true)} />}
        sideNav={<HStack gap={0} height="100%" style={{ minHeight: 0 }}>
          <CatalogSidebar onNavigate={closeNavigation} />
          {sidebarClusterId && <HStack gap={0} height="100%" className="cluster-sidebar-motion"
            data-open={!!clusterId} inert={!clusterId} aria-hidden={!clusterId}>
            <Divider orientation="vertical" />
            <ClusterSidebar clusterId={sidebarClusterId} isExiting={!clusterId} onNavigate={closeNavigation} />
          </HStack>}
        </HStack>}
      >
        <WorkspaceContent />
      </AppShell>
      </WindowFrame>
      <AppSearch isOpen={isSearchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
