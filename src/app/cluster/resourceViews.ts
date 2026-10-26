export type TableResourceKind =
  | "namespaces" | "pods" | "deployments" | "daemonSets" | "statefulSets"
  | "replicaSets" | "replicationControllers" | "jobs" | "cronJobs"
  | "configMaps" | "secrets" | "resourceQuotas" | "limitRanges"
  | "horizontalPodAutoscalers" | "verticalPodAutoscalers" | "podDisruptionBudgets"
  | "priorityClasses" | "runtimeClasses" | "leases"
  | "mutatingWebhookConfigurations" | "validatingWebhookConfigurations"
  | "validatingAdmissionPolicies" | "validatingAdmissionPolicyBindings"
  | "services" | "endpoints" | "endpointSlices" | "ingresses" | "ingressClasses"
  | "networkPolicies" | "persistentVolumes" | "persistentVolumeClaims" | "storageClasses"
  | "events" | "serviceAccounts" | "roles" | "roleBindings" | "clusterRoles"
  | "clusterRoleBindings" | "podSecurityPolicies" | "customResourceDefinitions";

export type ResourceView = {
  section: string;
  label: string;
  kind: TableResourceKind | null;
  namespaced: boolean;
  columns: readonly { key: string; label: string }[];
  createLabel?: string;
  service?: "helm-charts" | "helm-releases" | "port-forwarding";
};

