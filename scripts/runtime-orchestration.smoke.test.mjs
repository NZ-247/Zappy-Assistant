import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
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

const createResolverModule = (rootDir, moduleName) => {
  const moduleDir = path.join(rootDir, "infra", "external-services", moduleName);
  writeExecutable(
    path.join(moduleDir, "scripts", "bootstrap.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'pwd > ".bootstrap-cwd.log"',
      `echo "[${moduleName}][bootstrap] ok"`
    ].join("\n")
  );
  writeExecutable(
    path.join(moduleDir, "scripts", "run.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'pwd >> ".run-cwd.log"',
      `echo "[${moduleName}][run] ok"`
    ].join("\n")
  );
  return moduleDir;
};

const createTempProject = (options = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "zappy-runtime-smoke-"));
  const ytDir = createResolverModule(rootDir, "youtube-resolver");
  const fbDir = createResolverModule(rootDir, "facebook-resolver");

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

const createFakeTmux = (rootDir, initialState) => {
  const binDir = path.join(rootDir, ".fake-bin");
  const statePath = path.join(rootDir, ".fake-tmux-state.json");
  fs.mkdirSync(binDir, { recursive: true });

  const defaultState = {
    sessions: {},
    commands: [],
    signals: []
  };
  fs.writeFileSync(statePath, JSON.stringify(initialState ?? defaultState, null, 2), "utf8");

  writeExecutable(
    path.join(binDir, "tmux"),
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const { spawnSync } = require("node:child_process");',
      "",
      "const args = process.argv.slice(2);",
      "const stateFile = process.env.FAKE_TMUX_STATE;",
      "if (!stateFile) {",
      '  process.stderr.write("FAKE_TMUX_STATE missing\\n");',
      "  process.exit(2);",
      "}",
      "",
      "const loadState = () => {",
      "  if (!fs.existsSync(stateFile)) return { sessions: {}, commands: [], signals: [] };",
      "  try {",
      '    return JSON.parse(fs.readFileSync(stateFile, "utf8"));',
      "  } catch {",
      "    return { sessions: {}, commands: [], signals: [] };",
      "  }",
      "};",
      "",
      "const saveState = (state) => {",
      "  fs.mkdirSync(path.dirname(stateFile), { recursive: true });",
      '  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");',
      "};",
      "",
      "const state = loadState();",
      "state.sessions = state.sessions || {};",
      "state.commands = state.commands || [];",
      "state.signals = state.signals || [];",
      "",
      "const argValue = (flag) => {",
      "  const index = args.indexOf(flag);",
      '  return index >= 0 ? args[index + 1] || "" : "";',
      "};",
      "",
      "const parseTarget = (target) => {",
      "  const raw = String(target || \"\");",
      "  const [session, window] = raw.split(\":\");",
      '  return { session: session || "", window: window || "" };',
      "};",
      "",
      "const ensureSession = (sessionName) => {",
      "  if (!state.sessions[sessionName]) {",
      "    state.sessions[sessionName] = { windows: [] };",
      "  }",
      "  if (!Array.isArray(state.sessions[sessionName].windows)) {",
      "    state.sessions[sessionName].windows = [];",
      "  }",
      "  return state.sessions[sessionName];",
      "};",
      "",
      "const hasWindow = (sessionName, windowName) => {",
      "  const session = state.sessions[sessionName];",
      "  if (!session) return false;",
      "  return Array.isArray(session.windows) && session.windows.includes(windowName);",
      "};",
      "",
      "if (args[0] === \"-V\") {",
      '  process.stdout.write("tmux fake 1.0\\n");',
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === \"has-session\") {",
      "  const target = parseTarget(argValue(\"-t\")).session || argValue(\"-t\");",
      "  process.exit(state.sessions[target] ? 0 : 1);",
      "}",
      "",
      "if (args[0] === \"new-session\") {",
      "  const sessionName = argValue(\"-s\");",
      '  const windowName = argValue("-n") || "core";',
      "  if (!sessionName) process.exit(1);",
      "  const session = ensureSession(sessionName);",
      "  if (!session.windows.includes(windowName)) session.windows.push(windowName);",
      "  saveState(state);",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === \"list-windows\") {",
      "  const sessionName = parseTarget(argValue(\"-t\")).session || argValue(\"-t\");",
      "  const session = state.sessions[sessionName];",
      "  if (!session) process.exit(1);",
      "  process.stdout.write(session.windows.join(\"\\n\"));",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === \"new-window\") {",
      "  const target = argValue(\"-t\");",
      "  const sessionName = parseTarget(target).session || target;",
      '  const windowName = argValue("-n") || "core";',
      "  if (!sessionName) process.exit(1);",
      "  const session = ensureSession(sessionName);",
      "  if (!session.windows.includes(windowName)) session.windows.push(windowName);",
      "  saveState(state);",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === \"send-keys\") {",
      "  const target = parseTarget(argValue(\"-t\"));",
      "  if (!target.session || !target.window || !hasWindow(target.session, target.window)) {",
      '    process.stderr.write(`cannot_find_window: ${target.window || "unknown"}\\n`);',
      "    process.exit(1);",
      "  }",
      "  const startIndex = args.indexOf(\"-t\");",
      "  const keys = startIndex >= 0 ? args.slice(startIndex + 2) : [];",
      "  if (keys.includes(\"C-c\")) {",
      "    state.signals.push({ session: target.session, window: target.window, signal: \"C-c\" });",
      "  }",
      "  const command = keys.find((item) => item !== \"C-m\" && item !== \"C-c\");",
      "  if (command) {",
      "    state.commands.push({ session: target.session, window: target.window, command });",
      '    if (process.env.FAKE_TMUX_EXECUTE_SEND_KEYS === "1") {',
      "      spawnSync(\"bash\", [\"-lc\", command], {",
      "        env: process.env,",
      '        stdio: "ignore"',
      "      });",
      "    }",
      "  }",
      "  saveState(state);",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === \"kill-window\") {",
      "  const target = parseTarget(argValue(\"-t\"));",
      "  if (!target.session || !target.window || !state.sessions[target.session]) process.exit(1);",
      "  state.sessions[target.session].windows = state.sessions[target.session].windows.filter((item) => item !== target.window);",
      "  saveState(state);",
      "  process.exit(0);",
      "}",
      "",
      "process.exit(1);"
    ].join("\n")
  );

  const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
  return { binDir, statePath, readState };
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

