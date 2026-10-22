/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { CatalogCategoryRegistry } from "../../../../packages/core/src/common/catalog/category-registry";
import { GeneralCategory } from "../../../../packages/core/src/common/catalog-entities/general";
import catalogEntityInjectable from "../../../../packages/core/src/common/catalog-entities/general-catalog-entities/implementations/catalog-catalog-entity.injectable";
import welcomeEntityInjectable from "../../../../packages/core/src/common/catalog-entities/general-catalog-entities/implementations/welcome-catalog-entity.injectable";
import catalogRouteInjectable from "../../../../packages/core/src/common/front-end-routing/routes/catalog/catalog-route.injectable";
import welcomeRouteInjectable from "../../../../packages/core/src/common/front-end-routing/routes/welcome/welcome-route.injectable";
import welcomeRouteConfigInjectable from "../../../../packages/core/src/common/front-end-routing/routes/welcome/welcome-route-config.injectable";
import { CatalogEntityRegistry } from "../../../../packages/core/src/main/catalog/entity-registry";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

// Deliberately not the application's generated registration graph. These two
// providers and their routes need no profile, Kubernetes, extension or watcher.
export const createBuiltInCatalog = (): (() => CatalogSnapshot) => {
  const di = createContainer("tauri-built-in-catalog");
  di.register(
    welcomeRouteConfigInjectable,
    welcomeRouteInjectable,
    catalogRouteInjectable,
    welcomeEntityInjectable,
    catalogEntityInjectable,
  );
  di.override(welcomeRouteConfigInjectable, () => "/welcome");

  const categories = new CatalogCategoryRegistry();
  categories.add(new GeneralCategory());
  const entities = new CatalogEntityRegistry({
    hasCategoryForEntity: (entity) => categories.hasCategoryForEntity(entity),
  });
  entities.addComputedSource(
    "built-in",
    computed(() => [di.inject(welcomeEntityInjectable), di.inject(catalogEntityInjectable)]),
  );

  // Project explicitly: never serialize classes, specs, actions or paths.
  return () => ({
    protocolVersion: 1,
    scope: "built-in",
    categories: categories.items.map((category) => ({
      id: category.getId(),
      name: category.getName(),
      kind: category.spec.names.kind,
      group: category.spec.group,
      icon: category.metadata.icon,
    })),
    entities: entities.items.map((entity) => ({
      id: entity.getId(),
      name: entity.getName(),
      kind: entity.kind,
      group: entity.apiVersion.split("/")[0],
      source: entity.getSource(),
      status: entity.status.phase,
      labels: Object.fromEntries(
        Object.entries(entity.metadata.labels).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    })),
  });
};
