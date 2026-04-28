'use strict';

/**
 * PM2 Dev Ecosystem — Zappy Assistant
 *
 * Use for local development with tsx watch (hot-reload).
 * Services: admin-api, wa-gateway, worker, admin-ui, media-resolver-api
 *
 * IMPORTANT: admin-api is canonical for local dev and PM2.
 *   assistant-api is Docker-only (see infra/docker-compose.yml).
 *   Both cannot run simultaneously — they share ADMIN_API_PORT.
 *
 * Usage:
 *   npm run pm2:start:dev     Start all services (dev)
 *   npm run pm2:stop          Stop all services
 *   npm run pm2:restart       Restart all services
 *   npm run pm2:logs          Tail all logs
 *   npm run pm2:status        Show process table
 *   pm2 restart admin-api     Restart a single service
 *
 * Prerequisites: npm i -g pm2
 * Infra precheck: npm run pm2:check-infra (validates Redis/Postgres before start)
 */

const ROOT = __dirname;

/** Shared env block for all dev processes */
const devEnv = {
  NODE_ENV: 'development',
  ZAPPY_RUNTIME_MODE: 'dev',
};

module.exports = {
  apps: [
    // ────────────────────────────────────────────────────────────
    // Admin API  (canonical control-plane for local dev + PM2)
    // Serves: /admin/*, /admin/v1/*, /health
    // Port: ADMIN_API_PORT (default 3333)
    // ────────────────────────────────────────────────────────────
    {
      name: 'admin-api',
      cwd: ROOT,
      script: 'npm',
      args: 'run dev -w @zappy/admin-api',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 15,
      kill_timeout: 6000,
      wait_ready: true,
      listen_timeout: 20000,
      env: devEnv,
    },

    // ────────────────────────────────────────────────────────────
    // WA Gateway  (WhatsApp session — singleton, cannot scale)
    // Port: WA_GATEWAY_INTERNAL_PORT (default 3334)
    // Note: wait_ready fires after the internal dispatch API binds,
    //       not after WhatsApp connection (that's long-running async).
    // ────────────────────────────────────────────────────────────
    {
      name: 'wa-gateway',
      cwd: ROOT,
      script: 'npm',
      args: 'run dev -w @zappy/wa-gateway',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      kill_timeout: 8000,
      wait_ready: true,
      listen_timeout: 20000,
      env: devEnv,
    },

    // ────────────────────────────────────────────────────────────
    // Worker  (BullMQ consumer for reminders + timers)
    // Horizontally scalable: add instances > 1 if job backlog grows.
    // ────────────────────────────────────────────────────────────
    {
      name: 'worker',
      cwd: ROOT,
      script: 'npm',
      args: 'run dev -w @zappy/worker',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      kill_timeout: 8000,
      wait_ready: true,
      listen_timeout: 15000,
      instances: 1,
      exec_mode: 'fork',
      env: devEnv,
    },

    // ────────────────────────────────────────────────────────────
    // Admin UI  (static SPA + reverse proxy to admin-api)
    // Port: ADMIN_UI_PORT (default 8080)
    // Proxy target: ADMIN_API_BASE_URL (defaults to admin-api:3333)
    // ────────────────────────────────────────────────────────────
    {
      name: 'admin-ui',
      cwd: ROOT,
      script: 'npm',
      args: 'run dev -w @zappy/admin-ui',
      watch: false,
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 20,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
      env: devEnv,
    },

    // ────────────────────────────────────────────────────────────
    // Media Resolver API  (download pipeline sidecar)
    // Port: MEDIA_RESOLVER_API_PORT (default 3335)
    // ────────────────────────────────────────────────────────────
    {
      name: 'media-resolver',
      cwd: ROOT,
      script: 'npm',
      args: 'run dev -w @zappy/media-resolver-api',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
      env: devEnv,
    },
  ],
};
