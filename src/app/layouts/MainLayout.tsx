// Copyright (c) Meta Platforms, Inc. and affiliates.

import { useEffect, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/Stack";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { AppRail } from "../components/AppRail";
import { AppSearch } from "../components/AppSearch";
import { AppToolbar } from "../components/AppToolbar";
import { CatalogSidebar } from "../components/CatalogSidebar";
import { WindowFrame } from "./WindowFrame";
import { getWindowLayout } from "./window-layout";

export default function MainLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const isCatalog = pathname === "/catalog" || pathname.startsWith("/catalog/");

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
          <AppRail onNavigate={closeNavigation} />
          {isCatalog && <CatalogSidebar onNavigate={closeNavigation} />}
        </MobileNav> }}
        topNav={<AppToolbar onSearch={() => setSearchOpen(true)} />}
        sideNav={
          <HStack gap={0} height="100%">
            <AppRail onNavigate={closeNavigation} />
            {isCatalog && <>
              <Divider orientation="vertical" />
              <CatalogSidebar onNavigate={closeNavigation} />
            </>}
          </HStack>
        }
      >
        <Outlet />
      </AppShell>
      </WindowFrame>
      <AppSearch isOpen={isSearchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
