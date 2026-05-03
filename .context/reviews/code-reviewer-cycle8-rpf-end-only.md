# Code Review — Cycle 8 RPF (end-only)

## Method

Inventory pass: read every file in the cycle 7 RPF in-cycle fix set
(checkout route, webhook route, sales actions, cycle 7 source contracts,
download route, sales-client, download-tokens, license-tiers, stripe lib).
Cross-checked against the cycle 5/6/7 structured-object log contract.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — **991 passed across 112 files**
- `npm run build` — clean
- `npm run test:e2e` — DEFERRED (no MySQL in environment, carry-forward)
- `git status` — clean on master, 27 commits ahead of origin

## Cycle 7 RPF carry-forward verification

All cycle 7 RPF in-cycle claims (P392-01..06) verified intact in the
current source. The cycle 7 source-contract test file
(`cycle7-rpf-source-contracts.test.ts`) passes 6 / 6.

## Findings

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C8-RPF-CR-01 — Convert download lstat/realpath catch log to structured-object form

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Severity: **Low** | Confidence: **High**
- **What:** The download route's catch on the lstat/realpath block
  uses positional 2nd-arg form
  (`console.error('Download lstat/realpath error:', err)`), yet line 206
  in the SAME file's stream-error block already follows the cycle 5/6/7
  structured-object contract
  (`console.error('Download stream error:', { entitlementId, code: errCode })`).
  This is intra-file inconsistency on the entitlement-redemption surface.
  The download route is the **paid asset delivery** path that consumes
  Stripe-issued entitlement tokens, so it carries the same audit /
  correlation semantics as the webhook + checkout + sales actions covered
  by C7-RPF-01..05.
- **Failure scenario:** an operator triaging a Stripe-issued download
  surge (e.g., a customer reports "404 file not found" on a paid token)
  cannot grep by `entitlementId` to correlate the lstat failure with
  the stream-error follow-up: the lstat line is positional, but the
  same-incident stream-error line is structured. Datadog/Loki structured
  log parsers will produce two different telemetry events for what is
  conceptually one incident.
- **Fix (this cycle):** convert to
  `console.error('Download lstat/realpath error', { entitlementId: entitlement.id, err })`.
  `entitlement` is in scope (fetched on line 55).

#### C8-RPF-CR-02 — Add cycle 8 source-contract test for the lstat/realpath log shape

- File: `apps/web/src/__tests__/cycle8-rpf-source-contracts.test.ts` (new)
- Severity: **Low** | Confidence: **High**
- **What:** lock the C8-RPF-CR-01 fix shape so a future cycle does
  not silently regress to the legacy positional form.
- **Fix (this cycle):** assert
  - structured-object form on the lstat/realpath catch line, with
    `entitlementId: entitlement.id` field present;
  - legacy positional form `'Download lstat/realpath error:'` (with
    trailing colon) absent.

## Deferred (with exit criteria, carried forward from cycles 5/6/7 RPF)

All cycle 7 deferred items D01..D14 remain bound by the same exit
criteria — none have been triggered between cycle 7 and cycle 8
because the surrounding code is unchanged. They are restated in the
aggregate.

## Repo policy honored

- All deferrals are non-security, non-correctness, non-data-loss.
- The cycle 8 in-cycle fix is Low severity, schedulable within cycle 8.
- Plan numbering will reuse the higher P392 sequence (P394+).
- GPG-signed commits per CLAUDE.md.
- Conventional Commits + gitmoji + no Co-Authored-By per AGENTS.md.
- `git pull --rebase` before push.
