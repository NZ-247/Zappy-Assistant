#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const VALID_MODES = new Set(["dev", "prod", "debug"]);
const INFRA_MODES = new Set(["auto", "external", "managed"]);
const requestedMode = (process.argv[2] ?? "dev").toLowerCase();
if (!VALID_MODES.has(requestedMode)) {
  console.error(`[stop] invalid mode "${requestedMode}". Use: dev | prod | debug`);
  process.exit(1);
}

const printHelp = () => {
  console.log(`Usage: node scripts/stop.mjs <mode> [options]

Modes:
  dev | prod | debug

Options:
  --infra                         Stop only infra/resolver resources owned by this runtime
  --infra=<auto|external|managed> Same as --infra, with explicit mode annotation in logs
  --with-infra                    Backward-compatible alias for --infra
  --cleanup-ports                 Try cleanup of stale Zappy root-app leftovers on ports 8080/3333/3334/3335
  --force-runtime-cleanup         Backward-compatible alias for --cleanup-ports
  --help                          Show this help

Ownership behavior when --infra is used:
  - external_host/external_container dependencies are never stopped
  - compose_managed dependencies stop only when this runtime started them
  - resolver module stop is delegated only when module provides scripts/stop.sh

Ownership behavior when --cleanup-ports is used:
  - default stop behavior remains unchanged (report-only for unknown processes)
  - cleanup sends SIGINT -> SIGTERM -> SIGKILL (last resort) only to confidently-classified Zappy leftovers
  - non-Zappy/uncertain processes are always skipped with explicit logs`);
};

const args = process.argv.slice(3);
if (args.includes("--help")) {
  printHelp();
  process.exit(0);
}

let withInfra = false;
let explicitInfraMode = null;
let cleanupPorts = false;
const unknownFlags = [];

for (const arg of args) {
  if (arg === "--infra" || arg === "--with-infra") {
    withInfra = true;
    continue;
  }

  if (arg.startsWith("--infra=")) {
    const mode = arg.slice("--infra=".length).trim().toLowerCase();
    if (!INFRA_MODES.has(mode)) {
      console.error(`[stop:${requestedMode}] invalid infra mode "${mode}". Use: auto | external | managed`);
      process.exit(1);
    }
    explicitInfraMode = mode;
    withInfra = true;
    continue;
  }

  if (arg === "--cleanup-ports" || arg === "--force-runtime-cleanup") {
    cleanupPorts = true;
    continue;
  }

  if (arg.startsWith("--")) unknownFlags.push(arg);
}

