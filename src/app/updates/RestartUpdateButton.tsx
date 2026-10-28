import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useUpdates } from "./UpdateProvider";

export function RestartUpdateButton() {
  const { snapshot, error } = useUpdates();
  if (!snapshot || !["downloading", "ready", "preparing", "restarting"].includes(snapshot.phase)) return error ? <output role="alert" aria-label="Update error">{error}</output> : null;
  return <HStack gap={2} vAlign="center">
    <Text role="status">{snapshot.phase === "ready"
      ? "Update verified; installs automatically when work is safe."
      : snapshot.phase === "preparing" ? "Preparing update; checking that work is safe…"
      : snapshot.phase === "restarting" ? "Installing update and restarting…"
      : snapshot.progress ? `Downloading update: ${Math.floor(snapshot.progress.downloaded / Math.max(1, snapshot.progress.total) * 100)}%` : "Downloading update…"}</Text>
    {error && <output role="alert" aria-label="Update error">{error}</output>}
  </HStack>;
}
