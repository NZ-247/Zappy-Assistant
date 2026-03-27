# Downloads Module Evolution

Status: staged resolver architecture active. `/dl` now delegates to internal `media-resolver-api`.

## Goal

Evolve `/dl` from provider-specific placeholder handling into a modular flow with explicit boundaries:

1. provider detection
2. lightweight probe/metadata phase
3. controlled download phase
4. normalized outbound result for gateway send

## Current baseline

- Command parsing and routing already exist in `packages/core/src/modules/downloads`.
- Runtime adapter router exists in `packages/adapters/src/downloads` and is hosted by `apps/media-resolver-api`.
- `ig` supports public permalink probe/download with graceful fallback for private/login-required links.
- `yt` uses official metadata probe (`oEmbed` / Data API when configured) and explicit `preview_only` fallback.
- `fb` supports shared-link normalization + staged resolution/download when accessible, with explicit `private`/`login_required` fallback.
- `direct` supports safe URL probing/download normalization for media-like URLs.
- Resolver runtime manages Redis job TTL and temp-file cleanup.

## New domain/port contracts introduced

- `packages/core/src/modules/downloads/domain/download-contracts.ts`
  - provider detection contract
  - probe result contract
  - normalized download result/assets contract
- `packages/core/src/modules/downloads/ports/download-provider.port.ts`
  - provider-level contract (`detect`, `probe`, `download`)
  - router-level contract for orchestration

These contracts are preparation-only and do not force immediate provider implementation.

## Runtime flow

1. `detect(url)` selects the best provider (`yt`, `ig`, `fb`, `direct`) with confidence/reason.
2. `probe(url)` validates URL, gathers metadata, and checks policy/compliance before heavy work.
3. `resolveAsset(url, options)` selects concrete candidate asset URL(s) when available.
4. `download(url, options)` runs only when probe/asset checks are acceptable and limits are respected.
5. `normalizeForWhatsApp` returns normalized assets (`audio|video|image|document`) for outbound mapping.

## Provider responsibilities

- **YouTube provider**
  - robust URL normalization (`youtube.com`, `youtu.be`, shorts)
  - metadata/probe before media fetch
  - policy-aware status (`blocked`/`unsupported`) when required
- **Instagram provider**
  - permalink normalization and content-type detection (post/reel/story when allowed)
  - metadata extraction + policy gate before download
- **Facebook provider**
  - URL normalization and availability checks
  - metadata/probe before controlled fetch
- **Direct provider**
  - safe content-type and size probing
  - optional direct passthrough when media is already downloadable

## Safety and performance constraints

- Enforce max bytes/duration and request timeouts at provider boundary.
- Keep gateway side effects limited to outbound send; no business policy there.
- Use probe-first to avoid unnecessary heavy downloads on constrained hosts.
- Preserve explicit audit/metrics for provider decisions (`ready`, `blocked`, `invalid`, `error`).

## Next hardening steps

1. Add provider-level contract tests for `yt/fb` staged outcomes (`preview_only`, `private`, `login_required`).
2. Add operational metrics for resolver retries/cleanup cadence and job TTL expirations.
3. Add optional persistent cache layer for metadata probe hits to reduce external calls.
