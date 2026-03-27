#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_MODES = new Set(["dev", "prod", "debug"]);
const mode = (process.argv[2] ?? "dev").toLowerCase();

if (!VALID_MODES.has(mode)) {
  console.error(`[restart] invalid mode "${mode}". Use: dev | prod | debug`);
  process.exit(1);
}

const extraArgs = process.argv.slice(3);
const validFlags = new Set([
  "--with-infra",
  "--build",
  "--with-external-services",
  "--with-yt-resolver",
  "--with-fb-resolver",
  "--skip-resolver-healthcheck"
]);
const unknownFlags = extraArgs.filter((item) => item.startsWith("--") && !validFlags.has(item));
if (unknownFlags.length > 0) {
  console.error(
    `[restart:${mode}] unknown flag(s): ${unknownFlags.join(
      ", "
    )}. Supported: --with-infra --build --with-external-services --with-yt-resolver --with-fb-resolver --skip-resolver-healthcheck`
  );
  process.exit(1);
}

const withInfra = extraArgs.includes("--with-infra");
const withBuild = extraArgs.includes("--build");
const withExternalServices = extraArgs.includes("--with-external-services");
const withYoutubeResolver = extraArgs.includes("--with-yt-resolver");
const withFacebookResolver = extraArgs.includes("--with-fb-resolver");
const skipResolverHealthcheck = extraArgs.includes("--skip-resolver-healthcheck");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const startScript = path.join(rootDir, "scripts", "start.mjs");
const stopScript = path.join(rootDir, "scripts", "stop.mjs");

const run = (scriptPath, args) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    stdio: "inherit"
  });

const stopArgs = [mode, ...(withInfra ? ["--with-infra"] : [])];
const stopResult = run(stopScript, stopArgs);
if ((stopResult.status ?? 1) !== 0) {
  console.error(`[restart:${mode}] stop step failed.`);
  process.exit(stopResult.status ?? 1);
}

const startArgs = [
  mode,
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
