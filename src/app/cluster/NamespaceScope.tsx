import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { IconAlertTriangle, IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { connectionMessage, type ConnectionErrorCode, type SessionRequest } from "./api";
import { usePermissionChecks } from "./PermissionProvider";
import { createNamespaceStore, NAMESPACE_LIMIT, validNamespace } from "./namespaceStore";
import { useRegisterClusterRefresh } from "./WorkspaceRefresh";

type NamespaceScopeValue = {
  namespaces: string[];
  loading: boolean;
  cached: boolean;
  error: ConnectionErrorCode | null;
  partial: boolean;
  denied: boolean;
  unverified: boolean;
  subscribe: () => () => void;
  retry: () => void;
};
const Context = createContext<NamespaceScopeValue | null>(null);
type NamespaceSelection = readonly [string, (namespace: string) => void];
const SelectionContext = createContext<NamespaceSelection | null>(null);

export function useNamespaceSelection(): NamespaceSelection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("NamespaceScopeProvider is required");
  return selection;
}

export function NamespaceScopeProvider({ clusterId, sessionId, contextName, children }: SessionRequest & { contextName?: string; children: ReactNode }) {
  return <NamespaceSessionScope key={JSON.stringify([clusterId, sessionId])} clusterId={clusterId} sessionId={sessionId} contextName={contextName}>{children}</NamespaceSessionScope>;
}

function NamespaceSessionScope({ clusterId, sessionId, children }: SessionRequest & { contextName?: string; children: ReactNode }) {
  const [namespace, setNamespace] = useState("");
  const selection = useMemo<NamespaceSelection>(() => [namespace, setNamespace], [namespace]);
  const owner = useMemo(() => createNamespaceStore({ clusterId, sessionId }), [clusterId, sessionId]);
  const { namespaces, loading, cached, error, partial, subscribers, subscribeSelector: subscribe, retry } = useStore(owner.store);
  useEffect(() => owner.retain(), [owner]);
  useRegisterClusterRefresh(clusterId, owner.store.getState().refresh);
  const active = subscribers > 0;
  const check = { kind: "namespaces" as const, action: "list" as const };
  const permissions = usePermissionChecks(active ? [check] : []);
  const decision = permissions.decision(check);
  useEffect(() => owner.store.getState().setAccess({ loading: permissions.loading, decision, epoch: permissions.epoch }),
    [owner, permissions.loading, decision, permissions.epoch]);
  const denied = decision === "denied";
  const unverified = !permissions.loading && decision === "unknown";
  const value = useMemo(() => ({ namespaces: denied ? [] : namespaces, loading, cached, error, partial, denied, unverified, subscribe, retry }), [namespaces, loading, cached, error, partial, denied, unverified, subscribe, retry]);
  return <SelectionContext.Provider value={selection}><Context.Provider value={value}>{children}</Context.Provider></SelectionContext.Provider>;
}

type NamespaceSelectorProps = {
  value: string; onChange: (value: string) => void; label?: string; allowAll?: boolean; isLabelHidden?: boolean; showFeedback?: boolean; accessWarning?: string;
};
export function NamespaceSelector({ value, onChange, label = "Namespace", allowAll = true, isLabelHidden = true, showFeedback = true, accessWarning }: NamespaceSelectorProps) {
  const scope = useContext(Context);
  if (!scope) throw new Error("NamespaceScopeProvider is required");
  const { namespaces, loading, error, subscribe } = scope;
  useEffect(subscribe, [subscribe]);
  const choices = namespaces.map((namespace) => ({ value: namespace, label: namespace }));
  if (value && !namespaces.includes(value)) choices.push({ value, label: `${value} (not in loaded list)` });
  return <HStack gap={1} vAlign="center" style={{ minWidth: 0, maxWidth: "100%" }}>
    <Selector label={label} isLabelHidden={isLabelHidden} value={value} onChange={onChange} size="sm" width="min(18rem, 100%)" hasSearch presentation="adaptive"
      isLoading={loading && namespaces.length === 0} placeholder={allowAll ? "All namespaces" : "Choose namespace"}
      options={[...(allowAll ? [{ value: "", label: "All namespaces" }] : []), ...choices]}
      emptyText={loading ? "Loading namespaces…" : error ? "Namespace list unavailable" : "No namespaces returned"} />
    {loading && <VisuallyHidden><Text role="status" aria-label="Loading namespaces…">Loading namespaces…</Text></VisuallyHidden>}
    {showFeedback && <NamespaceFeedback value={value} onChange={onChange} allowAll={allowAll} accessWarning={accessWarning} />}
  </HStack>;
}

export function NamespaceFeedback({ value, onChange, allowAll = true, accessWarning }: Pick<NamespaceSelectorProps, "value" | "onChange" | "allowAll" | "accessWarning">) {
  const scope = useContext(Context);
  if (!scope) throw new Error("NamespaceScopeProvider is required");
  const { loading, cached, error, partial, denied, unverified, namespaces, retry } = scope;
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const manualId = useId();
  useEffect(() => setDraft(value), [value]);
  const manual = denied || unverified || error === "permissionDenied";
  const empty = !loading && !error && !denied && !unverified && namespaces.length === 0;
  if (!manual && !error && !partial && !empty && !cached && !accessWarning) return null;
  const messages = [
    accessWarning,
    denied || error === "permissionDenied" ? "Namespace listing is not permitted. You can enter a namespace manually." : unverified && !accessWarning ? "Namespace listing could not be verified. You can enter a namespace manually." : null,
    cached && !denied ? "Cached namespaces. These names may be stale; resource access is checked by Kubernetes." : null,
    error ? `Could not load namespaces. ${connectionMessage(error)}` : null,
    partial ? `The namespace list is partial; at most ${NAMESPACE_LIMIT} names are loaded.${allowAll ? " All namespaces still covers the full request scope." : ""}` : null,
    empty ? "No namespaces were returned." : null,
  ].filter(Boolean).join(" ");
  return <Popover label="Namespace options" placement="below" alignment="start" width="min(24rem, 100%)"
    isOpen={expanded} onOpenChange={setExpanded} content={<VStack gap={2} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <Text type="supporting">{messages}</Text>
      {manual && <>
        <Button label="Enter namespace" size="sm" variant="ghost" aria-expanded={manualOpen} aria-controls={manualId} onClick={() => setManualOpen(current => !current)} />
        {manualOpen && <HStack id={manualId} gap={2} wrap="wrap" vAlign="end">
          <TextInput label="Known namespace" value={draft} onChange={setDraft} size="sm" width="min(18rem, 100%)" onEnter={() => { if (validNamespace(draft)) onChange(draft); }} />
          <Button label="Use namespace" size="sm" variant="ghost" isDisabled={!validNamespace(draft)} onClick={() => { if (validNamespace(draft)) onChange(draft); }} />
        </HStack>}
        {unverified && !loading && <Button label="Load namespaces" size="sm" variant="ghost" onClick={retry} />}
      </>}
      {error && !denied && <Button label="Retry namespaces" icon={<IconRefresh />} isIconOnly tooltip="Retry namespaces" variant="ghost" size="sm" onClick={retry} />}
    </VStack>}>
    <IconButton label="Namespace options" tooltip={error ? `Could not load namespaces. ${connectionMessage(error)}` : denied ? "Namespace access restricted" : "Namespace options"} size="sm" variant="ghost"
      icon={<Icon icon={denied || error ? IconAlertTriangle : IconInfoCircle} color={denied || error ? "warning" : "secondary"} />} />
  </Popover>;
}
