#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const stateFile = path.join(rootDir, ".zappy-dev", "dev-stack.json");
const composeFile = path.join(rootDir, "infra", "docker-compose.yml");
const args = process.argv.slice(2);
const withInfra = args.includes("--with-infra");

const log = (msg) => console.log(`[stop-dev] ${msg}`);
const warn = (msg) => console.warn(`[stop-dev] ${msg}`);

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

const detectComposeCmd = () => {
  const tryCmd = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  if (tryCmd("docker", ["compose", "version"])) return ["docker", "compose"];
  if (tryCmd("docker-compose", ["version"])) return ["docker-compose"];
  return null;
};

const stopInfra = () => {
  const composeCmd = detectComposeCmd();
  if (!composeCmd) {
    warn("Docker Compose not available; skipping infra stop.");
    return;
  }
  log("Stopping infra containers (postgres, redis)...");
  const result = spawnSync(
    composeCmd[0],
    composeCmd.slice(1).concat(["-f", composeFile, "stop", "postgres", "redis"]),
    { stdio: "inherit", cwd: rootDir }
  );
  if (result.status !== 0) warn("Failed to stop infra containers; check Docker manually.");
};

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

const main = async () => {
  const state = readState();
  if (!state) {
    log("No dev stack state found. Nothing to stop.");
    return;
  }

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

  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  log("Cleared dev stack state.");

  if (withInfra) {
    stopInfra();
  } else {
    log("Infra containers left running (use --with-infra to stop postgres/redis).");
  }
};

main().catch((err) => {
  warn(err.message);
  process.exit(1);
});
