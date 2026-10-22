/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import styles from "./soon.module.scss";

/** Visible Tauri-only marker; keep the existing control's accessible name unchanged. */
export function Soon({ className, title = "Not implemented in Tauri yet." }: { className?: string; title?: string }) {
  return (
    <span
      className={`${styles.soon}${className ? ` ${className}` : ""}`}
      data-unimplemented
      aria-hidden="true"
      title={title}
    >
      SOON
    </span>
  );
}
