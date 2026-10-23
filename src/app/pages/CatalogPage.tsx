import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { IconPin } from "@tabler/icons-react";
import { categories } from "../navigation";
import { useShellState } from "../layouts/shell-state";

export default function CatalogPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { pinnedPages, togglePin } = useShellState();
  const category = categories.find((item) => item.path === pathname);
  const isClusters = pathname === "/catalog/clusters";
  const isWebLinks = pathname === "/catalog/web-links";

  return (
    <Layout height="fill"
      header={<LayoutHeader hasDivider>
        <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
          <Heading level={1}>{category?.label ?? "Catalog"}</Heading>
          {category && <IconButton
            label={`${pinnedPages.includes(category.path) ? "Unpin" : "Pin"} ${category.label} page`}
            tooltip={`${pinnedPages.includes(category.path) ? "Unpin from" : "Pin to"} app rail`}
            variant="ghost" icon={<Icon icon={IconPin} />}
            aria-pressed={pinnedPages.includes(category.path)} onClick={() => togglePin(category.path)} />}
        </HStack>
      </LayoutHeader>}
      content={<LayoutContent padding={6}>
        {isClusters || isWebLinks ? <VStack gap={5}>
          <Text type="supporting">{isClusters ? "Cluster inventory is not connected. No kubeconfig files have been read." : "Web link storage is not connected. No links have been loaded."}</Text>
          <Table data={[]}
            columns={isClusters ? [
              { key: "name", header: "Name" },
              { key: "source", header: "Source" },
              { key: "version", header: "Version" },
              { key: "distribution", header: "Distribution" },
              { key: "status", header: "Status" },
            ] : [{ key: "name", header: "Name" }, { key: "url", header: "URL" }]}
            density="compact"
            aria-label={isClusters ? "Clusters" : "Web links"}
            emptyState={<VStack padding={6} gap={2} hAlign="center">
              <Heading level={2}>{isClusters ? "No clusters loaded" : "No web links loaded"}</Heading>
              <Text color="secondary" justify="center">{isClusters ? "Kubeconfig import and cluster connections will be added in the next integration phase." : "Saved links will appear here once web link management is connected."}</Text>
            </VStack>} />
        </VStack> : category ? <VStack gap={4} maxWidth="44rem">
          <Heading level={2}>Local workspace</Heading>
          <Text as="p">Use Catalog to browse Kubernetes clusters and related web links.</Text>
          <Text as="p" color="secondary">Page pinning is stored on this device. Cluster inventory and connection settings will be connected later.</Text>
          <Button label="Browse clusters" onClick={() => void navigate({ to: "/catalog/clusters" })} />
        </VStack> : <VStack gap={4}>
          <Text as="p" color="secondary">Choose a category. Pin it to keep a shortcut in the app rail.</Text>
          {categories.map((item) => <VStack key={item.path} gap={0}>
            <HStack gap={3} vAlign="center" paddingBlock={3} wrap="wrap">
              <Icon icon={item.icon} />
              <StackItem size="fill"><VStack gap={1}>
                <Text type="label">{item.label}</Text>
                <Text type="supporting">{item.description}</Text>
              </VStack></StackItem>
              <Button label={`Open ${item.label}`} variant="ghost" onClick={() => void navigate({ to: item.path })} />
              <IconButton label={`${pinnedPages.includes(item.path) ? "Unpin" : "Pin"} ${item.label} page`} tooltip="Toggle app rail shortcut" variant="ghost" aria-pressed={pinnedPages.includes(item.path)} icon={<Icon icon={IconPin} />} onClick={() => togglePin(item.path)} />
            </HStack>
            <Divider />
          </VStack>)}
        </VStack>}
      </LayoutContent>} />
  );
}
