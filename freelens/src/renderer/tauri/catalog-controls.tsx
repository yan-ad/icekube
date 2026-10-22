/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import kubernetes from "../../../../packages/core/src/common/catalog-entities/icons/kubernetes.svg?raw";
import badgeStyles from "../../../../packages/core/src/renderer/components/badge/badge.module.scss";
import pushOff from "../../../../packages/ui-components/icon/assets/push_off.svg?raw";
import pushPin from "../../../../packages/ui-components/icon/assets/push_pin.svg?raw";
import { MaterialIconView } from "../../../../packages/ui-components/icon/src/icon-view";
import "../../../../packages/core/src/renderer/components/menu/menu.scss";
import "../../../../packages/core/src/renderer/components/menu/menu-actions.scss";
import styles from "./catalog.module.scss";
import { Soon } from "./soon";

import type { HTMLAttributes, ReactNode } from "react";

// Only bundled, trusted SVGs may enter this view. DTO strings never become HTML.
const icons = { kubernetes, push_off: pushOff, push_pin: pushPin };
export function CatalogIcon({ name, ...props }: HTMLAttributes<HTMLElement> & { name: string }) {
  if (Object.hasOwn(icons, name)) {
    return (
      <i {...props} className={`Icon svg small ${props.className ?? ""}`}>
        <span
          className="icon"
          data-icon-name={name}
          dangerouslySetInnerHTML={{ __html: icons[name as keyof typeof icons] }}
        />
      </i>
    );
  }
  return <MaterialIconView {...props} material={name} small />;
}

/** Badge's tooltip wrapper requires the Electron DI root; retain its existing view styles locally. */
export function CatalogLabel({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${badgeStyles.badge} ${badgeStyles.scrollable} ${badgeStyles.clickable} ${styles.labelBadge}`}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

/** Browser seam for MenuActions: shared Menu/MenuItem styles, without injected Icon/Animate/dialog services. */
export function CatalogActions({
  label,
  children,
  keepOpen = false,
  contextTrigger,
}: {
  label: string;
  children: ReactNode;
  keepOpen?: boolean;
  contextTrigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const rect = (contextTriggerRef.current ?? trigger.current)!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)) });
    menu.current?.querySelector<HTMLElement>("[role='menuitem']:not([aria-disabled='true']), input")?.focus();
    const closeOutside = (event: Event) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !(contextTriggerRef.current ?? trigger.current)?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOutside, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOutside, true);
    };
  }, [open]);
  return (
    <>
      {contextTrigger ? (
        <div
          ref={contextTriggerRef}
          tabIndex={-1}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }
          }}
        >
          {contextTrigger}
        </div>
      ) : (
        <button
          type="button"
          ref={trigger}
          className={styles.iconButton}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }
          }}
        >
          <MaterialIconView material="more_vert" aria-hidden />
        </button>
      )}
      {open &&
        createPortal(
          <ul
            ref={menu}
            role="menu"
            aria-label={label}
            className={`Menu MenuActions flex ${styles.actionsMenu}`}
            style={{ position: "fixed", ...position }}
            onClick={(event) => {
              event.stopPropagation();
              if (!keepOpen && !(event.target as HTMLElement).closest("[aria-disabled='true']")) {
                setOpen(false);
                (contextTriggerRef.current ?? trigger.current)?.focus();
              }
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                setOpen(false);
                (contextTriggerRef.current ?? trigger.current)?.focus();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = Array.from(
                  menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true']), input") ??
                    [],
                );
                const index = items.indexOf(document.activeElement as HTMLElement);
                items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
              }
            }}
          >
            {children}
          </ul>,
          document.body,
        )}
    </>
  );
}

export function CatalogAction({
  children,
  onClick,
  disabledReason,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabledReason?: string;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        className={`MenuItem ${styles.menuItem}${disabledReason ? " disabled" : ""}`}
        aria-disabled={!!disabledReason}
        title={disabledReason}
        tabIndex={disabledReason ? -1 : 0}
        onClick={(event) => {
          if (disabledReason) {
            event.preventDefault();
            return;
          }
          onClick?.();
        }}
      >
        {children}
        {disabledReason && <Soon />}
      </button>
      {disabledReason && <span className={styles.disabledReason}>{disabledReason}</span>}
    </li>
  );
}
