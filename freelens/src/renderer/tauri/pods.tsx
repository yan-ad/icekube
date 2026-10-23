/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "../../../../packages/core/src/renderer/components/checkbox/checkbox";
import { SearchInputView } from "../../../../packages/core/src/renderer/components/input/search-input-view";
import { ItemListLayoutHeaderView } from "../../../../packages/core/src/renderer/components/item-object-list/header-view";
import { TableCellView } from "../../../../packages/core/src/renderer/components/table/table-cell-view";
import { TableHead } from "../../../../packages/core/src/renderer/components/table/table-head";
import { TableRow } from "../../../../packages/core/src/renderer/components/table/table-row";
import { containerStatusClassName } from "../../../../packages/core/src/renderer/components/workloads-pods/container-status-class-name";
import { MaterialIconView } from "../../../../packages/ui-components/icon/src/icon-view";
import { bytesToUnits } from "../../../../packages/utility-features/utilities/src/convertMemory";
import { formatDuration } from "../../../../packages/utility-features/utilities/src/formatDuration";
import "../../../../packages/core/src/renderer/components/table/table.scss";
import "../../../../packages/core/src/renderer/components/workloads-pods/pods.scss";
import "../../../../packages/core/src/renderer/components/status-brick/status-brick.scss";
import "../../../../packages/core/src/renderer/components/layout/tab-layout.scss";
import "../../../../packages/core/src/renderer/components/tabs/tabs.scss";
import { isPodsNamespace } from "../../common/tauri/pods-protocol";
import { CatalogAction, CatalogActions } from "./catalog-controls";
import styles from "./pods.module.scss";
import { workloadsTabs } from "./sidebar-metadata";
import { Soon } from "./soon";

import type { PodSummary, PodsRequest, PodsSnapshot } from "../../common/tauri/pods-protocol";

export interface PodsHost {
  listPods(request: PodsRequest): Promise<PodsSnapshot>;
}
const columns = [
  ["name", "Name"],
  ["warning", "Warning"],
  ["namespace", "Namespace"],
  ["containers", "Containers"],
  ["cpu", "CPU"],
  ["memory", "Memory"],
  ["restarts", "Restarts"],
  ["owner", "Controlled By"],
  ["age", "Age"],
  ["status", "Status"],
] as const;
type Column = (typeof columns)[number][0];
const errors: Record<string, string> = {
  CLUSTER_NOT_FOUND: "The selected cluster is no longer in the local catalog.",
  CONFIG_UNAVAILABLE:
    "The selected kubeconfig is unavailable or changed. Restart the application to authorize changed configuration.",
  AUTH_FAILED: "Cluster authentication failed.",
  FORBIDDEN: "Access to Pods is forbidden.",
  TIMEOUT: "The Pods request timed out.",
  TLS_ERROR: "Cluster TLS verification failed.",
  UNAVAILABLE: "The cluster is unavailable.",
  RESPONSE_TOO_LARGE: "The Pods response exceeds the read-only size limit.",
  INVALID_RESPONSE: "The cluster returned an invalid Pods response.",
};
function sortValue(pod: PodSummary, key: Column): string | number {
  switch (key) {
    case "name":
    case "namespace":
    case "status":
      return pod[key];
    case "warning":
      return pod.phase === "Failed" || pod.status.includes("Error") ? 1 : 0;
    case "containers":
      return pod.readyContainers;
    case "restarts":
      return pod.restartCount;
    case "owner":
      return pod.owner ? `${pod.owner.kind}/${pod.owner.name}` : "";
    case "age":
      return pod.createdAt ? Date.parse(pod.createdAt) || 0 : 0;
    case "cpu":
    case "memory":
      return pod[key] ?? -1;
  }
}
function cell(pod: PodSummary, key: Column) {
  switch (key) {
    case "name":
    case "namespace":
    case "status":
      return pod[key];
    case "warning":
      return pod.phase === "Failed" || /Error|BackOff|Failed/.test(pod.status) ? (
        <MaterialIconView small material="warning" title={pod.status} aria-label={pod.status} />
      ) : null;
    case "containers":
      return (
        <span
          title={pod.containers
            .map((c) => `${c.name}${c.init ? " (init)" : ""}: ${c.state}${c.ready ? ", ready" : ""}`)
            .join("\n")}
        >
          {pod.containers.map((container) => (
            <span
              key={`${container.init}-${container.name}`}
              className={`StatusBrick ${containerStatusClassName(
                { type: container.init ? "initContainers" : "containers" },
                {
                  ready: container.ready,
                  restartCount: 0,
                  state: container.state === "unknown" ? {} : { [container.state]: {} },
                },
              )}`}
              role="img"
              aria-label={`${container.name}${container.init ? " (init)" : ""}: ${container.state}${container.ready ? ", ready" : ""}`}
            />
          ))}
          <span className={styles.containerCount}>
            {pod.readyContainers}/{pod.totalContainers}
          </span>
        </span>
      );
    case "cpu":
      return pod.cpu === null ? <span title="CPU metrics unavailable">N/A</span> : pod.cpu.toFixed(3);
    case "memory":
      return pod.memory === null ? (
        <span title="Memory metrics unavailable">N/A</span>
      ) : pod.memory < 1024 ? (
        `${(pod.memory / 1024).toFixed(1)}Ki`
      ) : (
        bytesToUnits(pod.memory, { precision: 1 }).replace(/B$/, "")
      );
    case "restarts":
      return pod.restartCount;
    case "owner":
      return pod.owner ? <span title={`${pod.owner.kind}/${pod.owner.name}`}>{pod.owner.kind}</span> : "N/A";
    case "age":
      return pod.createdAt && Number.isFinite(Date.parse(pod.createdAt)) ? (
        <span title={pod.createdAt}>{formatDuration(Date.now() - Date.parse(pod.createdAt))}</span>
      ) : (
        "N/A"
      );
  }
}

