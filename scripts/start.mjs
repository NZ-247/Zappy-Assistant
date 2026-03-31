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

const INFRA_MODES = new Set(["auto", "external", "managed"]);
const VALID_MODES = new Set(Object.keys(MODE_PROFILES));

const printHelp = () => {
  console.log(`Usage: node scripts/start.mjs <mode> [options]

Modes:
  dev | prod | debug

Options:
  --infra=<auto|external|managed>  Infra strategy mode (default: auto)
  --infra                           Alias for --infra=auto
  --build                           Build before boot (prod only; debug always builds)
  --with-external-services          Start enabled auxiliary resolvers (YT/FB)
  --with-yt-resolver                Start only YouTube auxiliary resolver
  --with-fb-resolver                Start only Facebook auxiliary resolver
  --skip-resolver-healthcheck       Skip resolver /health checks
  --help                            Show this help

Infra mode semantics:
  auto:     use existing usable dependency first; compose-up only if missing/unusable.
  external: never compose-up redis/postgres; validate configured endpoints only.
  managed:  require compose-managed redis/postgres and start them when needed.`);
};

const requestedMode = (process.argv[2] ?? "dev").toLowerCase();
if (!VALID_MODES.has(requestedMode)) {
  console.error(`[start] invalid mode "${requestedMode}". Use: dev | prod | debug`);
  process.exit(1);
}

const modeArgs = process.argv.slice(3);
if (modeArgs.includes("--help")) {
  printHelp();
  process.exit(0);
}

const validBooleanFlags = new Set([
  "--build",
  "--with-external-services",
  "--with-yt-resolver",
  "--with-fb-resolver",
  "--skip-resolver-healthcheck",
  "--infra"
]);

let infraMode = "auto";
const seenInfraModes = [];
const unknownFlags = [];
for (const arg of modeArgs) {
  if (arg.startsWith("--infra=")) {
    const rawMode = arg.slice("--infra=".length).trim().toLowerCase();
    if (!INFRA_MODES.has(rawMode)) {
      console.error(`[start:${requestedMode}] invalid infra mode "${rawMode}". Use: auto | external | managed`);
      process.exit(1);
    }
    seenInfraModes.push(rawMode);
    continue;
  }

  if (validBooleanFlags.has(arg)) {
    if (arg === "--infra") seenInfraModes.push("auto");
    continue;
  }

  if (arg.startsWith("--")) unknownFlags.push(arg);
}

if (unknownFlags.length > 0) {
  console.error(
    `[start:${requestedMode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --infra=<auto|external|managed> --infra --build --with-external-services --with-yt-resolver --with-fb-resolver --skip-resolver-healthcheck --help`
  );
  process.exit(1);
}

if (seenInfraModes.length > 1) {
  const unique = Array.from(new Set(seenInfraModes));
  if (unique.length > 1) {
    console.error(`[start:${requestedMode}] conflicting infra flags: ${unique.join(", ")}. Pick only one infra mode.`);
    process.exit(1);
  }
}
if (seenInfraModes.length > 0) {
  infraMode = seenInfraModes[seenInfraModes.length - 1];
}

const prodBuildRequested = modeArgs.includes("--build");
const withExternalServices = modeArgs.includes("--with-external-services");
const withYoutubeResolver = modeArgs.includes("--with-yt-resolver");
const withFacebookResolver = modeArgs.includes("--with-fb-resolver");
const skipResolverHealthcheck = modeArgs.includes("--skip-resolver-healthcheck");
const scriptSmokeMode = process.env.ZAPPY_SCRIPT_SMOKE_MODE === "1";

