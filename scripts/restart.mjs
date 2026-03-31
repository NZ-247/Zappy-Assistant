#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_MODES = new Set(["dev", "prod", "debug"]);
const INFRA_MODES = new Set(["auto", "external", "managed"]);
const mode = (process.argv[2] ?? "dev").toLowerCase();

if (!VALID_MODES.has(mode)) {
  console.error(`[restart] invalid mode "${mode}". Use: dev | prod | debug`);
  process.exit(1);
}

const printHelp = () => {
  console.log(`Usage: node scripts/restart.mjs <mode> [options]

Modes:
  dev | prod | debug

Options:
  --infra                       Restart with infra stop + start (mode defaults to auto)
  --infra=<auto|external|managed> Restart using explicit infra strategy
  --with-infra                  Backward-compatible alias for --infra
  --build
  --with-external-services
  --with-yt-resolver
  --with-fb-resolver
  --skip-resolver-healthcheck
  --help`);
};

const extraArgs = process.argv.slice(3);
if (extraArgs.includes("--help")) {
  printHelp();
  process.exit(0);
}

let infraMode = "auto";
let shouldStopInfra = false;
const seenInfraModes = [];
const unknownFlags = [];

for (const arg of extraArgs) {
  if (arg === "--infra" || arg === "--with-infra") {
    shouldStopInfra = true;
    seenInfraModes.push("auto");
    continue;
  }

  if (arg.startsWith("--infra=")) {
    const parsedMode = arg.slice("--infra=".length).trim().toLowerCase();
    if (!INFRA_MODES.has(parsedMode)) {
      console.error(`[restart:${mode}] invalid infra mode "${parsedMode}". Use: auto | external | managed`);
      process.exit(1);
    }
    shouldStopInfra = true;
    seenInfraModes.push(parsedMode);
    continue;
  }

  if (
    arg === "--build" ||
    arg === "--with-external-services" ||
    arg === "--with-yt-resolver" ||
    arg === "--with-fb-resolver" ||
    arg === "--skip-resolver-healthcheck"
  ) {
    continue;
  }

  if (arg.startsWith("--")) unknownFlags.push(arg);
}

if (unknownFlags.length > 0) {
  console.error(
    `[restart:${mode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --infra --infra=<auto|external|managed> --with-infra --build --with-external-services --with-yt-resolver --with-fb-resolver --skip-resolver-healthcheck --help`
  );
  process.exit(1);
}

if (seenInfraModes.length > 0) {
  const unique = Array.from(new Set(seenInfraModes));
  if (unique.length > 1) {
    console.error(`[restart:${mode}] conflicting infra flags: ${unique.join(", ")}. Pick only one infra mode.`);
    process.exit(1);
  }
  infraMode = unique[0];
}

const withBuild = extraArgs.includes("--build");
const withExternalServices = extraArgs.includes("--with-external-services");
const withYoutubeResolver = extraArgs.includes("--with-yt-resolver");
const withFacebookResolver = extraArgs.includes("--with-fb-resolver");
const skipResolverHealthcheck = extraArgs.includes("--skip-resolver-healthcheck");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const startScript = path.join(rootDir, "scripts", "start.mjs");
const stopScript = path.join(rootDir, "scripts", "stop.mjs");

const run = (scriptPath, scriptArgs) =>
  spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: rootDir,
    stdio: "inherit"
  });

const stopArgs = [mode, ...(shouldStopInfra ? [`--infra=${infraMode}`] : [])];
const stopResult = run(stopScript, stopArgs);
if ((stopResult.status ?? 1) !== 0) {
  console.error(`[restart:${mode}] stop step failed.`);
  process.exit(stopResult.status ?? 1);
}

const startArgs = [
  mode,
  `--infra=${infraMode}`,
  ...(withBuild ? ["--build"] : []),
  ...(withExternalServices ? ["--with-external-services"] : []),
  ...(withYoutubeResolver ? ["--with-yt-resolver"] : []),
  ...(withFacebookResolver ? ["--with-fb-resolver"] : []),
  ...(skipResolverHealthcheck ? ["--skip-resolver-healthcheck"] : [])
];

const startResult = run(startScript, startArgs);
if ((startResult.status ?? 1) !== 0) {
  console.error(`[restart:${mode}] start step failed.`);
  process.exit(startResult.status ?? 1);
}
