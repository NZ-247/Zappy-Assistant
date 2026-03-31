#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  --help                          Show this help

Ownership behavior when --infra is used:
  - external_host/external_container dependencies are never stopped
  - compose_managed dependencies stop only when this runtime started them
  - tmux resolver windows stop only when ownership=runtime_started`);
};

const args = process.argv.slice(3);
if (args.includes("--help")) {
  printHelp();
  process.exit(0);
}

let withInfra = false;
let explicitInfraMode = null;
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

  if (arg.startsWith("--")) unknownFlags.push(arg);
}

if (unknownFlags.length > 0) {
  console.error(
    `[stop:${requestedMode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --infra --infra=<auto|external|managed> --with-infra --help`
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.ZAPPY_PROJECT_ROOT
  ? path.resolve(process.env.ZAPPY_PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const stateFile = path.join(rootDir, ".zappy-dev", `${requestedMode}-stack.json`);
const composeFile = path.join(rootDir, "infra", "docker-compose.yml");

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
  if (!svc.pid || !pidAlive(svc.pid)) {
    log(`${svc.name}: already stopped.`);
    return;
  }
  log(`${svc.name}: sending SIGINT (pid ${svc.pid})...`);
  try {
    process.kill(svc.pid, "SIGINT");
  } catch {
    /* ignore */
  }
  let exited = await waitForExit(svc.pid, 4000);
  if (!exited && pidAlive(svc.pid)) {
    log(`${svc.name}: escalating to SIGTERM...`);
    try {
      process.kill(svc.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    exited = await waitForExit(svc.pid, 2000);
  }
  if (!exited && pidAlive(svc.pid)) {
    warn(`${svc.name}: still running (pid ${svc.pid}). Stop manually if needed.`);
  } else {
    log(`${svc.name}: stopped.`);
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

const runTmux = (tmuxArgs) => runCommand("tmux", tmuxArgs);

const isTmuxAvailable = () => runTmux(["-V"]).status === 0;

const tmuxSessionExists = (sessionName) => runTmux(["has-session", "-t", sessionName]).status === 0;

const listTmuxWindows = (sessionName) => {
  const result = runTmux(["list-windows", "-t", sessionName, "-F", "#{window_name}"]);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const stopOwnedResolverWindows = (state) => {
  const resolverState = state?.infra?.resolvers;
  if (!resolverState || resolverState.manager !== "tmux") {
    resolverLog("ownership-input", {
      status: "skip",
      reason: "no_tmux_resolver_state"
    });
    return;
  }

  const sessionName = resolverState.session || "zappy";
  const windows = Array.isArray(resolverState.windows) ? resolverState.windows : [];
  const ownedWindows = windows.filter((item) => item.ownership === "runtime_started" && item.windowName);

  resolverLog("ownership-input", {
    session: sessionName,
    trackedWindows: windows.length,
    ownedWindows: ownedWindows.length
  });

  for (const item of windows) {
    resolverLog("ownership-check", {
      service: item.serviceName,
      window: item.windowName,
      ownership: item.ownership,
      action: item.ownership === "runtime_started" ? "stop_candidate" : "skip"
    });
  }

  if (!ownedWindows.length) {
    resolverLog("tmux-stop", {
      status: "skip",
      reason: "no_owned_windows"
    });
    return;
  }

  if (!isTmuxAvailable()) {
    warn("tmux not available; cannot stop owned resolver windows.");
    return;
  }

  if (!tmuxSessionExists(sessionName)) {
    resolverLog("tmux-stop", {
      status: "skip",
      reason: "session_missing",
      session: sessionName
    });
    return;
  }

  const existingWindows = new Set(listTmuxWindows(sessionName));

  for (const item of ownedWindows) {
    if (!existingWindows.has(item.windowName)) {
      resolverLog("tmux-stop-window", {
        session: sessionName,
        window: item.windowName,
        status: "skip",
        reason: "window_missing"
      });
      continue;
    }

    const target = `${sessionName}:${item.windowName}`;
    runTmux(["send-keys", "-t", target, "C-c"]);
    resolverLog("tmux-stop-window", {
      session: sessionName,
      window: item.windowName,
      status: "terminate_signal_sent"
    });

    const result = runTmux(["kill-window", "-t", target]);
    if (result.status !== 0) {
      warn(
        `[stop:${requestedMode}][resolver-stop] failed to close window ${target}: ${result.stderr || result.stdout || "unknown_error"}`
      );
    } else {
      resolverLog("tmux-stop-window", {
        session: sessionName,
        window: item.windowName,
        status: "closed"
      });
    }
  }
};

const main = async () => {
  const state = readState();
  if (!state) {
    log(`No ${requestedMode} stack state found. Nothing to stop.`);
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
    await stopService(svc);
  }

  if (withInfra) {
    infraLog("start", {
      mode: effectiveInfraMode
    });
    stopOwnedManagedDependencies(state, effectiveInfraMode);
    stopOwnedResolverWindows(state);
  } else {
    log("Infra resources left untouched (use --infra to stop runtime-owned managed deps/resolvers).");
  }

  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  log(`Cleared ${requestedMode} stack state.`);
  log(`mode=${requestedMode}`);
};

main().catch((err) => {
  warn(err.message);
  process.exit(1);
});
