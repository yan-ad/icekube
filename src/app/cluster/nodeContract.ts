export type Usage = { used: number | null; allocatable: number | null; capacity: number | null };
export type NodeCondition = { type: string; status: "True" | "False" | "Unknown" };
export type NodeInfo = {
  roles: string[];
  taints: number;
  version: string | null;
  internalIps: string[];
  schedulable: boolean;
  conditions: NodeCondition[];
  diskAllocatable: string | null;
  cpu: Usage;
  memory: Usage;
  metricsTimestamp: string | null;
};
export const metricStates = ["available", "unavailable", "denied", "stale", "partial", "error"] as const;
export type MetricState = typeof metricStates[number];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validTimestamp(value: unknown): value is string {
  return text(value, 64) && Number.isFinite(Date.parse(value));
}
function strings(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => text(item, max))
    && new Set(value).size === value.length;
}
function usage(value: unknown): value is Usage {
  return record(value) && [value.used, value.allocatable, value.capacity].every((number) =>
    number === null || typeof number === "number" && Number.isFinite(number) && number >= 0);
}
export function parseNode(value: unknown): NodeInfo | null {
  if (value === null || value === undefined) return null;
  if (!record(value) || !strings(value.roles, 63) || !strings(value.internalIps, 45)
    || !Number.isSafeInteger(value.taints) || (value.taints as number) < 0 || (value.taints as number) > 100
    || !(value.version === null || text(value.version, 256)) || typeof value.schedulable !== "boolean"
    || !(value.diskAllocatable === null || text(value.diskAllocatable, 64))
    || !usage(value.cpu) || !usage(value.memory)
    || !(value.metricsTimestamp === null || validTimestamp(value.metricsTimestamp))
    || !Array.isArray(value.conditions) || value.conditions.length > 100
    || !value.conditions.every((condition) => record(condition) && text(condition.type, 256)
      && ["True", "False", "Unknown"].includes(condition.status as string))
    || new Set(value.conditions.map((condition) => condition.type)).size !== value.conditions.length) throw "invalidResponse";
  return {
    roles: value.roles, taints: value.taints as number, version: value.version as string | null,
    internalIps: value.internalIps, schedulable: value.schedulable,
    conditions: value.conditions.map((condition) => ({ type: condition.type, status: condition.status })),
    diskAllocatable: value.diskAllocatable as string | null,
    cpu: { ...value.cpu }, memory: { ...value.memory }, metricsTimestamp: value.metricsTimestamp as string | null,
  };
}
