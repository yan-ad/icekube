import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Plugin } from "vite";

const prefix = "/__iceon_engine";
const bodyLimit = 2 * 1024 * 1024;

export function devEngine(): Plugin {
  const frontendPort = Number(process.env.ICEON_DEV_PORT ?? "1420");
  if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
    throw new Error("ICEON_DEV_PORT must be an integer between 1 and 65535.");
  }
  const origins = new Set([`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`]);
  let child: ChildProcess | undefined;
  let stop: (() => Promise<void>) | undefined;
  return {
    name: "iceon-dev-engine",
    apply: "serve",
    config() {
      return { define: { "import.meta.env.VITE_ICEON_DEV_ENGINE": JSON.stringify("1"),
        "import.meta.env.VITE_ICEON_DEV_PORT": JSON.stringify(String(frontendPort)) },
        server: { port: frontendPort, fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.iceon-dev/**",
        `${resolve(process.env.ICEON_DEV_DATA_DIR || ".iceon-dev").replaceAll("\\", "/")}/**`] } } };
    },
    configResolved(config) {
      if (config.server.port !== frontendPort || config.server.https
        || config.server.host && !["localhost", "127.0.0.1"].includes(String(config.server.host))) {
        throw new Error(`The development engine requires HTTP on localhost or 127.0.0.1:${frontendPort}; LAN access is not supported.`);
      }
    },
    async configureServer(server) {
      const token = randomBytes(32).toString("hex");
      const discoveryHome = process.env.ICEON_DEV_DISCOVERY_HOME
        ?? (process.env.ICEON_DEV_DISCOVERY === "1" ? homedir() : undefined);
      child = spawn("cargo", ["run", "--manifest-path", "src-tauri/Cargo.toml", "--features", "dev-engine", "--bin", "iceon-dev-engine"], {
        cwd: server.config.root,
        env: { ...process.env, ICEON_DEV_ENGINE_TOKEN: token, ICEON_DEV_PORT: String(frontendPort),
          ...(discoveryHome ? { ICEON_DEV_DISCOVERY_HOME: discoveryHome } : {}),
          ICEON_DEV_DATA_DIR: resolve(server.config.root, process.env.ICEON_DEV_DATA_DIR || ".iceon-dev") },
        stdio: ["pipe", "pipe", "inherit"],
      });
      const engine = child;
      let closing = false;
      stop = async () => {
        if (closing) return;
        closing = true;
        const exited = new Promise<void>(done => {
          if (!engine.pid || engine.exitCode !== null || engine.signalCode !== null) done();
          else engine.once("close", () => done());
        });
        engine.stdin?.end();
        const kill = setTimeout(() => engine.kill("SIGTERM"), 10_000);
        const force = setTimeout(() => engine.kill("SIGKILL"), 15_000);
        kill.unref(); force.unref();
        await exited;
        clearTimeout(kill); clearTimeout(force);
      };
      let port: number;
      try {
        port = await new Promise<number>((done, reject) => {
          const lines = createInterface({ input: engine.stdout! });
          const timer = setTimeout(() => reject(new Error("Rust development engine startup timed out.")), 300_000);
          const finish = () => { clearTimeout(timer); lines.close(); };
          engine.once("error", () => { finish(); reject(new Error("Could not start Cargo. Install the Rust/Tauri development prerequisites.")); });
          engine.once("exit", () => { finish(); reject(new Error("Rust development engine exited before becoming ready. See Cargo output above.")); });
          lines.once("line", line => {
            finish();
            try {
              const value = JSON.parse(line);
              if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error();
              done(value.port);
            } catch { reject(new Error("Invalid Rust development engine readiness response.")); }
          });
        });
      } catch (reason) {
        await stop();
        throw reason;
      }
      engine.once("exit", () => {
        if (!closing) server.config.logger.error("Rust development engine stopped. Restart the development command to reconnect.");
      });
      server.httpServer?.once("close", () => { void stop?.(); });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        const fail = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ ok: false, error })); };
        const origin = req.headers.origin;
        const host = req.headers.host;
        const path = req.url.slice(prefix.length);
        if (!host || !origins.has(`http://${host}`) || !origin || !origins.has(origin)
          || origin !== `http://${host}` || req.headers["x-iceon-dev"] !== "1"
          || req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") {
          return fail(403, "unauthorized");
        }
        if (req.method !== "POST" || !["/invoke", "/heartbeat"].includes(path)
          || req.headers["content-type"] !== "application/json" || req.headers["content-encoding"]) return fail(400, "invalidRequest");
        const client = req.headers["x-iceon-client"];
        if (typeof client !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(client)) return fail(400, "invalidInput");
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          req.setTimeout(5_000, () => req.destroy());
          for await (const chunk of req) {
            const bytes = Buffer.from(chunk);
            length += bytes.length;
            if (length > bodyLimit) return fail(413, "limitExceeded");
            chunks.push(bytes);
          }
          req.setTimeout(0);
          const reply = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: "POST", headers: { "Content-Type": "application/json", Origin: origin,
              Authorization: `Bearer ${token}`, "x-iceon-dev": "1", "x-iceon-client": client },
            body: Buffer.concat(chunks), redirect: "error",
          });
          res.statusCode = reply.status;
          res.end(Buffer.from(await reply.arrayBuffer()));
        } catch { if (!res.writableEnded) fail(503, "unavailable"); }
      });
      server.config.logger.info("Rust development engine ready (isolated .iceon-dev storage unless overridden).");
    },
    async closeBundle() { await stop?.(); },
  };
}
