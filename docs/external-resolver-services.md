# External Resolver Services (YouTube/Facebook)

This runbook defines the root-vs-module runtime boundary for vendored resolver services.

## Location

- `infra/external-services/youtube-resolver`
- `infra/external-services/facebook-resolver`

These are intentionally outside `apps/*` and `packages/*` and are not npm workspaces.

## Boundary and flow

`wa-gateway` delegates `/dl` to `media-resolver-api`.

`media-resolver-api` keeps the normalized provider pipeline:

1. `detect`
2. `probe`
3. `resolveAsset`
4. `download`
5. `normalizeForWhatsApp`

Auxiliary resolvers are bridge targets only. Raw external payloads are normalized in `media-resolver-api`.

## Host prerequisites (setup once)

- Node/npm dependencies installed at repo root.
- `docker` + Compose available if you run `--infra=auto|managed` for Redis/Postgres.
- Python available for resolver modules (`python3` on `PATH`) so module `scripts/bootstrap.sh` can prepare `.venv`.
- `ffmpeg` installed for Facebook resolver extraction/merge flows.

Initialize vendored resolver sources if needed:

```bash
git submodule update --init --recursive infra/external-services/youtube-resolver infra/external-services/facebook-resolver
```

## Environment configuration

Main bridge flags:

- `DOWNLOADS_PROVIDER_YT_ENABLED`
- `DOWNLOADS_PROVIDER_FB_ENABLED`
- `YT_RESOLVER_ENABLED`
- `YT_RESOLVER_BASE_URL`
- `YT_RESOLVER_TOKEN`
- `YT_RESOLVER_TIMEOUT_MS`
- `YT_RESOLVER_MAX_BYTES`
- `FB_RESOLVER_ENABLED`
- `FB_RESOLVER_BASE_URL`
- `FB_RESOLVER_TOKEN`
- `FB_RESOLVER_TIMEOUT_MS`
- `FB_RESOLVER_MAX_BYTES`

## Service ports

Core runtime defaults:

- PostgreSQL: `5432`
- Redis: `6379`
- `assistant-api`: `3333` (`ADMIN_API_PORT`)
- `wa-gateway` internal endpoint: `3334` (`WA_GATEWAY_INTERNAL_PORT`)
- `media-resolver-api`: `3335` (`MEDIA_RESOLVER_API_PORT`)
- `admin-ui`: `8080` (`ADMIN_UI_PORT`)

Resolver defaults (from `*_RESOLVER_BASE_URL`):

- YouTube resolver: `3401`
- Facebook resolver: `3402`

## What bootstrap does

One-time host prep:

```bash
npm run bootstrap:dev -- --infra
# or
npm run bootstrap:prod -- --infra
```

Root `scripts/bootstrap.mjs` is selection + delegation only:

- selects resolver modules by flags/env
- calls module `scripts/bootstrap.sh` with module-local `cwd`
- logs selected/skipped modules and delegation result

Root bootstrap does not run root-level `pip`/`venv` logic.

Direct module bootstrap remains available:

```bash
./infra/external-services/youtube-resolver/scripts/bootstrap.sh
./infra/external-services/facebook-resolver/scripts/bootstrap.sh
```

## What start does

Start normal stack:

```bash
npm run start:dev -- --infra=auto
```

Start with resolver delegation:

```bash
npm run start:dev -- --infra=auto --with-external-services
# or per service
npm run start:dev -- --with-yt-resolver
npm run start:dev -- --with-fb-resolver
```

Root `scripts/start.mjs` is validator/delegator for resolvers:

- resolver selection logging (`selected` / `skipped`)
- health check before delegation (`GET /health`)
- if health is already OK: logs `health_ok_already_running` and skips duplicate startup
- if unhealthy: delegates exactly to module entrypoint (`cd <module-dir> && bash scripts/run.sh`)
- re-checks health after delegation and logs result

Root start does not recreate module internals (`.venv`, `pip`, uvicorn/tmux specifics).

## What module `scripts/run.sh` owns

Each resolver module owns its runtime internals, such as:

- process manager choice (foreground/background/tmux/screen)
- Python environment activation
- uvicorn/flask/gunicorn runtime command
- module-specific retries/waits/restarts

Contract expected by root and bridge:

- `GET /health`
- `POST /resolve`

## Stop behavior

Stop app services only:

```bash
npm run stop:dev
```

Stop runtime-owned infra/delegated resolver resources:

```bash
npm run stop:dev -- --infra
```

Resolver stop delegation rules:

- if resolver state is `runtime_delegated` and module has `scripts/stop.sh`, root delegates stop with module-local `cwd`
- if `scripts/stop.sh` is missing, root logs `missing_stop_script` and reports manual/non-delegated stop
- external host/container dependencies are never stopped by resolver stop flow

## Health checks

```bash
curl -H "Authorization: Bearer ${YT_RESOLVER_TOKEN}" http://localhost:3401/health
curl -H "Authorization: Bearer ${FB_RESOLVER_TOKEN}" http://localhost:3402/health
```

If tokens are empty, omit the header.

## Troubleshooting

- `disabled_by_env`:
  - resolver was requested by `--with-external-services`, but module env toggle is off (`YT_RESOLVER_ENABLED=false` / `FB_RESOLVER_ENABLED=false`).
- `EADDRINUSE`:
  - port conflict in app/resolver startup; free the port or update service/base-url port config.
- missing exports/package errors:
  - root startup diagnostics classify this as `package_export_error`; verify package versions/exports and rebuild.
- resolver post-run health failure (`health_fail_after_delegate:*`):
  - run module `scripts/run.sh` directly and inspect module-local logs; root delegation is intentionally non-invasive.
- resolver process exits immediately:
  - run module script manually and validate module prerequisites (`python3`, `.venv`, dependency install).
- Facebook extraction instability:
  - ensure `ffmpeg` is installed and available in `PATH`.
  - prefer full `facebook.com` permalink over short redirect URLs.
