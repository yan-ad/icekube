import { useRouterState } from "@tanstack/react-router";
import { Divider } from "@astryxdesign/core/Divider";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { categories, destinations } from "../navigation";
import { useShellState } from "../layouts/shell-state";
import { NavLink } from "./NavLink";

export function AppRail({ onNavigate }: { onNavigate: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { pinnedPages } = useShellState();
  const isCatalog = pathname === "/catalog" || pathname.startsWith("/catalog/");

  return (
    <SideNav aria-label="Pinned apps" collapsible={{ isCollapsed: true, hasButton: false }}>
      <SideNavSection title="Apps" isHeaderHidden>
        {destinations.slice(0, 2).map((destination) => (
          <NavLink key={destination.path} to={destination.path} label={destination.label} icon={destination.icon}
            isSelected={destination.path === "/catalog" ? isCatalog : pathname === destination.path}
            onClick={onNavigate} />
        ))}
      </SideNavSection>
      {pinnedPages.length > 0 && <>
        <Divider />
        <SideNavSection title="Pinned pages" isHeaderHidden>
          {pinnedPages.map((path) => {
            const destination = categories.find((item) => item.path === path)!;
            return <NavLink key={path} to={path} label={destination.label} icon={destination.icon} isSelected={pathname === path} onClick={onNavigate} />;
          })}
        </SideNavSection>
      </>}
    </SideNav>
  );
}
