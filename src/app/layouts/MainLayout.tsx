// Copyright (c) Meta Platforms, Inc. and affiliates.

import { useEffect, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AppRail } from "../components/AppRail";
import { AppSearch } from "../components/AppSearch";
import { AppToolbar } from "../components/AppToolbar";
import { CatalogSidebar } from "../components/CatalogSidebar";
import { useShellState } from "./shell-state";

export default function MainLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { storageWarning } = useShellState();
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
      <AppShell
        variant="section"
        contentPadding={0}
        mobileNav={{ isOpen: isMobileNavOpen, onOpenChange: setMobileNavOpen }}
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
        banner={storageWarning ? <VStack padding={2}><Text role="status">Shortcuts cannot be saved on this device. Pins will last for this session only.</Text></VStack> : undefined}
      >
        <Outlet />
      </AppShell>
      <AppSearch isOpen={isSearchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
