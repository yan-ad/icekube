/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useState } from "react";
import { WelcomeView } from "../../../../packages/core/src/renderer/components/welcome/welcome-view";
import logo from "../../../../packages/ui-components/icon/assets/logo-lens.svg?raw";
import styles from "./app.module.scss";
import { TauriCatalog } from "./catalog";
import { TauriCluster } from "./cluster";
import { useCatalogHotbar } from "./hotbar";
import { TauriShell } from "./shell";
import { Soon } from "./soon";

import type { CatalogSnapshot, RuntimeStatus } from "../../common/tauri/protocol";

export type { RuntimeStatus } from "../../common/tauri/protocol";

function currentRoute() {
  const hash = window.location.hash.slice(1);
  return hash === "/catalog" || hash.startsWith("/cluster/") ? hash : "/welcome";
}

export interface RuntimeHost {
  status: () => Promise<RuntimeStatus>;
  catalogSnapshot: () => Promise<CatalogSnapshot>;
  ready: () => Promise<void>;
  dragWindow: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
}

export function TauriApplication({ host }: { host: RuntimeHost }) {
  const [status, setStatus] = useState<RuntimeStatus>();
  const [error, setError] = useState<string>();
  const [route, setRoute] = useState(currentRoute);
  const [catalog, setCatalog] = useState<CatalogSnapshot>();
  const [catalogError, setCatalogError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<{ id?: string; revision: number }>({ revision: 0 });
  const hotbar = useCatalogHotbar(catalog);
  const runEntity = (id: string) => {
    const entity = catalog?.entities.find((item) => item.id === id);
    if (!entity) return;
    if (entity.action === "welcome") window.location.hash = "/welcome";
    else if (entity.kind === "KubernetesCluster") window.location.hash = `/cluster/${encodeURIComponent(entity.id)}`;
    else {
      setSelection((current) => ({ id: entity.action === "catalog" ? undefined : id, revision: current.revision + 1 }));
      window.location.hash = "/catalog";
    }
  };

  useEffect(() => {
    const onRoute = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);

  useEffect(() => {
    if (!status) return;
    let disposed = false;
    setCatalogError(undefined);
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const snapshot = await host.catalogSnapshot();
        if (!disposed) {
          setCatalog((current) => (JSON.stringify(current) === JSON.stringify(snapshot) ? current : snapshot));
          setCatalogError(undefined);
        }
      } catch (reason) {
        if (!disposed) setCatalogError(String(reason));
      } finally {
        if (!disposed && route !== "/welcome") timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [host, status, route, revision]);

  useEffect(() => {
    let disposed = false;
    host.status().then(
      (value) => {
        if (!disposed) setStatus(value);
      },
      (reason) => {
        if (!disposed) setError(String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [host]);

  useEffect(() => {
    if (!status || (route !== "/welcome" && !catalog)) return;
    let disposed = false;
    // Effects run after the DOM commit. rAF can be suspended in an unfocused webview.
    const timer = setTimeout(() => {
      host.ready().catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [host, status, route, catalog]);

  if (error) {
    return (
      <main className={styles.startup} role="alert">
        <h1>Freelens startup failed</h1>
        <pre>{error}</pre>
      </main>
    );
  }

  if (!status) {
    return (
      <main className={styles.startup} role="status">
        Starting Freelens…
      </main>
    );
  }

  return (
    <TauriShell
      catalog={catalog}
      hotbar={hotbar}
      onRunEntity={runEntity}
      onDragWindow={() => {
        void host.dragWindow().catch(() => setError("Window dragging failed"));
      }}
      onToggleMaximize={() => {
        void host.toggleMaximize().catch(() => setError("Window resize failed"));
      }}
      onNavigateHome={() => {
        window.location.hash = "/welcome";
      }}
    >
      {route !== "/welcome" ? (
        catalog ? (
          <>
            {catalogError && (
              <p role="alert">
                Catalog refresh failed. Showing the last snapshot.{" "}
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  Retry
                </button>
              </p>
            )}
            {route.startsWith("/cluster/") ? (
              <TauriCluster
                entity={catalog.entities.find(
                  (entity) =>
                    entity.kind === "KubernetesCluster" && `/cluster/${encodeURIComponent(entity.id)}` === route,
                )}
                onNavigateCatalog={() => {
                  window.location.hash = "/catalog";
                }}
              />
            ) : (
              <TauriCatalog
                snapshot={catalog}
                onRunEntity={runEntity}
                pinnedIds={hotbar.pinnedIds}
                selectedEntityId={selection.id}
                selectionRevision={selection.revision}
                onTogglePin={(id) => {
                  const entity = catalog.entities.find((item) => item.id === id);
                  if (entity) hotbar.toggle(entity);
                }}
              />
            )}
          </>
        ) : (
          <section className={styles.startup}>
            {catalogError ? (
              <>
                <p role="alert">Catalog could not be loaded: {catalogError}</p>
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  Retry
                </button>
              </>
            ) : (
              <p role="status">Loading catalog…</p>
            )}
          </section>
        )
      ) : (
        <WelcomeView
          productName="Freelens"
          keyboardNavigation
          menuItems={[
            {
              title: "Browse Clusters in Catalog",
              icon: "view_list",
              click: () => {
                window.location.hash = "/catalog";
              },
            },
            {
              title: "Open a Terminal",
              icon: "terminal",
              disabled: true,
              badge: <Soon />,
              unavailableReason: "Not available in Tauri yet",
              click: () => {
                throw new Error("Terminal is not available in Tauri yet");
              },
            },
          ]}
          renderIcon={({ className, ...props }) => (
            <i
              className={`Icon ${props.svg ? "svg" : "material"} ${className ?? ""}`}
              data-testid={props["data-testid"]}
            >
              {props.svg ? (
                <span className="icon" dangerouslySetInnerHTML={{ __html: logo }} />
              ) : (
                <span className="icon" aria-hidden>
                  {props.material}
                </span>
              )}
            </i>
          )}
          introduction="Your centralized view for managing cloud-native resources. Local kubeconfig contexts are discovered read-only; cluster connections are not started. Your existing Freelens profile has not been modified."
        />
      )}
    </TauriShell>
  );
}
