/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { CatalogCategoryRegistry } from "../../../../packages/core/src/common/catalog/category-registry";
import { GeneralCategory, GeneralEntity } from "../../../../packages/core/src/common/catalog-entities/general";
import catalogEntityInjectable from "../../../../packages/core/src/common/catalog-entities/general-catalog-entities/implementations/catalog-catalog-entity.injectable";
import welcomeEntityInjectable from "../../../../packages/core/src/common/catalog-entities/general-catalog-entities/implementations/welcome-catalog-entity.injectable";
import { generalCatalogCategory } from "../../../../packages/core/src/common/catalog-entities/general-category";
import { kubernetesClusterCatalogCategory } from "../../../../packages/core/src/common/catalog-entities/kubernetes-cluster-category";
import { webLinkCatalogCategory } from "../../../../packages/core/src/common/catalog-entities/web-link-category";
import catalogRouteInjectable from "../../../../packages/core/src/common/front-end-routing/routes/catalog/catalog-route.injectable";
import welcomeRouteInjectable from "../../../../packages/core/src/common/front-end-routing/routes/welcome/welcome-route.injectable";
import welcomeRouteConfigInjectable from "../../../../packages/core/src/common/front-end-routing/routes/welcome/welcome-route-config.injectable";
import preferencesEntityInjectable from "../../../../packages/core/src/features/preferences/common/preferences-catalog-entity.injectable";
import preferencesRouteInjectable from "../../../../packages/core/src/features/preferences/common/preferences-route.injectable";
import { CatalogEntityRegistry } from "../../../../packages/core/src/main/catalog/entity-registry";
import { discoverKubeconfigContexts } from "./kubeconfig-discovery";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

// Deliberately not the application's generated registration graph. These three
// providers and their routes need no profile, Kubernetes, extension or watcher.
export const createBuiltInCatalog = (
  options: { roots?: string[]; homeDirectory?: string } = {},
): (() => Promise<CatalogSnapshot>) => {
  if (
    options.roots !== undefined &&
    (!Array.isArray(options.roots) || options.roots.some((root) => typeof root !== "string"))
  ) {
    throw new Error("Invalid catalog discovery roots configuration");
  }
  const di = createContainer("tauri-built-in-catalog");
  di.register(
    preferencesEntityInjectable,
    preferencesRouteInjectable,
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
    computed(() => [
      di.inject(catalogEntityInjectable),
      di.inject(welcomeEntityInjectable),
      di.inject(preferencesEntityInjectable),
    ]),
  );

  // Explicit projection excludes executable specs, paths and callbacks.
  return async () => {
    const discovery = await discoverKubeconfigContexts({
      roots: options.roots ?? [],
      homeDirectory: options.homeDirectory ?? "",
      maxEntities: 997,
    });
    return {
      protocolVersion: 2,
      scope: "local",
      categories: [generalCatalogCategory, kubernetesClusterCatalogCategory, webLinkCatalogCategory],
      entities: [
        ...entities.items.map((entity) => ({
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
          icon:
            entity instanceof GeneralEntity && entity.spec.icon
              ? {
                  material: entity.spec.icon.material ?? "settings",
                  background: entity.spec.icon.background ?? "var(--primary)",
                }
              : null,
          action:
            entity.getId() === "welcome-page-entity"
              ? ("welcome" as const)
              : entity.getId() === "catalog-entity"
                ? ("catalog" as const)
                : null,
        })),
        ...discovery.entities,
      ],
      warnings: discovery.warnings,
    };
  };
};
