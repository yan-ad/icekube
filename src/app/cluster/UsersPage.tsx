import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ContentError } from "../components/ContentError";
import { ContentLoading } from "../components/ContentLoading";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import { NamespaceSelector } from "./NamespaceScope";
import { PermissionGate } from "./PermissionGate";
import { usePermissionChecks, usersPermissionChecks } from "./PermissionProvider";
import { useResourceInspector } from "./ResourceInspector";
import type { ResourceReference } from "./detailApi";
import { cancelUsers, loadUsers, validUsersNamespace, type SubjectRecord, type UsersPageData } from "./rbacApi";
import { TableToolbar, tableViewport } from "./TableToolbar";
import { useRegisterWorkspaceRefresh } from "./WorkspaceRefresh";

const UsersTable = memo(Table) as typeof Table;
const sourceLabels = { roleBindings: "Role bindings", clusterRoleBindings: "Cluster role bindings", serviceAccounts: "Service accounts" };

export function ObservedSubjectsPage(props: SessionRequest) {
  return <UsersSession key={`${props.clusterId}:${props.sessionId}`} {...props} />;
}
export const UsersPage = ObservedSubjectsPage;
function UsersSession({ clusterId, sessionId }: SessionRequest) {
  const [namespace, setNamespace] = useState("");
  const [manualNamespace, setManualNamespace] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ scope: string; data: UsersPageData | null; loading: boolean; error: string | null }>({ scope: "", data: null, loading: true, error: null });
  const [selected, setSelected] = useState<SubjectRecord | null>(null);
  const checks = usersPermissionChecks(namespace || null);
  const permissions = usePermissionChecks(checks);
  const denied = !permissions.loading && checks.every(check => permissions.decision(check) === "denied");
  const { openSummary, openResource } = useResourceInspector();
  const refresh = useCallback(() => { setSelected(null); setRevision(value => value + 1); }, []);
  const data = state.scope === namespace ? state.data : null;
  const loading = permissions.loading || state.scope !== namespace || state.loading;
  useRegisterWorkspaceRefresh({ clusterId, section: "users", enabled: !loading, refresh: denied ? permissions.retry : refresh });
  useEffect(() => {
    setSelected(null);
    if (permissions.loading || denied) return;
    let disposed = false;
    const request = { clusterId, sessionId, namespace: namespace || null, readId: nextReadId() };
    setState(previous => ({ scope: namespace, data: previous.scope === namespace ? previous.data : null, loading: true, error: null }));
    void loadUsers(request).then(next => { if (!disposed) setState({ scope: namespace, data: next, loading: false, error: null }); })
      .catch(reason => { if (!disposed) setState(previous => ({ ...previous, loading: false, error: connectionMessage(errorCode(reason)) })); });
    return () => { disposed = true; void cancelUsers(request).catch(() => {}); };
  }, [clusterId, sessionId, namespace, revision, permissions.loading, denied]);
  const items = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return (data?.items ?? []).filter(row => [row.name, row.kind, row.namespace ?? ""].join(" ").toLocaleLowerCase().includes(needle));
  }, [data, deferredQuery]);
  const inspect = useCallback((row: SubjectRecord) => {
    setSelected(row);
    openSummary({ title: row.name, facts: [
      { label: "Kind", value: row.kind }, { label: "Namespace", value: row.namespace ?? "Not namespaced" },
      { label: "Observed bindings", value: `${row.bindings.length}${row.bindingsTruncated ? "+ (bounded)" : ""}` },
      { label: "Coverage", value: data?.coverage.map(source => `${sourceLabels[source.resource]}: ${source.state}`).join("; ") ?? "Unavailable" },
      ...row.bindings.map(binding => ({ label: `${binding.kind}: ${binding.namespace ? `${binding.namespace}/` : ""}${binding.name}`, value: `${binding.roleRef.kind}: ${binding.roleRef.name}` })),
      { label: "Limitations", value: "Observed subjects and assignments only. This is not an account registry or an effective-permissions calculation." },
    ] });
  }, [data, openSummary]);
  const columns = useMemo<TableColumn<SubjectRecord>[]>(() => [
    { key: "name", header: "Name", width: proportional(3), renderCell: row => <Text>{row.name}</Text> },
    { key: "kind", header: "Kind", width: proportional(2), renderCell: row => <Text>{row.kind}</Text> },
    { key: "namespace", header: "Namespace", width: proportional(2), renderCell: row => <Text>{row.namespace ?? "Not namespaced"}</Text> },
    { key: "bindings", header: "Bindings", width: proportional(1), renderCell: row => <Text>{row.bindings.length}{row.bindingsTruncated ? "+" : ""}</Text> },
    { key: "actions", header: "Actions", width: proportional(1), renderCell: row => <Button label={`Details for ${row.name}`} size="sm" variant="ghost" onClick={() => inspect(row)} /> },
  ], [inspect]);
  if (permissions.loading && !data) return <ContentLoading label="Checking Users sources…" />;
  if (denied) return <ContentError title="Access denied" message="Listing role bindings, cluster role bindings, and service accounts is denied. No Users directory was requested." onRetry={permissions.retry} />;
  const partial = data && (data.truncated || data.coverage.some(source => source.state !== "complete"));
  return <VStack gap={0} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
    <TableToolbar label="Users" count={data ? `${items.length} loaded subjects` : undefined}>
      <TextInput label="Search subjects" isLabelHidden placeholder="Search subjects" value={query} onChange={setQuery} size="sm" />
      <NamespaceSelector value={namespace} onChange={setNamespace} />
      <Button label="Refresh Users" size="sm" variant="ghost" isDisabled={loading} onClick={refresh} />
    </TableToolbar>
    <VStack gap={2} padding={3} tabIndex={0} aria-label="Directory coverage and namespace" style={{ flexShrink: 1, minHeight: "6rem", maxHeight: "40%", overflow: "auto" }}>
      <Text weight="semibold">Read-only directory</Text>
      <Text type="supporting">User, Group, and ServiceAccount subjects observed in bounded RBAC lists. This is not a human account registry or an effective-permissions report.</Text>
      {checks.some(check => permissions.decision(check) === "unknown") && <Text role="status">Source access is unverified. Opening Users requests read-only lists; Kubernetes still enforces access.</Text>}
      <HStack gap={2} wrap="wrap" vAlign="center">
        <TextInput label="Known namespace" placeholder="Enter a known namespace" size="sm" value={manualNamespace} onChange={setManualNamespace} />
        <Button label="Use namespace" size="sm" variant="ghost" isDisabled={!validUsersNamespace(manualNamespace)} onClick={() => setNamespace(manualNamespace)} />
      </HStack>
      <Text type="supporting">If namespace discovery is denied, enter a namespace you already know. Cluster role bindings remain cluster-wide.</Text>
      {data && <Text role="status">Sources: {data.coverage.map(source => `${sourceLabels[source.resource]}: ${source.state}`).join("; ")}.</Text>}
      {partial && <Text role="status">Partial directory. Missing or bounded sources can omit subjects and bindings; zero observed bindings does not prove no access. At most 1,000 subjects and 64 bindings per subject are loaded.</Text>}
      {state.error && <HStack gap={2} wrap="wrap"><Text role="alert">{state.error}{data ? " Previously loaded subjects are stale." : ""}</Text><Button label="Retry Users" variant="ghost" size="sm" onClick={refresh} /></HStack>}
      {selected && <VStack gap={1} role="region" aria-label={`Bindings for ${selected.name}`} style={{ flexShrink: 0, maxHeight: "12rem", overflow: "auto" }}>
        <HStack gap={2}><Text weight="semibold">Bindings for {selected.name}</Text><Button label="Close bindings" size="sm" variant="ghost" onClick={() => setSelected(null)} /></HStack>
        {!selected.bindings.length && <Text>No bindings observed in loaded sources.</Text>}
        {selected.bindings.map(binding => {
          const reference: ResourceReference = { kind: binding.kind === "RoleBinding" ? "roleBindings" : "clusterRoleBindings", namespace: binding.namespace, name: binding.name, uid: binding.uid };
          const role: ResourceReference = { kind: binding.roleRef.kind === "Role" ? "roles" : "clusterRoles", namespace: binding.roleRef.kind === "Role" ? binding.namespace : null, name: binding.roleRef.name };
          return <HStack key={JSON.stringify([binding.kind, binding.namespace, binding.name])} gap={2} wrap="wrap">
            <Text>{binding.kind} {binding.namespace ? `${binding.namespace}/` : ""}{binding.name}</Text>
            <PermissionGate quiet check={{ kind: reference.kind, namespace: reference.namespace, name: reference.name, action: "get" }}><Button label={`View binding ${binding.name}`} size="sm" variant="ghost" onClick={() => openResource(reference)} /></PermissionGate>
            <PermissionGate quiet check={{ kind: role.kind, namespace: role.namespace, name: role.name, action: "get" }}><Button label={`View ${binding.roleRef.kind} ${role.name}`} size="sm" variant="ghost" onClick={() => openResource(role)} /></PermissionGate>
          </HStack>;
        })}
      </VStack>}
    </VStack>
    {loading && <ContentLoading label={data ? "Refreshing subjects…" : "Loading subjects…"} />}
    {data && !loading && items.length === 0 && <Text role="status" style={{ padding: "var(--spacing-3)" }}>{query ? "No loaded subjects match this search." : "No subjects observed in the loaded sources."}</Text>}
    {data && <VStack gap={0} style={{ flex: "1 1 0", minHeight: "10rem", minWidth: 0, position: "relative" }}><UsersTable aria-label="Users subjects" aria-busy={loading || query !== deferredQuery} data={items} columns={columns} idKey="id" density="compact" plugins={{ viewport: tableViewport<SubjectRecord>() }} /></VStack>}
    <Text type="supporting" style={{ padding: "var(--spacing-3)", flexShrink: 0 }}>Inspired by Permission Manager by SIGHUP (BSD-3-Clause).</Text>
  </VStack>;
}
