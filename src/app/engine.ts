import { invoke as nativeInvoke, isTauri } from "@tauri-apps/api/core";

const developmentEngine = import.meta.env.DEV && import.meta.env.VITE_ICEON_DEV_ENGINE === "1"
  && typeof window !== "undefined" && window.location.protocol === "http:"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "1420";
const client = developmentEngine ? crypto.randomUUID() : "";
let heartbeat: ReturnType<typeof setInterval> | undefined;
let opening = 0;
let session: { clusterId: string; sessionId: string } | undefined;

export function hasEngine(): boolean { return isTauri() || developmentEngine; }
export function hasDevelopmentEngine(): boolean { return !isTauri() && developmentEngine; }

async function request<T>(path: string, body: object, keepalive = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/__iceon_engine/${path}`, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error", keepalive,
      headers: { "Content-Type": "application/json", "x-iceon-dev": "1", "x-iceon-client": client },
      body: JSON.stringify(body),
    });
  } catch { throw "unavailable"; }
  let result: unknown;
  try { result = await response.json(); } catch { throw "unavailable"; }
  if (!result || typeof result !== "object" || !("ok" in result)) throw "invalidResponse";
  const envelope = result as { ok: unknown; value?: T; error?: unknown };
  if (envelope.ok === false && typeof envelope.error === "string") throw envelope.error;
  if (!response.ok || envelope.ok !== true || !("value" in envelope)) throw "invalidResponse";
  return envelope.value as T;
}
function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; }
function startHeartbeat() {
  stopHeartbeat();
  if (session) heartbeat = setInterval(() => { void request("heartbeat", {}).catch(() => {}); }, 5_000);
}
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return nativeInvoke<T>(command, args);
  if (!developmentEngine) throw "unavailable";
  const generation = command === "cluster_session_open" ? ++opening : opening;
  const value = await request<T>("invoke", { command, args: args ?? {} });
  if (command === "cluster_session_open" && generation === opening) {
    const opened = value as { clusterId?: string; sessionId?: string } | null;
    session = opened?.clusterId && opened.sessionId ? { clusterId: opened.clusterId, sessionId: opened.sessionId } : undefined;
    startHeartbeat();
  } else if (command === "cluster_disconnect" && (args?.request as { sessionId?: string } | undefined)?.sessionId === session?.sessionId) {
    stopHeartbeat(); session = undefined;
  }
  return value;
}
function release() {
  stopHeartbeat();
  if (session) void request("invoke", { command: "cluster_disconnect", args: { request: session } }, true).catch(() => {});
  session = undefined;
}
if (developmentEngine) window.addEventListener("pagehide", release);
if (import.meta.hot) import.meta.hot.dispose(() => { release(); window.removeEventListener("pagehide", release); });
