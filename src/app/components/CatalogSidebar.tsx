import { useRouterState } from "@tanstack/react-router";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconPin } from "@tabler/icons-react";
import { categories } from "../navigation";
import { useShellState } from "../layouts/shell-state";
import { NavLink } from "./NavLink";

export function CatalogSidebar({ onNavigate }: { onNavigate: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { pinnedPages, togglePin } = useShellState();

  return (
    <SideNav aria-label="Catalog navigation" style={{ width: "clamp(11rem, 18vw, 16rem)" }}
      header={<VStack padding={4} gap={1}><Text type="label">Catalog</Text><Text type="supporting">Browse your workspace</Text></VStack>}>
      <SideNavSection title="Categories">
        {categories.map((category) => {
          const isPinned = pinnedPages.includes(category.path);
          const label = `${isPinned ? "Unpin" : "Pin"} ${category.label}`;
          return <NavLink key={category.path} to={category.path} label={category.label} icon={category.icon} isSelected={pathname === category.path}
            onClick={onNavigate}
            actions={<IconButton label={label} tooltip={label} variant="ghost" aria-pressed={isPinned} icon={<Icon icon={IconPin} />} onClick={() => togglePin(category.path)} />} />;
        })}
      </SideNavSection>
      <Divider />
      <SideNavSection title="Pinned clusters">
        <VStack paddingInline={4} paddingBlock={2} gap={2}>
          <Text type="supporting">No pinned clusters.</Text>
          <Text type="supporting">Connected clusters will appear here when you pin them.</Text>
        </VStack>
      </SideNavSection>
    </SideNav>
  );
}
