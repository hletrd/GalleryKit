# Tracer — cycle 3 provenance

Review target: `afa11cf4`, 2026-07-18 KST. Review only.

## Inventory and trace coverage

I first inventoried the entire 939-file repository: all App Router and action files, libraries/components/DB, migrations/reconcile/scripts, tests/E2E, PWA and image assets, Docker/nginx/deploy, and governing/current/deferred docs. Causal traces covered request→guards→mutation→DB, upload→quota→original→privacy scrub→queue→derivatives→embedding, delete→transaction→durable cleanup, restore→locks/barrier/import/migrations/stores, SSR→preload→CSS placement→hydration, semantic inference→ranking/enrichment, and deploy→replacement→health. The final trace sweep also challenged recent tests/comments against runtime semantics.

## Genuinely new cycle-3 findings

### TRC-C3-01 — Resource-hint target selection breaks at the DOM-order → visual-placement edge

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 causal break**
- Trace: `home-client.tsx:146-169` selects indices 1-4 → React emits media-qualified image preloads → `home-client.tsx:307-314,363-375` hands the same ordered DOM list to CSS columns → browser balances top-to-bottom chunks → `masonry-card.tsx:121-145` applies eager/high from the same first-N assumption
- Adjacent repetitions: `g/[key]/page.tsx:192-196,244-245`; `timeline/page.tsx:138,227-282`; `year/[year]/page.tsx:131,189-241`

The missing causal edge is “DOM index identifies visible column leader.” It does not exist. Browser proof at four columns placed indices 0/5/10/15 at the top, while the hint loop targeted 1/2/3. Thus the viewport media predicates are correct but operate on the wrong identities.

Concrete failure: parser-time preload/high priority accelerates below-fold cards and misses later-column LCP candidates. Post-hydration DOM assertions can report the intended number of eager elements without revealing their actual positions.

Fix: either stop the trace at the only invariant target (index 0) or produce explicit placement metadata from a deterministic layout. Test the complete trace by correlating resource requests with card rects.

### TRC-C3-02 — Claimed request-timeline evidence terminates before the browser boundary

- Severity: **Low-Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 evidence-chain break**
- Trace: `.context/plans/cycle-2-2026-07-18-plan.md:29-32` promises browser request coverage → `masonry-card-memo.test.ts:115-123` only reads source → `apps/web/e2e/public.spec.ts:4-49` covers homepage presence and search state, not image requests/layout

The evidence chain proves strings were added, not that media filters, srcsets, balanced placement, or request priority work together. Update the ledger and add the missing browser leg.

## Revalidated carry-forward traces (not new)

### TRC-C3-R1 — Background DB reservation traces converge on the same pool

- Severity/Confidence: **High / High**
- Trace: `db/index.ts:31-45` establishes 10 connections → `image-queue.ts:120-152` independently reserves/adopts workers + `admin-backfill-runner.ts:97-142` independently reserves/adopts workers → distinct locks allow overlap → live query/analytics work reaches the same queue

Each local calculation passes, but their summed occupancy can leave one foreground connection. A shared weighted ledger or mutual exclusion must own the converging edge.

### TRC-C3-R2 — Restore safety stops at the SQL/filesystem generation boundary

- Severity/Confidence: **Medium / High**
- Trace: `db-actions.ts:789-1046` fences writers and imports SQL → `docker-compose.yml:24-32` retains originals/derivatives/resources independently → restored rows and files can belong to different snapshots

This remains an explicitly documented operational boundary, not a new code regression. Full recovery needs paired snapshot identity and post-restore reconciliation.

### TRC-C3-R3 — Deploy health observes failure after promotion

- Severity/Confidence: **Medium / High**
- Trace: `deploy.sh:67` replaces/starts the fixed service → `:69-83` observes health → `:85-89` exits without a reverse edge

The trace has detection but no rollback transition. This is unchanged carry-forward.

## Final causal/missed-file sweep

The closing sweep traced sitemap build/runtime cache ownership, search query/request/result/listbox state, every admin/public writer through origin/rate-limit/barrier checks, processing/delete races, restore sidecars and advisory locks, session/file cleanup, schema journal→apply→postcondition, settings→encoder→cache validators, IP trust→rate limits/analytics, and deploy→prune. No additional new causal break survived competing-hypothesis validation; established map/vector/topology/restore/deploy risks were preserved as carry-forward rather than counted again.
