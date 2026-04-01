import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bootstrapScript = path.join(repoRoot, "scripts", "bootstrap.mjs");
const startScript = path.join(repoRoot, "scripts", "start.mjs");
const stopScript = path.join(repoRoot, "scripts", "stop.mjs");

const toOutput = (result) => `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const writeExecutable = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  fs.chmodSync(filePath, 0o755);
};

const defaultBootstrapScript = (moduleName) =>
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'pwd > ".bootstrap-cwd.log"',
    `echo "[${moduleName}][bootstrap] ok"`
  ].join("\n");

const defaultRunScript = (moduleName) =>
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'pwd >> ".run-cwd.log"',
    `echo "[${moduleName}][run] ok"`
  ].join("\n");

const defaultStopScript = (moduleName) =>
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'pwd > ".stop-cwd.log"',
    `echo "[${moduleName}][stop] ok"`
  ].join("\n");

const createResolverModule = (rootDir, moduleName, options = {}) => {
  const moduleDir = path.join(rootDir, "infra", "external-services", moduleName);
  const scriptsDir = path.join(moduleDir, "scripts");

  writeExecutable(path.join(scriptsDir, "bootstrap.sh"), options.bootstrapScript ?? defaultBootstrapScript(moduleName));

  if (options.createRunScript !== false) {
    writeExecutable(path.join(scriptsDir, "run.sh"), options.runScript ?? defaultRunScript(moduleName));
  }

  if (options.createStopScript) {
    writeExecutable(path.join(scriptsDir, "stop.sh"), options.stopScript ?? defaultStopScript(moduleName));
  }

  return moduleDir;
};

const createTempProject = (options = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "zappy-runtime-smoke-"));

  const ytDir = createResolverModule(rootDir, "youtube-resolver", options.ytModule ?? {});
  const fbDir = createResolverModule(rootDir, "facebook-resolver", options.fbModule ?? {});

  fs.mkdirSync(path.join(rootDir, ".zappy-dev"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "infra"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "infra", "docker-compose.yml"), "services: {}\n", "utf8");

  const ytEnabled = options.ytEnabled ?? "true";
  const fbEnabled = options.fbEnabled ?? "true";
  const ytBaseUrl = options.ytBaseUrl ?? "http://127.0.0.1:3401";
  const fbBaseUrl = options.fbBaseUrl ?? "http://127.0.0.1:3402";
  fs.writeFileSync(
    path.join(rootDir, ".env"),
    [
      `YT_RESOLVER_ENABLED=${ytEnabled}`,
      `FB_RESOLVER_ENABLED=${fbEnabled}`,
      `YT_RESOLVER_BASE_URL=${ytBaseUrl}`,
      `FB_RESOLVER_BASE_URL=${fbBaseUrl}`
    ].join("\n") + "\n",
    "utf8"
  );

  return { rootDir, ytDir, fbDir };
};

const runNodeScript = (scriptPath, args, options) => {
  const env = {
    ...process.env,
    ...options.env,
    ZAPPY_PROJECT_ROOT: options.projectRoot
  };

  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env
  });
};

const waitForFile = async (filePath, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = spawnSync(process.execPath, [
      "-e",
      'const net=require("node:net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{const a=s.address(); process.stdout.write(String((a&&typeof a==="object")?a.port:0)); s.close(()=>process.exit(0));});'
    ], {
      encoding: "utf8"
    });

    if (server.status !== 0) {
      reject(new Error(server.stderr || server.stdout || "port_probe_failed"));
      return;
    }

    const port = Number((server.stdout || "").trim());
    if (!Number.isInteger(port) || port <= 0) {
      reject(new Error("invalid_port_probe"));
      return;
    }
    resolve(port);
  });

const waitForHealth = async (endpoint, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return true;
    } catch {
      /* keep waiting */
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
};

const probeTcpPort = (port, timeoutMs = 600) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });

const waitForTcpPort = async (port, timeoutMs = 3500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await probeTcpPort(port, 250)) return true;
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  return false;
};

const waitForTcpPortClosed = async (port, timeoutMs = 3500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!(await probeTcpPort(port, 250))) return true;
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  return false;
};

const startDetachedPortServer = async ({ port, marker = "smoke-marker" }) => {
  const serverScript =
    'const net=require("node:net"); const port=Number(process.argv[1]); const marker=String(process.argv[2]||"marker"); const s=net.createServer(); s.listen(port,"127.0.0.1"); process.on("SIGTERM",()=>s.close(()=>process.exit(0))); setInterval(()=>{ if (!marker) process.stdout.write(""); }, 1000);';
  const child = spawn(process.execPath, ["-e", serverScript, String(port), marker], {
    stdio: "ignore",
    detached: true
  });
  child.unref();

  const ready = await waitForTcpPort(port, 3000);
  if (!ready) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    throw new Error("detached_tcp_server_not_ready");
  }

  return {
    pid: child.pid,
    stop: () => {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  };
};

const allocateRootServicePorts = async () => {
  const adminUiPort = await getFreePort();
  const assistantApiPort = await getFreePort();
  const waGatewayPort = await getFreePort();
  const mediaResolverPort = await getFreePort();

  return {
    ADMIN_UI_PORT: String(adminUiPort),
    ADMIN_API_PORT: String(assistantApiPort),
    WA_GATEWAY_INTERNAL_PORT: String(waGatewayPort),
    MEDIA_RESOLVER_API_PORT: String(mediaResolverPort),
    values: {
      adminUiPort,
      assistantApiPort,
      waGatewayPort,
      mediaResolverPort
    }
  };
};

const startDetachedHealthServer = async () => {
  const port = await getFreePort();
  const serverScript =
    'const http=require("node:http"); const port=Number(process.argv[1]); const server=http.createServer((req,res)=>{ if(req.url==="/health"){ res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({ok:true})); return; } res.statusCode=404; res.end("not_found");}); server.listen(port,"127.0.0.1"); process.on("SIGTERM",()=>server.close(()=>process.exit(0)));';
  const child = spawn(process.execPath, ["-e", serverScript, String(port)], {
    stdio: "ignore",
    detached: true
  });
  child.unref();

  const ready = await waitForHealth(`http://127.0.0.1:${port}/health`, 3500);
  if (!ready) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    throw new Error("detached_health_server_not_ready");
  }

  return {
    port,
    stop: () => {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  };
};

