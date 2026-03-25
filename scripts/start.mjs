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
const validModeFlags = new Set(["--build"]);
const unknownModeFlags = modeArgs.filter((arg) => arg.startsWith("--") && !validModeFlags.has(arg));
if (unknownModeFlags.length > 0) {
  console.error(`[start:${requestedMode}] unknown flag(s): ${unknownModeFlags.join(", ")}. Supported: --build`);
  process.exit(1);
}
const prodBuildRequested = modeArgs.includes("--build");

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

const requiredInfra = ["postgres", "redis"];
const services = [
  { name: "assistant-api", workspace: "@zappy/assistant-api" },
  { name: "wa-gateway", workspace: "@zappy/wa-gateway" },
  { name: "worker", workspace: "@zappy/worker" },
  { name: "admin-ui", workspace: "@zappy/admin-ui" }
];

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
    case "admin-ui":
      return ANSI.colors.magenta;
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

const runCompose = (args) => {
  const result = spawnSync(composeCmd[0], composeCmd.slice(1).concat(args), {
    cwd: rootDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "unknown error";
    fail(`Docker Compose failed (${args.join(" ")}): ${stderr}`);
  }
  return result.stdout.trim();
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

const listRunningServices = () => {
  const output = runCompose(["-f", composeFile, "ps", "--services"]);
  return output
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const ensureInfra = () => {
  log("Checking Docker daemon...");
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (info.status !== 0) fail("Docker daemon not reachable. Start Docker and retry.");

  log("Ensuring infra containers are up (postgres, redis)...");
  const running = new Set(listRunningServices());
  const missing = requiredInfra.filter((name) => !running.has(name));

  if (missing.length === 0) {
    log("Infra already running.");
    return;
  }

  log(`Starting missing services: ${missing.join(", ")}`);
  runCompose(["-f", composeFile, "up", "-d", ...missing]);
};

const waitForPort = (port, label, host = "127.0.0.1", timeoutMs = 12000) =>
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
  log("Waiting for infra ports...");
  await Promise.all([waitForPort(5432, "Postgres"), waitForPort(6379, "Redis")]);
  log("Infra connectivity OK (Postgres, Redis).");
};

const prefixWriter = (name, stream, isErr) => {
  const width = Math.max(...services.map((s) => s.name.length));
  const rawPrefix = `[${name.padEnd(width)}]`;
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

const startServices = (env) => {
  services.forEach((svc) => {
    const child = spawn("npm", ["run", serviceScript, "-w", svc.workspace], {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    childProcs.push({ name: svc.name, workspace: svc.workspace, pid: child.pid, proc: child });
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
    services: childProcs.map(({ name, pid, workspace }) => ({ name, pid, workspace, script: serviceScript })),
    infra: { compose: composeCmd.join(" "), composeFile, requiredInfra }
  });

  log(`mode=${requestedMode}`);
  log(`${requestedMode} services started. Tracking state at ${path.relative(rootDir, stateFile)}.`);
  log(`To stop services, run: npm run stop:${requestedMode}`);
};

const main = async () => {
  const runtimeEnv = buildRuntimeEnv();
  assertNoRunningStack();
  ensureInfra();
  await ensurePorts().catch((err) => fail(err.message));

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
};

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));

main().catch((err) => fail(err.message));
