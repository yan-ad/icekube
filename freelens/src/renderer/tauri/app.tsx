/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useState } from "react";
import { WelcomeView } from "../../../../packages/core/src/renderer/components/welcome/welcome-view";
import logo from "../../../../packages/ui-components/icon/assets/logo-lens.svg?raw";
import styles from "./app.module.scss";

export interface RuntimeStatus {
  protocolVersion: 1;
  runtime: "node";
  nodeVersion: string;
  processId: number;
  userData: string;
  sessionData: string;
  phases: string[];
}

export interface RuntimeHost {
  status: () => Promise<RuntimeStatus>;
  ready: () => Promise<void>;
}

export function TauriApplication({ host }: { host: RuntimeHost }) {
  const [status, setStatus] = useState<RuntimeStatus>();
  const [error, setError] = useState<string>();

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
    if (!status) return;
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
  }, [host, status]);

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
    <main className={styles.application}>
      <WelcomeView
        productName="Freelens"
        menuItems={[]}
        renderIcon={({ className, ...props }) => (
          <i className={`Icon svg ${className ?? ""}`} data-testid={props["data-testid"]}>
            <span className="icon" dangerouslySetInnerHTML={{ __html: logo }} />
          </i>
        )}
        introduction="This Tauri development profile is isolated. Cluster discovery, catalog actions, terminals, and extensions are not connected yet. Your existing Freelens profile has not been opened."
      />
      <details className={styles.diagnostics}>
        <summary>Development runtime details</summary>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </details>
    </main>
  );
}
