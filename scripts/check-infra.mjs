/**
 * check-infra.mjs — Lightweight prerequisite check for PM2 startup.
 *
 * Validates that Redis and PostgreSQL are reachable and that required
 * environment variables are present. Exits with code 1 on any failure.
 *
 * Designed to be fast (<3s) and free of heavy framework imports.
 * Run automatically via `npm run pm2:start:dev / pm2:start:prod`.
 */

import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Env loading (minimal dotenv-like, no npm dep needed) ─────────────────
const loadEnvFile = (filePath) => {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawVal = trimmed.slice(eqIndex + 1).trim();
    const val = rawVal.replace(/^(['"])(.*)\1$/, '$2');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
};

loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.local'));

// ─── Required env vars ────────────────────────────────────────────────────
const REQUIRED_VARS = ['DATABASE_URL', 'REDIS_URL', 'ADMIN_API_TOKEN'];
const OPTIONAL_WARN_VARS = ['OPENAI_API_KEY', 'WA_GATEWAY_INTERNAL_TOKEN'];

// ─── Helpers ──────────────────────────────────────────────────────────────
const ok  = (msg) => process.stdout.write(`  ✓  ${msg}\n`);
const fail = (msg) => process.stderr.write(`  ✗  ${msg}\n`);
const warn = (msg) => process.stdout.write(`  ⚠  ${msg}\n`);
const head = (msg) => process.stdout.write(`\n${msg}\n`);

/** Parse host + port from a URL string. Returns null on parse failure. */
const parseHostPort = (urlStr) => {
  try {
    const u = new URL(urlStr);
    const host = u.hostname || '127.0.0.1';
    const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'rediss:' ? 6380 : u.protocol === 'redis:' ? 6379 : 5432);
    return { host, port };
  } catch {
    return null;
  }
};

/** Probe a TCP port. Resolves true if connected within timeoutMs, false otherwise. */
const probeTcp = (host, port, timeoutMs = 3000) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

// ─── Checks ───────────────────────────────────────────────────────────────
let exitCode = 0;

const checkEnvVars = () => {
  head('[1/3] Environment variables');
  let allPresent = true;
  for (const key of REQUIRED_VARS) {
    if (process.env[key]) {
      ok(`${key} is set`);
    } else {
      fail(`${key} is MISSING (required)`);
      allPresent = false;
    }
  }
  for (const key of OPTIONAL_WARN_VARS) {
    if (!process.env[key]) {
      warn(`${key} is not set (optional — some features will be disabled)`);
    }
  }
  if (!allPresent) exitCode = 1;
};

const checkRedis = async () => {
  head('[2/3] Redis');
  const url = process.env.REDIS_URL;
  if (!url) {
    fail('REDIS_URL not set — skipping TCP probe');
    exitCode = 1;
    return;
  }
  const parsed = parseHostPort(url);
  if (!parsed) {
    fail(`Cannot parse REDIS_URL: ${url}`);
    exitCode = 1;
    return;
  }
  const reachable = await probeTcp(parsed.host, parsed.port);
  if (reachable) {
    ok(`Redis reachable at ${parsed.host}:${parsed.port}`);
  } else {
    fail(`Redis NOT reachable at ${parsed.host}:${parsed.port} — start Redis or Docker infra first`);
    exitCode = 1;
  }
};

const checkPostgres = async () => {
  head('[3/3] PostgreSQL');
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail('DATABASE_URL not set — skipping TCP probe');
    exitCode = 1;
    return;
  }
  const parsed = parseHostPort(url);
  if (!parsed) {
    fail(`Cannot parse DATABASE_URL: ${url}`);
    exitCode = 1;
    return;
  }
  const reachable = await probeTcp(parsed.host, parsed.port || 5432);
  if (reachable) {
    ok(`PostgreSQL reachable at ${parsed.host}:${parsed.port || 5432}`);
  } else {
    fail(`PostgreSQL NOT reachable at ${parsed.host}:${parsed.port || 5432} — start Postgres or Docker infra first`);
    exitCode = 1;
  }
};

// ─── Run ──────────────────────────────────────────────────────────────────
process.stdout.write('\nZappy Assistant — Infrastructure Precheck\n');
process.stdout.write('─'.repeat(44) + '\n');

checkEnvVars();
await checkRedis();
await checkPostgres();

process.stdout.write('\n');

if (exitCode !== 0) {
  process.stderr.write('Precheck FAILED — fix the issues above before starting PM2.\n\n');
  process.exit(1);
} else {
  process.stdout.write('Precheck PASSED — all infrastructure dependencies are reachable.\n\n');
}
