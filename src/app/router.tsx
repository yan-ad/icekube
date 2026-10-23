import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import MainLayout from "./layouts/MainLayout";
import WelcomePage from "./pages/WelcomePage";
import CatalogPage from "./pages/CatalogPage";
import NotFoundPage from "./pages/NotFoundPage";
import { ShellStateProvider } from "./layouts/shell-state";

const rootRoute = createRootRoute({
  component: () => <ShellStateProvider><MainLayout /></ShellStateProvider>,
  notFoundComponent: NotFoundPage,
});
const welcomeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: WelcomePage });
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: "catalog" });
const catalogIndexRoute = createRoute({ getParentRoute: () => catalogRoute, path: "/", component: CatalogPage });
const generalRoute = createRoute({ getParentRoute: () => catalogRoute, path: "general", component: CatalogPage });
const clustersRoute = createRoute({ getParentRoute: () => catalogRoute, path: "clusters", component: CatalogPage });
const webLinksRoute = createRoute({ getParentRoute: () => catalogRoute, path: "web-links", component: CatalogPage });

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([
    welcomeRoute,
    catalogRoute.addChildren([catalogIndexRoute, generalRoute, clustersRoute, webLinksRoute]),
  ]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
