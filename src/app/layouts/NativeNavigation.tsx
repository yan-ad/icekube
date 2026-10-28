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
import { subscribeNativeNavigation } from "./nativeNavigationApi";

function statusMessage(snapshot: UpdateSnapshot | null): string {
  if (!snapshot) return "Requesting an update check…";
  if (snapshot.phase === "disabled") return "Automatic updates are unavailable in this build.";
  if (snapshot.error) return updateError(snapshot.error);
  if (snapshot.phase === "ready") return `Version ${snapshot.version} is verified and will install automatically when work is safe.`;
  if (snapshot.phase === "preparing") return "Preparing update; checking that work is safe…";
  if (snapshot.phase === "restarting") return "Installing update and restarting…";
  if (snapshot.phase === "checking") return "Checking GitHub releases…";
  if (snapshot.phase === "downloading") return snapshot.progress ? `Downloading update: ${snapshot.progress.downloaded} of ${snapshot.progress.total} bytes` : "Downloading update…";
  if (snapshot.phase === "stopped") return "The updater has stopped.";
  return "No newer supported release was found.";
}

export function NativeNavigation({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  const { snapshot, busy, error: updateFailure, check } = useUpdates();
  const checkAction = useRef(check);
  checkAction.current = check;
  const { openPreferences } = usePreferences();
  const preferencesAction = useRef(openPreferences);
  preferencesAction.current = openPreferences;
  const [open, setOpen] = useState(false);
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
        setOpen(true); setError(null);
        void checkAction.current();
      }
    }).then((stop) => { if (disposed) stop(); else unsubscribe = stop; })
      .catch(() => { if (!disposed) setError("Native menu navigation is unavailable. Use the toolbar to navigate."); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [navigate, onSearch]);
  return <Dialog isOpen={open || !!error} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
    <VStack gap={4} padding={6}>
      <DialogHeader title="Check for Updates" />
      <Text role="status">{error ?? updateFailure ?? (busy && snapshot?.phase !== "downloading" ? "Requesting an update check…" : statusMessage(snapshot))}</Text>
      <Button label="Close" onClick={() => { setOpen(false); setError(null); }} />
    </VStack>
  </Dialog>;
}
