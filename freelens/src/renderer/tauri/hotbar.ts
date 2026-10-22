/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { reaction } from "mobx";
import { useEffect, useState } from "react";
import { Hotbar } from "../../../../packages/core/src/features/hotbar/storage/common/hotbar";
import {
  createDefaultHotbarItems,
  defaultHotbarCells,
} from "../../../../packages/core/src/features/hotbar/storage/common/types";

import type { HotbarData, HotbarEntity } from "../../../../packages/core/src/features/hotbar/storage/common/hotbar";
import type { CatalogSnapshot } from "../../common/tauri/protocol";

export type CatalogHotbarEntity = CatalogSnapshot["entities"][number];
export interface CatalogHotbar {
  readonly pinnedIds: ReadonlySet<string>;
  readonly items: HotbarData["items"];
  readonly message?: string;
  readonly persistence: "localStorage" | "memory";
  toggle(entity: CatalogHotbarEntity): void;
  remove(id: string): void;
}

const storageKey = "freelens.tauri.hotbar.v1";
const logger = {
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  silly: console.debug,
};

function identity(entity: CatalogHotbarEntity): HotbarEntity {
  return {
    getId: () => entity.id,
    getName: () => entity.name,
    metadata: { uid: entity.id, name: entity.name, source: entity.source, labels: entity.labels },
  };
}

/** Only the actual Hotbar.toJSON schema is stored, never an Electron user profile. */
function restore(value: string | null): HotbarData | undefined {
  if (!value) return;
  const data = JSON.parse(value) as HotbarData;
  if (
    !data ||
    typeof data.id !== "string" ||
    typeof data.name !== "string" ||
    !Array.isArray(data.items) ||
    data.items.length !== defaultHotbarCells ||
    !data.items.every(
      (item) =>
        item === null ||
        (item &&
          typeof item.entity?.uid === "string" &&
          typeof item.entity.name === "string" &&
          (item.entity.source === undefined || typeof item.entity.source === "string")),
    )
  ) {
    throw new Error("Invalid saved hotbar");
  }
  return data;
}

/** Mount above the route switch: refreshes change display DTOs, not pin membership. */
export function useCatalogHotbar(snapshot?: CatalogSnapshot): CatalogHotbar {
  const [model, setModel] = useState<Hotbar>();
  const [items, setItems] = useState<HotbarData["items"]>(() => Array(defaultHotbarCells).fill(null));
  const [message, setMessage] = useState<string>();
  const [persistence, setPersistence] = useState<"localStorage" | "memory">("localStorage");

  useEffect(() => {
    if (model || !snapshot) return;
    const welcome = snapshot.entities.find((entity) => entity.action === "welcome");
    const catalog = snapshot.entities.find((entity) => entity.action === "catalog");
    if (!welcome || !catalog) return;
    let saved: HotbarData | undefined;
    try {
      saved = restore(window.localStorage.getItem(storageKey));
    } catch {
      setPersistence("memory");
      setMessage("Hotbar storage unavailable or invalid; pins are kept in memory for this session.");
    }
    const entityData = (entity: CatalogHotbarEntity) => ({ uid: entity.id, name: entity.name, source: entity.source });
    const next = new Hotbar(
      { logger, onTooManyItems: () => setMessage("Hotbar is full. Remove a pin before adding another.") },
      saved ?? {
        name: "Default",
        items: createDefaultHotbarItems(entityData(welcome), entityData(catalog)),
      },
    );
    setItems(next.toJSON().items);
    setModel(next);
  }, [snapshot, model]);

  useEffect(() => {
    if (!model) return;
    return reaction(
      () => model.toJSON(),
      (data) => {
        setItems(data.items);
        if (persistence === "memory") return;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(data));
        } catch {
          setPersistence("memory");
          setMessage("Hotbar storage unavailable; pins are kept in memory for this session.");
        }
      },
      { fireImmediately: true },
    );
  }, [model, persistence]);

  return {
    items,
    pinnedIds: new Set(items.flatMap((item) => (item ? [item.entity.uid] : []))),
    message,
    persistence,
    toggle: (entity) => {
      setMessage(undefined);
      model?.toggleEntity(identity(entity));
    },
    remove: (id) => model?.removeEntity(id),
  };
}
