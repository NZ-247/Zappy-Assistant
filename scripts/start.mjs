#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfonts from "cfonts";
import dotenv from "dotenv";

const MODE_PROFILES = {
  dev: {
    serviceScript: "dev",
    nodeEnv: "development",
    logDefaults: {
      LOG_FORMAT: "pretty",
      LOG_LEVEL: "debug",
      LOG_PRETTY_MODE: "dev",
      LOG_COLORIZE: "true",
      LOG_VERBOSE_FIELDS: "true"
    }
  },
  prod: {
    serviceScript: "start",
    nodeEnv: "production",
    logDefaults: {
      LOG_FORMAT: "pretty",
      LOG_LEVEL: "info",
      LOG_PRETTY_MODE: "prod",
      LOG_COLORIZE: "true",
      LOG_VERBOSE_FIELDS: "false"
    }
  },
  debug: {
    serviceScript: "start",
    nodeEnv: "production",
    logDefaults: {
      LOG_FORMAT: "json",
      LOG_LEVEL: "debug",
      LOG_VERBOSE_FIELDS: "true",
      DEBUG: "trace"
    }
  }
};

const VALID_MODES = new Set(Object.keys(MODE_PROFILES));
const requestedMode = (process.argv[2] ?? "dev").toLowerCase();
if (!VALID_MODES.has(requestedMode)) {
  console.error(`[start] invalid mode "${requestedMode}". Use: dev | prod | debug`);
  process.exit(1);
}
const modeArgs = process.argv.slice(3);
const validModeFlags = new Set([
  "--build",
  "--with-external-services",
  "--with-yt-resolver",
  "--with-fb-resolver",
  "--skip-resolver-healthcheck"
]);
const unknownModeFlags = modeArgs.filter((arg) => arg.startsWith("--") && !validModeFlags.has(arg));
if (unknownModeFlags.length > 0) {
  console.error(
    `[start:${requestedMode}] unknown flag(s): ${unknownModeFlags.join(
      ", "
    )}. Supported: --build --with-external-services --with-yt-resolver --with-fb-resolver --skip-resolver-healthcheck`
  );
  process.exit(1);
}
const prodBuildRequested = modeArgs.includes("--build");
const withExternalServices = modeArgs.includes("--with-external-services");
const withYoutubeResolver = modeArgs.includes("--with-yt-resolver");
const withFacebookResolver = modeArgs.includes("--with-fb-resolver");
const skipResolverHealthcheck = modeArgs.includes("--skip-resolver-healthcheck");

const modeProfile = MODE_PROFILES[requestedMode];
const serviceScript = modeProfile.serviceScript;
const isDev = requestedMode === "dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const composeFile = path.join(rootDir, "infra", "docker-compose.yml");
const stateDir = path.join(rootDir, ".zappy-dev");
const stateFile = path.join(stateDir, `${requestedMode}-stack.json`);
const modeStateFiles = Object.fromEntries(Array.from(VALID_MODES).map((mode) => [mode, path.join(stateDir, `${mode}-stack.json`)]));

dotenv.config({ path: path.join(rootDir, ".env") });

if (!fs.existsSync(composeFile)) {
  console.error(`[start:${requestedMode}] Compose file missing at ${composeFile}`);
  process.exit(1);
}