test("start delegates to module run.sh using resolver cwd", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: "http://127.0.0.1:65530"
  });
  const fakeTmux = createFakeTmux(project.rootDir);

  const result = runNodeScript(startScript, ["dev", "--with-yt-resolver", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env: {
      PATH: `${fakeTmux.binDir}:${process.env.PATH || ""}`,
      FAKE_TMUX_STATE: fakeTmux.statePath,
      FAKE_TMUX_EXECUTE_SEND_KEYS: "1",
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "false",
      YT_RESOLVER_BASE_URL: "http://127.0.0.1:65530",
      FB_RESOLVER_BASE_URL: "http://127.0.0.1:65539"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const runLogPath = path.join(project.ytDir, ".run-cwd.log");
  assert.equal(fs.existsSync(runLogPath), true);
  assert.equal(fs.readFileSync(runLogPath, "utf8").trim(), project.ytDir);
  assert.match(toOutput(result), new RegExp(`action=run-delegate`));
  assert.match(toOutput(result), new RegExp(`cwd=${escapeRegex(project.ytDir)}`));
});

test("start --with-external-services selects only env-enabled resolvers", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: "http://127.0.0.1:65531",
    fbBaseUrl: "http://127.0.0.1:65532"
  });
  const fakeTmux = createFakeTmux(project.rootDir);

  const result = runNodeScript(startScript, ["dev", "--with-external-services", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env: {
      PATH: `${fakeTmux.binDir}:${process.env.PATH || ""}`,
      FAKE_TMUX_STATE: fakeTmux.statePath,
      FAKE_TMUX_EXECUTE_SEND_KEYS: "1",
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
  assert.equal(fs.existsSync(path.join(project.ytDir, ".run-cwd.log")), true);
  assert.equal(fs.existsSync(path.join(project.fbDir, ".run-cwd.log")), false);
});

test("tmux window creation uses deterministic resolver window names", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "true",
    ytBaseUrl: "http://127.0.0.1:65533",
    fbBaseUrl: "http://127.0.0.1:65534"
  });
  const fakeTmux = createFakeTmux(project.rootDir);

  const result = runNodeScript(startScript, ["dev", "--with-external-services", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env: {
      PATH: `${fakeTmux.binDir}:${process.env.PATH || ""}`,
      FAKE_TMUX_STATE: fakeTmux.statePath,
      FAKE_TMUX_EXECUTE_SEND_KEYS: "1",
      ZAPPY_SCRIPT_SMOKE_MODE: "1",
      YT_RESOLVER_ENABLED: "true",
      FB_RESOLVER_ENABLED: "true",
      YT_RESOLVER_BASE_URL: "http://127.0.0.1:65533",
      FB_RESOLVER_BASE_URL: "http://127.0.0.1:65534"
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const windows = (fakeTmux.readState().sessions?.zappy?.windows || []).slice().sort();
  assert.deepEqual(windows, ["core", "facebook", "youtube"]);
});

test("rerunning start does not duplicate healthy resolver windows", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 404;
    res.end("not_found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "false",
    ytBaseUrl: `http://127.0.0.1:${port}`
  });
  const fakeTmux = createFakeTmux(project.rootDir, {
    sessions: {
      zappy: {
        windows: ["core", "youtube"]
      }
    },
    commands: [],
    signals: []
  });

  const env = {
    PATH: `${fakeTmux.binDir}:${process.env.PATH || ""}`,
    FAKE_TMUX_STATE: fakeTmux.statePath,
    FAKE_TMUX_EXECUTE_SEND_KEYS: "1",
    ZAPPY_SCRIPT_SMOKE_MODE: "1",
    YT_RESOLVER_ENABLED: "true",
    FB_RESOLVER_ENABLED: "false",
    YT_RESOLVER_BASE_URL: `http://127.0.0.1:${port}`,
    FB_RESOLVER_BASE_URL: "http://127.0.0.1:65535"
  };

  const first = runNodeScript(startScript, ["dev", "--with-yt-resolver", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env
  });
  assert.equal(first.status, 0, toOutput(first));
  assert.match(toOutput(first), /status=already_running/);

  const second = runNodeScript(startScript, ["dev", "--with-yt-resolver", "--skip-resolver-healthcheck"], {
    projectRoot: project.rootDir,
    env
  });
  assert.equal(second.status, 0, toOutput(second));
  assert.match(toOutput(second), /status=already_running/);

  const windows = fakeTmux.readState().sessions.zappy.windows.filter((item) => item === "youtube");
  assert.equal(windows.length, 1);
  assert.equal(fs.existsSync(path.join(project.ytDir, ".run-cwd.log")), false);
});

