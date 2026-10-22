/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useState } from "react";
import { WelcomeView } from "../../../../packages/core/src/renderer/components/welcome/welcome-view";
import logo from "../../../../packages/ui-components/icon/assets/logo-lens.svg?raw";
import styles from "./app.module.scss";
import { TauriCatalog } from "./catalog";
import { TauriShell } from "./shell";

import type { CatalogSnapshot, RuntimeStatus } from "../../common/tauri/protocol";

export type { RuntimeStatus } from "../../common/tauri/protocol";

export interface RuntimeHost {
  status: () => Promise<RuntimeStatus>;
  catalogSnapshot: () => Promise<CatalogSnapshot>;
  ready: () => Promise<void>;
}

export function TauriApplication({ host }: { host: RuntimeHost }) {
  const [status, setStatus] = useState<RuntimeStatus>();
  const [error, setError] = useState<string>();
  const [route, setRoute] = useState(() => (window.location.hash === "#/catalog" ? "catalog" : "welcome"));
  const [catalog, setCatalog] = useState<CatalogSnapshot>();
  const [catalogError, setCatalogError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onRoute = () => setRoute(window.location.hash === "#/catalog" ? "catalog" : "welcome");
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);

  useEffect(() => {
    if (!status || route !== "catalog") return;
    let disposed = false;
    setCatalog(undefined);
    setCatalogError(undefined);
    host.catalogSnapshot().then(
      (snapshot) => {
        if (!disposed) setCatalog(snapshot);
      },
      (reason) => {
        if (!disposed) setCatalogError(String(reason));
      },
    );
    return () => {
      disposed = true;
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
    if (!status || (route === "catalog" && !catalog)) return;
    let disposed = false;
    // Readiness follows the committed Welcome DOM, not just a successful IPC handshake.
    const frame = requestAnimationFrame(() => {
      host.ready().catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
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
      onNavigateHome={() => {
        window.location.hash = "/welcome";
      }}
    >
      {route === "catalog" ? (
        catalog ? (
          <TauriCatalog snapshot={catalog} />
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
          introduction="Your centralized view for managing cloud-native resources. This isolated Tauri development profile currently shows the built-in application catalog; cluster discovery is not connected yet."
        />
      )}
    </TauriShell>
  );
}
