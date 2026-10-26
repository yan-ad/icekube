import { Badge } from "@astryxdesign/core/Badge";
import type { NodeCondition } from "./nodeContract";

export type StatusVariant = "neutral" | "success" | "warning" | "error";

export function statusVariant(status: string | null | undefined): StatusVariant {
  const value = status?.trim().toLowerCase();
  if (["connected", "running", "active", "succeeded", "bound", "deployed", "healthy", "ready", "success"].includes(value ?? "")) return "success";
  if (["failed", "failure", "error", "notready", "not ready", "crashloopbackoff", "imagepullbackoff", "errimagepull", "lost"].includes(value ?? "")) return "error";
  if (["pending", "terminating", "degraded", "unhealthy", "unschedulable", "pending-install", "pending-upgrade", "pending-rollback", "uninstalling"].includes(value ?? "")) return "warning";
  return "neutral";
}

export function StatusBadge({ status, variant }: { status: string | boolean | null | undefined; variant?: StatusVariant }) {
  const label = typeof status === "boolean" ? status ? "True" : "False" : status?.trim() || "Unknown";
  return <Badge label={label} variant={variant ?? statusVariant(label)} />;
}

export function NodeConditionBadge({ condition }: { condition: NodeCondition }) {
  const { type, status } = condition;
  const negative = ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"].includes(type);
  const variant = type === "Ready" && status === "True" ? "success"
    : type === "Ready" && status === "False" ? "error"
    : negative && status === "True" ? "warning" : "neutral";
  return <StatusBadge status={type === "Ready" && status === "True" ? "Ready" : `${type}: ${status}`} variant={variant} />;
}
