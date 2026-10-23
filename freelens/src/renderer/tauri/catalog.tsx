/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useMemo, useState } from "react";
import { AvatarView } from "../../../../packages/core/src/renderer/components/avatar/avatar-view";
import catalogStyles from "../../../../packages/core/src/renderer/components/catalog/catalog.module.scss";
import { browseCatalogTab } from "../../../../packages/core/src/renderer/components/catalog/catalog-browse-tab";
import { CatalogMenuView } from "../../../../packages/core/src/renderer/components/catalog/catalog-menu-view";
import { CatalogNameView } from "../../../../packages/core/src/renderer/components/catalog/catalog-name-view";
import { Checkbox } from "../../../../packages/core/src/renderer/components/checkbox/checkbox";
import { DrawerItem } from "../../../../packages/core/src/renderer/components/drawer/drawer-item";
import { SearchInputView } from "../../../../packages/core/src/renderer/components/input/search-input-view";
import { ItemListLayoutHeaderView } from "../../../../packages/core/src/renderer/components/item-object-list/header-view";
import { MainLayoutView } from "../../../../packages/core/src/renderer/components/layout/main-layout-view";
import { TableCellView } from "../../../../packages/core/src/renderer/components/table/table-cell-view";
import { TableHead } from "../../../../packages/core/src/renderer/components/table/table-head";
import { TableRow } from "../../../../packages/core/src/renderer/components/table/table-row";
import { MaterialIconView } from "../../../../packages/ui-components/icon/src/icon-view";
import styles from "./catalog.module.scss";
import { CatalogAction, CatalogActions, CatalogIcon, CatalogLabel } from "./catalog-controls";
import { Soon } from "./soon";
import "../../../../packages/core/src/renderer/components/table/table.scss";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

export interface TauriCatalogProps {
  snapshot: CatalogSnapshot;
  onRunEntity: (id: string) => void;
  pinnedIds: ReadonlySet<string>;
  onTogglePin: (id: string) => void;
  selectedEntityId?: string;
  selectionRevision?: number;
}

type SortKey = "name" | "kind" | "source" | "status";