test("bootstrap delegates to module bootstrap.sh using resolver cwd", () => {
  const project = createTempProject();
  const result = runNodeScript(bootstrapScript, ["dev", "--infra", "--with-yt-resolver"], {
    projectRoot: project.rootDir,
    env: {}
  });

  assert.equal(result.status, 0, toOutput(result));
  const bootstrapLogPath = path.join(project.ytDir, ".bootstrap-cwd.log");
  assert.equal(fs.existsSync(bootstrapLogPath), true);
  assert.equal(fs.readFileSync(bootstrapLogPath, "utf8").trim(), project.ytDir);
  assert.match(
    toOutput(result),
    new RegExp(`resolver=youtube-resolver cwd=${escapeRegex(project.ytDir)} action=bootstrap-delegate`)
  );
});

test("start logs already_running and skips delegation when resolver health is already ok", async (t) => {
  const healthy = await startDetachedHealthServer();
  t.after(() => healthy.stop());

  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: `http://127.0.0.1:${healthy.port}`
  });

  const result = runNodeScript(startScript, ["dev", "--with-yt-resolver"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "false",
      YT_RESOLVER_BASE_URL: `http://127.0.0.1:${healthy.port}`,
      FB_RESOLVER_BASE_URL: "http://127.0.0.1:65539"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(output, /phase=health-before .*status=ok/);
  assert.match(output, /phase=run-skip .*reason=health_ok_already_running/);
  assert.equal(fs.existsSync(path.join(project.ytDir, ".run-cwd.log")), false);
});

