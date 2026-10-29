import { useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconFilePlus, IconPlus, IconTerminal2 } from "@tabler/icons-react";
import { useCatalog } from "../catalog/CatalogProvider";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import type { ResourceKind, SessionRequest } from "./api";
import { CreateEditor } from "./ResourceCreate";
import { NamespaceSelector } from "./NamespaceScope";
import type { PodIdentity } from "./podApi";
import { resourceCreation } from "./resourceViews";

type Props = SessionRequest & {
  pod?: PodIdentity;
  full: boolean;
  onTerminal: (pod: PodIdentity) => void;
  onCreated: () => void;
};

export function DockActions({ clusterId, sessionId, pod, full, onTerminal, onCreated }: Props) {
  const { snapshot } = useCatalog();
  const cluster = snapshot?.clusters.find(item => item.id === clusterId);
  const [action, setAction] = useState<"terminal" | "kind" | "create" | null>(null);
  const [namespace, setNamespace] = useState("default");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("configMaps");
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useUpdateBlocker(action !== null, "A workspace creation dialog is open.");
  const close = () => { setAction(null); requestAnimationFrame(() => trigger.current?.focus()); };
  const validTarget = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)
    && name.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name);
  return <>
    <DropdownMenu presentation="popover" placement="above" alignment="start" hasChevron={false}
      renderTrigger={props => <IconButton {...props} ref={node => { trigger.current = node; props.ref(node); }} label="New tab" tooltip="New tab" icon={<Icon icon={IconPlus} />} size="sm" variant="ghost" />}
      items={[
        { label: "New Terminal", icon: IconTerminal2, isDisabled: full, onClick: () => { setNamespace(pod?.namespace ?? "default"); setName(pod?.name ?? ""); setAction("terminal"); } },
        { label: "Create Resource", icon: IconFilePlus, isDisabled: !cluster, onClick: () => setAction("kind") },
      ]} />
    {notice && <Text role="status" type="supporting" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{notice}</Text>}
    {action === "terminal" && <Dialog isOpen onOpenChange={open => { if (!open) close(); }} purpose="form">
      <DialogHeader title="New Terminal" onOpenChange={open => { if (!open) close(); }} />
      <VStack gap={4} padding={4} style={{ minWidth: 0, overflowY: "auto" }}>
        <Text>Open a shell in a running Pod container in {cluster?.name}. This is not a local terminal.</Text>
        <NamespaceSelector value={namespace} onChange={setNamespace} allowAll={false} isLabelHidden={false} />
        <TextInput label="Pod name" value={name} onChange={setName} />
        <HStack gap={2} wrap="wrap">
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Open terminal" isDisabled={!validTarget || full} onClick={() => {
            if (!validTarget || full) return;
            onTerminal({ namespace, name, ...(pod?.namespace === namespace && pod.name === name && pod.uid ? { uid: pod.uid } : {}) });
            close();
          }} />
        </HStack>
      </VStack>
    </Dialog>}
    {action === "kind" && <Dialog isOpen onOpenChange={open => { if (!open) close(); }} purpose="form">
      <DialogHeader title="Create Resource" onOpenChange={open => { if (!open) close(); }} />
      <VStack gap={4} padding={4} style={{ minWidth: 0, overflowY: "auto" }}>
        <Text>Choose a resource kind for {cluster?.name}. The YAML editor checks create access before validation and confirmation.</Text>
        <Selector label="Resource kind" value={kind} onChange={value => { if (Object.prototype.hasOwnProperty.call(resourceCreation, value)) setKind(value as ResourceKind); }} hasSearch
          options={Object.entries(resourceCreation).map(([value, info]) => ({ value, label: info.kind }))} />
        <HStack gap={2} wrap="wrap"><Button label="Cancel" variant="ghost" onClick={close} /><Button label="Continue" onClick={() => setAction("create")} /></HStack>
      </VStack>
    </Dialog>}
    {action === "create" && cluster && <CreateEditor key={kind} clusterId={clusterId} sessionId={sessionId} kind={kind}
      label={`Create ${resourceCreation[kind].kind}`} clusterName={cluster.name} contextName={cluster.contextName}
      onClose={sent => { close(); if (sent) setNotice("Creation may have reached the API server. Refresh the inventory before retrying."); }}
      onCreated={() => { close(); setNotice(`${resourceCreation[kind].kind} created. Refreshing inventory…`); onCreated(); }} />}
  </>;
}
