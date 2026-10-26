import { RouterProvider } from "@tanstack/react-router";
import { router } from "./app/router";
import { UpdateProvider } from "./app/updates/UpdateProvider";
import { PreferencesProvider } from "./app/preferences/PreferencesProvider";
import { PreferencesDialog } from "./app/preferences/PreferencesDialog";

export default function App() {
  return (
    <UpdateProvider>
      <PreferencesProvider>
        <RouterProvider router={router} />
        <PreferencesDialog />
      </PreferencesProvider>
    </UpdateProvider>
  );
}
