import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { useUpdates } from "./UpdateProvider";

export function RestartUpdateButton() {
  const { snapshot, busy, error, restart } = useUpdates();
  return <HStack gap={2} vAlign="center">
    {(snapshot?.phase === "ready" || snapshot?.phase === "restarting") && <Button label="Restart to Update" size="sm" isLoading={busy || snapshot.phase === "restarting"} isDisabled={busy} onClick={() => void restart()} tooltip={`Install version ${snapshot.version} and restart Icekube`} />}
    {error && <output role="alert" aria-label="Update error">{error}</output>}
  </HStack>;
}
