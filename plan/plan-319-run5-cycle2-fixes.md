# Plan 319 — HIGH fixes (Run-5 Cycle 2)

**Source:** `.context/reviews/run5-cycle2/_aggregate.md` (48 merged findings from 11 agents, 73 raw).
Severities/confidences are the ORIGINAL aggregate values. All commits: GPG-signed (`-S`), conventional + gitmoji, fine-grained, push after each.

## Item 1 — AGG-R5C2-01: semantic-search stub honesty cluster (HIGH, High, confirmed, 3 agents)
Sources: CRT-R5C2-01, BUG-R5C2-02, BUG-R5C2-03, BUG-R5C2-07, CRT-R5C2-05, ARCH-R5C2-03.
- `apps/web/src/app/api/search/semantic/route.ts:6-19` — rewrite the docstring: the endpoint SERVES when mode is `'stub'` (random EXIF-stub scores, admin opt-in) and 503s otherwise; remove "rejects when mode is not 'production'".
- `apps/web/src/components/search.tsx:414-438` — render a visitor-facing experimental disclaimer when `semanticSearchMode === 'stub'` (new i18n key `search.semanticExperimentalHint` en+ko: results are experimental/approximate). Product decision recorded: stub-serving is the deliberate demo posture (admin label already says "Stub (testing only)"); the disclaimer makes it honest. Do NOT change the serving gate.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:545-549` — the stale-`'production'` warning lies (resolver treats legacy `'production'` as `'disabled'`). Replace with a note that a legacy `'production'` value is treated as disabled and should be re-selected; keep it as defense-in-depth for stale rows.
- `apps/web/src/lib/gallery-config.ts:65,127,182` — narrow the union to `'disabled' | 'stub'` (resolver can never return `'production'`); adjust the route's local type. If narrowing ripples too far, annotate `'production'` as rejected-sentinel-only with a comment (fallback option).
- i18n: remove the orphaned `semanticSearchModeProduction` Select label key (en+ko) or pin it with a WI-09 comment; keep `semanticSearchProductionWarning` only if the stale-value note reuses it (otherwise replace key).
- **Acceptance:** docstring matches gate; visitor sees disclaimer in stub mode; legacy-`'production'` admin sees truthful note; types compile with narrowed union; en/ko parity preserved.

## Item 2 — AGG-R5C2-02 / ARCH-R5C2-02: break client→server-stub import edge (HIGH, High, confirmed)
- Extract `ALT_TEXT_STUB_PREFIX` from `apps/web/src/lib/caption-generator.ts:31` into a client-safe module (new `apps/web/src/lib/caption-constants.ts` or reuse `lib/image-types.ts`); update `apps/web/src/lib/photo-title.ts:2` and caption-generator to import from there.
- Add `import 'server-only'` to `caption-generator.ts` (install `server-only` package if absent — check `apps/web/package.json` first).
- **Acceptance:** no `'use client'`-reachable module imports caption-generator; build green; grep shows photo-title no longer imports caption-generator.

## Item 3 — AGG-R5C2-03: rewrite `admin-backfill-runner-batching.test.ts` (HIGH, High, confirmed, 3 agents)
Sources: BUG-R5C2-01, CRT-R5C2-04, TEST-R5C2-02, BUG-R5C2-04, TEST-R5C2-15.
- `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-242` — the mock's `batchIndex` counter mistakes `reprocessOne` UPDATE calls for SELECT batches; the "second batch" the test sees comes from an UPDATE call; rows 101-150 are never actually enqueued; an OFFSET/always-break regression would pass.
- Rewrite: dispatch mock responses by SQL content (drizzle `sql` template exposes `queryChunks` — SELECT batches contain `LIMIT`/`id >`, UPDATEs contain `SET`); assert the BOUND cursor params are `0` then `100`; replace all three `setTimeout(500)` sleeps with `vi.waitFor(() => readAdminBackfillState().running === false)`; stop asserting on a concurrently-mutated array without the deterministic completion barrier.
- **Acceptance:** test fails if the loop breaks after batch 1 or uses OFFSET-style pagination (verify by temporary mutation, then revert); no wall-clock sleeps remain; suite green.

## Item 4 — AGG-R5C2-04 / DOC-R5C2-01: Firefox `color-gamut` MQ docs are factually wrong (HIGH, High, confirmed)
- RE-VERIFY against caniuse/MDN before editing (agent cited Firefox 110+, Jan 2023, full `(color-gamut: p3)` support).
- CLAUDE.md browser-matrix Firefox row: `(color-gamut: p3)` MQ → `✓ (FF 110+)`; `screen.colorGamut` stays `✗`. Rewrite the "Firefox photographer-visible impact (R10-H4)" prose: FF 110+ hits the MQ fallback branch, so badges/hints DO work; only FF ≤109 falls back to conservative `'srgb'`.
- `apps/web/src/lib/use-display-capability.ts:64,103` — fix both stale comments.
- **Acceptance:** doc + comments match external reality with source URL noted; no behavior change (code already correct).

## Item 5 — AGG-R5C2-05 / TEST-R5C2-05: caption-generator behavioral tests (HIGH, High, confirmed)
- New `apps/web/src/__tests__/caption-generator.test.ts`: (a) `[AUTO] ` prefix + camera model; (b) empty/null model fallback; (c) error-path behavior (resolves/propagates per actual contract — read code first); (d) prefix exactly equals `ALT_TEXT_STUB_PREFIX` (post Item-2 constant location).
- **Acceptance:** new suite green; covers all branches of `generateCaption`/`generateCaptionStub`.

## Item 6 — AGG-R5C2-06 / TEST-R5C2-01 + plan-315 item 6 (TRC-R5C1-16): checkout unknown-IP idempotency fix + tests (HIGH test gap; MED underlying fix, pulled forward)
- `apps/web/src/app/api/checkout/[imageId]/route.ts:178` — when `getClientIp()` returns `'unknown'`, omit the Stripe idempotency key (or include a `crypto.randomUUID()` component) so distinct buyers can't share `checkout-{id}-unknown-{minute}`.
- Extend `apps/web/src/__tests__/checkout-route.test.ts`: unknown-IP branch → two calls in the same minute produce distinct sessions / no shared key; known-IP branch keeps the deterministic key shape.
- **Acceptance:** test pins both branches; plan-315 item 6 marked done there.

## Sequencing
2 → 5 (constant location feeds tests) → 1 → 3 → 6 → 4. Run full gates after each commit batch.

## Progress

| # | Finding(s) | Commit | Status |
|---|---|---|---|
| 1 | AGG-R5C2-01 | | |
| 2 | AGG-R5C2-02 | | |
| 3 | AGG-R5C2-03 | | |
| 4 | AGG-R5C2-04 | | |
| 5 | AGG-R5C2-05 | | |
| 6 | AGG-R5C2-06 (+plan-315 item 6) | | |
