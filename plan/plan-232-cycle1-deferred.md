# Plan 232 — Cycle 1 deferred review findings

Status: active-deferred
Created: 2026-04-24

Repo policy read before deferral: `CLAUDE.md`, `AGENTS.md`, existing `.context/**`, root `plan/**`. No repo rule authorizes deferring confirmed security/correctness/data-loss bugs. Deferred items below are performance/scale/product-positioning/refactor/test-coverage risks, operational credential work that cannot be performed safely without secret authority, or findings whose safe implementation requires broader product/design decisions.

## Deferred findings

1. **AGG-008 — Live local secrets in gitignored env files**
   - Citation: `apps/web/.env.local:2-9`, `.env.deploy` (gitignored local files).
   - Original severity/confidence: High/High.
   - Reason: rotating/replacing live local/deploy secrets is credential-destructive and cannot be done safely by this code cycle without environment owner authority. The tracked repo already keeps examples placeholder-only.
   - Re-open/exit criterion: environment owner confirms rotation/removal of local plaintext values or asks agent to rewrite local env files.

2. **AGG-009 — CSP permits unsafe-inline**
   - Citation: `apps/web/next.config.ts:73-95`.
   - Original severity/confidence: Medium/Medium.
   - Reason: nonce/hash CSP for Next App Router requires a cross-cutting runtime nonce design and third-party script/style audit; partial removal would risk breaking inline framework/styles.
   - Re-open/exit criterion: create nonce architecture plan or add CSP report-only telemetry showing inline requirements.

3. **AGG-010 — distributed login/password rate-limit DB race**
   - Citation: `apps/web/src/app/actions/auth.ts:108-141`, `apps/web/src/app/actions/auth.ts:320-337`.
   - Original severity/confidence: Medium/High.
   - Reason: default deployment is single Node process; changing auth rate-limit ordering needs dedicated security regression tests and careful rollback semantics beyond this bounded cycle.
   - Re-open/exit criterion: multi-process deployment support is required or auth rate-limit tests are expanded.

4. **AGG-014 — sitemap pagination beyond single-file cap**
   - Citation: `apps/web/src/app/sitemap.ts:14-49`.
   - Original severity/confidence: Medium/High.
   - Reason: Next metadata `generateSitemaps()` static-param behavior can require DB at build; this cycle fixes timestamp/cache semantics and records full pagination for a route-handler/sitemap-index plan.
   - Re-open/exit criterion: gallery approaches 20k images or a route-handler sitemap index is approved.

5. **AGG-017/018/019 — richer social/JSON-LD policy decisions**
   - Citation: home/photo metadata and JSON-LD routes under `apps/web/src/app/[locale]/(public)/**`.
   - Original severity/confidence: Medium/Medium.
   - Reason: configurable license, locale-specific OG locale values, and latest-photo OG fallback are product/SEO policy choices, not correctness bugs.
   - Re-open/exit criterion: admin-configurable license/locale/social image policy is requested.

6. **AGG-043 — image processing CPU/memory concurrency budget**
   - Citation: `apps/web/src/lib/process-image.ts:16-24`, `apps/web/src/lib/process-image.ts:362-459`, `apps/web/src/lib/image-queue.ts`.
   - Original severity/confidence: High/High.
   - Reason: lowering defaults changes throughput/quality tradeoffs for production operators; requires benchmark-based tuning. This cycle fixes bootstrap retry/batching and doc mismatch only.
   - Re-open/exit criterion: benchmark target/container size is specified or OOM/latency evidence appears.

7. **AGG-046 — exact public gallery count on hot path**
   - Citation: `apps/web/src/lib/data.ts:359-391`.
   - Original severity/confidence: Medium/High.
   - Reason: replacing exact totals changes visible UI semantics (`totalCount`) and requires product decision on approximate/async counters.
   - Re-open/exit criterion: performance trace shows count query bottleneck or UI accepts approximate/no count.

8. **AGG-047 — delete scans derivative dirs per image/format**
   - Citation: `apps/web/src/lib/process-image.ts` delete variant helpers; image delete actions.
   - Original severity/confidence: Medium/High.
   - Reason: legacy variant cleanup semantics need a separate safe migration/cleanup strategy to avoid orphaning older size variants.
   - Re-open/exit criterion: large bulk-delete latency is observed or a deterministic-size cleanup migration is planned.

9. **AGG-048 — CSV export materializes large payload**
   - Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:50-98`.
   - Original severity/confidence: Medium/High.
   - Reason: streaming CSV needs a new authenticated route/download flow and UI change; not a data-loss/security bug at current capped scale.
   - Re-open/exit criterion: CSV export exceeds memory/time budgets or route-based streaming is scheduled.

10. **AGG-049 — public search leading-wildcard LIKE**
    - Citation: `apps/web/src/lib/data.ts` search queries.
    - Original severity/confidence: Medium/Medium.
    - Reason: search index strategy (`FULLTEXT`, ngram, external search) is a DB/product tradeoff.
    - Re-open/exit criterion: search latency/DB CPU issue appears or search indexing strategy is selected.

11. **AGG-050 — rate-limit purge missing bucket_start index**
    - Citation: rate-limit bucket schema/migration and purge code.
    - Original severity/confidence: Medium/Medium.
    - Reason: schema migration requires DB migration planning and verification against current Drizzle snapshots.
    - Re-open/exit criterion: bucket table growth is observed or migration window is approved.

12. **AGG-051 — broad/narrow revalidation overlap**
    - Citation: mutation actions using `revalidateAllAppData()` and narrow path revalidation.
    - Original severity/confidence: Low/Medium.
    - Reason: cache invalidation policy needs route dependency mapping; current behavior is safe but possibly overbroad.
    - Re-open/exit criterion: cache churn becomes measurable or route dependency matrix is authored.

13. **AGG-052/053 — optional viewer chunk and touchmove state perf**
    - Citation: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`.
    - Original severity/confidence: Low/Medium.
    - Reason: needs bundle analyzer/mobile interaction profiling before changing loading behavior.
    - Re-open/exit criterion: bundle/profile budget is set.

14. **AGG-054 — broad monolith clusters / dead storage abstraction**
    - Citation: `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/lib/storage/**`.
    - Original severity/confidence: Medium/High.
    - Reason: refactor/deletion is not behavior-preserving without a dedicated cleanup plan and regression locks; repo working agreement requires cleanup plan/tests first.
    - Re-open/exit criterion: explicit cleanup/refactor cycle is started.

15. **Test coverage gaps not directly tied to implemented fixes**
    - Citation: `.context/reviews/test-engineer.md` findings 1, 3-11.
    - Original severity/confidence: Medium-High/Medium-High.
    - Reason: this cycle adds/updates tests where implementation changes require it; remaining gaps are coverage debt rather than current product failures.
    - Re-open/exit criterion: test-hardening cycle or touched feature area.

16. **Gate warning — Next.js edge runtime disables static generation for OG route**
    - Citation: `apps/web/src/app/api/og/route.tsx:1-6`; gate output from `npm run build` / `npm run test:e2e` warns: `Using edge runtime on a page currently disables static generation for that page`.
    - Original severity/confidence: Low/High (tool warning; not an application failure).
    - Reason: the route uses `next/og` `ImageResponse`, which is designed for the edge runtime. Removing edge runtime would be a framework/API compatibility change, not a clean warning fix in this cycle.
    - Re-open/exit criterion: Next.js supports Node runtime for `ImageResponse`, the OG image route is replaced with a Node-compatible renderer, or the warning becomes a CI failure.
