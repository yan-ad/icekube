import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ContentLoading } from "../components/ContentLoading";
import { ContentError } from "../components/ContentError";
import { nextReadId, type SessionRequest } from "./api";
import { helmMessage } from "./helmApi";
import { cancelHelmDetail, loadHelmDetail, type HelmDetail, type HelmReference } from "./helmDetailsApi";

export function HelmDetails({ clusterId, sessionId, reference, revision, onLoadingChange }: SessionRequest & {
  reference: HelmReference; revision: number; onLoadingChange: (loading: boolean) => void;
}) {
  const { view, name, namespace, version } = reference;
  const scope = JSON.stringify([clusterId, sessionId, view, name, namespace, version]);
  const [state, setState] = useState<{ scope: string; detail?: HelmDetail; error?: string; loading: boolean }>({ scope, loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let readId: number;
    try { readId = nextReadId(); } catch (reason) { setState(previous => ({ scope, detail: previous.scope === scope ? previous.detail : undefined, loading: false, error: helmMessage(reason) })); onLoadingChange(false); return; }
    const request = { clusterId, sessionId, view, name, namespace, version, readId };
    setState(previous => ({ scope, detail: previous.scope === scope ? previous.detail : undefined, loading: true }));
    onLoadingChange(true);
    void loadHelmDetail(request).then(detail => {
      if (!disposed) setState({ scope, detail, loading: false });
    }).catch(reason => {
      if (!disposed) setState(previous => ({ scope, detail: previous.scope === scope ? previous.detail : undefined, error: helmMessage(reason), loading: false }));
    }).finally(() => { if (!disposed) onLoadingChange(false); });
    return () => {
      disposed = true;
      void cancelHelmDetail({ clusterId, sessionId, view, readId }).catch(() => {});
    };
  }, [clusterId, sessionId, view, name, namespace, version, scope, revision, retry, onLoadingChange]);
  const current = state.scope === scope ? state : null;
  const detail = current?.detail;
  return <VStack gap={4} padding={4} style={{ minWidth: 0 }}>
    {(!current || current.loading) && <ContentLoading label="Loading Helm details…" refreshing={!!detail} />}
    {current?.loading && detail && <Text role="status" color="secondary">Refreshing details. Showing the last successful snapshot, which may be stale.</Text>}
    {current?.error && <ContentError title="Could not load Helm details" message={current.error} retained={!!detail} onRetry={() => setRetry(value => value + 1)} />}
    {detail && <>
      {detail.truncated && <Text role="status">These details are partial. Metadata is limited to 64 KiB and history to 100 revisions.</Text>}
      <MetadataList aria-label="Helm identity">
        <MetadataListItem label="Name">{name}</MetadataListItem>
        {namespace && <MetadataListItem label="Namespace">{namespace}</MetadataListItem>}
        {version && <MetadataListItem label="Requested version">{version}</MetadataListItem>}
        {detail.facts.map((fact, index) => <MetadataListItem key={`${fact.label}-${index}`} label={fact.label}><Text style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{fact.value}</Text></MetadataListItem>)}
      </MetadataList>
      {view === "charts" && <Text color="secondary">Chart metadata is read from the configured Helm repository for this version. README, templates and values are not loaded. Repository links are shown as text.</Text>}
      {view === "releases" && <>
        <Text>Revision history</Text>
        {detail.history.length === 0 && <Text>No revisions were returned.</Text>}
        {detail.history.map(item => <MetadataList key={item.revision} aria-label={`Revision ${item.revision}`}>
          <MetadataListItem label="Revision">{String(item.revision)}</MetadataListItem>
          <MetadataListItem label="Status">{item.status}</MetadataListItem>
          <MetadataListItem label="Updated">{item.updated || "Not provided"}</MetadataListItem>
          <MetadataListItem label="Chart">{item.chart}</MetadataListItem>
          <MetadataListItem label="App version">{item.appVersion || "Not provided"}</MetadataListItem>
        </MetadataList>)}
        <Text color="secondary">History metadata only. Values, manifests, notes and revision descriptions are withheld. Rollback and uninstall are not available here.</Text>
      </>}
    </>}
  </VStack>;
}
