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
const rootDir = process.env.ZAPPY_PROJECT_ROOT
  ? path.resolve(process.env.ZAPPY_PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const stateDir = path.join(rootDir, ".zappy-dev");

dotenv.config({ path: path.join(rootDir, ".env") });

const resolverDefinitions = [
  {
    key: "yt",
    serviceName: "youtube-resolver",
    enabledEnv: "YT_RESOLVER_ENABLED",
    moduleDir: path.join(rootDir, "infra", "external-services", "youtube-resolver"),
    bootstrapScriptPath: path.join(rootDir, "infra", "external-services", "youtube-resolver", "scripts", "bootstrap.sh")
  },
  {
    key: "fb",
    serviceName: "facebook-resolver",
    enabledEnv: "FB_RESOLVER_ENABLED",
    moduleDir: path.join(rootDir, "infra", "external-services", "facebook-resolver"),
    bootstrapScriptPath: path.join(rootDir, "infra", "external-services", "facebook-resolver", "scripts", "bootstrap.sh")
  }
];

const log = (msg) => console.log(`[bootstrap:${requestedMode}] ${msg}`);
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

const shouldSelectResolver = (target) => {
  if (withYoutubeResolver || withFacebookResolver) {
    if (target.key === "yt" && withYoutubeResolver) return { selected: true };
    if (target.key === "fb" && withFacebookResolver) return { selected: true };
    return { selected: false, reason: "not_selected_by_flag" };
  }

  if (withExternalServices && !parseToggle(process.env[target.enabledEnv], false)) {
    return { selected: false, reason: "disabled_by_env" };
  }

  return { selected: true };
};

const resolveResolverSelection = () => {
  const selected = [];
  const skipped = [];

  for (const target of resolverDefinitions) {
    const decision = shouldSelectResolver(target);
    if (decision.selected) {
      selected.push(target);
      continue;
    }
    skipped.push({
      ...target,
      reason: decision.reason || "selection_filtered"
    });
  }

  return { selected, skipped };
};

const runResolverBootstrap = (target) => {
  if (!fs.existsSync(target.moduleDir)) {
    log(`resolver=${target.serviceName} action=bootstrap-skip reason=missing_module_dir cwd=${target.moduleDir}`);
    return {
      status: "skipped",
      reason: "missing_module_dir"
    };
  }

  if (!fs.existsSync(target.bootstrapScriptPath)) {
    log(`resolver=${target.serviceName} action=bootstrap-skip reason=missing_bootstrap_script cwd=${target.moduleDir}`);
    return {
      status: "skipped",
      reason: "missing_bootstrap_script"
    };
  }

  log(`resolver=${target.serviceName} cwd=${target.moduleDir} action=bootstrap-delegate entrypoint=scripts/bootstrap.sh`);
  const result = spawnSync("bash", ["scripts/bootstrap.sh"], {
    cwd: target.moduleDir,
    stdio: "inherit",
    env: process.env
  });

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    log(`resolver=${target.serviceName} action=bootstrap-fail cwd=${target.moduleDir} exitCode=${exitCode}`);
    return {
      status: "failed",
      reason: "bootstrap_delegate_failed"
    };
  }

  log(`resolver=${target.serviceName} action=bootstrap-ok cwd=${target.moduleDir}`);
  return {
    status: "ok"
  };
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
  const selection = resolveResolverSelection();
  log(
    `resolver-selection selected=${
      selection.selected.length ? selection.selected.map((item) => item.serviceName).join(",") : "none"
    } skipped=${selection.skipped.length ? selection.skipped.map((item) => `${item.serviceName}:${item.reason}`).join(",") : "none"}`
  );
  for (const item of selection.skipped) {
    log(`resolver=${item.serviceName} action=bootstrap-skip reason=${item.reason}`);
  }

  let failed = 0;
  for (const target of selection.selected) {
    const result = runResolverBootstrap(target);
    if (result.status === "failed") failed += 1;
  }

  if (failed > 0) {
    fail(`infraBootstrap=failed resolverBootstrapFailures=${failed}`);
  }

  log("infraBootstrap=done");
};

main();
