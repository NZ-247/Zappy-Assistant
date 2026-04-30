'use strict';

/**
 * PM2 Production Ecosystem — Zappy Assistant
 *
 * Runs compiled output (node dist/...) instead of tsx watch.
 * Run `npm run build` before starting.
 *
 * Usage:
 *   npm run pm2:start:prod    Start all services (prod)
 *   npm run pm2:stop          Stop all services
 *   npm run pm2:restart       Restart all services
 *   pm2 restart wa-gateway    Restart a single service
 *
 * Boot persistence: run `pm2 save && pm2 startup` once per host.
 */

const ROOT = __dirname;

const prodEnv = {
  NODE_ENV: 'production',
  ZAPPY_RUNTIME_MODE: 'prod',
};

module.exports = {
  apps: [
    {
      name: 'admin-api',
      cwd: ROOT,
      script: 'npm',
      args: 'run start -w @zappy/admin-api',
      watch: false,
      autorestart: true,
      min_uptime: 10000,
      restart_delay: 4000,
      max_restarts: 15,
      kill_timeout: 8000,
      wait_ready: true,
      listen_timeout: 20000,
      env: prodEnv,
    },
    {
      name: 'wa-gateway',
      cwd: ROOT,
      script: 'npm',
      args: 'run start -w @zappy/wa-gateway',
      watch: false,
      autorestart: true,
      min_uptime: 15000,
      restart_delay: 6000,
      max_restarts: 10,
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 25000,
      env: prodEnv,
    },
    {
      name: 'worker',
      cwd: ROOT,
      script: 'npm',
      args: 'run start -w @zappy/worker',
      watch: false,
      autorestart: true,
      min_uptime: 10000,
      restart_delay: 4000,
      max_restarts: 20,
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 15000,
      instances: 1,
      exec_mode: 'fork',
      env: prodEnv,
    },
    {
      name: 'admin-ui',
      cwd: ROOT,
      script: 'npm',
      args: 'run start -w @zappy/admin-ui',
      watch: false,
      autorestart: true,
      min_uptime: 8000,
      restart_delay: 3000,
      max_restarts: 20,
      kill_timeout: 6000,
      wait_ready: true,
      listen_timeout: 15000,
      env: prodEnv,
    },
    {
      name: 'media-resolver',
      cwd: ROOT,
      script: 'npm',
      args: 'run start -w @zappy/media-resolver-api',
      watch: false,
      autorestart: true,
      min_uptime: 8000,
      restart_delay: 4000,
      max_restarts: 20,
      kill_timeout: 6000,
      wait_ready: true,
      listen_timeout: 15000,
      env: prodEnv,
    },
  ],
};
