/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import filteredCategoriesInjectable from "../../../common/catalog/filtered-categories.injectable";
import { browseCatalogTab } from "./catalog-browse-tab";
import { CatalogCategoryLabel } from "./catalog-category-label";
import { CatalogMenuView } from "./catalog-menu-view";

import type { IComputedValue } from "mobx";

import type { CatalogCategory } from "../../api/catalog-entity";

export interface CatalogMenuProps {
  activeTab: string | undefined;
  onItemClick: (id: string) => void;
}

function CategoryIcon(props: { category: CatalogCategory }) {
  const { icon } = props.category.metadata ?? {};

  if (typeof icon === "string") {
    return Icon.isSvg(icon) ? <Icon small svg={icon} /> : <Icon small material={icon} />;
  }

  return null;
}

interface Dependencies {
  filteredCategories: IComputedValue<CatalogCategory[]>;
}

const NonInjectedCatalogMenu = observer(
  ({ activeTab, filteredCategories, onItemClick }: CatalogMenuProps & Dependencies) => (
    <CatalogMenuView
      activeTab={activeTab}
      onItemClick={(id) => onItemClick(id === browseCatalogTab ? "*" : id)}
      collapseIcon={<Icon material="expand_more" />}
      expandIcon={<Icon material="chevron_right" />}
      categories={filteredCategories.get().map((category) => ({
        id: category.getId(),
        label: <CatalogCategoryLabel category={category} />,
        icon: <CategoryIcon category={category} />,
      }))}
    />
  ),
);

export const CatalogMenu = withInjectables<Dependencies, CatalogMenuProps>(NonInjectedCatalogMenu, {
  getProps: (di, props) => ({
    ...props,
    filteredCategories: di.inject(filteredCategoriesInjectable),
  }),
});
