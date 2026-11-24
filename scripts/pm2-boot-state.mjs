import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const services = ["admin-api", "admin-ui", "wa-gateway", "worker", "media-resolver"];

export function decideBootAction(saved, processes, cwd) {
  if (!Array.isArray(saved) || !Array.isArray(processes)) return "invalid";
  if (saved.length !== services.length || !services.every((name) => saved.some((app) => app.name === name && app.pm_cwd === cwd))) {
    return "invalid";
  }
  if (processes.length === 0) return "restore";
  const active = services.every((name) => processes.some(
    (app) => app.name === name && app.pm2_env?.status === "online" && app.pm2_env.pm_cwd === cwd
  ));
  return active ? "keep" : "partial";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let action;
  try {
    const saved = JSON.parse(readFileSync(process.argv[2], "utf8"));
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    action = decideBootAction(saved, JSON.parse(input), process.cwd());
  } catch {
    action = "invalid";
  }
  if (action === "invalid" || action === "partial") {
    console.error(`[zappy-boot] ${action} PM2 snapshot or process list; inspect it before restoring`);
    process.exitCode = 1;
  } else {
    console.log(action);
  }
}
