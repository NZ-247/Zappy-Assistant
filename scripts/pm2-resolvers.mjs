import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";

const config = { ...(existsSync(".env") ? dotenv.parse(readFileSync(".env")) : {}), ...process.env };
const providers = [
  { key: "YT", name: "youtube-resolver", port: 3401 },
  { key: "FB", name: "facebook-resolver", port: 3402 }
];

for (const { key, name, port } of providers) {
  const flag = config[`${key}_RESOLVER_ENABLED`]?.trim().toLowerCase();
  if (flag !== "true" && flag !== "1") {
    console.log(`[zappy-boot] ${name} disabled`);
    continue;
  }

  const baseUrl = config[`${key}_RESOLVER_BASE_URL`] ?? `http://localhost:${port}`;
  let endpoint;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    console.error(`[zappy-boot] ${name} invalid base URL`);
    process.exitCode = 1;
    continue;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    console.log(`[zappy-boot] ${name} managed externally`);
    continue;
  }
  if (endpoint.protocol !== "http:") {
    console.error(`[zappy-boot] ${name} requires HTTP for the local resolver`);
    process.exitCode = 1;
    continue;
  }

  const healthUrl = new URL(endpoint.href.replace(/\/$/, "") + "/health");
  const token = config[`${key}_RESOLVER_TOKEN`]?.trim();
  const healthy = async () => {
    try {
      const response = await fetch(healthUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(3000),
        redirect: "error"
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await healthy()) {
    console.log(`[zappy-boot] ${name} already healthy`);
    continue;
  }

  const cwd = resolve("infra/external-services", name);
  if (!existsSync(resolve(cwd, ".venv/bin/python"))) {
    console.error(`[zappy-boot] ${name} missing virtual environment; run its bootstrap script`);
    process.exitCode = 1;
    continue;
  }
  const resolverEnv = Object.fromEntries(Object.entries(config).filter(([name]) => name.startsWith(`${key}_RESOLVER_`)));
  const env = { ...process.env, ...resolverEnv, [`${key}_RESOLVER_BASE_URL`]: baseUrl };
  env[`${key}_RESOLVER_HOST`] = endpoint.hostname === "[::1]" ? "::1" : "127.0.0.1";
  const child = spawnSync("pm2", ["start", resolve(cwd, "scripts/run.sh"), "--name", name, "--cwd", cwd, "--interpreter", "/bin/bash", "--restart-delay", "5000"], {
    env,
    stdio: "inherit"
  });
  const deadline = performance.now() + 15_000;
  let ready = false;
  if (child.status === 0) {
    do {
      ready = await healthy();
      if (ready) break;
      await delay(1000);
    } while (performance.now() < deadline);
  }
  if (ready) {
    console.log(`[zappy-boot] ${name} ready`);
  } else {
    console.error(`[zappy-boot] ${name} could not become healthy`);
    process.exitCode = 1;
  }
}
