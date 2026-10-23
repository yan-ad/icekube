// Copyright (c) Meta Platforms, Inc. and affiliates.

import { useEffect, useState } from "react";
import { Outlet, useParams, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { AppSearch } from "../components/AppSearch";
import { AppToolbar } from "../components/AppToolbar";
import { CatalogSidebar } from "../components/CatalogSidebar";
import { WindowFrame } from "./WindowFrame";
import { getWindowLayout } from "./window-layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Divider } from "@astryxdesign/core/Divider";
import { ClusterSidebar } from "../cluster/ClusterSidebar";

export default function MainLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { clusterId } = useParams({ strict: false });
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("icekube.sidebar-collapsed.v1") === "true"; }
    catch { return false; }
  });
  const [workspaceCollapse, setWorkspaceCollapse] = useState<{ clusterId: string; collapsed: boolean } | null>(null);
  const collapsed = clusterId ? workspaceCollapse?.clusterId === clusterId ? workspaceCollapse.collapsed : true : isSidebarCollapsed;
  function toggleSidebar() {
    if (clusterId) setWorkspaceCollapse({ clusterId, collapsed: !collapsed });
    else setSidebarCollapsed((previous) => !previous);
  }
  useEffect(() => {
    try { localStorage.setItem("icekube.sidebar-collapsed.v1", String(isSidebarCollapsed)); }
    catch { /* Collapse remains available when preference storage is blocked. */ }
  }, [isSidebarCollapsed]);
  useEffect(() => { setWorkspaceCollapse(null); }, [clusterId]);

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
      <WindowFrame {...getWindowLayout()}>
      <AppShell
        style={{ height: "100%", minHeight: 0 }}
        variant="section"
        contentPadding={0}
        mobileNav={{ isOpen: isMobileNavOpen, onOpenChange: setMobileNavOpen, content: <MobileNav header="Catalog navigation">
          <CatalogSidebar id="catalog-sidebar-drawer" onNavigate={closeNavigation} />
          {clusterId && <ClusterSidebar clusterId={clusterId} id="cluster-sidebar-drawer" onNavigate={closeNavigation} />}
        </MobileNav> }}
        topNav={<AppToolbar onSearch={() => setSearchOpen(true)} isSidebarCollapsed={collapsed} onToggleSidebar={toggleSidebar} />}
        sideNav={clusterId ? <HStack gap={0} height="100%">
          <CatalogSidebar onNavigate={closeNavigation} isCollapsed={collapsed} />
          <Divider orientation="vertical" />
          <ClusterSidebar clusterId={clusterId} onNavigate={closeNavigation} />
        </HStack> : <CatalogSidebar onNavigate={closeNavigation} isCollapsed={collapsed} />}
      >
        <Outlet />
      </AppShell>
      </WindowFrame>
      <AppSearch isOpen={isSearchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