const modeProfile = MODE_PROFILES[requestedMode];
const serviceScript = modeProfile.serviceScript;
const isDev = requestedMode === "dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.ZAPPY_PROJECT_ROOT
  ? path.resolve(process.env.ZAPPY_PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const composeFile = path.join(rootDir, "infra", "docker-compose.yml");
const stateDir = path.join(rootDir, ".zappy-dev");
const stateFile = path.join(stateDir, `${requestedMode}-stack.json`);
const modeStateFiles = Object.fromEntries(Array.from(VALID_MODES).map((mode) => [mode, path.join(stateDir, `${mode}-stack.json`)]));

dotenv.config({ path: path.join(rootDir, ".env") });

if (!scriptSmokeMode && !fs.existsSync(composeFile)) {
  console.error(`[start:${requestedMode}] Compose file missing at ${composeFile}`);
  process.exit(1);
}

const dependencyValidationTimeoutMs = 45_000;
const dependencyValidationIntervalMs = 1_250;

const dependencyDefinitions = [
  {
    key: "postgres",
    service: "postgres",
    kind: "postgres",
    label: "PostgreSQL",
    envVar: "DATABASE_URL",
    defaultUrl: "postgresql://postgres:postgres@localhost:5432/zappy_assistant?schema=public",
    supportedSchemes: new Set(["postgres", "postgresql"]),
    defaultPort: 5432
  },
  {
    key: "redis",
    service: "redis",
    kind: "redis",
    label: "Redis",
    envVar: "REDIS_URL",
    defaultUrl: "redis://localhost:6379",
    supportedSchemes: new Set(["redis", "rediss"]),
    defaultPort: 6379
  }
];

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
    runScriptPath: path.join(rootDir, "infra", "external-services", "youtube-resolver", "scripts", "run.sh"),
    stopScriptPath: path.join(rootDir, "infra", "external-services", "youtube-resolver", "scripts", "stop.sh")
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
    runScriptPath: path.join(rootDir, "infra", "external-services", "facebook-resolver", "scripts", "run.sh"),
    stopScriptPath: path.join(rootDir, "infra", "external-services", "facebook-resolver", "scripts", "stop.sh")
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

const stripWrappingQuotes = (value) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const isLoopbackHost = (rawHost) => {
  const normalized = (rawHost ?? "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
};

const parseConnectionTarget = (definition, env) => {
  const raw = stripWrappingQuotes((env[definition.envVar] || definition.defaultUrl || "").trim());
  if (!raw) {
    fail(`[deps] ${definition.envVar} is empty; set a valid ${definition.kind} URL.`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`[deps] ${definition.envVar} is invalid: ${raw}`);
  }

  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!definition.supportedSchemes.has(protocol)) {
    fail(
      `[deps] ${definition.envVar} uses unsupported scheme "${protocol}". Supported: ${Array.from(definition.supportedSchemes).join(", ")}`
    );
  }

  const host = (parsed.hostname || "").trim();
  if (!host) {
    fail(`[deps] ${definition.envVar} must include a hostname.`);
  }

  const port = parsed.port ? Number(parsed.port) : definition.defaultPort;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`[deps] ${definition.envVar} has invalid port "${parsed.port || ""}".`);
  }

  return {
    ...definition,
    connectionUrl: raw,
    host,
    port,
    endpoint: `${host}:${port}`,
    loopback: isLoopbackHost(host)
  };
};

const resolveDependencyTargets = (env) => dependencyDefinitions.map((definition) => parseConnectionTarget(definition, env));

const resolveAuxiliaryTargets = (env) =>
  auxiliaryResolverDefinitions.map((definition) => {
    const enabled = parseToggleEnv(env[definition.enabledEnv], false);
    const baseUrl = stripWrappingQuotes((env[definition.baseUrlEnv] || definition.defaultBaseUrl || "").trim());
    const token = stripWrappingQuotes((env[definition.tokenEnv] || "").trim()) || undefined;
    return {
      ...definition,
      enabled,
      baseUrl,
      token
    };
  });

const noColorRaw = process.env.NO_COLOR;
const noColor = parseColorEnv(noColorRaw);
const logColorize = parseColorEnv(process.env.LOG_COLORIZE);
const forceColor = parseColorEnv(process.env.FORCE_COLOR);
const colorizedPrefixes =
  (noColorRaw === undefined || noColor === false) && (logColorize ?? forceColor ?? process.stdout.isTTY);

const normalizeDiagnostic = (value) => String(value || "").replace(/\s+/g, " ").trim();

const classifyDiagnosticCategory = (value) => {
  const text = normalizeDiagnostic(value).toLowerCase();
  if (!text) return "unknown";
  if (text.includes("eaddrinuse") || text.includes("address already in use")) return "port_conflict";
  if (
    text.includes("does not provide an export named") ||
    text.includes("err_package_path_not_exported") ||
    text.includes("cannot find module") ||
    text.includes("err_module_not_found") ||
    text.includes("named export")
  ) {
    return "package_export_error";
  }
  if (text.includes("[resolver]") || text.includes("health_fail_after_delegate") || text.includes("run_delegate_failed")) {
    return "external_resolver";
  }
  return "startup_validation_issue";
};

const log = (msg) => console.log(`[start:${requestedMode}] ${msg}`);
const warn = (msg) => console.warn(`[start:${requestedMode}] ${msg}`);
const fail = (msg) => {
  const category = classifyDiagnosticCategory(msg);
  console.error(`[start:${requestedMode}] [startup-diagnostics] category=${category} message="${normalizeDiagnostic(msg)}"`);
  console.error(`[start:${requestedMode}] ${msg}`);
  process.exit(1);
};

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

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    env: options.env,
    stdio: options.stdio ?? "pipe"
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
};

let composeCmdCache;
const detectComposeCmd = () => {
  const dockerComposeResult = runCommand("docker", ["compose", "version"], { stdio: "ignore" });
  if (dockerComposeResult.status === 0) return ["docker", "compose"];

  const dockerComposeV1Result = runCommand("docker-compose", ["version"], { stdio: "ignore" });
  if (dockerComposeV1Result.status === 0) return ["docker-compose"];

  return null;
};

