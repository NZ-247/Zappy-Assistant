#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const VALID_MODES = new Set(["dev", "prod", "debug"]);
const requestedMode = (process.argv[2] ?? "dev").toLowerCase();
if (!VALID_MODES.has(requestedMode)) {
  console.error(`[bootstrap] invalid mode "${requestedMode}". Use: dev | prod | debug`);
  process.exit(1);
}

const printHelp = () => {
  console.log(`Usage: node scripts/bootstrap.mjs <mode> [options]

Modes:
  dev | prod | debug

Options:
  --infra                    Prepare infra/runtime prerequisites for this host
  --with-external-services   Bootstrap only resolvers enabled in .env
  --with-yt-resolver         Bootstrap only youtube resolver
  --with-fb-resolver         Bootstrap only facebook resolver
  --help                     Show this help

Examples:
  npm run bootstrap:dev -- --infra
  npm run bootstrap:prod -- --infra --with-yt-resolver`);
};

const args = process.argv.slice(3);
if (args.includes("--help")) {
  printHelp();
  process.exit(0);
}

const validFlags = new Set(["--infra", "--with-external-services", "--with-yt-resolver", "--with-fb-resolver"]);
const unknownFlags = args.filter((arg) => arg.startsWith("--") && !validFlags.has(arg));
if (unknownFlags.length > 0) {
  console.error(
    `[bootstrap:${requestedMode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --infra --with-external-services --with-yt-resolver --with-fb-resolver --help`
  );
  process.exit(1);
}

const withInfra = args.includes("--infra");
const withExternalServices = args.includes("--with-external-services");
const withYoutubeResolver = args.includes("--with-yt-resolver");
const withFacebookResolver = args.includes("--with-fb-resolver");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const stateDir = path.join(rootDir, ".zappy-dev");

dotenv.config({ path: path.join(rootDir, ".env") });

const resolverDefinitions = [
  {
    key: "yt",
    serviceName: "youtube-resolver",
    enabledEnv: "YT_RESOLVER_ENABLED",
    workingDir: path.join(rootDir, "infra", "external-services", "youtube-resolver"),
    bootstrapScriptPath: path.join(rootDir, "infra", "external-services", "youtube-resolver", "scripts", "bootstrap.sh")
  },
  {
    key: "fb",
    serviceName: "facebook-resolver",
    enabledEnv: "FB_RESOLVER_ENABLED",
    workingDir: path.join(rootDir, "infra", "external-services", "facebook-resolver"),
    bootstrapScriptPath: path.join(rootDir, "infra", "external-services", "facebook-resolver", "scripts", "bootstrap.sh")
  }
];

const log = (msg) => console.log(`[bootstrap:${requestedMode}] ${msg}`);
const warn = (msg) => console.warn(`[bootstrap:${requestedMode}] ${msg}`);
const fail = (msg) => {
  console.error(`[bootstrap:${requestedMode}] ${msg}`);
  process.exit(1);
};

const parseToggle = (value, defaultValue = false) => {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

const runCommand = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    stdio: options.stdio ?? "pipe",
    env: options.env
  });
  return {
    status: result.status ?? 1
  };
};

const commandExists = (command, argsForCheck = ["--version"]) => runCommand(command, argsForCheck, { stdio: "ignore" }).status === 0;

const detectCompose = () => {
  if (commandExists("docker", ["compose", "version"])) return "docker compose";
  if (commandExists("docker-compose", ["version"])) return "docker-compose";
  return null;
};

const resolveResolverTargets = () => {
  if (withYoutubeResolver || withFacebookResolver) {
    return resolverDefinitions.filter((item) => (item.key === "yt" && withYoutubeResolver) || (item.key === "fb" && withFacebookResolver));
  }

  if (withExternalServices) {
    return resolverDefinitions.filter((item) => parseToggle(process.env[item.enabledEnv], false));
  }

  return resolverDefinitions;
};

const runResolverBootstrap = (target) => {
  if (!fs.existsSync(target.workingDir)) {
    fail(`Resolver directory missing for ${target.serviceName}: ${path.relative(rootDir, target.workingDir)}`);
  }

  if (!fs.existsSync(target.bootstrapScriptPath)) {
    fail(`Bootstrap script missing for ${target.serviceName}: ${path.relative(rootDir, target.bootstrapScriptPath)}`);
  }

  log(`resolver=${target.serviceName} action=bootstrap-start`);
  const result = spawnSync("bash", [target.bootstrapScriptPath], {
    cwd: target.workingDir,
    stdio: "inherit",
    env: process.env
  });

  if ((result.status ?? 1) !== 0) {
    fail(`resolver=${target.serviceName} bootstrap failed`);
  }

  log(`resolver=${target.serviceName} action=bootstrap-ok`);
};

const main = () => {
  log(`mode=${requestedMode}`);
  fs.mkdirSync(stateDir, { recursive: true });
  log(`stateDir=${path.relative(rootDir, stateDir)} prepared`);

  if (!withInfra) {
    log("No infra bootstrap requested (--infra not provided). Completed base bootstrap only.");
    return;
  }

  log("infraBootstrap=start");

  if (!commandExists("python3", ["--version"])) {
    fail("python3 not found. Install python3 before running bootstrap with --infra.");
  }
  log("prereq=python3 status=ok");

  const composeCmd = detectCompose();
  if (composeCmd) {
    log(`prereq=compose status=ok cmd=\"${composeCmd}\"`);
  } else {
    warn("prereq=compose status=missing (acceptable for pure external infra mode)");
  }

  if (commandExists("tmux", ["-V"])) {
    log("prereq=tmux status=ok");
  } else {
    warn("prereq=tmux status=missing (required for tmux-managed resolver runtime)");
  }

  const targets = resolveResolverTargets();
  if (!targets.length) {
    warn("No resolver selected for bootstrap (filters excluded all services).");
  } else {
    log(`resolvers=${targets.map((item) => item.serviceName).join(",")} action=bootstrap`);
    for (const target of targets) {
      runResolverBootstrap(target);
    }
  }

  log("infraBootstrap=done");
};

main();
