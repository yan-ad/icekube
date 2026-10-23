import { useRouterState } from "@tanstack/react-router";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { destinations } from "../navigation";
import { NavLink } from "./NavLink";

export function AppRail({ onNavigate }: { onNavigate: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isCatalog = pathname === "/catalog" || pathname.startsWith("/catalog/");

  return (
    <SideNav aria-label="Apps" collapsible={{ isCollapsed: true, hasButton: false }}>
      <SideNavSection title="Apps" isHeaderHidden>
        {destinations.slice(0, 1).map((destination) => (
          <NavLink key={destination.path} to={destination.path} label={destination.label} icon={destination.icon}
            isSelected={destination.path === "/catalog" ? isCatalog : pathname === destination.path}
            onClick={onNavigate} />
        ))}
      </SideNavSection>
    </SideNav>
  );
}
