import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { IconAlertTriangle, IconCircleCheck, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useUpdates } from "./UpdateProvider";

const statusFootprint = {
  width: "var(--spacing-4)",
  minWidth: "var(--spacing-4)",
  maxWidth: "var(--spacing-4)",
  flex: "0 0 var(--spacing-4)",
  justifyContent: "center",
  overflow: "visible",
} as const;

function updateStatus(snapshot: NonNullable<ReturnType<typeof useUpdates>["snapshot"]>) {
  if (snapshot.phase === "ready") return "Update verified; installs automatically when work is safe.";
  if (snapshot.phase === "preparing") return "Preparing update; checking that work is safe.";
  if (snapshot.phase === "restarting") return "Installing update and restarting.";
  if (snapshot.progress) {
    const percentage = Math.floor(snapshot.progress.downloaded / Math.max(1, snapshot.progress.total) * 100);
    return `Downloading update: ${percentage}%.`;
  }
  return "Downloading update.";
}

function statusIcon(phase: "downloading" | "ready" | "preparing" | "restarting") {
  if (phase === "ready") return <Icon icon={IconCircleCheck} color="success" size="sm" />;
  if (phase === "preparing") return <Icon icon={IconAlertTriangle} color="warning" size="sm" />;
  if (phase === "restarting") return <Icon icon={IconLoader2} color="warning" size="sm" />;
  return <Icon icon={IconDownload} color="accent" size="sm" />;
}

function CompactUpdateStatus({ message, phase }: { message: string; phase: "downloading" | "ready" | "preparing" | "restarting" }) {
  return <Tooltip content={message} placement="below" alignment="end">
    <HStack
      role="status"
      tabIndex={0}
      aria-label={message}
      style={statusFootprint}
      vAlign="center"
      aria-live="polite"
    >
      {statusIcon(phase)}
      <VisuallyHidden>{message}</VisuallyHidden>
    </HStack>
  </Tooltip>;
}

function CompactUpdateError({ message }: { message: string }) {
  return <Tooltip content={message} placement="below" alignment="end">
    <HStack
      role="alert"
      tabIndex={0}
      aria-label="Update error"
      style={statusFootprint}
      vAlign="center"
    >
      <Icon icon={IconAlertTriangle} color="error" size="sm" />
      <VisuallyHidden>{message}</VisuallyHidden>
    </HStack>
  </Tooltip>;
}

export function RestartUpdateButton() {
  const { snapshot, error } = useUpdates();
  if (error) return <CompactUpdateError message={error} />;
  const phase = snapshot?.phase;
  const showStatus = phase === "downloading" || phase === "ready" || phase === "preparing" || phase === "restarting";
  if (snapshot && showStatus) return <CompactUpdateStatus message={updateStatus(snapshot)} phase={phase} />;
  return null;
}