const infraDependencies = [
  {
    service: "postgres",
    label: "PostgreSQL",
    host: "127.0.0.1",
    port: 5432,
    requireHealthyStatus: true
  },
  {
    service: "redis",
    label: "Redis",
    host: "127.0.0.1",
    port: 6379,
    requireHealthyStatus: true
  }
];
const requiredInfra = infraDependencies.map((item) => item.service);
const dependencyValidationTimeoutMs = 45_000;
const dependencyValidationIntervalMs = 1_250;
const services = [
  { name: "assistant-api", workspace: "@zappy/assistant-api" },
  { name: "media-resolver-api", workspace: "@zappy/media-resolver-api" },
  { name: "wa-gateway", workspace: "@zappy/wa-gateway" },
  { name: "worker", workspace: "@zappy/worker" },
  { name: "admin-ui", workspace: "@zappy/admin-ui" }
];
const auxiliaryResolverDefinitions = [
  {
    key: "yt",
    provider: "yt",
    serviceName: "youtube-resolver",
    enabledEnv: "YT_RESOLVER_ENABLED",
    baseUrlEnv: "YT_RESOLVER_BASE_URL",
    tokenEnv: "YT_RESOLVER_TOKEN",
    defaultBaseUrl: "http://localhost:3401",
    workingDir: path.join(rootDir, "infra", "external-services", "youtube-resolver"),
    runScriptPath: path.join(rootDir, "infra", "external-services", "youtube-resolver", "scripts", "run.sh")
  },
  {
    key: "fb",
    provider: "fb",
    serviceName: "facebook-resolver",
    enabledEnv: "FB_RESOLVER_ENABLED",
    baseUrlEnv: "FB_RESOLVER_BASE_URL",
    tokenEnv: "FB_RESOLVER_TOKEN",
    defaultBaseUrl: "http://localhost:3402",
    workingDir: path.join(rootDir, "infra", "external-services", "facebook-resolver"),
    runScriptPath: path.join(rootDir, "infra", "external-services", "facebook-resolver", "scripts", "run.sh")
  }
];
const prefixedServiceNames = [...services.map((item) => item.name), ...auxiliaryResolverDefinitions.map((item) => item.serviceName)];
const prefixedServiceWidth = Math.max(...prefixedServiceNames.map((name) => name.length));

const ANSI = {
  reset: "\u001B[0m",
  colors: {
    cyan: "\u001B[36m",
    blue: "\u001B[34m",
    green: "\u001B[32m",
    yellow: "\u001B[33m",
    magenta: "\u001B[35m"
  }
};

const servicePrefixColor = (name) => {
  switch (name) {
    case "wa-gateway":
      return ANSI.colors.green;
    case "worker":
      return ANSI.colors.yellow;
    case "assistant-api":
      return ANSI.colors.blue;
    case "media-resolver-api":
      return ANSI.colors.cyan;
    case "admin-ui":
      return ANSI.colors.magenta;
    case "youtube-resolver":
    case "facebook-resolver":
      return ANSI.colors.yellow;
    default:
      return ANSI.colors.cyan;
  }
};

const parseColorEnv = (value) => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (/^\d+$/.test(normalized)) return Number(normalized) > 0;
  return undefined;
};

const parseToggleEnv = (value, defaultValue = false) => {
  const parsed = parseColorEnv(value);
  return parsed ?? defaultValue;
};

const parseBaseUrlSafe = (input) => {
  try {
    return new URL(input);
  } catch {
    return null;
  }
};

const isLoopbackHost = (rawHost) => {
  const normalized = (rawHost ?? "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
};

const resolveAuxiliaryTargets = (env) =>
  auxiliaryResolverDefinitions.map((definition) => {
    const enabled = parseToggleEnv(env[definition.enabledEnv], false);
    const baseUrl = env[definition.baseUrlEnv] || definition.defaultBaseUrl;
    const parsedBaseUrl = parseBaseUrlSafe(baseUrl);
    const token = (env[definition.tokenEnv] || "").trim() || undefined;
    return {
      ...definition,
      enabled,
      baseUrl,
      token,
      parsedBaseUrl,
      localBaseUrl: Boolean(parsedBaseUrl && isLoopbackHost(parsedBaseUrl.hostname))
    };
  });

const noColorRaw = process.env.NO_COLOR;
const noColor = parseColorEnv(noColorRaw);
const logColorize = parseColorEnv(process.env.LOG_COLORIZE);
const forceColor = parseColorEnv(process.env.FORCE_COLOR);
const colorizedPrefixes =
  (noColorRaw === undefined || noColor === false) && (logColorize ?? forceColor ?? process.stdout.isTTY);

const log = (msg) => console.log(`[start:${requestedMode}] ${msg}`);
const warn = (msg) => console.warn(`[start:${requestedMode}] ${msg}`);
const fail = (msg) => {
  console.error(`[start:${requestedMode}] ${msg}`);
  process.exit(1);
};

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readState = (targetFile) => {
  if (!fs.existsSync(targetFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetFile, "utf8"));
  } catch (err) {
    warn(`Could not read state file ${path.basename(targetFile)}: ${err.message}`);
    return null;
  }
};

const writeState = (data) => {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
};

const clearState = (targetFile = stateFile) => {
  if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
};

