# Debugger — cycle 3 provenance

Review target: `afa11cf4`, 2026-07-18 KST. Review only.

## Inventory and debugging approach

The complete 939-file repository inventory was reviewed across routes/actions, 115 libraries, 61 components, DB/schema/migrations, scripts/jobs, PWA/deploy/runtime assets, 368 unit tests, 12 Playwright files, docs, recent commits, and deferred history. I followed failure paths and competing hypotheses for recent sitemap, search, and responsive-image changes; then swept races, stale state, abort/timeout cleanup, locks, conditional updates, delete/restore interleavings, file cleanup, and error fallbacks. Linters and typecheck passed.

## Genuinely new cycle-3 findings

### DBG-C3-01 — Responsive priority fixes the attribute count but targets the wrong rendered elements

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 latent bug**
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`; `apps/web/src/components/masonry-card.tsx:121-145`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:192-196,244-245`

Competing hypotheses were: (a) first N DOM children are the first visual row, or (b) CSS columns partition them vertically. Chromium geometry confirms (b): in four columns with 20 equal cards, index 1 is below index 0, and the next column begins at index 5. The implementation preloads indices 1-3 and marks 0-3 high/eager, so the browser is explicitly encouraged to fetch the wrong cards.

Failure scenario: on a desktop cold load, a large top image in a later column is a likely LCP candidate but lacks explicit priority, while below-fold first-column cards consume connections/bandwidth. Hydration/final attribute inspection cannot reveal which balanced elements were topmost.

Fix: remove the invalid first-N inference; use only the first card until actual geometry or deterministic placement is available. Add a browser regression that joins each early request to the corresponding card rect.

### DBG-C3-02 — The regression proof cannot fail on the observed bug

- Severity: **Low-Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 test gap**
- Regions: `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`; `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`; `apps/web/e2e/public.spec.ts:4-49`

The test only asserts source substrings (`preload`, media breakpoints, helper call). It never executes layout or observes requests, although the ledger says browser request-timeline coverage was added. The exact wrong-index implementation therefore passes by design.

Fix: add cold-context request interception and geometry assertions at 320/640/768/1280/1536 widths, and correct the completion evidence.

## Revalidated carry-forward debugger findings (not new)

### DBG-C3-R1 — Health failure has no release rollback

- Severity/Confidence: **Medium / High**
- Regions: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:3-17`

After Compose replaces the fixed-name container, health failure only prints logs and exits; the bad release keeps restarting. Preserve the old image/release and restore it on failure, or health a candidate before traffic promotion.

### DBG-C3-R2 — Queue/backfill overlap can starve the pool despite green unit proofs

- Severity/Confidence: **High / High**
- Regions: `apps/web/src/lib/image-queue.ts:120-152`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/db/index.ts:31-45`

Each resolver is locally correct, but no test runs both admissions simultaneously. Their combined occupancy invalidates each module's reserved-live-traffic claim. A shared admission harness/controller is required.

## Final missed-bug sweep

I revalidated stale-request IDs and aborts in search, successful-only sitemap cache behavior, upload quota claim rollback, per-image processing claims, delete-mid-process cleanup, advisory-lock destroy-on-release-failure, restore marker/barrier ordering, session revocation flushing, pending file deletion retries, single-writer reacquisition, service-worker metadata mutation serialization, and timer/listener teardown. No further new critical/high latent failure was confirmed. Existing deployment, restore-generation, map/vector-scale, and topology issues remain carry-forward.
