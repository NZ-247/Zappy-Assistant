#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const stopScript = path.join(rootDir, "scripts", "stop.mjs");
const forwardedArgs = process.argv.slice(2);

const result = spawnSync(process.execPath, [stopScript, "dev", ...forwardedArgs], {
  cwd: rootDir,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