// Behavior reference: Freelens 088d08513c8c149365dd802c588b9b0b90c6293e,
// packages/core/src/renderer/components resource lists. No upstream code copied.
// Name, Namespace, Age and Status belong to the shared table, not these columns.
// Existing createLabel values preserve the reference controls’ accessible names.
export const resourceViews: readonly ResourceView[] = [
  {
    section: "pods", label: "Pods", kind: "pods", namespaced: true,
    columns: [
      { key: "ready", label: "Ready" }, { key: "restarts", label: "Restarts" },
      { key: "node", label: "Node" }, { key: "qos", label: "QoS" },
    ],
  },
  {
    section: "deployments", label: "Deployments", kind: "deployments", namespaced: true,
    columns: [
      { key: "replicas", label: "Current" }, { key: "desired", label: "Desired" }, { key: "ready", label: "Ready" },
      { key: "updated", label: "Updated" },
      { key: "available", label: "Available" },
    ],
  },
  {
    section: "daemon-sets", label: "Daemon Sets", kind: "daemonSets", namespaced: true,
    columns: [
      { key: "desired", label: "Desired" }, { key: "scheduled", label: "Current" },
      { key: "ready", label: "Ready" },
      { key: "updated", label: "Updated" }, { key: "available", label: "Available" },
    ],
  },
  {
    section: "stateful-sets", label: "Stateful Sets", kind: "statefulSets", namespaced: true,
    columns: [{ key: "ready", label: "Ready" }, { key: "replicas", label: "Current" }, { key: "desired", label: "Desired" }],
  },
  {
    section: "replica-sets", label: "Replica Sets", kind: "replicaSets", namespaced: true,
    columns: [
      { key: "replicas", label: "Current" }, { key: "desired", label: "Desired" },
      { key: "ready", label: "Ready" },
    ],
  },
  {
    section: "replication-controllers", label: "Replication Controllers", kind: "replicationControllers", namespaced: true,
    columns: [
      { key: "replicas", label: "Current" }, { key: "desired", label: "Desired" },
      { key: "ready", label: "Ready" },
    ],
  },
  {
    section: "jobs", label: "Jobs", kind: "jobs", namespaced: true,
    columns: [
      { key: "active", label: "Active" }, { key: "completions", label: "Succeeded" },
      { key: "failed", label: "Failed" },
      { key: "desiredCompletions", label: "Completions" }, { key: "parallelism", label: "Parallelism" },
      { key: "suspend", label: "Suspended" },
    ],
  },
  {
    section: "cron-jobs", label: "Cron Jobs", kind: "cronJobs", namespaced: true,
    columns: [
      { key: "schedule", label: "Schedule" }, { key: "timeZone", label: "Timezone" },
      { key: "suspend", label: "Suspended" }, { key: "active", label: "Active" },
      { key: "lastSchedule", label: "Last Schedule" },
    ],
  },
  // Metadata-only lists deliberately omit Secret/ConfigMap data and key names.
  { section: "config-maps", label: "Config Maps", kind: "configMaps", namespaced: true, columns: [] },
  {
    section: "secrets", label: "Secrets", kind: "secrets", namespaced: true,
    columns: [], createLabel: "Create new Secret",
  },
  {
    section: "resource-quotas", label: "Resource Quotas", kind: "resourceQuotas", namespaced: true,
    columns: [
      { key: "cpuUsed", label: "CPU Used" }, { key: "cpuHard", label: "CPU Hard" },
      { key: "memoryUsed", label: "Memory Used" }, { key: "memoryHard", label: "Memory Hard" },
      { key: "podsUsed", label: "Pods Used" }, { key: "podsHard", label: "Pods Hard" },
    ], createLabel: "Create new ResourceQuota",
  },
  {
    section: "limit-ranges", label: "Limit Ranges", kind: "limitRanges", namespaced: true,
    columns: [
      { key: "types", label: "Types" }, { key: "minCpu", label: "Min CPU" },
      { key: "maxCpu", label: "Max CPU" },
    ],
  },
  {
    section: "horizontal-pod-autoscalers", label: "Horizontal Pod Autoscalers", kind: "horizontalPodAutoscalers", namespaced: true,
    columns: [
      { key: "min", label: "Min Pods" }, { key: "max", label: "Max Pods" },
      { key: "current", label: "Replicas" },
    ],
  },
  {
    section: "vertical-pod-autoscalers", label: "Vertical Pod Autoscalers", kind: "verticalPodAutoscalers", namespaced: true,
    columns: [{ key: "updateMode", label: "Mode" }],
  },
  {
    section: "pod-disruption-budgets", label: "Pod Disruption Budgets", kind: "podDisruptionBudgets", namespaced: true,
    columns: [
      { key: "minAvailable", label: "Min Available" }, { key: "maxUnavailable", label: "Max Unavailable" },
      { key: "currentHealthy", label: "Current Healthy" }, { key: "desiredHealthy", label: "Desired Healthy" },
    ],
  },
  {
    section: "priority-classes", label: "Priority Classes", kind: "priorityClasses", namespaced: false,
    columns: [{ key: "value", label: "Value" }, { key: "globalDefault", label: "Global Default" }],
  },
  {
    section: "runtime-classes", label: "Runtime Classes", kind: "runtimeClasses", namespaced: false,
    columns: [{ key: "handler", label: "Handler" }],
  },
  {
    section: "leases", label: "Leases", kind: "leases", namespaced: true,
    columns: [{ key: "holder", label: "Holder" }],
  },
  {
    section: "mutating-webhook-configs", label: "Mutating Webhook Configs", kind: "mutatingWebhookConfigurations", namespaced: false,
    columns: [{ key: "webhooks", label: "Webhooks" }],
  },
  {
    section: "validating-webhook-configs", label: "Validating Webhook Configs", kind: "validatingWebhookConfigurations", namespaced: false,
    columns: [{ key: "webhooks", label: "Webhooks" }],
  },
  {
    section: "validating-admission-policies", label: "Validating Admission Policies", kind: "validatingAdmissionPolicies", namespaced: false,
    columns: [{ key: "validations", label: "Validations" }],
  },
  {
    section: "validating-admission-policy-bindings", label: "Validating Admission Policy Bindings", kind: "validatingAdmissionPolicyBindings", namespaced: false,
    columns: [{ key: "policy", label: "Policy" }, { key: "validationActions", label: "Actions" }],
  },
  {
    section: "services", label: "Services", kind: "services", namespaced: true,
    columns: [
      { key: "type", label: "Type" }, { key: "clusterIP", label: "Cluster IP" },
      { key: "externalIPs", label: "External IP Count" }, { key: "ports", label: "Ports" },
    ],
  },
  {
    section: "endpoint-slices", label: "Endpoint Slices", kind: "endpointSlices", namespaced: true,
    columns: [
      { key: "addressType", label: "Address Type" }, { key: "ports", label: "Ports" },
      { key: "endpoints", label: "Endpoints" },
    ],
  },
  {
    section: "endpoints", label: "Endpoints", kind: "endpoints", namespaced: true,
    columns: [{ key: "readyAddresses", label: "Ready Addresses" }, { key: "notReadyAddresses", label: "Not Ready Addresses" }],
  },
  {
    section: "ingresses", label: "Ingresses", kind: "ingresses", namespaced: true,
    columns: [
      { key: "class", label: "Class" }, { key: "rules", label: "Rules" },
      { key: "tls", label: "TLS" },
    ],
  },
  {
    section: "ingress-classes", label: "Ingress Classes", kind: "ingressClasses", namespaced: false,
    columns: [
      { key: "controller", label: "Controller" }, { key: "parametersKind", label: "Parameters Kind" },
      { key: "parametersName", label: "Parameters Name" },
    ],
  },
  {
    section: "network-policies", label: "Network Policies", kind: "networkPolicies", namespaced: true,
    columns: [{ key: "policyTypes", label: "Policy Types" }],
  },
  {
    section: "port-forwarding", label: "Port Forwarding", kind: null, namespaced: true,
    columns: [
      { key: "kind", label: "Kind" }, { key: "port", label: "Pod Port" },
      { key: "forwardPort", label: "Local Port" }, { key: "protocol", label: "Protocol" },
      { key: "address", label: "Address" },
    ],
    service: "port-forwarding",
  },
  {
    section: "persistent-volume-claims", label: "Persistent Volume Claims", kind: "persistentVolumeClaims", namespaced: true,
    columns: [{ key: "storageClass", label: "Storage Class" }, { key: "capacity", label: "Size" }],
  },
  {
    section: "persistent-volumes", label: "Persistent Volumes", kind: "persistentVolumes", namespaced: false,
    columns: [
      { key: "storageClass", label: "Storage Class" }, { key: "capacity", label: "Capacity" },
      { key: "claim", label: "Claim" },
    ],
  },
  {
    section: "storage-classes", label: "Storage Classes", kind: "storageClasses", namespaced: false,
    columns: [
      { key: "provisioner", label: "Provisioner" }, { key: "reclaim", label: "Reclaim Policy" },
      { key: "bindingMode", label: "Binding Mode" }, { key: "allowExpansion", label: "Allow Expansion" },
    ],
  },
  {
    section: "namespaces", label: "Namespaces", kind: "namespaces", namespaced: false,
    columns: [{ key: "labels", label: "Label Count" }], createLabel: "Add Namespace",
  },
  {
    section: "events", label: "Events", kind: "events", namespaced: true,
    columns: [
      { key: "type", label: "Type" }, { key: "reason", label: "Reason" },
      { key: "involvedObject", label: "Involved Object" }, { key: "count", label: "Count" },
    ],
  },
  {
    section: "helm-charts", label: "Charts", kind: null, namespaced: false,
    columns: [
      { key: "description", label: "Description" }, { key: "version", label: "Version" },
      { key: "appVersion", label: "App Version" }, { key: "repository", label: "Repository" },
    ],
    createLabel: "Install",
    service: "helm-charts",
  },
  {
    section: "helm-releases", label: "Releases", kind: null, namespaced: true,
    columns: [
      { key: "chart", label: "Chart" }, { key: "revision", label: "Revision" },
      { key: "version", label: "Version" }, { key: "appVersion", label: "App Version" },
      { key: "updated", label: "Updated" },
    ],
    service: "helm-releases",
  },
  {
    section: "service-accounts", label: "Service Accounts", kind: "serviceAccounts", namespaced: true,
    columns: [], createLabel: "Create new Service Account",
  },
  {
    section: "cluster-roles", label: "Cluster Roles", kind: "clusterRoles", namespaced: false,
    columns: [{ key: "rules", label: "Rules" }], createLabel: "Create new ClusterRole",
  },
  {
    section: "roles", label: "Roles", kind: "roles", namespaced: true,
    columns: [{ key: "rules", label: "Rules" }], createLabel: "Create new Role",
  },
  {
    section: "cluster-role-bindings", label: "Cluster Role Bindings", kind: "clusterRoleBindings", namespaced: false,
    columns: [
      { key: "roleRef", label: "Cluster Role" }, { key: "roleKind", label: "Role Kind" },
      { key: "subjects", label: "Bindings" },
    ],
    createLabel: "Create new ClusterRoleBinding",
  },
  {
    section: "role-bindings", label: "Role Bindings", kind: "roleBindings", namespaced: true,
    columns: [
      { key: "roleRef", label: "Role" }, { key: "roleKind", label: "Role Kind" },
      { key: "subjects", label: "Bindings" },
    ],
    createLabel: "Create new RoleBinding",
  },
  // Retain the actual legacy API request; a removed API must surface as unavailable.
  {
    section: "pod-security-policies", label: "Pod Security Policies", kind: "podSecurityPolicies", namespaced: false,
    columns: [
      { key: "privileged", label: "Privileged" }, { key: "hostNetwork", label: "Host Network" },
      { key: "runAsUser", label: "Run As User" },
    ],
  },
  {
    section: "custom-resource-definitions", label: "Definitions", kind: "customResourceDefinitions", namespaced: false,
    columns: [
      { key: "kind", label: "Resource" }, { key: "group", label: "Group" },
      { key: "versions", label: "Versions" }, { key: "shortNames", label: "Short Names" },
      { key: "scope", label: "Scope" },
    ],
  },
];

