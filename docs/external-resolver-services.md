# External Resolver Services (YouTube/Facebook)

This document describes how Zappy vendors and runs external downloader services as internal auxiliary components.

## Location

- `infra/external-services/youtube-resolver`
- `infra/external-services/facebook-resolver`

These are intentionally outside `apps/*` and `packages/*`, and are not npm workspaces.

## Boundary and flow

`wa-gateway` stays thin and delegates `/dl` to `media-resolver-api`.

`media-resolver-api` keeps the normalized provider flow:

1. `detect`
2. `probe`
3. `resolveAsset`
4. `download`
5. `normalizeForWhatsApp`

Auxiliary resolvers are bridge targets only. Raw external payloads are normalized in `media-resolver-api`.

## Initialize vendored sources

If your clone did not fetch resolver sources:

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

Default local ports (from base URLs):

- YouTube resolver: `3401`
- Facebook resolver: `3402`

## Bootstrap Python environments (one-time)

```bash
npm run bootstrap:dev -- --infra
# or
npm run bootstrap:prod -- --infra
```

This prepares resolver virtualenvs (`.venv`) and installs Python dependencies. Runtime `start` no longer installs resolver dependencies automatically.
Root `bootstrap` only delegates to each resolver `scripts/bootstrap.sh` using resolver-local `cwd`.

Direct bootstrap scripts are still available:

```bash
./infra/external-services/youtube-resolver/scripts/bootstrap.sh
./infra/external-services/facebook-resolver/scripts/bootstrap.sh
```

## Run auxiliary services manually

```bash
./infra/external-services/youtube-resolver/scripts/run.sh
./infra/external-services/facebook-resolver/scripts/run.sh
```

Wrapper contract per service:

- `GET /health`
- `POST /resolve`

## Run with supervisor (tmux-managed resolvers)

Start normal stack:

```bash
npm run start:dev -- --infra=auto
```

Start stack with auxiliary resolvers:

```bash
npm run start:dev -- --infra=auto --with-external-services
```

Per-service startup flags:

```bash
npm run start:dev -- --with-yt-resolver
npm run start:dev -- --with-fb-resolver
```

Resolver runtime policy:

- tmux session name: `zappy`
- standardized windows: `core`, `youtube`, `facebook`
- startup checks resolver module directory + `scripts/run.sh` before launch
- root `start` delegates to module entrypoint: `cd <module-dir> && bash scripts/run.sh`
- duplicate guard: if resolver is already healthy, startup logs `already_running` and does not create duplicate process/window
- health validation after launch (`GET /health`)

Bridge health checks remain non-fatal for app startup (operator gets explicit logs with reason).

## Stop behavior with ownership guard

Use `--infra` on stop when you want shutdown to include owned infra resources:

```bash
npm run stop:dev -- --infra
```

Ownership-aware rules:

- resolver windows are closed only when ownership is `runtime_started`
- windows/session not created by this runtime are left untouched
- external host/container dependencies are never stopped by resolver stop flow

## Health checks

```bash
curl -H "Authorization: Bearer ${YT_RESOLVER_TOKEN}" http://localhost:3401/health
curl -H "Authorization: Bearer ${FB_RESOLVER_TOKEN}" http://localhost:3402/health
```

If tokens are empty, omit the header.

## Host dependency for Facebook

Facebook resolver may require `ffmpeg` for some extraction/merge flows.

Ubuntu/Debian:

```bash
sudo apt update && sudo apt install -y ffmpeg
```

## Troubleshooting

- Resolver bridge health fails but stack is up:
  - confirm `*_RESOLVER_BASE_URL` points to the actual wrapper port.
  - confirm `*_RESOLVER_TOKEN` matches wrapper token.
- Resolver startup reports `venv_missing`:
  - run `npm run bootstrap:dev -- --infra` (or `bootstrap:prod` on production host).
- Resolver process exits immediately:
  - run wrapper manually with `scripts/run.sh` and inspect logs.
- `/dl yt` or `/dl fb` returns blocked/unsupported:
  - inspect `media-resolver-api` logs for `provider_call_*` and `provider_normalize_*` events.
  - verify upstream platform URL is public and still valid.
- Facebook extraction instability:
  - ensure `ffmpeg` is installed and available in `PATH`.
  - try full `facebook.com` permalink instead of short redirect links.