const detectComposeCmd = () => {
  const tryCmd = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  if (tryCmd("docker", ["info"])) {
    if (tryCmd("docker", ["compose", "version"])) return ["docker", "compose"];
  }
  if (tryCmd("docker-compose", ["version"])) return ["docker-compose"];
  return null;
};

const composeCmd = detectComposeCmd();
if (!composeCmd) {
  fail("Docker Compose is required. Install Docker Desktop/Engine with Compose v2.");
}

const runCompose = (args, options = {}) => {
  const allowFailure = options.allowFailure === true;
  const result = spawnSync(composeCmd[0], composeCmd.slice(1).concat(args), {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    fail(`Docker Compose failed (${args.join(" ")}): ${stderr}`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
};

const runNpm = (args, options = {}) => {
  const result = spawnSync("npm", args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    fail(`npm ${args.join(" ")} failed`);
  }
};

const probePort = (port, label, host = "127.0.0.1", timeoutMs = 1200) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });

const waitForPort = (port, label, host = "127.0.0.1", timeoutMs = 12_000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`${label} not reachable on ${host}:${port}`));
        } else {
          setTimeout(attempt, 350);
        }
      });
    };
    attempt();
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dependencyLog = (phase, fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[deps] phase=${phase}${suffix ? ` ${suffix}` : ""}`);
};

const resolverLog = (phase, fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[resolver] phase=${phase}${suffix ? ` ${suffix}` : ""}`);
};

