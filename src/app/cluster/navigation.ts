import type { IconType } from "@astryxdesign/core/Icon";
import {
  IconActivity, IconBox, IconCalendarEvent, IconDatabase, IconFileSettings,
  IconCube, IconHexagons, IconKey, IconNetwork, IconPackages, IconServer, IconSitemap,
} from "@tabler/icons-react";

const clusterChildren = {
  workloads: [
    { id: "workloads-overview", label: "Overview" },
    { id: "pods", label: "Pods" },
    { id: "deployments", label: "Deployments" },
    { id: "daemon-sets", label: "Daemon Sets" },
    { id: "stateful-sets", label: "Stateful Sets" },
    { id: "replica-sets", label: "Replica Sets" },
    { id: "replication-controllers", label: "Replication Controllers" },
    { id: "jobs", label: "Jobs" },
    { id: "cron-jobs", label: "Cron Jobs" },
  ],
  config: [
    { id: "config-maps", label: "Config Maps" },
    { id: "secrets", label: "Secrets" },
    { id: "resource-quotas", label: "Resource Quotas" },
    { id: "limit-ranges", label: "Limit Ranges" },
    { id: "horizontal-pod-autoscalers", label: "Horizontal Pod Autoscalers" },
    { id: "vertical-pod-autoscalers", label: "Vertical Pod Autoscalers" },
    { id: "pod-disruption-budgets", label: "Pod Disruption Budgets" },
    { id: "priority-classes", label: "Priority Classes" },
    { id: "runtime-classes", label: "Runtime Classes" },
    { id: "leases", label: "Leases" },
    { id: "mutating-webhook-configs", label: "Mutating Webhook Configs" },
    { id: "validating-webhook-configs", label: "Validating Webhook Configs" },
    { id: "validating-admission-policies", label: "Validating Admission Policies" },
    { id: "validating-admission-policy-bindings", label: "Validating Admission Policy Bindings" },
  ],
  network: [
    { id: "services", label: "Services" },
    { id: "endpoint-slices", label: "Endpoint Slices" },
    { id: "endpoints", label: "Endpoints" },
    { id: "ingresses", label: "Ingresses" },
    { id: "ingress-classes", label: "Ingress Classes" },
    { id: "network-policies", label: "Network Policies" },
    { id: "port-forwarding", label: "Port Forwarding" },
  ],
  storage: [
    { id: "persistent-volume-claims", label: "Persistent Volume Claims" },
    { id: "persistent-volumes", label: "Persistent Volumes" },
    { id: "storage-classes", label: "Storage Classes" },
  ],
  helm: [
    { id: "helm-charts", label: "Charts" },
    { id: "helm-releases", label: "Releases" },
  ],
  "access-control": [
    { id: "users", label: "Users" },
    { id: "service-accounts", label: "Service Accounts" },
    { id: "cluster-roles", label: "Cluster Roles" },
    { id: "roles", label: "Roles" },
    { id: "cluster-role-bindings", label: "Cluster Role Bindings" },
    { id: "role-bindings", label: "Role Bindings" },
    { id: "pod-security-policies", label: "Pod Security Policies" },
  ],
  "custom-resources": [
    { id: "custom-resource-definitions", label: "Definitions" },
  ],
} as const;

export const clusterSections = [
  { id: "overview", label: "Cluster", icon: IconHexagons },
  { id: "nodes", label: "Nodes", icon: IconServer },
  { id: "workloads", label: "Workloads", icon: IconPackages, children: clusterChildren.workloads },
  { id: "config", label: "Config", icon: IconFileSettings, children: clusterChildren.config },
  { id: "network", label: "Network", icon: IconNetwork, children: clusterChildren.network },
  { id: "storage", label: "Storage", icon: IconDatabase, children: clusterChildren.storage },
  { id: "namespaces", label: "Namespaces", icon: IconSitemap },
  { id: "events", label: "Events", icon: IconCalendarEvent },
  { id: "helm", label: "Helm", icon: IconBox, children: clusterChildren.helm },
  { id: "access-control", label: "Access Control", icon: IconKey, children: clusterChildren["access-control"] },
  { id: "custom-resources", label: "Custom Resources", icon: IconActivity, children: clusterChildren["custom-resources"] },
] as const satisfies readonly { id: string; label: string; icon: IconType; children?: readonly { id: string; label: string }[] }[];

export const clusterDestinations = clusterSections.flatMap((item) => [
  { id: item.id, label: item.label, icon: item.icon },
  ...("children" in item ? item.children.map(child => ({ ...child, icon: child.id === "pods" ? IconCube : item.icon })) : []),
]);

export type ClusterSectionId = (typeof clusterDestinations)[number]["id"];