export function resourceView(section: string): ResourceView | undefined {
  return resourceViews.find((view) => view.section === section);
}

// Metadata scaffolds only; required resource-specific fields must be supplied by the user.
export const resourceCreation = {
  nodes: { apiVersion: "v1", kind: "Node" },
  namespaces: { apiVersion: "v1", kind: "Namespace" },
  pods: { apiVersion: "v1", kind: "Pod" },
  deployments: { apiVersion: "apps/v1", kind: "Deployment" },
  daemonSets: { apiVersion: "apps/v1", kind: "DaemonSet" },
  statefulSets: { apiVersion: "apps/v1", kind: "StatefulSet" },
  replicaSets: { apiVersion: "apps/v1", kind: "ReplicaSet" },
  replicationControllers: { apiVersion: "v1", kind: "ReplicationController" },
  jobs: { apiVersion: "batch/v1", kind: "Job" },
  cronJobs: { apiVersion: "batch/v1", kind: "CronJob" },
  configMaps: { apiVersion: "v1", kind: "ConfigMap" },
  secrets: { apiVersion: "v1", kind: "Secret" },
  resourceQuotas: { apiVersion: "v1", kind: "ResourceQuota" },
  limitRanges: { apiVersion: "v1", kind: "LimitRange" },
  horizontalPodAutoscalers: { apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler" },
  verticalPodAutoscalers: { apiVersion: "autoscaling.k8s.io/v1", kind: "VerticalPodAutoscaler" },
  podDisruptionBudgets: { apiVersion: "policy/v1", kind: "PodDisruptionBudget" },
  priorityClasses: { apiVersion: "scheduling.k8s.io/v1", kind: "PriorityClass" },
  runtimeClasses: { apiVersion: "node.k8s.io/v1", kind: "RuntimeClass" },
  leases: { apiVersion: "coordination.k8s.io/v1", kind: "Lease" },
  services: { apiVersion: "v1", kind: "Service" },
  endpoints: { apiVersion: "v1", kind: "Endpoints" },
  ingresses: { apiVersion: "networking.k8s.io/v1", kind: "Ingress" },
  ingressClasses: { apiVersion: "networking.k8s.io/v1", kind: "IngressClass" },
  networkPolicies: { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy" },
  endpointSlices: { apiVersion: "discovery.k8s.io/v1", kind: "EndpointSlice" },
  mutatingWebhookConfigurations: { apiVersion: "admissionregistration.k8s.io/v1", kind: "MutatingWebhookConfiguration" },
  validatingWebhookConfigurations: { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingWebhookConfiguration" },
  validatingAdmissionPolicies: { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicy" },
  validatingAdmissionPolicyBindings: { apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicyBinding" },
  podSecurityPolicies: { apiVersion: "policy/v1beta1", kind: "PodSecurityPolicy" },
  persistentVolumes: { apiVersion: "v1", kind: "PersistentVolume" },
  persistentVolumeClaims: { apiVersion: "v1", kind: "PersistentVolumeClaim" },
  storageClasses: { apiVersion: "storage.k8s.io/v1", kind: "StorageClass" },
  events: { apiVersion: "v1", kind: "Event" },
  serviceAccounts: { apiVersion: "v1", kind: "ServiceAccount" },
  roles: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role" },
  roleBindings: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding" },
  clusterRoles: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole" },
  clusterRoleBindings: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding" },
  customResourceDefinitions: { apiVersion: "apiextensions.k8s.io/v1", kind: "CustomResourceDefinition" },
} as const satisfies Record<"nodes" | TableResourceKind, { apiVersion: string; kind: string }>;