const requestResolverHealth = async (input) => {
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/health`;
  const timeoutMs = Math.max(1200, Math.min(input.timeoutMs ?? 5000, 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {})
      }
    });

    const raw = await response.text().catch(() => "");
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = raw ? { raw: raw.slice(0, 180) } : {};
    }

    return {
      ok: response.ok,
      endpoint,
      httpStatus: response.status,
      payload,
      reason: response.ok ? "ok" : `http_${response.status}`
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      endpoint,
      payload: {},
      reason: timedOut ? "timeout" : "network_error",
      error
    };
  } finally {
    clearTimeout(timer);
  }
};

const runResolverHealthChecks = async (targets, phase, options = {}) => {
  if (skipResolverHealthcheck) {
    resolverLog(`${phase}-skip`, { reason: "flag_disabled" });
    return;
  }

  const onlyEnabled = options.onlyEnabled !== false;
  const candidates = targets.filter((item) => (onlyEnabled ? item.enabled : true));
  if (!candidates.length) {
    resolverLog(`${phase}-skip`, { reason: "no_candidates" });
    return;
  }

  for (const target of candidates) {
    const startedAt = Date.now();
    const result = await requestResolverHealth({
      baseUrl: target.baseUrl,
      token: target.token,
      timeoutMs: 6000
    });
    resolverLog(`${phase}-check`, {
      provider: target.provider,
      service: target.serviceName,
      enabled: target.enabled ? "yes" : "no",
      status: result.ok ? "ok" : "fail",
      endpoint: result.endpoint,
      reason: result.reason,
      latencyMs: Date.now() - startedAt
    });
    if (!result.ok) {
      warn(
        `[start:${requestedMode}][resolver] provider=${target.provider} service=${target.serviceName} health=fail endpoint=${result.endpoint} reason=${result.reason} (non-fatal)`
      );
    }
  }
};

const waitForResolverHealthy = async (target, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let latestResult = null;

  while (Date.now() <= deadline) {
    latestResult = await requestResolverHealth({
      baseUrl: target.baseUrl,
      token: target.token,
      timeoutMs: 3500
    });
    if (latestResult.ok) return latestResult;
    await delay(750);
  }

  return latestResult;
};

const inspectContainerState = (containerId) => {
  const result = spawnSync("docker", ["inspect", containerId, "--format", "{{json .State}}"], {
    cwd: rootDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return {
      status: "inspect_error",
      health: "unknown",
      hasHealthcheck: false,
      inspectError: result.stderr?.trim() || "inspect_failed"
    };
  }

  const raw = result.stdout?.trim();
  if (!raw) {
    return {
      status: "inspect_error",
      health: "unknown",
      hasHealthcheck: false,
      inspectError: "empty_inspect_payload"
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const status = typeof parsed?.Status === "string" ? parsed.Status : "unknown";
    const health = typeof parsed?.Health?.Status === "string" ? parsed.Health.Status : "none";
    const hasHealthcheck = parsed?.Health && typeof parsed.Health === "object";
    return { status, health, hasHealthcheck, inspectError: undefined };
  } catch (error) {
    return {
      status: "inspect_error",
      health: "unknown",
      hasHealthcheck: false,
      inspectError: error instanceof Error ? error.message : "inspect_parse_failed"
    };
  }
};

const getDependencySnapshot = async () => {
  const snapshots = [];

  for (const dependency of infraDependencies) {
    const psResult = runCompose(["-f", composeFile, "ps", "-q", dependency.service], { allowFailure: true });
    if (psResult.status !== 0) {
      snapshots.push({
        ...dependency,
        containerId: null,
        containerStatus: "missing",
        healthStatus: "unknown",
        hasHealthcheck: false,
        portReachable: false,
        ready: false,
        failedCheck: "compose_ps_failed",
        diagnostic: psResult.stderr || psResult.stdout || "compose_ps_failed"
      });
      continue;
    }

    const containerId = psResult.stdout.split(/\s+/).map((item) => item.trim()).filter(Boolean)[0] ?? null;
    if (!containerId) {
      snapshots.push({
        ...dependency,
        containerId: null,
        containerStatus: "missing",
        healthStatus: "missing",
        hasHealthcheck: false,
        portReachable: false,
        ready: false,
        failedCheck: "container_missing",
        diagnostic: "container not created"
      });
      continue;
    }

    const inspected = inspectContainerState(containerId);
    const running = inspected.status === "running";
    const portReachable = running ? await probePort(dependency.port, dependency.label, dependency.host) : false;
    const healthRequired = dependency.requireHealthyStatus && inspected.hasHealthcheck;
    const healthReady = !healthRequired || inspected.health === "healthy";
    const ready = running && healthReady && portReachable;

    let failedCheck = "none";
    if (!running) failedCheck = "container_not_running";
    else if (!healthReady) failedCheck = "health_not_healthy";
    else if (!portReachable) failedCheck = "port_unreachable";

    const diagnosticParts = [
      `container=${containerId.slice(0, 12)}`,
      `status=${inspected.status}`,
      `health=${inspected.health}`,
      `port=${dependency.host}:${dependency.port}`,
      `portReachable=${portReachable}`
    ];
    if (inspected.inspectError) diagnosticParts.push(`inspectError=${inspected.inspectError}`);

    snapshots.push({
      ...dependency,
      containerId,
      containerStatus: inspected.status,
      healthStatus: inspected.health,
      hasHealthcheck: inspected.hasHealthcheck,
      portReachable,
      ready,
      failedCheck,
      diagnostic: diagnosticParts.join(", ")
    });
  }

  return snapshots;
};

const logDependencySnapshot = (phase, snapshots) => {
  for (const item of snapshots) {
    dependencyLog(phase, {
      service: item.service,
      ready: item.ready ? "yes" : "no",
      containerStatus: item.containerStatus,
      health: item.healthStatus,
      port: `${item.host}:${item.port}`,
      failedCheck: item.failedCheck
    });
  }
};

const ensureInfra = async () => {
  dependencyLog("docker-check", { status: "start" });
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (info.status !== 0) fail("Docker daemon not reachable. Start Docker and retry.");
  dependencyLog("docker-check", { status: "ok" });

  dependencyLog("pre-validate", { services: requiredInfra.join(",") });
  let snapshots = await getDependencySnapshot();
  logDependencySnapshot("pre-validate", snapshots);
  let pending = snapshots.filter((item) => !item.ready);

  if (pending.length === 0) {
    dependencyLog("pre-validate", { status: "all_ready" });
    return;
  }

  const targetServices = pending.map((item) => item.service);
  dependencyLog("auto-start", { action: "compose_up", services: targetServices.join(",") });
  const upResult = runCompose(["-f", composeFile, "up", "-d", ...targetServices], { allowFailure: true });
  if (upResult.status !== 0) {
    for (const item of pending) {
      warn(
        `[start:${requestedMode}][deps] service=${item.service} action=compose_up status=failed reason=${item.failedCheck} diagnostic="${item.diagnostic}"`
      );
    }
    fail(`Dependency auto-start failed: ${upResult.stderr || upResult.stdout || "unknown compose error"}`);
  }

  const deadline = Date.now() + dependencyValidationTimeoutMs;
  while (Date.now() <= deadline) {
    await delay(dependencyValidationIntervalMs);
    snapshots = await getDependencySnapshot();
    pending = snapshots.filter((item) => !item.ready);
    if (pending.length === 0) {
      dependencyLog("post-validate", { status: "all_ready", waitedMs: dependencyValidationTimeoutMs - (deadline - Date.now()) });
      return;
    }
  }

  logDependencySnapshot("post-validate", snapshots);
  for (const item of pending) {
    warn(
      `[start:${requestedMode}][deps] service=${item.service} action=compose_up status=failed finalCheck=${item.failedCheck} diagnostic="${item.diagnostic}"`
    );
  }
  fail(`Dependency validation failed after ${dependencyValidationTimeoutMs}ms.`);
};

const toLocalTime = (timezone) => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }).format(new Date());
  } catch {
    return new Date().toLocaleTimeString();
  }
};

const printDevBanner = () => {
  const timezone = process.env.BOT_TIMEZONE || "America/Cuiaba";
  const llmModel = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const llmEnabled = (process.env.LLM_ENABLED ?? "true").toString() !== "false";
  const waSessionPath = process.env.WA_SESSION_PATH || ".wa_auth";

  const rendered = cfonts.render("Zappy Assistant ©", {
    font: "slick",
    align: "left",
    colors: ["cyan", "magenta"],
    letterSpacing: 1,
    lineHeight: 1,
    gradient: ["#00d7ff", "#b14cff"],
    env: "node"
  });
  console.log(rendered.string);

  const rows = [
    ["Mode", "dev"],
    ["Environment", "development"],
    ["Timezone", `${timezone} (${toLocalTime(timezone)})`],
    ["LLM/model", llmEnabled ? llmModel : `disabled (${llmModel})`],
    ["WA session path", path.resolve(rootDir, waSessionPath)]
  ];

  const pad = Math.max(...rows.map(([k]) => k.length));
  rows.forEach(([k, v]) => console.log(`${k.padEnd(pad)} : ${v}`));
  console.log("");
};

const printProdBanner = (runtimeEnv, options = {}) => {
  const buildStatus = options.buildExecuted ? "executed" : "skipped";
  const timezone = process.env.BOT_TIMEZONE || "America/Cuiaba";
  const llmModel = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const llmEnabled = (process.env.LLM_ENABLED ?? "true").toString() !== "false";
  const waSessionPath = process.env.WA_SESSION_PATH || ".wa_auth";
  console.log("==============================================");
  console.log("Zappy Assistant Runtime");
  console.log("mode=prod environment=production");
  console.log(`timezone=${timezone} localTime=${toLocalTime(timezone)}`);
  console.log(`llm=${llmEnabled ? "enabled" : "disabled"} model=${llmModel}`);
  console.log(
    `logs format=${runtimeEnv.LOG_FORMAT ?? "pretty"} level=${runtimeEnv.LOG_LEVEL ?? "info"} prettyMode=${
      runtimeEnv.LOG_PRETTY_MODE ?? "prod"
    } colorize=${runtimeEnv.LOG_COLORIZE ?? "true"} verboseFields=${runtimeEnv.LOG_VERBOSE_FIELDS ?? "false"}`
  );
  console.log(`build=${buildStatus}`);
  console.log(`waSessionPath=${path.resolve(rootDir, waSessionPath)}`);
  console.log("==============================================");
};

const printDebugBanner = (runtimeEnv) => {
  const timezone = process.env.BOT_TIMEZONE || "America/Cuiaba";
  const llmModel = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const llmEnabled = (process.env.LLM_ENABLED ?? "true").toString() !== "false";
  const waSessionPath = process.env.WA_SESSION_PATH || ".wa_auth";
  console.log("==============================================");
  console.log("Zappy Assistant Runtime");
  console.log("mode=debug environment=production");
  console.log(`timezone=${timezone} localTime=${toLocalTime(timezone)}`);
  console.log(`llm=${llmEnabled ? "enabled" : "disabled"} model=${llmModel}`);
  console.log(
    `logs format=${runtimeEnv.LOG_FORMAT ?? "json"} level=${runtimeEnv.LOG_LEVEL ?? "debug"} verboseFields=${
      runtimeEnv.LOG_VERBOSE_FIELDS ?? "true"
    } debug=${runtimeEnv.DEBUG ?? "trace"}`
  );
  console.log(`waSessionPath=${path.resolve(rootDir, waSessionPath)}`);
  console.log("==============================================");
};

const applyDefaultEnv = (env, key, value) => {
  if (env[key] === undefined || env[key] === "") env[key] = value;
};

const buildRuntimeEnv = () => {
  const env = {
    ...process.env,
    ZAPPY_RUNTIME_MODE: requestedMode,
    NODE_ENV: modeProfile.nodeEnv,
    ZAPPY_SKIP_SERVICE_BANNER: "1"
  };
  for (const [key, value] of Object.entries(modeProfile.logDefaults)) {
    applyDefaultEnv(env, key, value);
  }
  return env;
};

const isStateAlive = (state) =>
  Boolean(state) && (pidAlive(state.supervisorPid) || (state.services || []).some((svc) => svc.pid && pidAlive(svc.pid)));

const ensurePorts = async () => {
  dependencyLog("port-check", { status: "start" });
  await Promise.all(infraDependencies.map((dependency) => waitForPort(dependency.port, dependency.label, dependency.host)));
  dependencyLog("port-check", { status: "ok" });
};

const prefixWriter = (name, stream, isErr) => {
  const rawPrefix = `[${name.padEnd(prefixedServiceWidth)}]`;
  const prefix = colorizedPrefixes ? `${servicePrefixColor(name)}${rawPrefix}${ANSI.reset}` : rawPrefix;
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    const output = `${prefix} ${line}`;
    isErr ? console.error(output) : console.log(output);
  });
};

const childProcs = [];
let shuttingDown = false;

const cleanup = async (reason = "shutdown", exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Stopping ${requestedMode} services (${reason})...`);

  for (const child of childProcs) {
    if (!pidAlive(child.pid)) continue;
    try {
      process.kill(child.pid, "SIGINT");
    } catch {
      /* ignore */
    }
  }

  await Promise.all(
    childProcs.map(
      (child) =>
        new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (pidAlive(child.pid)) {
              try {
                process.kill(child.pid, "SIGTERM");
              } catch {
                /* ignore */
              }
            }
            resolve(true);
          }, 4000);
          child.proc.on("exit", () => {
            clearTimeout(timeout);
            resolve(true);
          });
        })
    )
  );

  clearState();
  process.exit(exitCode);
};