if (unknownFlags.length > 0) {
  console.error(
    `[stop:${requestedMode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --infra --infra=<auto|external|managed> --with-infra --cleanup-ports --force-runtime-cleanup --help`
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.ZAPPY_PROJECT_ROOT
  ? path.resolve(process.env.ZAPPY_PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const stateFile = path.join(rootDir, ".zappy-dev", `${requestedMode}-stack.json`);
const composeFile = path.join(rootDir, "infra", "docker-compose.yml");
dotenv.config({ path: path.join(rootDir, ".env") });

const rootAppPortServices = [
  {
    name: "admin-ui",
    workspace: "@zappy/admin-ui",
    port: {
      envVar: "ADMIN_UI_PORT",
      defaultPort: 8080
    }
  },
  {
    name: "assistant-api",
    workspace: "@zappy/assistant-api",
    port: {
      envVar: "ADMIN_API_PORT",
      defaultPort: 3333
    }
  },
  {
    name: "wa-gateway",
    workspace: "@zappy/wa-gateway",
    port: {
      envVar: "WA_GATEWAY_INTERNAL_PORT",
      defaultPort: 3334
    }
  },
  {
    name: "media-resolver-api",
    workspace: "@zappy/media-resolver-api",
    port: {
      envVar: "MEDIA_RESOLVER_API_PORT",
      defaultPort: 3335
    }
  }
];

const log = (msg) => console.log(`[stop:${requestedMode}] ${msg}`);
const warn = (msg) => console.warn(`[stop:${requestedMode}] ${msg}`);

const infraLog = (phase, fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[infra-stop] phase=${phase}${suffix ? ` ${suffix}` : ""}`);
};

const resolverLog = (phase, fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[resolver-stop] phase=${phase}${suffix ? ` ${suffix}` : ""}`);
};

const stateLog = (fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[state]${suffix ? ` ${suffix}` : ""}`);
};

const cleanupLog = (phase, fields = {}) => {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  log(`[cleanup] phase=${phase}${suffix ? ` ${suffix}` : ""}`);
};

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForExit = (pid, timeoutMs) =>
  new Promise((resolve) => {
    const end = Date.now() + timeoutMs;
    const check = () => {
      if (!pidAlive(pid)) return resolve(true);
      if (Date.now() > end) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });

const readState = () => {
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (err) {
    warn(`Could not read state file: ${err.message}`);
    return null;
  }
};

const runCommand = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
};

const isStateAlive = (state) =>
  Boolean(state) && (pidAlive(state.supervisorPid) || (state.services || []).some((svc) => svc.pid && pidAlive(svc.pid)));

let lsofAvailableCache;
const isLsofAvailable = () => {
  if (lsofAvailableCache !== undefined) return lsofAvailableCache;
  lsofAvailableCache = runCommand("lsof", ["-v"], { stdio: "ignore" }).status === 0;
  return lsofAvailableCache;
};

let ssAvailableCache;
const isSsAvailable = () => {
  if (ssAvailableCache !== undefined) return ssAvailableCache;
  ssAvailableCache = runCommand("ss", ["-h"], { stdio: "ignore" }).status === 0;
  return ssAvailableCache;
};

const parsePidLines = (output) =>
  output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

const getListeningPidsFromLsof = (port) => {
  if (!isLsofAvailable()) return [];
  const result = runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (result.status !== 0 && !result.stdout) return [];
  return parsePidLines(result.stdout);
};

const getListeningPidsFromSs = (port) => {
  if (!isSsAvailable()) return [];
  const result = runCommand("ss", ["-ltnp", `sport = :${port}`]);
  if (result.status !== 0 || !result.stdout) return [];

  const matches = result.stdout.matchAll(/pid=(\d+)/g);
  const pids = [];
  for (const match of matches) {
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) pids.push(parsed);
  }
  return pids;
};

const listListeningPidsByPort = (port) => {
  const pids = new Set();
  for (const pid of getListeningPidsFromLsof(port)) pids.add(pid);
  for (const pid of getListeningPidsFromSs(port)) pids.add(pid);
  return Array.from(pids);
};

const getProcessCommandLine = (pid) => {
  const result = runCommand("ps", ["-o", "args=", "-p", String(pid)]);
  if (result.status !== 0) return "";
  return result.stdout.trim();
};

const getPortOwnerProcesses = (port) =>
  listListeningPidsByPort(port).map((pid) => ({
    pid,
    commandLine: getProcessCommandLine(pid)
  }));

const normalizeMarker = (value) => String(value || "").trim().toLowerCase().replace(/\\/g, "/");
const runtimeIdentityMarkers = [normalizeMarker(rootDir), normalizeMarker("zappy-assistant"), normalizeMarker("scripts/start.mjs")];
const nodeLikeCommandPattern = /\b(node|npm|pnpm|yarn|bun|tsx|ts-node)\b/;

const serviceIdentityMarkers = (service) =>
  [
    service.workspace || `@zappy/${service.name}`,
    `@zappy/${service.name}`,
    `apps/${service.name}`,
    path.join(rootDir, "apps", service.name)
  ]
    .map((item) => normalizeMarker(item))
    .filter(Boolean);

const classifyPortOwner = (service, owner) => {
  const normalizedCommandLine = normalizeMarker(owner.commandLine);
  const serviceMarkers = serviceIdentityMarkers(service);
  const matchedServiceMarkers = serviceMarkers.filter((marker) => normalizedCommandLine.includes(marker));
  const matchedRuntimeMarkers = runtimeIdentityMarkers.filter((marker) => normalizedCommandLine.includes(marker));
  const nodeLikeCommand = nodeLikeCommandPattern.test(normalizedCommandLine);
  const confident = matchedServiceMarkers.length > 0 && (nodeLikeCommand || matchedRuntimeMarkers.length > 0);

  return {
    confident,
    classification: confident ? "confident_zappy_runtime_leftover" : "non_zappy_or_uncertain",
    matchedServiceMarker: matchedServiceMarkers[0] || "none",
    matchedRuntimeMarker: matchedRuntimeMarkers[0] || "none",
    nodeLikeCommand
  };
};

const sendSignal = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

const terminateConfidentLeftoverProcess = async ({ service, port, pid }) => {
  if (!pidAlive(pid)) {
    cleanupLog("already_exited", {
      service,
      port,
      pid
    });
    return { exited: true };
  }

  const signalStages = [
    { signal: "SIGINT", waitMs: 3000 },
    { signal: "SIGTERM", waitMs: 2000 }
  ];

  for (const stage of signalStages) {
    if (!pidAlive(pid)) return { exited: true };
    const sent = sendSignal(pid, stage.signal);
    cleanupLog("signal_sent", {
      service,
      port,
      pid,
      signal: stage.signal,
      status: sent ? "ok" : "failed"
    });
    if (!sent) continue;
    const exited = await waitForExit(pid, stage.waitMs);
    if (exited) return { exited: true };
  }

  if (pidAlive(pid)) {
    const sent = sendSignal(pid, "SIGKILL");
    cleanupLog("signal_sent", {
      service,
      port,
      pid,
      signal: "SIGKILL",
      status: sent ? "ok" : "failed"
    });
    if (sent) {
      const exited = await waitForExit(pid, 1000);
      if (exited) return { exited: true };
    }
  }

  return { exited: !pidAlive(pid) };
};

const probeTcpPort = (host, port, timeoutMs = 1100) =>
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
    socket.on("error", (error) => done(false, error.code || "connect_error"));
  });

const resolveServicePort = (service) => {
  const raw = String(process.env[service.port.envVar] ?? "").trim();
  if (!raw) return service.port.defaultPort;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    warn(
      `[stop-reconcile] service=${service.name} invalid ${service.port.envVar}="${raw}". Falling back to ${service.port.defaultPort}.`
    );
    return service.port.defaultPort;
  }
  return parsed;
};

const cleanupRootAppPorts = async () => {
  const portTargets = rootAppPortServices.map((service) => resolveServicePort(service)).join(",");
  cleanupLog("scan_started", {
    services: rootAppPortServices.length,
    ports: portTargets
  });
  const cleanupByPid = new Map();

  for (const service of rootAppPortServices) {
    const port = resolveServicePort(service);
    const owners = getPortOwnerProcesses(port);

    for (const owner of owners) {
      const classification = classifyPortOwner(service, owner);
      cleanupLog("owner", {
        service: service.name,
        port,
        pid: owner.pid,
        classification: classification.classification,
        matchedServiceMarker: classification.matchedServiceMarker,
        matchedRuntimeMarker: classification.matchedRuntimeMarker,
        nodeLikeCommand: classification.nodeLikeCommand
      });

      if (!classification.confident) {
        cleanupLog("skip", {
          service: service.name,
          port,
          pid: owner.pid,
          status: "skipped_non_zappy_process"
        });
        continue;
      }

      if (!cleanupByPid.has(owner.pid)) {
        const terminateResult = await terminateConfidentLeftoverProcess({
          service: service.name,
          port,
          pid: owner.pid
        });
        cleanupByPid.set(owner.pid, terminateResult);
      }
    }

    const ownersAfter = getPortOwnerProcesses(port);
    const probeAfter =
      ownersAfter.length > 0 ? { open: true, reason: "owner_detected" } : await probeTcpPort("127.0.0.1", port, 900);
    const stillBusy = ownersAfter.length > 0 || probeAfter.open;
    cleanupLog("port", {
      service: service.name,
      port,
      status: stillBusy ? "still_busy" : "cleared"
    });
  }
};

const reconcileRootAppPorts = async (serviceStopResultsByName = new Map()) => {
  for (const service of rootAppPortServices) {
    const port = resolveServicePort(service);
    const owners = getPortOwnerProcesses(port);
    const probe = owners.length > 0 ? { open: true, reason: "owner_detected" } : await probeTcpPort("127.0.0.1", port, 900);
    const busy = owners.length > 0 || probe.open;

    const stopResult = serviceStopResultsByName.get(service.name);
    const trackedPid = stopResult?.trackedPid || null;
    const trackedPidOwnsPort = trackedPid ? owners.some((owner) => owner.pid === trackedPid) : false;

    const status = busy ? "port_still_busy_unknown_process" : stopResult?.stoppedByPid ? "stopped_by_pid" : "already_stopped";
    const occupancy = busy
      ? trackedPidOwnsPort
        ? "tracked_runtime_owned_process"
        : owners.length
          ? "untracked_process"
          : "untracked_process_unresolved"
      : "none";

    log(`[stop-reconcile] service=${service.name} port=${port} status=${status} occupancy=${occupancy}`);
  }
};

const detectComposeCmd = () => {
  if (runCommand("docker", ["compose", "version"], { stdio: "ignore" }).status === 0) return ["docker", "compose"];
  if (runCommand("docker-compose", ["version"], { stdio: "ignore" }).status === 0) return ["docker-compose"];
  return null;
};

const runCompose = (composeCmd, composeArgs) =>
  runCommand(composeCmd[0], composeCmd.slice(1).concat(composeArgs), {
    cwd: rootDir,
    stdio: "inherit"
  });

const stopService = async (svc) => {
  const trackedPid = Number(svc.pid);
  if (!Number.isInteger(trackedPid) || trackedPid <= 0 || !pidAlive(trackedPid)) {
    log(`${svc.name}: already stopped.`);
    return {
      name: svc.name,
      trackedPid: Number.isInteger(trackedPid) && trackedPid > 0 ? trackedPid : null,
      stoppedByPid: false,
      alreadyStopped: true
    };
  }
  log(`${svc.name}: sending SIGINT (pid ${trackedPid})...`);
  try {
    process.kill(trackedPid, "SIGINT");
  } catch {
    /* ignore */
  }
  let exited = await waitForExit(trackedPid, 4000);
  if (!exited && pidAlive(trackedPid)) {
    log(`${svc.name}: escalating to SIGTERM...`);
    try {
      process.kill(trackedPid, "SIGTERM");
    } catch {
      /* ignore */
    }
    exited = await waitForExit(trackedPid, 2000);
  }
  if (!exited && pidAlive(trackedPid)) {
    warn(`${svc.name}: still running (pid ${trackedPid}). Stop manually if needed.`);
    return {
      name: svc.name,
      trackedPid,
      stoppedByPid: false,
      alreadyStopped: false
    };
  } else {
    log(`${svc.name}: stopped.`);
    return {
      name: svc.name,
      trackedPid,
      stoppedByPid: true,
      alreadyStopped: false
    };
  }
};

const stopOwnedManagedDependencies = (state, effectiveInfraMode) => {
  const infraState = state?.infra ?? {};
  const dependencies = Array.isArray(infraState.dependencies) ? infraState.dependencies : [];
  const managedServicesStarted = new Set(Array.isArray(infraState.managedServicesStarted) ? infraState.managedServicesStarted : []);

  infraLog("ownership-input", {
    mode: effectiveInfraMode,
    dependencyCount: dependencies.length,
    managedStartedCount: managedServicesStarted.size
  });

  const ownedServicesToStop = [];

  for (const dependency of dependencies) {
    const source = dependency?.source || "unknown";
    const startedByRuntime = managedServicesStarted.has(dependency.service);
    const shouldStop = source === "compose_managed" && startedByRuntime;

    infraLog("ownership-check", {
      service: dependency.service,
      source,
      action: shouldStop ? "stop" : "skip",
      reason: shouldStop ? "compose_managed_started_by_runtime" : `${source}_or_not_started_by_runtime`
    });

    if (shouldStop) {
      ownedServicesToStop.push(dependency.service);
    }
  }

  if (!ownedServicesToStop.length) {
    infraLog("compose-stop", {
      status: "skip",
      reason: "no_owned_managed_services"
    });
    return;
  }

  const composeCmd = detectComposeCmd();
  if (!composeCmd) {
    warn("Docker Compose not available; cannot stop owned managed dependencies.");
    return;
  }

  infraLog("compose-stop", {
    status: "attempt",
    services: ownedServicesToStop.join(",")
  });

  const result = runCompose(composeCmd, ["-f", composeFile, "stop", ...ownedServicesToStop]);
  if (result.status !== 0) {
    warn("Failed to stop owned managed dependencies; check Docker manually.");
  } else {
    infraLog("compose-stop", {
      status: "ok",
      services: ownedServicesToStop.join(",")
    });
  }
};

const inferModuleDirFromServiceName = (serviceName) => {
  if (!serviceName) return null;
  return path.join(rootDir, "infra", "external-services", serviceName);
};

const resolveResolverModules = (state) => {
  const resolverState = state?.infra?.resolvers;
  if (!resolverState) return [];

  if (Array.isArray(resolverState.modules)) {
    return resolverState.modules;
  }

  if (Array.isArray(resolverState.windows)) {
    return resolverState.windows.map((item) => ({
      ...item,
      moduleDir: item.moduleDir || inferModuleDirFromServiceName(item.serviceName),
      stopScriptPath:
        item.stopScriptPath || (item.moduleDir ? path.join(item.moduleDir, "scripts", "stop.sh") : undefined),
      ownership: item.ownership === "runtime_started" ? "runtime_delegated" : item.ownership
    }));
  }

  return [];
};

const stopDelegatedResolverModules = (state) => {
  const resolverModules = resolveResolverModules(state);
  if (!resolverModules.length) {
    resolverLog("ownership-input", {
      status: "skip",
      reason: "no_resolver_state"
    });
    return;
  }

  resolverLog("ownership-input", {
    manager: state?.infra?.resolvers?.manager || "unknown",
    trackedModules: resolverModules.length
  });

  for (const moduleState of resolverModules) {
    const serviceName = moduleState.serviceName || "unknown";
    const ownership = moduleState.ownership || "unknown";
    const moduleDir = moduleState.moduleDir || inferModuleDirFromServiceName(serviceName);
    const stopScriptPath = moduleState.stopScriptPath || (moduleDir ? path.join(moduleDir, "scripts", "stop.sh") : null);

    if (ownership !== "runtime_delegated") {
      resolverLog("ownership-check", {
        service: serviceName,
        ownership,
        action: "skip",
        reason: "not_runtime_delegated"
      });
      continue;
    }

    if (!moduleDir || !fs.existsSync(moduleDir)) {
      resolverLog("module-stop", {
        service: serviceName,
        action: "skip",
        reason: "missing_module_dir",
        manual: "required"
      });
      continue;
    }

    if (!stopScriptPath || !fs.existsSync(stopScriptPath)) {
      resolverLog("module-stop", {
        service: serviceName,
        action: "skip",
        reason: "missing_stop_script",
        cwd: moduleDir,
        manual: "required"
      });
      continue;
    }

    resolverLog("module-stop", {
      service: serviceName,
      action: "delegate",
      cwd: moduleDir,
      entrypoint: "scripts/stop.sh"
    });

    const result = runCommand("bash", ["scripts/stop.sh"], {
      cwd: moduleDir,
      stdio: "inherit"
    });

    if (result.status !== 0) {
      resolverLog("module-stop", {
        service: serviceName,
        action: "failed",
        cwd: moduleDir,
        exitCode: result.status
      });
      warn(`[resolver-stop] delegated stop failed for ${serviceName}; check module logs.`);
    } else {
      resolverLog("module-stop", {
        service: serviceName,
        action: "ok",
        cwd: moduleDir
      });
    }
  }
};

const main = async () => {
  const stateFileExists = fs.existsSync(stateFile);
  const state = readState();
  const stopResultsByService = new Map();

  if (!stateFileExists) {
    stateLog({
      mode: requestedMode,
      status: "missing",
      file: path.relative(rootDir, stateFile)
    });
  } else if (!state) {
    stateLog({
      mode: requestedMode,
      status: "stale_unreadable",
      file: path.relative(rootDir, stateFile)
    });
  } else if (!isStateAlive(state)) {
    stateLog({
      mode: requestedMode,
      status: "stale_pid_state",
      file: path.relative(rootDir, stateFile)
    });
  } else {
    stateLog({
      mode: requestedMode,
      status: "active",
      file: path.relative(rootDir, stateFile),
      supervisorPid: state.supervisorPid || "none",
      trackedServices: Array.isArray(state.services) ? state.services.length : 0
    });
  }

  if (!state) {
    log(`No ${requestedMode} stack state found. PID stop skipped.`);
    if (cleanupPorts) {
      await cleanupRootAppPorts();
    }
    await reconcileRootAppPorts(stopResultsByService);
    return;
  }

  const effectiveInfraMode = explicitInfraMode || state?.infra?.mode || "auto";

  const services = state.services || [];
  if (state.supervisorPid && pidAlive(state.supervisorPid)) {
    log(`Signalling supervisor (pid ${state.supervisorPid})...`);
    try {
      process.kill(state.supervisorPid, "SIGINT");
    } catch {
      /* ignore */
    }
    await waitForExit(state.supervisorPid, 3000);
  }

  for (const svc of services) {
    const result = await stopService(svc);
    stopResultsByService.set(svc.name, result);
  }

  if (withInfra) {
    infraLog("start", {
      mode: effectiveInfraMode
    });
    stopOwnedManagedDependencies(state, effectiveInfraMode);
    stopDelegatedResolverModules(state);
  } else {
    log("Infra resources left untouched (use --infra to stop runtime-owned managed deps/resolvers).");
  }

  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  log(`Cleared ${requestedMode} stack state.`);
  if (cleanupPorts) {
    await cleanupRootAppPorts();
  }
  await reconcileRootAppPorts(stopResultsByService);
  log(`mode=${requestedMode}`);
};

main().catch((err) => {
  warn(err.message);
  process.exit(1);
});
