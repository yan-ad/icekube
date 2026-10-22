/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useMemo, useState } from "react";
import { AvatarView } from "../../../../packages/core/src/renderer/components/avatar/avatar-view";
import catalogStyles from "../../../../packages/core/src/renderer/components/catalog/catalog.module.scss";
import { browseCatalogTab } from "../../../../packages/core/src/renderer/components/catalog/catalog-browse-tab";
import { CatalogMenuView } from "../../../../packages/core/src/renderer/components/catalog/catalog-menu-view";
import { CatalogNameView } from "../../../../packages/core/src/renderer/components/catalog/catalog-name-view";
import { SearchInputView } from "../../../../packages/core/src/renderer/components/input/search-input-view";
import { ItemListLayoutHeaderView } from "../../../../packages/core/src/renderer/components/item-object-list/header-view";
import { MainLayoutView } from "../../../../packages/core/src/renderer/components/layout/main-layout-view";
import { TableCellView } from "../../../../packages/core/src/renderer/components/table/table-cell-view";
import { TableHead } from "../../../../packages/core/src/renderer/components/table/table-head";
import { TableRow } from "../../../../packages/core/src/renderer/components/table/table-row";
import { MaterialIconView } from "../../../../packages/ui-components/icon/src/icon-view";
import styles from "./catalog.module.scss";
import "../../../../packages/core/src/renderer/components/table/table.scss";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

export interface TauriCatalogProps {
  snapshot: CatalogSnapshot;
}

type SortKey = "name" | "kind" | "source" | "status";

export function TauriCatalog({ snapshot }: TauriCatalogProps) {
  const [activeTab, setActiveTab] = useState(browseCatalogTab);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });

  const selectedCategory = snapshot.categories.find((category) => category.id === activeTab);
  const categoryEntities = useMemo(
    () =>
      snapshot.entities.filter(
        (entity) =>
          !selectedCategory || (entity.group === selectedCategory.group && entity.kind === selectedCategory.kind),
      ),
    [snapshot.entities, selectedCategory],
  );
  const entities = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return categoryEntities
      .filter(
        (entity) =>
          !query ||
          [
            entity.name,
            entity.kind,
            entity.group,
            entity.source,
            entity.status,
            ...Object.entries(entity.labels).flat(),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((left, right) => {
        const result = left[sort.key].localeCompare(right[sort.key], undefined, { sensitivity: "base" });
        return sort.descending ? -result : result;
      });
  }, [categoryEntities, search, sort]);

  const changeSort = (key: string) =>
    setSort((current) => ({ key: key as SortKey, descending: current.key === key ? !current.descending : false }));
  const categories = snapshot.categories.map((category) => ({
    id: category.id,
    label: category.name,
    icon: category.icon ? <MaterialIconView material={category.icon} small aria-hidden /> : undefined,
  }));

  return (
    <MainLayoutView
      className={styles.catalog}
      sidebar={
        <CatalogMenuView
          categories={categories}
          activeTab={selectedCategory?.id ?? browseCatalogTab}
          onItemClick={setActiveTab}
        />
      }
    >
      <section className={`${catalogStyles.views}`}>
        <div className={`ItemListLayout flex flex-col ${catalogStyles.Catalog} ${styles.list}`}>
          <ItemListLayoutHeaderView
            title={<h5 className="title">{selectedCategory?.name ?? "Browse All"}</h5>}
            info={
              search.trim() ? (
                <>
                  Filtered: {entities.length} / {categoryEntities.length}
                </>
              ) : (
                `${categoryEntities.length} ${categoryEntities.length === 1 ? "item" : "items"}`
              )
            }
            search={<SearchInputView value={search} onChange={setSearch} label="Search catalog" />}
          />
          <div className="items grow">
            <div className={`Table autoSize ${catalogStyles.Catalog}`} role="table" aria-label="Catalog entities">
              <TableHead role="row">
                {(["name", "kind", "source", "labels", "status"] as const).map((key) => (
                  <TableCellView
                    key={key}
                    role="columnheader"
                    aria-sort={
                      key === "labels"
                        ? undefined
                        : sort.key === key
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                    }
                    className={
                      key === "name"
                        ? catalogStyles.entityName
                        : key === "source"
                          ? catalogStyles.sourceCell
                          : key === "status"
                            ? catalogStyles.statusCell
                            : undefined
                    }
                    sortBy={key === "labels" ? undefined : key}
                    _sort={changeSort}
                    _sorting={{ sortBy: sort.key, orderBy: sort.descending ? "desc" : "asc" }}
                    renderSortIcon={(active, direction) => (
                      <MaterialIconView
                        material={direction}
                        className={`sortIcon${active ? " enabled" : ""}`}
                        aria-hidden
                      />
                    )}
                    tabIndex={key === "labels" ? undefined : 0}
                    onKeyDown={(event) => {
                      if (key !== "labels" && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        changeSort(key);
                      }
                    }}
                  >
                    {key[0].toUpperCase() + key.slice(1)}
                  </TableCellView>
                ))}
              </TableHead>
              {entities.map((entity) => (
                <TableRow key={entity.id} role="row" testId={`catalog-entity-${entity.id}`}>
                  <TableCellView role="cell" className={catalogStyles.entityName}>
                    <CatalogNameView
                      name={entity.name}
                      avatar={
                        <AvatarView
                          title={entity.name}
                          colorHash={`${entity.name}-${entity.source}`}
                          size={24}
                          className={catalogStyles.catalogAvatar}
                        />
                      }
                    />
                  </TableCellView>
                  <TableCellView role="cell">{entity.kind}</TableCellView>
                  <TableCellView role="cell" className={catalogStyles.sourceCell}>
                    {entity.source}
                  </TableCellView>
                  <TableCellView role="cell" className={catalogStyles.labelsCell}>
                    {Object.entries(entity.labels)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(", ")}
                  </TableCellView>
                  <TableCellView role="cell" className={catalogStyles.statusCell}>
                    <span className={entity.status}>{entity.status}</span>
                  </TableCellView>
                </TableRow>
              ))}
            </div>
            {!entities.length ? <div className={styles.empty}>No catalog entities found.</div> : null}
          </div>
        </div>
      </section>
    </MainLayoutView>
  );
}
