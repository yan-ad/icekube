import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconRefresh } from "@tabler/icons-react";
import { connectionMessage, type ConnectionErrorCode, type SessionRequest } from "./api";
import { usePermissionChecks } from "./PermissionProvider";
import { createNamespaceStore, NAMESPACE_LIMIT, validNamespace } from "./namespaceStore";
import { useRegisterClusterRefresh } from "./WorkspaceRefresh";

type NamespaceScopeValue = {
  namespaces: string[];
  loading: boolean;
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

export function NamespaceScopeProvider({ clusterId, sessionId, children }: SessionRequest & { children: ReactNode }) {
  return <NamespaceSessionScope key={JSON.stringify([clusterId, sessionId])} clusterId={clusterId} sessionId={sessionId}>{children}</NamespaceSessionScope>;
}

function NamespaceSessionScope({ clusterId, sessionId, children }: SessionRequest & { children: ReactNode }) {
  const [namespace, setNamespace] = useState("");
  const selection = useMemo<NamespaceSelection>(() => [namespace, setNamespace], [namespace]);
  const owner = useMemo(() => createNamespaceStore({ clusterId, sessionId }), [clusterId, sessionId]);
  const { namespaces, loading, error, partial, subscribers, subscribeSelector: subscribe, retry } = useStore(owner.store);
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
  const value = useMemo(() => ({ namespaces: denied ? [] : namespaces, loading, error, partial, denied, unverified, subscribe, retry }), [namespaces, loading, error, partial, denied, unverified, subscribe, retry]);
  return <SelectionContext.Provider value={selection}><Context.Provider value={value}>{children}</Context.Provider></SelectionContext.Provider>;
}

type NamespaceSelectorProps = {
  value: string; onChange: (value: string) => void; label?: string; allowAll?: boolean; isLabelHidden?: boolean; showFeedback?: boolean;
};
export function NamespaceSelector({ value, onChange, label = "Namespace", allowAll = true, isLabelHidden = true, showFeedback = true }: NamespaceSelectorProps) {
  const scope = useContext(Context);
  if (!scope) throw new Error("NamespaceScopeProvider is required");
  const { namespaces, loading, error, subscribe } = scope;
  useEffect(subscribe, [subscribe]);
  const choices = namespaces.map((namespace) => ({ value: namespace, label: namespace }));
  if (value && !namespaces.includes(value)) choices.push({ value, label: `${value} (not in loaded list)` });
  return <VStack gap={1} style={{ minWidth: 0, maxWidth: "100%" }}>
    <Selector label={label} isLabelHidden={isLabelHidden} value={value} onChange={onChange} size="sm" width="min(18rem, 100%)" hasSearch presentation="adaptive"
      isLoading={loading} placeholder={allowAll ? "All namespaces" : "Choose namespace"}
      options={[...(allowAll ? [{ value: "", label: "All namespaces" }] : []), ...choices]}
      emptyText={loading ? "Loading namespaces…" : error ? "Namespace list unavailable" : "No namespaces returned"} />
    {loading && <VisuallyHidden><Text role="status" aria-label="Loading namespaces…">Loading namespaces…</Text></VisuallyHidden>}
    {showFeedback && <NamespaceFeedback value={value} onChange={onChange} allowAll={allowAll} />}
  </VStack>;
}

export function NamespaceFeedback({ value, onChange, allowAll = true }: Pick<NamespaceSelectorProps, "value" | "onChange" | "allowAll">) {
  const scope = useContext(Context);
  if (!scope) throw new Error("NamespaceScopeProvider is required");
  const { loading, error, partial, denied, unverified, namespaces, retry } = scope;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const manual = denied || unverified || error === "permissionDenied";
  const empty = !loading && !error && !denied && !unverified && namespaces.length === 0;
  if (!manual && !error && !partial && !empty) return null;
  return <VStack gap={2} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {manual && <>
      <Text role="status" type="supporting">{denied || error === "permissionDenied" ? "Namespace discovery is denied. Enter a known namespace to request resources within it." : "Namespace discovery access is unverified. Enter a known namespace or explicitly load the bounded namespace list."}</Text>
      <HStack gap={2} wrap="wrap" vAlign="end">
        <TextInput label="Known namespace" value={draft} onChange={setDraft} size="sm" width="min(18rem, 100%)" onEnter={() => { if (validNamespace(draft)) onChange(draft); }} />
        <Button label="Use namespace" size="sm" variant="ghost" isDisabled={!validNamespace(draft)} onClick={() => { if (validNamespace(draft)) onChange(draft); }} />
        {unverified && !loading && <Button label="Load namespaces" size="sm" variant="ghost" onClick={retry} />}
      </HStack>
    </>}
    {error && <>
      <Text role="status" type="supporting">Could not load namespaces. {connectionMessage(error)}{allowAll ? " All namespaces remains available." : " Retry to choose a namespace."}</Text>
      <Button label="Retry namespaces" icon={<IconRefresh />} isIconOnly tooltip="Retry namespaces" variant="ghost" size="sm" onClick={retry} />
    </>}
    {partial && <Text role="status" type="supporting">The namespace list is partial; at most {NAMESPACE_LIMIT} names are loaded.{allowAll ? " All namespaces still covers the full request scope." : ""}</Text>}
    {!loading && !error && !denied && !unverified && namespaces.length === 0 && <Text role="status" type="supporting">No namespaces were returned.</Text>}
  </VStack>;
}