test("stop closes only resolver windows marked as runtime_started", () => {
  const project = createTempProject({
    ytEnabled: "true",
    fbEnabled: "true"
  });
  const fakeTmux = createFakeTmux(project.rootDir, {
    sessions: {
      zappy: {
        windows: ["core", "youtube", "facebook"]
      }
    },
    commands: [],
    signals: []
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
        manager: "tmux",
        session: "zappy",
        windows: [
          {
            serviceName: "youtube-resolver",
            windowName: "youtube",
            ownership: "runtime_started"
          },
          {
            serviceName: "facebook-resolver",
            windowName: "facebook",
            ownership: "preexisting"
          }
        ]
      }
    }
  };

  const stateFile = path.join(project.rootDir, ".zappy-dev", "dev-stack.json");
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

  const result = runNodeScript(stopScript, ["dev", "--infra"], {
    projectRoot: project.rootDir,
    env: {
      PATH: `${fakeTmux.binDir}:${process.env.PATH || ""}`,
      FAKE_TMUX_STATE: fakeTmux.statePath
    }
  });

  assert.equal(result.status, 0, toOutput(result));
  const windows = fakeTmux.readState().sessions.zappy.windows.slice().sort();
  assert.deepEqual(windows, ["core", "facebook"]);
  assert.match(toOutput(result), /ownership=preexisting action=skip/);
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