/** Read-only snapshot adapter. Opening a route never authorizes a kubeconfig request. */
export function TauriPods({ clusterId, host }: { clusterId: string; host?: PodsHost }) {
  const [approvedCluster, setApprovedCluster] = useState<string>();
  const consented = approvedCluster === clusterId;
  const [namespace, setNamespace] = useState<string | null>(null);
  const [namespaceInput, setNamespaceInput] = useState("");
  const [namespaceError, setNamespaceError] = useState<string>();
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<PodsSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: Column; descending: boolean }>({ key: "name", descending: false });
  const [hidden, setHidden] = useState<ReadonlySet<Column>>(new Set());
  const busy = useRef(false);
  const pendingScope = useRef(false);
  const runLatest = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    setNamespace(null);
    setNamespaceInput("");
    setNamespaceError(undefined);
    setSnapshot(undefined);
    setAvailableNamespaces([]);
    setLoading(false);
    setError(undefined);
    setApprovedCluster(undefined);
  }, [clusterId]);
  useEffect(() => {
    if (!consented || !host) return;
    let alive = true;
    const request = { clusterId, namespace };
    setSnapshot(undefined);
    setError(undefined);
    setLoading(true);
    const run = async () => {
      if (!alive || busy.current) return;
      busy.current = true;
      pendingScope.current = false;
      setLoading(true);
      try {
        const result = await host.listPods(request);
        if (!alive) return;
        if (result.clusterId !== clusterId || result.namespace !== namespace) {
          setError(errors.INVALID_RESPONSE);
          setSnapshot(undefined);
        } else {
          setSnapshot(result);
          setAvailableNamespaces((current) =>
            namespace === null && !result.error
              ? result.namespaces
              : Array.from(new Set([...current, ...result.namespaces])),
          );
          setError(result.error ? errors[result.error] : undefined);
        }
      } catch {
        // Never expose raw transport/auth-plugin messages or kubeconfig paths.
        if (alive) {
          setError("Unable to load Pods. Check cluster access and retry.");
          setSnapshot(undefined);
        }
      } finally {
        busy.current = false;
        if (alive) setLoading(false);
        // A scope switch waits for the previous request, then starts the newest scope only.
        if (pendingScope.current) runLatest.current?.();
      }
    };
    runLatest.current = () => {
      void run();
    };
    pendingScope.current = true;
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      runLatest.current = undefined;
      pendingScope.current = false;
    };
  }, [clusterId, namespace, consented, host]);

  const current = snapshot?.clusterId === clusterId && snapshot.namespace === namespace ? snapshot : undefined;
  const pods = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (current?.pods ?? [])
      .filter(
        (pod) =>
          !query ||
          [
            pod.name,
            pod.namespace,
            pod.nodeName,
            pod.status,
            pod.phase,
            pod.owner?.kind,
            pod.owner?.name,
            ...pod.containers.map((c) => c.name),
          ].some((value) => value?.toLocaleLowerCase().includes(query)),
      )
      .sort((a, b) => {
        const av = sortValue(a, sort.key),
          bv = sortValue(b, sort.key);
        const result =
          typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return result * (sort.descending ? -1 : 1);
      });
  }, [current, search, sort]);
  const changeSort = (key: Column) =>
    setSort((old) => ({ key, descending: old.key === key ? !old.descending : false }));
  const retry = () => runLatest.current?.();
  const namespaces = Array.from(new Set([...availableNamespaces, ...(namespace ? [namespace] : [])])).sort();

  return (
    <div className={`TabLayout ${styles.layout}`}>
      <div className={`Tabs center ${styles.tabs}`} role="tablist" aria-label="Workloads">
        {workloadsTabs.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            aria-selected={tab.id === "sidebar-item-pods"}
            disabled={tab.id !== "sidebar-item-pods"}
            aria-disabled={tab.id !== "sidebar-item-pods"}
            className={`Tab ${tab.id === "sidebar-item-pods" ? "active" : "disabled"}`}
          >
            {tab.title}
            {tab.id !== "sidebar-item-pods" && <Soon />}
          </button>
        ))}
      </div>
      <main className={styles.main}>
        <section className={`Pods ItemListLayout ${styles.pods}`} aria-label="Pods">
          <ItemListLayoutHeaderView
            title={<h5 className="title">Pods</h5>}
            info={
              <span role="status">
                {current && !error
                  ? `${pods.length} / ${current.pods.length} Pods${current.truncated ? " (truncated)" : ""}`
                  : loading
                    ? "Loading Pods…"
                    : "Not loaded"}
              </span>
            }
            filters={
              <div className={styles.filters}>
                <label>
                  Namespace{" "}
                  <select
                    aria-label="Namespace"
                    value={namespace ?? ""}
                    disabled={!consented}
                    onChange={(event) => setNamespace(event.target.value || null)}
                  >
                    <option value="">All namespaces</option>
                    {namespaces.map((ns) => (
                      <option key={ns}>{ns}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={retry} disabled={!consented || loading || !host}>
                  Refresh
                </button>
                {consented && (
                  <button
                    type="button"
                    onClick={() => {
                      setApprovedCluster(undefined);
                      setSnapshot(undefined);
                    }}
                  >
                    Stop refreshing
                  </button>
                )}
                <CatalogActions label="Pod actions">
                  <CatalogAction disabledReason="Creating resources is not ported.">Create Pod</CatalogAction>
                  <CatalogAction disabledReason="Mutations are not available in this read-only view.">
                    Delete
                  </CatalogAction>
                </CatalogActions>
              </div>
            }
            search={<SearchInputView value={search} onChange={setSearch} label="Search Pods" />}
          />
          {!consented && (
            <div className={styles.message}>
              <p id="pods-consent">
                Loading Pods may execute kubeconfig auth plugins and contact the selected cluster. After confirmation,
                this read-only view refreshes every 10 seconds until you leave the cluster.
              </p>
              <button
                type="button"
                aria-describedby="pods-consent"
                disabled={!host}
                onClick={() => setApprovedCluster(clusterId)}
              >
                Load Pods
              </button>
              {!host && <p>Pods host unavailable.</p>}
            </div>
          )}
          {consented &&
            (current?.error === "FORBIDDEN" || current?.warnings.includes("Namespace list unavailable")) && (
              <form
                className={styles.filters}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isPodsNamespace(namespaceInput)) {
                    setNamespaceError("Enter a valid namespace name.");
                    return;
                  }
                  setNamespaceError(undefined);
                  setNamespace(namespaceInput);
                }}
              >
                <label>
                  Namespace name{" "}
                  <input
                    value={namespaceInput}
                    onChange={(event) => setNamespaceInput(event.target.value)}
                    aria-label="Namespace name"
                  />
                </label>
                <button type="submit">Load namespace</button>
                {namespaceError && <span role="alert">{namespaceError}</span>}
              </form>
            )}
          {error && (
            <div className={styles.message} role="alert">
              <p>{error}</p>
              <button type="button" onClick={retry} disabled={loading}>
                Retry
              </button>
            </div>
          )}
          {loading && (
            <p className={styles.message} role="status">
              Loading Pods…
            </p>
          )}
          {current?.warnings.map((warning) => (
            <p className={styles.message} key={warning} role="status">
              {warning}
              {warning === "Namespace list unavailable" && (
                <button type="button" onClick={retry} disabled={loading}>
                  Retry namespaces
                </button>
              )}
            </p>
          ))}
          {current?.truncated && (
            <p className={styles.message}>Pod list truncated. Counts reflect the returned Pods only.</p>
          )}
          <div className={`Table ${styles.table}`} role="table" aria-label="Pods" aria-busy={loading}>
            <TableHead role="row">
              {columns
                .filter(([key]) => !hidden.has(key))
                .map(([key, label]) => (
                  <TableCellView
                    key={key}
                    className={key}
                    role="columnheader"
                    sortBy={key}
                    _sort={() => changeSort(key)}
                    _sorting={{ sortBy: sort.key, orderBy: sort.descending ? "desc" : "asc" }}
                    aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        changeSort(key);
                      }
                    }}
                  >
                    {label}
                  </TableCellView>
                ))}
              <TableCellView className="logs" role="columnheader">
                Logs
              </TableCellView>
              <TableCellView className="menu" role="columnheader">
                <CatalogActions label="Pod column visibility" keepOpen>
                  {columns.map(([key, label]) => (
                    <li key={key} className="MenuItem input" role="none">
                      <Checkbox
                        label={label}
                        value={!hidden.has(key)}
                        onChange={() =>
                          setHidden((old) => {
                            const next = new Set(old);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      />
                    </li>
                  ))}
                </CatalogActions>
              </TableCellView>
            </TableHead>
            {!error &&
              pods.map((pod) => (
                <TableRow key={pod.uid} role="row">
                  {columns
                    .filter(([key]) => !hidden.has(key))
                    .map(([key]) => (
                      <TableCellView
                        role="cell"
                        key={key}
                        className={`${key}${key === "status" ? ` ${pod.status.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}` : ""}`}
                      >
                        {cell(pod, key)}
                      </TableCellView>
                    ))}
                  <TableCellView role="cell" className="logs">
                    <button
                      type="button"
                      disabled
                      aria-label={`Logs for ${pod.name} SOON`}
                      title="Pod logs are not ported."
                    >
                      <MaterialIconView small material="subject" aria-hidden />
                      <Soon />
                    </button>
                  </TableCellView>
                  <TableCellView role="cell" className="menu">
                    <CatalogActions label={`Actions for ${pod.name}`}>
                      <CatalogAction disabledReason="Pod details are not ported.">Details</CatalogAction>
                      <CatalogAction disabledReason="Pod logs are not ported.">Logs</CatalogAction>
                      <CatalogAction disabledReason="Pod terminal is not ported.">Shell</CatalogAction>
                      <CatalogAction disabledReason="Mutations are not available in this read-only view.">
                        Delete
                      </CatalogAction>
                    </CatalogActions>
                  </TableCellView>
                </TableRow>
              ))}
          </div>
          {current && !error && !loading && pods.length === 0 && (
            <p className={styles.message}>
              {current.pods.length ? "No Pods match your search." : "No Pods found in this namespace scope."}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