test("start delegates to module run.sh using resolver cwd and validates post-run health", async () => {
  const runScriptWithHealthServer = `#!/usr/bin/env bash
set -euo pipefail
pwd >> ".run-cwd.log"
PORT="$(node -e 'const u=new URL(process.env.YT_RESOLVER_BASE_URL||"http://127.0.0.1:3401"); process.stdout.write(String(u.port || 3401));')"
exec node -e 'const http=require("node:http"); const port=Number(process.argv[1]); const server=http.createServer((req,res)=>{ if (req.url==="/health") { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({ok:true})); return; } res.statusCode=404; res.end("not_found");}); server.listen(port,"127.0.0.1"); setTimeout(()=>server.close(()=>process.exit(0)), 12000);' "$PORT"
`;

  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: "http://127.0.0.1:65530",
    ytModule: {
      runScript: runScriptWithHealthServer
    }
  });

  const result = runNodeScript(startScript, ["dev", "--with-yt-resolver"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "false",
      YT_RESOLVER_BASE_URL: "http://127.0.0.1:65530",
      FB_RESOLVER_BASE_URL: "http://127.0.0.1:65539"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const runLogPath = path.join(project.ytDir, ".run-cwd.log");
  assert.equal(await waitForFile(runLogPath), true, toOutput(result));
  assert.equal(fs.readFileSync(runLogPath, "utf8").trim(), project.ytDir);

  const output = toOutput(result);
  assert.match(output, /phase=health-before .*status=fail/);
  assert.match(output, new RegExp(`phase=run-delegate .*cwd=${escapeRegex(project.ytDir)}`));
  assert.match(output, /phase=health-after .*status=ok/);
});

test("start --with-external-services selects only env-enabled resolvers", async () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: "http://127.0.0.1:65531",
    fbBaseUrl: "http://127.0.0.1:65532"
  });

  const result = runNodeScript(startScript, ["dev", "--with-external-services", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "false",
      YT_RESOLVER_BASE_URL: "http://127.0.0.1:65531",
      FB_RESOLVER_BASE_URL: "http://127.0.0.1:65532"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(output, /phase=selection .*selected=youtube-resolver/);
  assert.match(output, /phase=selection .*facebook-resolver:disabled_by_env/);
  assert.equal(await waitForFile(path.join(project.ytDir, ".run-cwd.log")), true);
  assert.equal(fs.existsSync(path.join(project.fbDir, ".run-cwd.log")), false);
});

test("start reports missing_run_script clearly", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytModule: {
      createRunScript: false
    }
  });

  const result = runNodeScript(startScript, ["dev", "--with-yt-resolver", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "false"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  assert.match(toOutput(result), /phase=run-skip .*reason=missing_run_script/);
});

test("stop delegates resolver stop when scripts/stop.sh exists", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytModule: {
      createStopScript: true
    }
  });

  const state = {
    mode: "dev",
    supervisorPid: 999999,
    startedAt: new Date().toISOString(),
    services: [],
    infra: {
      mode: "auto",
      dependencies: [],
      managedServicesStarted: [],
      resolvers: {
        manager: "module_delegate",
        modules: [
          {
            serviceName: "youtube-resolver",
            moduleDir: project.ytDir,
            stopScriptPath: path.join(project.ytDir, "scripts", "stop.sh"),
            ownership: "runtime_delegated"
          }
        ]
      }
    }
  };

  const stateFile = path.join(project.rootDir, ".zappy-dev", "dev-stack.json");
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

  const result = runNodeScript(stopScript, ["dev", "--infra"], {
    projectRoot: project.rootDir,
    env: {}
  });

  assert.equal(result.status, 0, toOutput(result));
  const stopLogPath = path.join(project.ytDir, ".stop-cwd.log");
  assert.equal(fs.existsSync(stopLogPath), true);
  assert.equal(fs.readFileSync(stopLogPath, "utf8").trim(), project.ytDir);
  assert.match(toOutput(result), /phase=module-stop .*action=delegate/);
  assert.match(toOutput(result), /phase=module-stop .*action=ok/);
});

test("stop reports missing_stop_script as manual/non-delegated", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false"
  });

  const state = {
    mode: "dev",
    supervisorPid: 999999,
    startedAt: new Date().toISOString(),
    services: [],
    infra: {
      mode: "auto",
      dependencies: [],
      managedServicesStarted: [],
      resolvers: {
        manager: "module_delegate",
        modules: [
          {
            serviceName: "youtube-resolver",
            moduleDir: project.ytDir,
            ownership: "runtime_delegated"
          }
        ]
      }
    }
  };

  const stateFile = path.join(project.rootDir, ".zappy-dev", "dev-stack.json");
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

  const result = runNodeScript(stopScript, ["dev", "--infra"], {
    projectRoot: project.rootDir,
    env: {}
  });

  assert.equal(result.status, 0, toOutput(result));
  assert.match(toOutput(result), /phase=module-stop .*reason=missing_stop_script .*manual=required/);
});

