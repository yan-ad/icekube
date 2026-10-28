import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { IconRefresh } from "@tabler/icons-react";
import { cancelResources, connectionMessage, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceRequest, type SessionRequest } from "./api";
import { usePermissionChecks } from "./PermissionProvider";

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
const NAMESPACE_LIMIT = 1_000;
const validNamespace = (value: string) => value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);

export function NamespaceScopeProvider({ clusterId, sessionId, children }: SessionRequest & { children: ReactNode }) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [partial, setPartial] = useState(false);
  const [subscribers, setSubscribers] = useState(0);
  const [revision, setRevision] = useState(0);
  const [explicitRead, setExplicitRead] = useState(false);
  const loaded = useRef(false);
  const subscribe = useCallback(() => {
    setSubscribers((count) => count + 1);
    return () => setSubscribers((count) => count - 1);
  }, []);
  const active = subscribers > 0;
  const check = { kind: "namespaces" as const, action: "list" as const };
  const permissions = usePermissionChecks(active ? [check] : []);
  const decision = permissions.decision(check);
  useEffect(() => {
    if (permissions.loading && permissions.observed(check) && loaded.current) return;
    if (permissions.loading || decision === "denied" || decision === "unknown" && !explicitRead) {
      loaded.current = false; setNamespaces([]); setPartial(false); setError(null); setLoading(permissions.loading);
      return;
    }
    if (!active || loaded.current) return;
    let disposed = false;
    let request: ResourceRequest | null = null;
    setLoading(true); setError(null);
    const read = async () => {
      const names = new Set<string>();
      const tokens = new Set<string>();
      let token: string | null = null;
      let incomplete = false;
      do {
        request = { clusterId, sessionId, kind: "namespaces", readId: nextReadId(), continueToken: token };
        const page = await loadResources(request);
        if (disposed) return;
        for (const item of page.items) {
          if (!validNamespace(item.name) || names.has(item.name)) throw "invalidResponse";
          names.add(item.name);
        }
        token = page.continueToken;
        if (token && tokens.has(token)) throw "invalidResponse";
        if (token) tokens.add(token);
        incomplete = page.truncated;
        if (names.size >= NAMESPACE_LIMIT || tokens.size >= NAMESPACE_LIMIT / 100) break;
      } while (token);
      if (!disposed) {
        setNamespaces([...names].sort((left, right) => left.localeCompare(right)));
        setPartial(incomplete); loaded.current = true;
      }
    };
    void read().catch((reason) => {
      if (!disposed) { setError(errorCode(reason)); loaded.current = true; }
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => {
      disposed = true;
      if (request) void cancelResources(request).catch(() => {});
    };
  }, [active, clusterId, sessionId, revision, permissions.loading, decision, explicitRead]);
  const retry = useCallback(() => { loaded.current = false; setExplicitRead(true); setRevision((value) => value + 1); }, []);
  const denied = decision === "denied";
  const unverified = !permissions.loading && decision === "unknown";
  const value = useMemo(() => ({ namespaces: denied ? [] : namespaces, loading, error, partial, denied, unverified, subscribe, retry }), [namespaces, loading, error, partial, denied, unverified, subscribe, retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function NamespaceSelector({ value, onChange, label = "Namespace", allowAll = true, isLabelHidden = true }: {
  value: string; onChange: (value: string) => void; label?: string; allowAll?: boolean; isLabelHidden?: boolean;
}) {
  const scope = useContext(Context);
  if (!scope) throw new Error("NamespaceScopeProvider is required");
  const { namespaces, loading, error, partial, denied, unverified, subscribe, retry } = scope;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(subscribe, [subscribe]);
  const choices = namespaces.map((namespace) => ({ value: namespace, label: namespace }));
  if (value && !namespaces.includes(value)) choices.push({ value, label: `${value} (not in loaded list)` });
  return <VStack gap={1} style={{ minWidth: 0 }}>
    <Selector label={label} isLabelHidden={isLabelHidden} value={value} onChange={onChange} size="sm" width="min(18rem, 100%)" hasSearch presentation="adaptive"
      isLoading={loading} placeholder={allowAll ? "All namespaces" : "Choose namespace"}
      options={[...(allowAll ? [{ value: "", label: "All namespaces" }] : []), ...choices]}
      emptyText={loading ? "Loading namespaces…" : error ? "Namespace list unavailable" : "No namespaces returned"} />
    {(denied || unverified || error === "permissionDenied") && <>
      <Text role="status" type="supporting">{denied || error === "permissionDenied" ? "Namespace discovery is denied. Enter a known namespace to request resources within it." : "Namespace discovery access is unverified. Enter a known namespace or explicitly load the bounded namespace list."}</Text>
      <HStack gap={2} wrap="wrap" vAlign="end">
        <TextInput label="Known namespace" value={draft} onChange={setDraft} size="sm" />
        <Button label="Use namespace" size="sm" variant="ghost" isDisabled={!validNamespace(draft)} onClick={() => { if (validNamespace(draft)) onChange(draft); }} />
        {unverified && !loading && <Button label="Load namespaces" size="sm" variant="ghost" onClick={retry} />}
      </HStack>
    </>}
    {loading && <Spinner size="sm" aria-label="Loading namespaces…" />}
    {error && <>
      <Text role="status" type="supporting">Could not load namespaces. {connectionMessage(error)}{allowAll ? " All namespaces remains available." : " Retry to choose a namespace."}</Text>
      <Button label="Retry namespaces" icon={<IconRefresh />} isIconOnly tooltip="Retry namespaces" variant="ghost" size="sm" onClick={retry} />
    </>}
    {partial && <Text role="status" type="supporting">The namespace list is partial; at most {NAMESPACE_LIMIT} names are loaded.{allowAll ? " All namespaces still covers the full request scope." : ""}</Text>}
    {!loading && !error && !denied && !unverified && namespaces.length === 0 && <Text role="status" type="supporting">No namespaces were returned.</Text>}
  </VStack>;
}
