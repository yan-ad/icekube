import { useEffect, useRef, useState } from "react";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { ContentError } from "../components/ContentError";
import { ContentLoading } from "../components/ContentLoading";
import { connectionMessage, errorCode, nextReadId, type ConnectionErrorCode, type SessionRequest } from "./api";
import { useCustomResources } from "./CustomResourcesProvider";
import { cancelCustomRead, loadCustomInstances, type CustomDefinition, type CustomInstance, type CustomInstanceRead, type CustomInstancePage } from "./customResourcesApi";
import { CustomInstanceInspector } from "./CustomInstanceInspector";
import { NamespaceSelector } from "./NamespaceScope";
import { TableToolbar } from "./TableToolbar";
import { useRegisterWorkspacePageActions, useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";
import { useAutoRefresh } from "./useAutoRefresh";

export function CustomResourceTable({ clusterId, sessionId, definitionName }: SessionRequest & { definitionName?: string }) {
  const { snapshot, refresh, loadMore, canLoadMore } = useCustomResources();
  const current = snapshot?.clusterId === clusterId && snapshot.sessionId === sessionId ? snapshot : null;
  const selected = current?.items.find(item => item.name === definitionName);
  useRegisterWorkspaceRefresh({ clusterId, section: "custom-resource-instances", enabled: !current?.loading, refresh }, !selected);
  if (!current || current.loading && !selected) return <ContentLoading label="Loading custom resource definitions…" />;
  if (current.error && !selected) return <ContentError title="Could not discover custom resources" message={`${connectionMessage(current.error)} (${current.error})`} onRetry={refresh} retryLabel="Retry custom resource discovery" />;
  if (!selected) return <ContentError title="Custom resource definition unavailable" message={current.partial ? "The definition is not in the partial discovery result." : "This custom resource definition is unavailable. Refresh discovery or choose another definition."} onRetry={canLoadMore ? loadMore : refresh} retryLabel={canLoadMore ? "Load more definitions" : "Refresh discovery"} />;
  return <CustomResourceScope key={`${clusterId}:${sessionId}:${selected.uid}`} clusterId={clusterId} sessionId={sessionId} definition={selected} />;
}
function CustomResourceScope({ clusterId, sessionId, definition }: SessionRequest & { definition: CustomDefinition }) {
  const [namespace, setNamespace] = useState("");
  return <VStack gap={3} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    <TableToolbar label={definition.kind}>{definition.scope === "Namespaced" && <NamespaceSelector value={namespace} onChange={setNamespace} />}</TableToolbar>
    <CustomResourceSnapshot key={namespace} clusterId={clusterId} sessionId={sessionId} definition={definition} namespace={namespace || null} />
  </VStack>;
}
function CustomResourceSnapshot({ clusterId, sessionId, definition, namespace }: SessionRequest & { definition: CustomDefinition; namespace: string | null }) {
  const [page, setPage] = useState<CustomInstancePage | null>(null);
  const firstPage = useRef<CustomInstancePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | null>(null);
  const [revision, setRevision] = useState(0);
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const token = tokens[tokens.length - 1];
  const refresh = () => { if (tokens.length > 1) setPage(firstPage.current); setTokens([null]); setRevision(value => value + 1); };
  const auto = useAutoRefresh({ scope: JSON.stringify([clusterId, sessionId, definition.uid, namespace, token]), interval: 10_000, busy: loading, paused: tokens.length > 1, refresh });
  useRegisterWorkspaceRefresh({ clusterId, section: "custom-resource-instances", enabled: !loading, refresh });
  useRegisterWorkspacePageActions({ clusterId, section: "custom-resource-instances",
    previous: { enabled: !loading && tokens.length > 1, run: () => { setPage(null); setTokens(value => value.slice(0, -1)); } },
    next: { enabled: !loading && !error && !!page?.continueToken, run: () => { if (page?.continueToken) { setPage(null); setTokens(value => [...value, page.continueToken]); } } },
  });
  useEffect(() => {
    let disposed = false;
    const request: CustomInstanceRead = { clusterId, sessionId, definitionName: definition.name, definitionUid: definition.uid, namespace, readId: nextReadId(), continueToken: token };
    setLoading(true);
    void loadCustomInstances(request).then(result => { if (!disposed) auto.deliver(() => {
      if (disposed) return;
      if (definition.scope === "Cluster" && result.items.some(item => item.namespace !== null)) { setError("invalidResponse"); }
      else { if (token === null) firstPage.current = result; setPage(result); setError(null); }
      setLoading(false); auto.complete();
    }); }).catch(reason => { if (!disposed) { setError(errorCode(reason)); setLoading(false); auto.complete(reason); } });
    return () => { disposed = true; void cancelCustomRead(request).catch(() => {}); };
  }, [clusterId, sessionId, definition.name, definition.uid, definition.scope, namespace, token, revision]);
  return <VStack gap={3} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    {loading && <ContentLoading label={page ? "Refreshing custom resources…" : "Loading custom resources…"} refreshing={!!page} />}
    {error && <ContentError title={`Could not load ${definition.kind}`} message={`${connectionMessage(error)} (${error})`} retained={!!page} disabled={loading} onRetry={refresh} />}
    {page && <Table aria-label={`${definition.kind} custom resources`} data={page.items} idKey="uid" density="compact" aria-busy={loading} columns={[
      { key: "name", header: "Name", renderCell: item => <CustomInstanceInspector item={item} page={page} /> },
      ...(definition.scope === "Namespaced" ? [{ key: "namespace", header: "Namespace", renderCell: (item: CustomInstance) => <Text>{item.namespace}</Text> }] : []),
      { key: "createdAt", header: "Created", renderCell: item => <Text>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Unknown"}</Text> },
      { key: "labelCount", header: "Labels", renderCell: item => <Text>{item.labelCount}</Text> },
    ]} />}
    {page && !page.items.length && !loading && !error && <Text role="status">No custom resources returned in this scope.</Text>}
    {page?.truncated && <Text role="status">This snapshot is partial.{page.continueToken ? " Use Next page to load more." : " The response reached the engine limit."}</Text>}
  </VStack>;
}