test("start precheck marks already_running_same_service and skips duplicate root spawn", async (t) => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const holder = await startDetachedPortServer({
    port: ports.values.adminUiPort,
    marker: "@zappy/admin-ui"
  });
  t.after(() => holder.stop());

  const result = runNodeScript(startScript, ["dev"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      ZAPPY_SCRIPT_SMOKE_INCLUDE_APP_PRECHECK: "1",
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(
    output,
    new RegExp(`\\[app-precheck\\] service=admin-ui port=${ports.values.adminUiPort} status=already_running_same_service`)
  );
  assert.match(output, /\[app-start-skip\] service=admin-ui reason=already_running_same_service/);
});

test("start precheck fails on unknown process occupying a root app port", async (t) => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const holder = await startDetachedPortServer({
    port: ports.values.assistantApiPort,
    marker: "unrelated-process"
  });
  t.after(() => holder.stop());

  const result = runNodeScript(startScript, ["dev"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      ZAPPY_SCRIPT_SMOKE_INCLUDE_APP_PRECHECK: "1",
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.notEqual(result.status, 0, toOutput(result));
  assert.match(
    toOutput(result),
    new RegExp(`\\[app-precheck\\] service=assistant-api port=${ports.values.assistantApiPort} status=port_conflict_unknown_process`)
  );
});

test("stop reconciles root app ports with already_stopped vs still_busy_unknown_process statuses", async (t) => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const holder = await startDetachedPortServer({
    port: ports.values.assistantApiPort,
    marker: "unknown-holder"
  });
  t.after(() => holder.stop());

  const stateFile = path.join(project.rootDir, ".zappy-dev", "dev-stack.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        mode: "dev",
        supervisorPid: 999999,
        startedAt: new Date().toISOString(),
        services: []
      },
      null,
      2
    ),
    "utf8"
  );

  const result = runNodeScript(stopScript, ["dev"], {
    projectRoot: project.rootDir,
    env: {
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(
    output,
    new RegExp(
      `\\[stop-reconcile\\] service=assistant-api port=${ports.values.assistantApiPort} status=port_still_busy_unknown_process`
    )
  );
  assert.match(output, new RegExp(`\\[stop-reconcile\\] service=admin-ui port=${ports.values.adminUiPort} status=already_stopped`));
});

test("stop --cleanup-ports terminates confidently-classified zappy leftovers on root app ports", async (t) => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const holder = await startDetachedPortServer({
    port: ports.values.waGatewayPort,
    marker: "@zappy/wa-gateway"
  });
  t.after(() => holder.stop());

  const result = runNodeScript(stopScript, ["dev", "--cleanup-ports"], {
    projectRoot: project.rootDir,
    env: {
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(output, /\[cleanup\] phase=scan_started/);
  assert.match(
    output,
    new RegExp(
      `\\[cleanup\\] phase=owner service=wa-gateway port=${ports.values.waGatewayPort} pid=\\d+ classification=confident_zappy_runtime_leftover`
    )
  );
  assert.match(
    output,
    new RegExp(`\\[cleanup\\] phase=signal_sent service=wa-gateway port=${ports.values.waGatewayPort} pid=\\d+ signal=SIG(INT|TERM|KILL)`)
  );
  assert.match(output, new RegExp(`\\[cleanup\\] phase=port service=wa-gateway port=${ports.values.waGatewayPort} status=cleared`));
  assert.equal(await waitForTcpPortClosed(ports.values.waGatewayPort, 3500), true, toOutput(result));
});

test("stop --cleanup-ports skips non-zappy process owners safely", async (t) => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const holder = await startDetachedPortServer({
    port: ports.values.assistantApiPort,
    marker: "unrelated-process"
  });
  t.after(() => holder.stop());

  const result = runNodeScript(stopScript, ["dev", "--cleanup-ports"], {
    projectRoot: project.rootDir,
    env: {
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(
    output,
    new RegExp(
      `\\[cleanup\\] phase=owner service=assistant-api port=${ports.values.assistantApiPort} pid=\\d+ classification=non_zappy_or_uncertain`
    )
  );
  assert.match(
    output,
    new RegExp(`\\[cleanup\\] phase=skip service=assistant-api port=${ports.values.assistantApiPort} pid=\\d+ status=skipped_non_zappy_process`)
  );
  assert.match(output, new RegExp(`\\[cleanup\\] phase=port service=assistant-api port=${ports.values.assistantApiPort} status=still_busy`));
  assert.equal(await probeTcpPort(ports.values.assistantApiPort, 500), true);
});

test("start clears stale state and still runs port precheck reconciliation", async () => {
  const project = createTempProject();
  const ports = await allocateRootServicePorts();
  const stateFile = path.join(project.rootDir, ".zappy-dev", "dev-stack.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        mode: "dev",
        supervisorPid: 999999,
        startedAt: new Date().toISOString(),
        services: [{ name: "assistant-api", pid: 999999 }]
      },
      null,
      2
    ),
    "utf8"
  );

  const result = runNodeScript(startScript, ["dev"], {
    projectRoot: project.rootDir,
    env: {
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      ZAPPY_SCRIPT_SMOKE_INCLUDE_APP_PRECHECK: "1",
      ADMIN_UI_PORT: ports.ADMIN_UI_PORT,
      ADMIN_API_PORT: ports.ADMIN_API_PORT,
      WA_GATEWAY_INTERNAL_PORT: ports.WA_GATEWAY_INTERNAL_PORT,
      MEDIA_RESOLVER_API_PORT: ports.MEDIA_RESOLVER_API_PORT
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const output = toOutput(result);
  assert.match(output, /\[state\] mode=dev status=stale_pid_state_cleared/);
  assert.match(
    output,
    new RegExp(`\\[app-precheck\\] service=assistant-api port=${ports.values.assistantApiPort} status=ready_to_start`)
  );
});

test("redis source selection logs are explicit in auto/external/managed flows", () => {
  const runWithInfra = (infraMode, dependencyOverrides) => {
    const project = createTempProject();
    return runNodeScript(startScript, ["dev", `--infra=${infraMode}`], {
      projectRoot: project.rootDir,
      env: {
        ZAPPY_SCRIPT_SMOKE_MODE: "1",
        ZAPPY_SCRIPT_SMOKE_DEPENDENCIES_JSON: JSON.stringify(dependencyOverrides)
      }
    });
  };

  const autoResult = runWithInfra("auto", {
    postgres: {
      source: "external_host",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "select_1_ok"
    },
    redis: {
      source: "external_host",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "ping_pong",
      redisVersion: "6.0.16",
      redisMinVersionRecommended: false
    }
  });
  assert.equal(autoResult.status, 0, toOutput(autoResult));
  assert.match(
    toOutput(autoResult),
    /\[deps\] service=redis source=external_host version=6\.0\.16 selected_by=auto_mode warning=min_version_recommended/
  );

  const externalResult = runWithInfra("external", {
    postgres: {
      source: "external_host",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "select_1_ok"
    },
    redis: {
      source: "external_host",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "ping_pong",
      redisVersion: "6.0.16",
      redisMinVersionRecommended: false
    }
  });
  assert.equal(externalResult.status, 0, toOutput(externalResult));
  assert.match(
    toOutput(externalResult),
    /\[deps\] service=redis source=external_host version=6\.0\.16 selected_by=external_mode warning=min_version_recommended/
  );

  const managedResult = runWithInfra("managed", {
    postgres: {
      source: "compose_managed",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "select_1_ok"
    },
    redis: {
      source: "compose_managed",
      usable: true,
      tcpOpen: true,
      serviceCheckOk: true,
      serviceCheckReason: "ping_pong",
      redisVersion: "7.2.4",
      redisMinVersionRecommended: true
    }
  });
  assert.equal(managedResult.status, 0, toOutput(managedResult));
  assert.match(toOutput(managedResult), /\[deps\] service=redis source=compose_managed version=7\.2\.4 selected_by=managed_mode/);
});

test("root bootstrap/start scripts no longer contain Python dependency handling", () => {
  const bootstrapSource = fs.readFileSync(bootstrapScript, "utf8");
  const startSource = fs.readFileSync(startScript, "utf8");
  const combined = `${bootstrapSource}\n${startSource}`;

  assert.equal(/pip install/iu.test(combined), false);
  assert.equal(/python\s+-m\s+venv/iu.test(combined), false);
  assert.equal(/\.venv\/bin\/python/iu.test(combined), false);
  assert.equal(/source\s+[^\\n]*activate/iu.test(combined), false);
});