const getComposeCmd = () => {
  if (composeCmdCache !== undefined) return composeCmdCache;
  composeCmdCache = detectComposeCmd();
  return composeCmdCache;
};

let dockerAvailabilityCache;
const getDockerAvailability = () => {
  if (dockerAvailabilityCache !== undefined) return dockerAvailabilityCache;
  const dockerCli = runCommand("docker", ["version"], { stdio: "ignore" }).status === 0;
  const daemon = dockerCli && runCommand("docker", ["info"], { stdio: "ignore" }).status === 0;
  dockerAvailabilityCache = { dockerCli, daemon };
  return dockerAvailabilityCache;
};

const ensureComposeReady = () => {
  const composeCmd = getComposeCmd();
  if (!composeCmd) {
    fail("Docker Compose is required for managed infra actions. Install Compose or use --infra=external.");
  }
  const dockerAvailability = getDockerAvailability();
  if (!dockerAvailability.daemon) {
    fail("Docker daemon not reachable for managed infra actions. Start Docker or use --infra=external.");
  }
  return composeCmd;
};

const runCompose = (args, options = {}) => {
  const composeCmd = getComposeCmd();
  if (!composeCmd) {
    return {
      status: 1,
      stdout: "",
      stderr: "compose_not_available"
    };
  }

  return runCommand(composeCmd[0], composeCmd.slice(1).concat(args), {
    cwd: rootDir,
    stdio: options.stdio ?? "pipe"
  });
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, timeoutMs, timeoutLabel) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const probeTcpPort = (host, port, timeoutMs = 1400) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (open, reason) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true, "connected"));
    socket.on("timeout", () => done(false, "timeout"));
    socket.on("error", (err) => done(false, err.code || "connect_error"));
  });

