// Copyright (c) Meta Platforms, Inc. and affiliates.

import { useEffect, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { AppSearch } from "../components/AppSearch";
import { AppToolbar } from "../components/AppToolbar";
import { CatalogSidebar } from "../components/CatalogSidebar";
import { WindowFrame } from "./WindowFrame";
import { getWindowLayout } from "./window-layout";

export default function MainLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("icekube.sidebar-collapsed.v1") === "true"; }
    catch { return false; }
  });
  function toggleSidebar() {
    setSidebarCollapsed((previous) => !previous);
  }
  useEffect(() => {
    try { localStorage.setItem("icekube.sidebar-collapsed.v1", String(isSidebarCollapsed)); }
    catch { /* Collapse remains available when preference storage is blocked. */ }
  }, [isSidebarCollapsed]);

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
        </MobileNav> }}
        topNav={<AppToolbar onSearch={() => setSearchOpen(true)} isSidebarCollapsed={isSidebarCollapsed} onToggleSidebar={toggleSidebar} />}
        sideNav={<CatalogSidebar onNavigate={closeNavigation} isCollapsed={isSidebarCollapsed} />}
      >
        <Outlet />
      </AppShell>
      </WindowFrame>
      <AppSearch isOpen={isSearchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