export function TauriCatalog({
  snapshot,
  onRunEntity,
  pinnedIds,
  onTogglePin,
  selectedEntityId,
  selectionRevision,
}: TauriCatalogProps) {
  const [activeTab, setActiveTab] = useState(browseCatalogTab);
  const [search, setSearch] = useState("");
  // TableModel starts with empty sortParams and Catalog supplies no sortByDefault.
  // Preserve source order until the user explicitly chooses a column.
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>();
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [detailsId, setDetailsId] = useState<string>();
  useEffect(() => {
    setDetailsId(selectedEntityId);
  }, [selectedEntityId, selectionRevision]);
  const details = snapshot.entities.find((entity) => entity.id === detailsId);
  const columns = [
    "name",
    ...(!snapshot.categories.find((category) => category.id === activeTab) ? ["kind"] : []),
    "source",
    "labels",
    "status",
  ] as const;
  const visible = (key: string) => !hiddenColumns.has(key);
  const showEntity = (entity: CatalogSnapshot["entities"][number]) =>
    entity.action || entity.kind === "KubernetesCluster" ? onRunEntity(entity.id) : setDetailsId(entity.id);

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
            ...Object.entries(entity.labels).map(([key, value]) => `${key}=${value}`),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((left, right) => {
        if (!sort) return 0;
        const result = left[sort.key] < right[sort.key] ? -1 : left[sort.key] === right[sort.key] ? 0 : 1;
        return sort.descending ? -result : result;
      });
  }, [categoryEntities, search, sort]);

  const changeSort = (key: string) =>
    setSort((current) => ({ key: key as SortKey, descending: current?.key === key ? !current.descending : false }));
  const categories = snapshot.categories.map((category) => ({
    id: category.id,
    label: category.name,
    icon: category.icon ? <CatalogIcon name={category.icon} aria-hidden /> : undefined,
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
        {snapshot.warnings.length > 0 && (
          <div role="status" className={styles.warnings}>
            {snapshot.warnings.map((warning, index) => (
              <p key={`${index}-${warning}`}>{warning}</p>
            ))}
          </div>
        )}
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
            search={
              <div className={styles.search}>
                <SearchInputView value={search} onChange={setSearch} label="Search catalog" />
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled
                  aria-label="Link search (unavailable)"
                  title="Shared search and URL linking are not available in the local Catalog."
                >
                  <MaterialIconView material="link_off" small aria-hidden />
                </button>
                <Soon />
              </div>
            }
          />
          <div className="items grow">
            <div
              className={`Table autoSize selectable ${catalogStyles.Catalog}`}
              role="table"
              aria-label="Catalog entities"
            >
              <TableHead role="row">
                {columns.filter(visible).map((key) => (
                  <TableCellView
                    key={key}
                    role="columnheader"
                    aria-sort={
                      key === "labels"
                        ? undefined
                        : sort?.key === key
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
                    _sorting={{ sortBy: sort?.key ?? "", orderBy: sort?.descending ? "desc" : "asc" }}
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
                <TableCellView role="columnheader" className="menu">
                  <CatalogActions label="Column visibility" keepOpen>
                    {columns.map((key) => (
                      <li key={key} className="MenuItem input" role="none">
                        <Checkbox
                          label={key[0].toUpperCase() + key.slice(1)}
                          value={visible(key)}
                          onChange={() =>
                            setHiddenColumns((current) => {
                              const next = new Set(current);
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
              {entities.map((entity) => (
                <TableRow
                  key={entity.id}
                  role="row"
                  selected={detailsId === entity.id}
                  testId={`catalog-entity-${entity.id}`}
                  data-catalog-kind={entity.kind}
                  onClick={() => showEntity(entity)}
                >
                  {visible("name") && (
                    <TableCellView role="cell" className={catalogStyles.entityName}>
                      <CatalogNameView
                        name={entity.name}
                        avatar={
                          <AvatarView
                            title={entity.name}
                            colorHash={`${entity.name}-${entity.source}`}
                            background={entity.icon?.background}
                            size={24}
                            className={catalogStyles.catalogAvatar}
                          >
                            {entity.icon && <MaterialIconView material={entity.icon.material} small aria-hidden />}
                          </AvatarView>
                        }
                        actions={
                          <>
                            {entity.id === "preferences-entity" && (
                              <Soon title="Preferences are not available in Tauri yet." />
                            )}
                            <CatalogIcon
                              name={pinnedIds.has(entity.id) ? "push_off" : "push_pin"}
                              className={catalogStyles.pinIcon}
                              role="button"
                              tabIndex={0}
                              aria-label={`${pinnedIds.has(entity.id) ? "Remove from" : "Add to"} Hotbar: ${entity.name}`}
                              title={pinnedIds.has(entity.id) ? "Remove from Hotbar" : "Add to Hotbar"}
                              onClick={(event) => {
                                event.stopPropagation();
                                onTogglePin(entity.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onTogglePin(entity.id);
                                }
                              }}
                            />
                          </>
                        }
                      />
                      <button
                        type="button"
                        className={styles.rowActivation}
                        aria-label={`Open ${entity.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          showEntity(entity);
                        }}
                      />
                    </TableCellView>
                  )}
                  {columns.includes("kind") && visible("kind") && (
                    <TableCellView role="cell">{entity.kind}</TableCellView>
                  )}
                  {visible("source") && (
                    <TableCellView role="cell" className={catalogStyles.sourceCell}>
                      {entity.source}
                    </TableCellView>
                  )}
                  {visible("labels") && (
                    <TableCellView role="cell" className={catalogStyles.labelsCell}>
                      {Object.entries(entity.labels).map(([key, value]) => (
                        <CatalogLabel
                          key={key}
                          label={`${key}=${value}`}
                          onClick={() => setSearch(`${key}=${value}`)}
                        />
                      ))}
                    </TableCellView>
                  )}
                  {visible("status") && (
                    <TableCellView role="cell" className={catalogStyles.statusCell}>
                      <span className={entity.status}>{entity.status}</span>
                    </TableCellView>
                  )}
                  <TableCellView role="cell" className="menu" onClick={(event) => event.stopPropagation()}>
                    <CatalogActions label={`Actions for ${entity.name}`}>
                      <CatalogAction onClick={() => setDetailsId(entity.id)}>View Details</CatalogAction>
                      {!entity.action && (entity.kind === "KubernetesCluster" || entity.kind === "Cluster") && (
                        <>
                          <CatalogAction disabledReason="Cluster connections are not available in this local Catalog.">
                            Connect
                          </CatalogAction>
                          <CatalogAction disabledReason="Cluster settings are not available in this local Catalog.">
                            Settings
                          </CatalogAction>
                        </>
                      )}
                      <CatalogAction onClick={() => onTogglePin(entity.id)}>
                        {pinnedIds.has(entity.id) ? "Remove from Hotbar" : "Add to Hotbar"}
                      </CatalogAction>
                    </CatalogActions>
                  </TableCellView>
                </TableRow>
              ))}
            </div>
            {!entities.length ? <div className={styles.empty}>No catalog entities found.</div> : null}
          </div>
        </div>
        {details && (
          <section className={styles.details} role="region" aria-label={`Details for ${details.name}`}>
            <div className={styles.detailsHeader}>
              <h5>View Details</h5>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close details"
                onClick={() => setDetailsId(undefined)}
              >
                <MaterialIconView material="close" aria-hidden />
              </button>
            </div>
            <AvatarView
              title={details.name}
              colorHash={`${details.name}-${details.source}`}
              background={details.icon?.background}
              size={64}
            >
              {details.icon && <MaterialIconView material={details.icon.material} aria-hidden />}
            </AvatarView>
            <DrawerItem name="Name">{details.name}</DrawerItem>
            <DrawerItem name="Kind">{details.kind}</DrawerItem>
            <DrawerItem name="Source">{details.source}</DrawerItem>
            <DrawerItem name="Status">{details.status}</DrawerItem>
            <DrawerItem name="Labels">
              {Object.entries(details.labels).map(([key, value]) => (
                <CatalogLabel key={key} label={`${key}=${value}`} onClick={() => setSearch(`${key}=${value}`)} />
              ))}
            </DrawerItem>
            <p>
              Local catalog metadata only. Live cluster details and settings are not available. <Soon />
            </p>
            {details.action && (
              <button type="button" onClick={() => onRunEntity(details.id)}>
                Open {details.name}
              </button>
            )}
          </section>
        )}
      </section>
    </MainLayoutView>
  );
}