let redisCtorPromise;
const loadRedisCtor = async () => {
  if (!redisCtorPromise) {
    redisCtorPromise = import("ioredis")
      .then((mod) => mod.default ?? mod.Redis ?? mod)
      .catch((error) => {
        throw new Error(`ioredis import failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
  return redisCtorPromise;
};

const checkRedisPing = async (connectionUrl, timeoutMs = 3200) => {
  let client;
  try {
    const RedisCtor = await loadRedisCtor();
    client = new RedisCtor(connectionUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: timeoutMs,
      enableReadyCheck: true
    });

    await withTimeout(client.connect(), timeoutMs, "connect_timeout");
    const pong = await withTimeout(client.ping(), timeoutMs, "ping_timeout");
    return {
      ok: typeof pong === "string" && pong.toUpperCase() === "PONG",
      reason: typeof pong === "string" ? `ping_${pong.toLowerCase()}` : "ping_unexpected"
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "redis_ping_failed"
    };
  } finally {
    if (!client) return;
    try {
      await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
};

let psqlAvailableCache;
const isPsqlAvailable = () => {
  if (psqlAvailableCache !== undefined) return psqlAvailableCache;
  psqlAvailableCache = runCommand("psql", ["--version"], { stdio: "ignore" }).status === 0;
  return psqlAvailableCache;
};

let prismaClientCtorPromise;
const loadPrismaClientCtor = async () => {
  if (!prismaClientCtorPromise) {
    prismaClientCtorPromise = import("@prisma/client")
      .then((mod) => mod.PrismaClient ?? mod.default?.PrismaClient)
      .then((ctor) => {
        if (!ctor) throw new Error("PrismaClient export not found");
        return ctor;
      })
      .catch((error) => {
        throw new Error(
          `@prisma/client import failed (${error instanceof Error ? error.message : String(error)}). Run npm run prisma:generate if needed.`
        );
      });
  }
  return prismaClientCtorPromise;
};

const checkPostgresViaPsql = async (connectionUrl, timeoutMs = 4000) => {
  const connectTimeout = Math.max(1, Math.floor(timeoutMs / 1000));
  const result = runCommand("psql", ["-w", "-Atqc", "SELECT 1", connectionUrl], {
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: String(connectTimeout)
    }
  });

  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr || result.stdout || "psql_check_failed"
    };
  }

  const ok = result.stdout.split(/\r?\n/).map((line) => line.trim()).includes("1");
  return {
    ok,
    reason: ok ? "select_1_ok" : "select_1_unexpected_output"
  };
};

const checkPostgresViaPrisma = async (connectionUrl, timeoutMs = 5000) => {
  let client;
  try {
    const PrismaClient = await loadPrismaClientCtor();
    client = new PrismaClient({
      datasources: {
        db: {
          url: connectionUrl
        }
      }
    });

    await withTimeout(client.$queryRawUnsafe("SELECT 1"), timeoutMs, "query_timeout");
    return {
      ok: true,
      reason: "select_1_ok"
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "postgres_check_failed"
    };
  } finally {
    if (client) {
      try {
        await client.$disconnect();
      } catch {
        /* ignore */
      }
    }
  }
};

const checkPostgresConnection = async (connectionUrl, timeoutMs = 5000) => {
  if (isPsqlAvailable()) {
    return checkPostgresViaPsql(connectionUrl, timeoutMs);
  }
  return checkPostgresViaPrisma(connectionUrl, timeoutMs);
};

const shortContainerId = (containerId) => {
  if (!containerId) return null;
  return containerId.slice(0, 12);
};

const getComposeServiceState = (serviceName) => {
  const composeCmd = getComposeCmd();
  if (!composeCmd) {
    return {
      available: false,
      exists: false,
      running: false,
      containerId: null,
      containerName: null,
      status: "compose_unavailable",
      health: "unknown",
      composeProject: null,
      error: "compose_unavailable"
    };
  }

  const psResult = runCompose(["-f", composeFile, "ps", "-q", serviceName]);
  if (psResult.status !== 0) {
    return {
      available: true,
      exists: false,
      running: false,
      containerId: null,
      containerName: null,
      status: "compose_ps_failed",
      health: "unknown",
      composeProject: null,
      error: psResult.stderr || psResult.stdout || "compose_ps_failed"
    };
  }

  const containerId = psResult.stdout
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)[0];

  if (!containerId) {
    return {
      available: true,
      exists: false,
      running: false,
      containerId: null,
      containerName: null,
      status: "missing",
      health: "missing",
      composeProject: null,
      error: null
    };
  }

  const inspectResult = runCommand("docker", ["inspect", containerId]);
  if (inspectResult.status !== 0) {
    return {
      available: true,
      exists: true,
      running: false,
      containerId,
      containerName: null,
      status: "inspect_failed",
      health: "unknown",
      composeProject: null,
      error: inspectResult.stderr || inspectResult.stdout || "inspect_failed"
    };
  }

  try {
    const parsed = JSON.parse(inspectResult.stdout);
    const inspected = parsed[0] ?? {};
    const state = inspected.State ?? {};
    const labels = inspected.Config?.Labels ?? {};

    return {
      available: true,
      exists: true,
      running: state.Status === "running",
      containerId,
      containerName: inspected.Name ? String(inspected.Name).replace(/^\//, "") : null,
      status: state.Status || "unknown",
      health: state.Health?.Status || "none",
      composeProject: labels["com.docker.compose.project"] || null,
      error: null
    };
  } catch (error) {
    return {
      available: true,
      exists: true,
      running: false,
      containerId,
      containerName: null,
      status: "inspect_parse_failed",
      health: "unknown",
      composeProject: null,
      error: error instanceof Error ? error.message : "inspect_parse_failed"
    };
  }
};

const getPortOwnerContainer = (port) => {
  const dockerAvailability = getDockerAvailability();
  if (!dockerAvailability.daemon) return null;

  const psResult = runCommand("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}\t{{.Names}}"]);
  if (psResult.status !== 0 || !psResult.stdout) return null;

  const [firstLine] = psResult.stdout.split(/\r?\n/).filter(Boolean);
  if (!firstLine) return null;

  const [containerId, containerName] = firstLine.split("\t");
  if (!containerId) return null;

  const inspectResult = runCommand("docker", ["inspect", containerId]);
  if (inspectResult.status !== 0) {
    return {
      containerId,
      containerName: containerName || null,
      composeProject: null,
      inspectError: inspectResult.stderr || inspectResult.stdout || "inspect_failed"
    };
  }

  try {
    const parsed = JSON.parse(inspectResult.stdout);
    const inspected = parsed[0] ?? {};
    const labels = inspected.Config?.Labels ?? {};
    return {
      containerId,
      containerName: containerName || inspected.Name?.replace(/^\//, "") || null,
      composeProject: labels["com.docker.compose.project"] || null,
      inspectError: null
    };
  } catch (error) {
    return {
      containerId,
      containerName: containerName || null,
      composeProject: null,
      inspectError: error instanceof Error ? error.message : "inspect_parse_failed"
    };
  }
};

const containerIdsMatch = (left, right) => {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
};

const classifyDependencySource = ({ dependency, tcpOpen, serviceOk, composeState, portOwner }) => {
  const loopback = dependency.loopback;
  const composeCandidate = loopback && dependency.port === dependency.defaultPort;

  const composeOwnsPort = Boolean(
    composeCandidate &&
      composeState.exists &&
      composeState.containerId &&
      portOwner &&
      containerIdsMatch(composeState.containerId, portOwner.containerId)
  );

  if (composeOwnsPort) return "compose_managed";

  if (tcpOpen && serviceOk) {
    if (loopback && portOwner) return "external_container";
    return "external_host";
  }

  if (loopback && portOwner) return "external_container";
  if (composeCandidate && composeState.exists) return "compose_managed";
  if (!loopback && (tcpOpen || serviceOk)) return "external_host";
  return "unavailable";
};

const discoverDependency = async (dependency, phase = "discover") => {
  dependencyLog(`${phase}-start`, {
    service: dependency.service,
    endpoint: dependency.endpoint,
    mode: infraMode
  });

  const composeState = getComposeServiceState(dependency.service);
  const tcpProbe = await probeTcpPort(dependency.host, dependency.port);

  let serviceCheck = {
    ok: false,
    reason: tcpProbe.open ? "not_checked" : `tcp_${tcpProbe.reason}`
  };

  if (tcpProbe.open) {
    if (dependency.kind === "redis") {
      serviceCheck = await checkRedisPing(dependency.connectionUrl);
    } else {
      serviceCheck = await checkPostgresConnection(dependency.connectionUrl);
    }
  }

  const portOwner = dependency.loopback ? getPortOwnerContainer(dependency.port) : null;
  const source = classifyDependencySource({
    dependency,
    tcpOpen: tcpProbe.open,
    serviceOk: serviceCheck.ok,
    composeState,
    portOwner
  });

  const usable = tcpProbe.open && serviceCheck.ok;

  dependencyLog(`${phase}-result`, {
    service: dependency.service,
    source,
    tcpOpen: tcpProbe.open ? "yes" : "no",
    serviceOk: serviceCheck.ok ? "yes" : "no",
    usable: usable ? "yes" : "no",
    composeStatus: composeState.status,
    composeHealth: composeState.health,
    owner: portOwner?.containerName || "none",
    check: serviceCheck.reason
  });

  return {
    ...dependency,
    source,
    usable,
    tcpOpen: tcpProbe.open,
    tcpReason: tcpProbe.reason,
    serviceCheckOk: serviceCheck.ok,
    serviceCheckReason: serviceCheck.reason,
    compose: composeState,
    portOwner
  };
};

const waitForDependency = async (dependency, phase, matcher, timeoutMs = dependencyValidationTimeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() <= deadline) {
    latest = await discoverDependency(dependency, phase);
    if (matcher(latest)) {
      return { ok: true, snapshot: latest };
    }
    await delay(dependencyValidationIntervalMs);
  }

  return { ok: false, snapshot: latest };
};

const composeUpDependency = (serviceName) => {
  ensureComposeReady();

  dependencyLog("compose-up-attempt", {
    service: serviceName,
    action: "compose_up"
  });

  const result = runCompose(["-f", composeFile, "up", "-d", serviceName]);
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || "compose_up_failed"
    };
  }

  dependencyLog("compose-up-result", {
    service: serviceName,
    status: "ok"
  });

  return {
    ok: true
  };
};

const sanitizeDependencyForState = (snapshot, action) => ({
  service: snapshot.service,
  label: snapshot.label,
  envVar: snapshot.envVar,
  endpoint: snapshot.endpoint,
  source: snapshot.source,
  usable: snapshot.usable,
  tcpOpen: snapshot.tcpOpen,
  tcpReason: snapshot.tcpReason,
  serviceCheckOk: snapshot.serviceCheckOk,
  serviceCheckReason: snapshot.serviceCheckReason,
  action,
  compose: {
    available: snapshot.compose.available,
    exists: snapshot.compose.exists,
    running: snapshot.compose.running,
    status: snapshot.compose.status,
    health: snapshot.compose.health,
    containerId: shortContainerId(snapshot.compose.containerId),
    containerName: snapshot.compose.containerName,
    project: snapshot.compose.composeProject,
    error: snapshot.compose.error || null
  },
  portOwner: snapshot.portOwner
    ? {
        containerId: shortContainerId(snapshot.portOwner.containerId),
        containerName: snapshot.portOwner.containerName,
        project: snapshot.portOwner.composeProject || null,
        inspectError: snapshot.portOwner.inspectError || null
      }
    : null
});

const ensureInfra = async (dependencies) => {
  dependencyLog("strategy", {
    mode: infraMode,
    services: dependencies.map((item) => item.service).join(",")
  });

  const managedServicesStarted = new Set();
  const finalized = [];

  for (const dependency of dependencies) {
    let snapshot = await discoverDependency(dependency, "initial");

    if (infraMode === "external") {
      if (!snapshot.usable) {
        fail(
          `[deps] infra=external validation failed for ${dependency.service} (${dependency.endpoint}). source=${snapshot.source} tcpOpen=${
            snapshot.tcpOpen ? "yes" : "no"
          } serviceOk=${snapshot.serviceCheckOk ? "yes" : "no"} check=${snapshot.serviceCheckReason}`
        );
      }

      finalized.push(sanitizeDependencyForState(snapshot, "validated_external"));
      continue;
    }

    if (infraMode === "auto") {
      if (snapshot.usable) {
        if (snapshot.source === "compose_managed") {
          dependencyLog("auto-decision", {
            service: dependency.service,
            decision: "reuse_compose_managed",
            reason: "usable_dependency_detected"
          });
        } else {
          dependencyLog("auto-decision", {
            service: dependency.service,
            decision: "skip_compose",
            reason: "usable_external_dependency_detected",
            source: snapshot.source
          });
        }

        finalized.push(sanitizeDependencyForState(snapshot, "reuse_existing"));
        continue;
      }

      dependencyLog("auto-decision", {
        service: dependency.service,
        decision: "compose_up",
        reason: "no_usable_dependency"
      });

      const beforeStartManaged = snapshot.compose.exists && snapshot.compose.running;
      const upResult = composeUpDependency(dependency.service);
      if (!upResult.ok) {
        fail(
          `[deps] auto compose-up failed for ${dependency.service}. source=${snapshot.source} endpoint=${dependency.endpoint} error=${upResult.error}`
        );
      }

      if (!beforeStartManaged) {
        managedServicesStarted.add(dependency.service);
      }

      const waited = await waitForDependency(dependency, "auto-post-compose", (item) => item.usable);
      snapshot = waited.snapshot;
      if (!waited.ok || !snapshot?.usable) {
        fail(
          `[deps] auto validation failed after compose-up for ${dependency.service}. source=${snapshot?.source ?? "unknown"} check=${
            snapshot?.serviceCheckReason ?? "unknown"
          }`
        );
      }

      finalized.push(sanitizeDependencyForState(snapshot, "compose_started"));
      continue;
    }

    if (snapshot.usable && snapshot.source !== "compose_managed") {
      fail(
        `[deps] infra=managed requires compose-managed ${dependency.service}, but detected ${snapshot.source} at ${dependency.endpoint}. ` +
          "Switch to --infra=auto/--infra=external or free the host port for compose-managed dependency."
      );
    }

    if (snapshot.usable && snapshot.source === "compose_managed") {
      dependencyLog("managed-decision", {
        service: dependency.service,
        decision: "reuse_compose_managed"
      });
      finalized.push(sanitizeDependencyForState(snapshot, "reuse_managed"));
      continue;
    }

    dependencyLog("managed-decision", {
      service: dependency.service,
      decision: "compose_up",
      reason: "managed_dependency_unavailable_or_unusable"
    });

    const beforeStartManaged = snapshot.compose.exists && snapshot.compose.running;
    const upResult = composeUpDependency(dependency.service);
    if (!upResult.ok) {
      fail(
        `[deps] managed compose-up failed for ${dependency.service}. source=${snapshot.source} endpoint=${dependency.endpoint} error=${upResult.error}`
      );
    }

    if (!beforeStartManaged) {
      managedServicesStarted.add(dependency.service);
    }

    const waited = await waitForDependency(dependency, "managed-post-compose", (item) => item.usable && item.source === "compose_managed");
    snapshot = waited.snapshot;
    if (!waited.ok || !snapshot?.usable || snapshot.source !== "compose_managed") {
      fail(
        `[deps] managed validation failed for ${dependency.service}. finalSource=${snapshot?.source ?? "unknown"} ` +
          `check=${snapshot?.serviceCheckReason ?? "unknown"}`
      );
    }

    finalized.push(sanitizeDependencyForState(snapshot, "compose_started"));
  }

  dependencyLog("strategy-complete", {
    mode: infraMode,
    summary: finalized.map((item) => `${item.service}:${item.source}:${item.usable ? "usable" : "unusable"}`).join(",")
  });

  return {
    mode: infraMode,
    dependencies: finalized,
    managedServicesStarted: Array.from(managedServicesStarted),
    composeCommand: getComposeCmd()?.join(" ") || null,
    composeFile
  };
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
    ["Infra mode", infraMode],
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
  console.log(`infraMode=${infraMode}`);
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
  console.log(`infraMode=${infraMode}`);
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

const prefixWriter = (name, stream, isErr, onLine) => {
  const rawPrefix = `[${name.padEnd(prefixedServiceWidth)}]`;
  const prefix = colorizedPrefixes ? `${servicePrefixColor(name)}${rawPrefix}${ANSI.reset}` : rawPrefix;
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    const output = `${prefix} ${line}`;
    isErr ? console.error(output) : console.log(output);
    if (typeof onLine === "function") onLine(line, isErr);
  });
};

const pushLine = (buffer, line, limit = 80) => {
  buffer.push(String(line));
  while (buffer.length > limit) buffer.shift();
};

const extractDiagnosticLine = (lines) => {
  const all = Array.isArray(lines) ? lines : [];
  const patterns = [
    /EADDRINUSE/i,
    /address already in use/i,
    /does not provide an export named/i,
    /ERR_PACKAGE_PATH_NOT_EXPORTED/i,
    /ERR_MODULE_NOT_FOUND/i,
    /Cannot find module/i
  ];

  for (const pattern of patterns) {
    const matched = all.find((line) => pattern.test(line));
    if (matched) return normalizeDiagnostic(matched).slice(0, 240);
  }

  const fallback = all[all.length - 1] || "no_output";
  return normalizeDiagnostic(fallback).slice(0, 240);
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

const waitForResolverHealthy = async (target, timeoutMs = 20_000) => {
  if (skipResolverHealthcheck) {
    return {
      ok: true,
      endpoint: `${target.baseUrl.replace(/\/+$/, "")}/health`,
      reason: "flag_disabled"
    };
  }

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

const spawnResolverRunDelegate = (target, env) =>
  new Promise((resolve) => {
    try {
      const child = spawn("bash", ["scripts/run.sh"], {
        cwd: target.workingDir,
        env,
        stdio: "ignore",
        detached: true
      });

      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      child.once("error", (error) => {
        done({
          ok: false,
          error: error instanceof Error ? error.message : "run_delegate_error"
        });
      });

      child.once("spawn", () => {
        child.unref();
        setTimeout(() => {
          done({
            ok: true,
            pid: child.pid ?? null
          });
        }, 40);
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : "run_delegate_error"
      });
    }
  });

const shouldStartAuxiliaryResolver = (target) => {
  if (target.key === "yt" && withYoutubeResolver) return { selected: true };
  if (target.key === "fb" && withFacebookResolver) return { selected: true };

  if (withYoutubeResolver || withFacebookResolver) {
    return {
      selected: false,
      reason: "not_selected_by_flag"
    };
  }

  if (withExternalServices) {
    if (target.enabled) return { selected: true };
    return {
      selected: false,
      reason: "disabled_by_env"
    };
  }

  return {
    selected: false,
    reason: "not_requested"
  };
};

const startAuxiliaryResolvers = async (env) => {
  const targets = resolveAuxiliaryTargets(env);
  const selected = [];
  const skipped = [];

  for (const target of targets) {
    const decision = shouldStartAuxiliaryResolver(target);
    if (decision.selected) {
      selected.push(target);
    } else {
      skipped.push({
        target,
        reason: decision.reason || "selection_filtered"
      });
    }
  }

  const state = {
    manager: "module_delegate",
    modules: []
  };

  resolverLog("selection", {
    selected: selected.length ? selected.map((item) => item.serviceName).join(",") : "none",
    skipped: skipped.length ? skipped.map((item) => `${item.target.serviceName}:${item.reason}`).join(",") : "none"
  });

  for (const item of skipped) {
    resolverLog("selection-skip", {
      service: item.target.serviceName,
      reason: item.reason
    });
    state.modules.push({
      key: item.target.key,
      provider: item.target.provider,
      serviceName: item.target.serviceName,
      moduleDir: item.target.workingDir,
      runScriptPath: item.target.runScriptPath,
      stopScriptPath: item.target.stopScriptPath,
      ownership: "not_started",
      status: "skipped",
      reason: item.reason,
      baseUrl: item.target.baseUrl
    });
  }

  if (!selected.length) {
    resolverLog("delegation-skip", { reason: "no_selected_services" });
    return { targets, state };
  }

  resolverLog("delegation-start", {
    manager: "module_delegate",
    selected: selected.map((target) => target.serviceName).join(","),
    requestedByFlags: [withExternalServices ? "all" : null, withYoutubeResolver ? "yt" : null, withFacebookResolver ? "fb" : null]
      .filter(Boolean)
      .join(",")
  });

  for (const target of selected) {
    const record = {
      key: target.key,
      provider: target.provider,
      serviceName: target.serviceName,
      moduleDir: target.workingDir,
      runScriptPath: target.runScriptPath,
      stopScriptPath: target.stopScriptPath,
      ownership: "not_started",
      status: "skipped",
      reason: null,
      baseUrl: target.baseUrl,
      delegatedPid: null
    };

    if (!fs.existsSync(target.workingDir)) {
      record.status = "skipped";
      record.reason = "missing_module_dir";
      resolverLog("run-skip", {
        provider: target.provider,
        service: target.serviceName,
        reason: "missing_module_dir"
      });
      state.modules.push(record);
      continue;
    }

    if (!fs.existsSync(target.runScriptPath)) {
      record.status = "skipped";
      record.reason = "missing_run_script";
      resolverLog("run-skip", {
        provider: target.provider,
        service: target.serviceName,
        reason: "missing_run_script"
      });
      state.modules.push(record);
      continue;
    }

    let preHealth;
    if (skipResolverHealthcheck) {
      preHealth = {
        ok: false,
        endpoint: `${target.baseUrl.replace(/\/+$/, "")}/health`,
        reason: "flag_disabled"
      };
      resolverLog("health-before", {
        provider: target.provider,
        service: target.serviceName,
        status: "skip",
        endpoint: preHealth.endpoint,
        reason: "flag_disabled"
      });
    } else {
      preHealth = await requestResolverHealth({
        baseUrl: target.baseUrl,
        token: target.token,
        timeoutMs: 2500
      });
      resolverLog("health-before", {
        provider: target.provider,
        service: target.serviceName,
        status: preHealth.ok ? "ok" : "fail",
        endpoint: preHealth.endpoint,
        reason: preHealth.reason
      });
    }

    if (preHealth.ok) {
      resolverLog("run-skip", {
        provider: target.provider,
        service: target.serviceName,
        reason: "health_ok_already_running"
      });
      record.status = "already_running";
      record.ownership = "preexisting";
      record.reason = "health_ok_already_running";
      state.modules.push(record);
      continue;
    }

    resolverLog("run-delegate", {
      provider: target.provider,
      service: target.serviceName,
      cwd: target.workingDir,
      action: "run-delegate",
      entrypoint: "scripts/run.sh"
    });

    const delegated = await spawnResolverRunDelegate(target, env);
    if (!delegated.ok) {
      record.status = "failed";
      record.reason = `run_delegate_failed:${delegated.error || "unknown"}`;
      warn(
        `[resolver] provider=${target.provider} service=${target.serviceName} run delegation failed (${record.reason})`
      );
      state.modules.push(record);
      continue;
    }

    record.ownership = "runtime_delegated";
    record.delegatedPid = delegated.pid ?? null;

    const health = await waitForResolverHealthy(target);
    const healthStatus = health?.reason === "flag_disabled" ? "skip" : health?.ok ? "ok" : "fail";
    resolverLog("health-after", {
      provider: target.provider,
      service: target.serviceName,
      status: healthStatus,
      endpoint: health?.endpoint ?? `${target.baseUrl.replace(/\/+$/, "")}/health`,
      reason: health?.reason ?? "unknown"
    });

    if (health?.reason === "flag_disabled") {
      record.status = "delegated";
      record.reason = "healthcheck_skipped_after_delegate";
      state.modules.push(record);
      continue;
    }

    if (!health?.ok) {
      record.status = "failed";
      record.reason = `health_fail_after_delegate:${health?.reason ?? "unknown"}`;
      warn(
        `[resolver] provider=${target.provider} service=${target.serviceName} post-run health failed at ${target.baseUrl} (reason=${health?.reason ?? "unknown"}). module_owns_runtime=true`
      );
      state.modules.push(record);
      continue;
    }

    record.status = "started";
    record.reason = "health_ok_after_delegate";
    state.modules.push(record);
  }

  return { targets, state };
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

const startServices = (env, runtimeStateInfra) => {
  services.forEach((svc) => {
    const stdoutLines = [];
    const stderrLines = [];

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
    prefixWriter(svc.name, child.stdout, false, (line) => pushLine(stdoutLines, line));
    prefixWriter(svc.name, child.stderr, true, (line) => pushLine(stderrLines, line));

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      const combined = stderrLines.concat(stdoutLines).join("\n");
      const category = classifyDiagnosticCategory(combined);
      const hint = extractDiagnosticLine(stderrLines.concat(stdoutLines));
      log(`[app-diagnostics] service=${svc.name} category=${category} hint="${hint}"`);
      warn(`${svc.name} exited (${signal ?? code}). Stopping remaining services.`);
      cleanup(`${svc.name} exited`, typeof code === "number" && code !== 0 ? code : 1);
    });
  });

  const composeCmd = getComposeCmd();
  writeState({
    mode: requestedMode,
    supervisorPid: process.pid,
    startedAt: new Date().toISOString(),
    services: childProcs.map(({ name, pid, workspace, script, kind }) => ({ name, pid, workspace, script, kind })),
    infra: {
      ...runtimeStateInfra,
      compose: composeCmd ? composeCmd.join(" ") : null,
      composeFile
    }
  });

  log(`mode=${requestedMode}`);
  log(`infraMode=${infraMode}`);
  log(`${requestedMode} services started. Tracking state at ${path.relative(rootDir, stateFile)}.`);
  log(`To stop services, run: npm run stop:${requestedMode}`);
};

const main = async () => {
  const runtimeEnv = buildRuntimeEnv();
  assertNoRunningStack();

  const dependencies = scriptSmokeMode ? [] : resolveDependencyTargets(runtimeEnv);
  const infraState = scriptSmokeMode
    ? {
        mode: infraMode,
        dependencies: [],
        managedServicesStarted: [],
        composeCommand: null,
        composeFile
      }
    : await ensureInfra(dependencies);

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

  const resolverRuntime = await startAuxiliaryResolvers(runtimeEnv);

  if (scriptSmokeMode) {
    writeState({
      mode: requestedMode,
      supervisorPid: process.pid,
      startedAt: new Date().toISOString(),
      services: [],
      infra: {
        mode: infraMode,
        dependencies: infraState.dependencies,
        managedServicesStarted: infraState.managedServicesStarted,
        resolvers: resolverRuntime.state,
        compose: null,
        composeFile
      }
    });
    log("scriptSmokeMode=enabled appServices=skipped state=written");
    return;
  }

  startServices(runtimeEnv, {
    mode: infraMode,
    dependencies: infraState.dependencies,
    managedServicesStarted: infraState.managedServicesStarted,
    resolvers: resolverRuntime.state
  });

};

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));

main().catch((err) => fail(err.message));
