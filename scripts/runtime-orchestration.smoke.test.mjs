import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("root bootstrap/start scripts no longer contain Python dependency handling", () => {
  const bootstrapSource = fs.readFileSync(bootstrapScript, "utf8");
  const startSource = fs.readFileSync(startScript, "utf8");
  const combined = `${bootstrapSource}\n${startSource}`;

  assert.equal(/pip install/iu.test(combined), false);
  assert.equal(/python\s+-m\s+venv/iu.test(combined), false);
  assert.equal(/\.venv\/bin\/python/iu.test(combined), false);
  assert.equal(/source\s+[^\\n]*activate/iu.test(combined), false);
});
