# Runtime Lifecycle and Redis Strategy (Operator Guide)

This guide documents the root runtime behavior in `scripts/start.mjs` and `scripts/stop.mjs` for safer start/stop cycles.

## Why `EADDRINUSE` can happen

`EADDRINUSE` usually means one of the root app ports is still occupied from a previous run:

- `admin-ui`: `8080`
- `assistant-api`: `3333`
- `wa-gateway`: `3334`
- `media-resolver-api`: `3335`

This can happen when shutdown is incomplete or when another process (not runtime-owned) is already listening on the same port.

## Start-time reconciliation

Before spawning each root app, startup now performs a port + identity precheck and logs one of:

- `ready_to_start`
- `already_running_same_service`
- `port_conflict_unknown_process`

Examples:

- `[app-precheck] service=admin-ui port=8080 status=already_running_same_service`
- `[app-start-skip] service=wa-gateway reason=already_running_same_service`
- `[app-precheck] service=assistant-api port=3333 status=port_conflict_unknown_process`

Behavior:

- `already_running_same_service`: startup skips duplicate spawn for that service.
- `port_conflict_unknown_process`: startup fails clearly and does not spawn a duplicate.

## Stop-time reconciliation

Stop remains ownership-aware (PID/state driven), then performs a final reconciliation pass for ports `8080/3333/3334/3335`.

Reconciliation statuses:

- `stopped_by_pid`
- `already_stopped`
- `port_still_busy_unknown_process`

Examples:

- `[stop-reconcile] service=media-resolver-api port=3335 status=already_stopped`
- `[stop-reconcile] service=assistant-api port=3333 status=port_still_busy_unknown_process`

Important:

- stop does **not** kill arbitrary unknown processes.
- unknown occupancy is reported so operators can decide what to do manually.

## Optional cleanup mode for stale leftovers

When needed, run:

- `npm run stop:dev -- --cleanup-ports`
- alias: `npm run stop:dev -- --force-runtime-cleanup`

Cleanup mode behavior:

- scans root app ports (`8080/3333/3334/3335`) after normal stop flow
- logs owner classification (`service/port/pid/classification`)
- sends signals in order: `SIGINT -> SIGTERM -> SIGKILL` (last resort)
- targets only confidently-classified Zappy runtime leftovers (command/path markers)
- skips non-Zappy or uncertain owners with `status=skipped_non_zappy_process`
- logs final per-port cleanup status: `cleared` or `still_busy`

## State file behavior

Runtime ownership still uses `.zappy-dev/<mode>-stack.json`, but with explicit diagnostics:

- `status=missing`: no state file found.
- `status=stale_*`: state file exists but is unreadable/stale and gets cleared.
- `status=active`: tracked runtime is still alive.

This prevents relying only on stale state and improves start/stop diagnostics when ports are still busy.

## Redis runtime strategies

Infra strategy remains `--infra=external | managed | auto`, with explicit Redis source logs.

### `external` (external host intent)

- Uses configured host endpoint only (no compose up).
- Logs selected Redis source + version.
- Warns when version is below recommended minimum (`6.2.0`).

Example:

- `[deps] service=redis source=external_host version=6.0.16 selected_by=external_mode warning=min_version_recommended`

### `managed` (compose-managed intent)

- Requires compose-managed Redis/Postgres.
- Logs source + version as managed selection.

Example:

- `[deps] service=redis source=compose_managed version=7.2.4 selected_by=managed_mode`

### `auto`

- Keeps existing behavior: reuse usable dependency first, compose-up only when needed.
- Now logs explicit source selection and reason.

Example:

- `[deps] service=redis source=external_host version=6.0.16 selected_by=auto_mode warning=min_version_recommended`

## Recommendation

- Prefer compose-managed Redis 7 whenever possible (`--infra=managed`, or `--infra=auto` with host port free).
- If intentionally using host Redis, upgrade host Redis to `>= 6.2.0`.

## Troubleshooting

### `EADDRINUSE` on `8080/3333/3334/3335`

1. Run startup again and check `[app-precheck]` logs.
2. If `already_running_same_service`, startup skips duplicate automatically.
3. If `port_conflict_unknown_process`, free the port or change service port env vars (`ADMIN_UI_PORT`, `ADMIN_API_PORT`, `WA_GATEWAY_INTERNAL_PORT`, `MEDIA_RESOLVER_API_PORT`).

### Stale state file

- Look for `[state] ... status=stale_*` in start/stop logs.
- Runtime clears stale state automatically before continuing.

### Unknown process occupying service port

- Stop logs show `status=port_still_busy_unknown_process`.
- Runtime will not kill unknown process automatically; operator must decide/manual stop.
- If it is likely a stale Zappy runtime process, run cleanup mode:
  - `npm run stop:dev -- --cleanup-ports`
  - verify `[cleanup]` logs for classification and final `status=cleared`.

### External Redis `6.0.16` warning

- Confirm source with `[deps] service=redis source=... version=...`.
- If source is `external_host` and warning appears, either:
  - upgrade host Redis to `>= 6.2.0`, or
  - switch to compose-managed Redis strategy.
