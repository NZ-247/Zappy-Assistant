# External Auxiliary Services

`infra/external-services` contains vendored non-Node services used by `apps/media-resolver-api` bridge providers.

## Services

- `youtube-resolver` (upstream + Zappy wrapper)
- `facebook-resolver` (upstream + Zappy wrapper)

These services are intentionally **not** npm workspaces.

## Clone/init

If your clone does not include service sources yet:

```bash
git submodule update --init --recursive infra/external-services/youtube-resolver infra/external-services/facebook-resolver
```

## Local bootstrap

```bash
./infra/external-services/youtube-resolver/scripts/bootstrap.sh
./infra/external-services/facebook-resolver/scripts/bootstrap.sh
```

## Local run

```bash
./infra/external-services/youtube-resolver/scripts/run.sh
./infra/external-services/facebook-resolver/scripts/run.sh
```

## Health endpoints

- YouTube: `GET http://localhost:3401/health`
- Facebook: `GET http://localhost:3402/health`

Ports can be changed via `YT_RESOLVER_BASE_URL` and `FB_RESOLVER_BASE_URL`.
