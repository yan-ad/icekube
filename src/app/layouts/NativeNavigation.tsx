import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useUpdates } from "../updates/UpdateProvider";
import { usePreferences } from "../preferences/PreferencesProvider";
import { useRef } from "react";
import { updateError, type UpdateSnapshot } from "../updates/api";
import { checkForUpdates, subscribeNativeNavigation } from "./nativeNavigationApi";

function statusMessage(snapshot: UpdateSnapshot | null): string {
  if (!snapshot) return "Requesting an update check…";
  if (snapshot.phase === "disabled") return snapshot.error ? updateError(snapshot.error) : "Updates are disabled in this build. Signed release updates are supported on Apple silicon release builds.";
  if (snapshot.error) return updateError(snapshot.error);
  if (snapshot.phase === "ready") return `Version ${snapshot.version} is verified and ready. Use Restart to update in the toolbar when you are ready.`;
  if (snapshot.phase === "checking") return "Checking for a signed release…";
  if (snapshot.phase === "downloading") return "Downloading and verifying the release…";
  if (snapshot.phase === "stopped") return "The updater has stopped.";
  if (snapshot.phase === "restarting") return "Restarting to install the verified release…";
  return "The Rust updater is scheduled to check for a signed release. No update is ready to install.";
}

export function NativeNavigation({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  const { snapshot } = useUpdates();
  const { openPreferences } = usePreferences();
  const preferencesAction = useRef(openPreferences);
  preferencesAction.current = openPreferences;
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<UpdateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeNativeNavigation((action) => {
      if (disposed) return;
      if (action === "openSearch") onSearch();
      if (action === "openPreferences") preferencesAction.current();
      if (action === "allCategories") void navigate({ to: "/catalog/all" });
      if (action === "checkUpdates") {
        setOpen(true); setError(null); setRequested(null);
        void checkForUpdates().then((next) => { if (!disposed) setRequested(next); })
          .catch(() => { if (!disposed) setError("The update check could not be requested. Try again from Help."); });
      }
    }).then((stop) => { if (disposed) stop(); else unsubscribe = stop; })
      .catch(() => { if (!disposed) setError("Native menu navigation is unavailable. Use the toolbar to navigate."); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [navigate, onSearch]);
  return <Dialog isOpen={open || !!error} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
    <VStack gap={4} padding={6}>
      <DialogHeader title="Check for Updates" />
      <Text role="status">{error ?? statusMessage(requested?.phase === "disabled" ? requested : snapshot ?? requested)}</Text>
      <Button label="Close" onClick={() => { setOpen(false); setError(null); }} />
    </VStack>
  </Dialog>;
}