const assertNoRunningStack = () => {
  for (const mode of Object.keys(modeStateFiles)) {
    const targetFile = modeStateFiles[mode];
    const state = readState(targetFile);
    if (!state) continue;
    const alive = isStateAlive(state);
    if (!alive) {
      clearState(targetFile);
      continue;
    }
    if (mode === requestedMode) {
      fail(`${requestedMode} stack already running (see ${path.relative(rootDir, targetFile)}). Run npm run stop:${requestedMode} first.`);
    }
    fail(`another stack mode is running (${path.basename(targetFile)}). Stop it before starting mode=${requestedMode}.`);
  }
};

const shouldStartAuxiliaryResolver = (target) => {
  if (target.key === "yt" && withYoutubeResolver) return true;
  if (target.key === "fb" && withFacebookResolver) return true;
  if (withExternalServices && target.enabled) return true;
  return false;
};

const startAuxiliaryResolvers = async (env) => {
  const targets = resolveAuxiliaryTargets(env);
  const selected = targets.filter((target) => shouldStartAuxiliaryResolver(target));

  if (!selected.length) {
    resolverLog("autostart-skip", { reason: "no_selected_services" });
    return targets;
  }

  resolverLog("autostart-start", {
    selected: selected.map((target) => target.serviceName).join(","),
    requestedByFlags: [withExternalServices ? "all" : null, withYoutubeResolver ? "yt" : null, withFacebookResolver ? "fb" : null]
      .filter(Boolean)
      .join(",")
  });

  for (const target of selected) {
    if (!fs.existsSync(target.workingDir)) {
      warn(
        `[start:${requestedMode}][resolver] provider=${target.provider} service=${target.serviceName} workingDir missing (${path.relative(
          rootDir,
          target.workingDir
        )}). Skipping autostart.`
      );
      continue;
    }

    if (!target.localBaseUrl) {
      warn(
        `[start:${requestedMode}][resolver] provider=${target.provider} service=${target.serviceName} baseUrl=${target.baseUrl} is not local. Skipping autostart.`
      );
      continue;
    }

    if (!fs.existsSync(target.runScriptPath)) {
      warn(
        `[start:${requestedMode}][resolver] provider=${target.provider} service=${target.serviceName} run script missing (${path.relative(
          rootDir,
          target.runScriptPath
        )}). Skipping autostart.`
      );
      continue;
    }

    const child = spawn("bash", [target.runScriptPath], {
      cwd: target.workingDir,
      env: {
        ...env,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    childProcs.push({
      name: target.serviceName,
      workspace: path.relative(rootDir, target.workingDir),
      pid: child.pid,
      proc: child,
      script: "external",
      kind: "auxiliary",
      critical: false
    });
    prefixWriter(target.serviceName, child.stdout, false);
    prefixWriter(target.serviceName, child.stderr, true);

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      warn(
        `${target.serviceName} exited (${signal ?? code}). Continuing without this auxiliary service (non-fatal).`
      );
    });
    child.on("error", (error) => {
      if (shuttingDown) return;
      warn(`${target.serviceName} process error (${error.message}). Continuing without this auxiliary service (non-fatal).`);
    });

    const health = await waitForResolverHealthy(target);
    if (!health?.ok) {
      warn(
        `[start:${requestedMode}][resolver] provider=${target.provider} service=${target.serviceName} failed to become healthy at ${target.baseUrl} (reason=${health?.reason ?? "unknown"})`
      );
      continue;
    }

    resolverLog("autostart-ready", {
      provider: target.provider,
      service: target.serviceName,
      endpoint: health.endpoint
    });
  }

  return targets;
};

const startServices = (env) => {
  services.forEach((svc) => {
    const child = spawn("npm", ["run", serviceScript, "-w", svc.workspace], {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    childProcs.push({
      name: svc.name,
      workspace: svc.workspace,
      pid: child.pid,
      proc: child,
      script: serviceScript,
      kind: "workspace",
      critical: true
    });
    prefixWriter(svc.name, child.stdout, false);
    prefixWriter(svc.name, child.stderr, true);

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      warn(`${svc.name} exited (${signal ?? code}). Stopping remaining services.`);
      cleanup(`${svc.name} exited`, typeof code === "number" && code !== 0 ? code : 1);
    });
  });

  writeState({
    mode: requestedMode,
    supervisorPid: process.pid,
    startedAt: new Date().toISOString(),
    services: childProcs.map(({ name, pid, workspace, script, kind }) => ({ name, pid, workspace, script, kind })),
    infra: { compose: composeCmd.join(" "), composeFile, requiredInfra }
  });

  log(`mode=${requestedMode}`);
  log(`${requestedMode} services started. Tracking state at ${path.relative(rootDir, stateFile)}.`);
  log(`To stop services, run: npm run stop:${requestedMode}`);
};

const main = async () => {
  const runtimeEnv = buildRuntimeEnv();
  assertNoRunningStack();
  await ensureInfra();
  await ensurePorts().catch((err) => fail(err.message));
  const auxiliaryTargets = await startAuxiliaryResolvers(runtimeEnv);
  await runResolverHealthChecks(auxiliaryTargets, "pre-app-start", { onlyEnabled: true });

  if (isDev) {
    printDevBanner();
  } else if (requestedMode === "prod") {
    if (prodBuildRequested) {
      log("Preparing production build (--build enabled)...");
      runNpm(["run", "build"], { env: runtimeEnv });
    } else {
      log("Skipping build (use --build to force compile before startup).");
    }
    printProdBanner(runtimeEnv, { buildExecuted: prodBuildRequested });
  } else {
    log("Preparing debug build...");
    runNpm(["run", "build"], { env: runtimeEnv });
    printDebugBanner(runtimeEnv);
  }

  startServices(runtimeEnv);
  void runResolverHealthChecks(auxiliaryTargets, "post-app-start", { onlyEnabled: true });
};

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));

main().catch((err) => fail(err.message));
