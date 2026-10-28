import type { ReactNode } from "react";
import { ContentError } from "../components/ContentError";
import { ContentLoading } from "../components/ContentLoading";
import { usePermissionChecks } from "./PermissionProvider";
import { ReadOnlyNotice } from "./ReadOnlyNotice";
import type { PermissionCheckInput } from "./permissionsApi";

export function PermissionGate({ check, children, quiet = false }: { check: PermissionCheckInput; children: ReactNode; quiet?: boolean }) {
  const permissions = usePermissionChecks([check]);
  if (permissions.loading && !permissions.observed(check)) return quiet ? null : <ContentLoading label="Checking access…" />;
  const decision = permissions.decision(check);
  if (decision === "denied") return quiet ? null : <ContentError title="Access denied" message="Your Kubernetes permissions do not allow viewing these resources." onRetry={permissions.retry} />;
  // Entering this route is an explicit read request, not a grant for mutations.
  return <>{decision === "unknown" && !quiet && <ReadOnlyNotice unverified />}{children}</>;
}
