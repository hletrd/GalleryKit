# Review Aggregate — Cycle 1/100

Date: 2026-06-29

## Agent Coverage

- `code-reviewer`: completed, wrote `.context/reviews/code-reviewer.md`.
- `perf-reviewer`: completed, wrote `.context/reviews/perf-reviewer.md`.
- `security-reviewer`: completed, wrote `.context/reviews/security-reviewer.md`.
- `critic` + `verifier`: completed as a combined lane, wrote `.context/reviews/critic-verifier.md`.
- `test-engineer`: completed, wrote `.context/reviews/test-engineer.md`.
- `architect` + `debugger` + `tracer`: completed as a combined lane, wrote `.context/reviews/architect-debugger-tracer.md`.
- `document-specialist`: completed, wrote `.context/reviews/document-specialist.md`.
- `designer`: completed, wrote `.context/reviews/designer.md`; live browser validation was limited by local DB `ECONNREFUSED`, so findings are source/test backed.

Registered global reviewer prompts under `~/.codex/agents/product-marketer-reviewer.md` and `~/.codex/agents/ui-ux-designer-reviewer.md` were not run as additional repo reviewers because their required context and source paths are for a different SwiftUI/BurstPick project and would produce misleading GalleryKit findings.

## Summary

Raw reviewer findings: 28.

Deduped implementation findings: 27. The per-photo OG fallback redirect issue was independently reported by security-reviewer and critic/verifier, so it is listed once with cross-agent agreement.

High severity: 4. Medium severity: 19. Low severity: 4.

## High Findings

### AGG-C1 — Semantic similar-photo failures refund the limiter after DB work

- Sources: `code-reviewer` CR-01.
- Severity/confidence: High / High.
- Status: Confirmed.
- Location: `apps/web/src/app/api/search/similar/[id]/route.ts:83-154`; tests at `apps/web/src/__tests__/similar-route.test.ts:195-240`.
- Issue: missing/corrupt target embedding and DB failure paths call `rollbackSemanticAttempt(ip)` after consuming protected DB work, creating an unmetered probe and DB-load path.
- Fix: remove post-lookup/post-scan rollbacks; keep refunds only before protected work; update tests and comments.

### AGG-C2 — SQL restore scanner misses dangerous comment-separated multi-token statements

- Sources: `architect-debugger-tracer` finding 1.
- Severity/confidence: High / High.
- Status: Confirmed.
- Location: `apps/web/src/lib/sql-restore-scan.ts:39-137`; restore enforcement at `apps/web/src/app/[locale]/admin/db-actions.ts:408-436`.
- Issue: stripping block comments to an empty string turns `DROP/**/TABLE` into `DROPTABLE`, bypassing patterns like `DROP\s+TABLE` while MySQL still treats comments as separators.
- Fix: scan both comment-as-empty and comment-as-space normalized forms; add regression tests for dangerous comment-separated statements.

### AGG-C3 — Documented public-route rate-limit lint gate is absent from root/CI execution

- Sources: `test-engineer` TE-01.
- Severity/confidence: High / High.
- Status: Confirmed.
- Location: `package.json:19-20`, `.github/workflows/quality.yml:60`, `apps/web/package.json:24`, `AGENTS.md:29-34`, `CLAUDE.md:579-590`.
- Issue: the repo documents `lint:public-route-rate-limit` as blocking, but root scripts and CI omit it.
- Fix: add the root forwarding script and run it in the CI security lint step.

### AGG-C4 — CLIP production backfill docs omit `--force` in the pre-enable flow

- Sources: `document-specialist` DOC-C1.
- Severity/confidence: High / High.
- Status: Confirmed mismatch.
- Location: `CLAUDE.md:506-527`; correct app README reference at `apps/web/README.md:68-70`; script behavior at `apps/web/scripts/backfill-clip-embeddings.ts:90-95`.
- Issue: following `CLAUDE.md` on a default install exits successfully without generating embeddings.
- Fix: update the documented pre-enable command to `--production --force` and explain when `--force` is unnecessary.

## Medium Findings

### AGG-M1 — Production semantic search returns empty 200s when no production embeddings exist

- Sources: `critic-verifier` finding 1.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/src/app/api/search/semantic/route.ts:249-335`; docs at `apps/web/README.md:58-60`.
- Issue: production mode with zero real rows returns `200 { results: [] }`, contradicting the honesty gate and hiding configuration/backfill failures.
- Fix: return 503/no-store when production scan returns zero rows; add route test.

### AGG-M2 — Checked-in nginx upload root conflicts with host-side nginx topology

- Sources: `critic-verifier` finding 2.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/docker-compose.yml:14-26`, `apps/web/nginx/default.conf:170-173`, `apps/web/README.md:47-49`.
- Issue: the shipped host-side nginx config roots uploads at `/app/apps/web/public`, which is container-internal and can 404 all derivatives when installed on the host.
- Fix: make nginx use the documented host bind-mount root or proxy uploads to Next by default, then add a config/source test.

### AGG-M3 — Per-photo OG fallback redirects trust inbound request origin

- Sources: `security-reviewer` SEC-01, `critic-verifier` finding 3.
- Cross-agent agreement: High signal; two independent lanes found the same fallback trust problem.
- Severity/confidence: Medium / High (preserving higher security-reviewer severity/confidence).
- Status: Confirmed.
- Location: `apps/web/src/app/api/og/photo/[id]/route.tsx:251-285`; nginx forwards host at `apps/web/nginx/default.conf:191-200`.
- Issue: fallback redirects derive `Location` from `new URL(req.url).origin`, enabling open redirect/host-header poisoning if the edge forwards a hostile Host.
- Fix: derive fallback origin from canonical SEO/site config and fail closed when invalid; add hostile-origin regression.

### AGG-M4 — Lightroom uploads skip semantic embeddings

- Sources: `architect-debugger-tracer` finding 2.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/src/app/api/admin/lr/upload/route.ts:425-465`, `apps/web/src/lib/image-queue.ts:391-413` and `:512-531`.
- Issue: Lightroom enqueue forwards quality/image size settings but omits `semanticSearchMode`, so queue jobs default embeddings to disabled.
- Fix: pass `semanticSearchMode: config.semanticSearchMode`; add test coverage.

### AGG-M5 — Semantic search reads request body before reliable byte/rate-limit gate

- Sources: `architect-debugger-tracer` finding 3.
- Severity/confidence: Medium / Medium.
- Status: Likely.
- Location: `apps/web/src/app/api/search/semantic/route.ts:128-216`.
- Issue: missing/variant transfer encoding and absent content-length paths can read large bodies before limiter charge; post-read length uses string length, not UTF-8 bytes.
- Fix: normalize transfer encoding, add pre-body limiter or reject unknown lengths, byte-count reads; add tests.

### AGG-M6 — Timeline/on-this-day queries are non-sargable on dynamic public pages

- Sources: `perf-reviewer` PERF-01.
- Severity/confidence: Medium / High.
- Status: Confirmed likely production impact.
- Location: `apps/web/src/lib/data-timeline.ts:95-205`.
- Issue: `MONTH()`, `DAY()`, and `YEAR()` filters/orderings require broad scans as the archive grows.
- Fix: rewrite year/month to sargable ranges; use generated columns or materialized/cache table for on-this-day.

### AGG-M7 — Map page loads up to 10,000 unclustered markers without supporting index

- Sources: `perf-reviewer` PERF-02.
- Severity/confidence: Medium / High.
- Status: Confirmed likely user-visible stalls.
- Location: `apps/web/src/lib/data.ts:1624-1661`, `apps/web/src/db/schema.ts:111-117`, `apps/web/src/components/map/map-client.tsx:86-143`.
- Issue: `/map` can scan, serialize, hydrate, and render thousands of markers without clustering or a GPS/map query index.
- Fix: add supporting indexes and move toward viewport/bounds loading or clustering.

### AGG-M8 — Production CLIP image embeddings bypass image-queue backpressure

- Sources: `perf-reviewer` PERF-03.
- Severity/confidence: Medium / High.
- Status: Confirmed concurrency risk.
- Location: `apps/web/src/lib/image-queue.ts:512-569`, `apps/web/src/lib/clip-model.ts:151-186`.
- Issue: detached production embedding jobs are not bounded by the main processing queue, allowing CPU/memory spikes during batch uploads.
- Fix: add a bounded embedding queue or await embedding in the existing queue; add metrics.

### AGG-M9 — Valid single-photo share-link 200-path e2e is skipped

- Sources: `test-engineer` TE-02.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/e2e/public.spec.ts:125-137`, `apps/web/scripts/seed-e2e.ts:230`.
- Issue: valid `/s/[key]` rendering is not exercised unless an external env var is supplied.
- Fix: seed or query a deterministic key and remove the skip.

### AGG-M10 — Vitest discovery ignores future `.test.tsx` tests

- Sources: `test-engineer` TE-03.
- Severity/confidence: Medium / High.
- Status: Risk confirmed by config.
- Location: `apps/web/vitest.config.ts:17`.
- Issue: `*.test.tsx` files can be typechecked but not executed.
- Fix: include `src/__tests__/**/*.test.{ts,tsx}` or explicitly reject `.test.tsx`.

### AGG-M11 — Navigation visual checks only capture screenshots

- Sources: `test-engineer` TE-04.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/e2e/nav-visual-check.spec.ts:14-39`.
- Issue: screenshots are emitted but never compared, so visual regressions pass.
- Fix: use `toHaveScreenshot` with baselines or rename to smoke/artifact capture and add DOM/box assertions.

### AGG-M12 — High-value client interactions are source-regex locked instead of behavior-tested

- Sources: `test-engineer` TE-05.
- Severity/confidence: Medium / Medium.
- Status: Likely coverage gap.
- Location: `apps/web/src/__tests__/search-stale-response.test.ts:8-19`, `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:15-19`, production code in `components/search.tsx` and `components/upload-dropzone.tsx`.
- Issue: runtime asynchronous behavior can drift while brittle source-shape tests remain green.
- Fix: add browser/component behavior tests for stale search responses and topic wiring.

### AGG-M13 — `site-config.json.url` docs misstate build validation and OG behavior

- Sources: `document-specialist` DOC-C2.
- Severity/confidence: Medium / High.
- Status: Confirmed mismatch.
- Location: `CLAUDE.md:212`, `CLAUDE.md:628-632`, `apps/web/scripts/ensure-site-config.mjs:11-42`, `apps/web/Dockerfile:71-75`.
- Issue: docs say there is no build-time validation and invalid OG config returns 404; code validates at build/prebuild and per-photo OG can redirect fallback.
- Fix: rewrite docs to distinguish build guard, per-photo fetch fail-closed behavior, and topic OG behavior.

### AGG-M14 — Per-photo OG inline comment says fallback to request origin

- Sources: `document-specialist` DOC-C3.
- Severity/confidence: Medium / High.
- Status: Confirmed mismatch.
- Location: `apps/web/src/app/api/og/photo/[id]/route.tsx:101-110`.
- Issue: the stale comment could guide a future refactor to reintroduce request-origin fallback.
- Fix: update comment to match the intended invariant.

### AGG-M15 — `.env.local.example` documents stale `NEXT_UPLOAD_BODY_MAX_BYTES`

- Sources: `document-specialist` DOC-C4.
- Severity/confidence: Medium / High.
- Status: Confirmed mismatch.
- Location: `apps/web/.env.local.example:45-47`, `apps/web/src/lib/upload-limits.ts:3-21`.
- Issue: example pins the old 206 MiB value and can break documented 250 MiB restores.
- Fix: update to 278921216 / 266 MiB and clarify it covers photo uploads and DB restore transport overhead.

### AGG-M16 — Localized error boundary has a broken skip-link target

- Sources: `designer` D1.
- Severity/confidence: Medium / High.
- Status: Confirmed.
- Location: `apps/web/src/app/[locale]/layout.tsx:123-128`, `apps/web/src/app/[locale]/error.tsx:16-46`, `apps/web/src/__tests__/a11y-us-p15.test.ts:29-37`.
- Issue: the global skip link targets `#main-content`, but the localized error boundary main lacks that id.
- Fix: add `id="main-content" tabIndex={-1}` and a source regression.

### AGG-M17 — Search result links are tab-focusable while focus scanner exempts them

- Sources: `designer` D2.
- Severity/confidence: Medium / High.
- Status: Confirmed from source.
- Location: `apps/web/src/components/search.tsx:71-79`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts:41-75`.
- Issue: real `<Link role="option" href=...>` elements can receive Tab focus without a visible focus style, while the scanner assumes role-option results are not tab-focusable.
- Fix: choose a consistent combobox or link-list pattern; update scanner exemption.

### AGG-M18 — Error states can render with an empty document title

- Sources: `designer` D3.
- Severity/confidence: Medium / Medium.
- Status: Confirmed runtime under DB-down dev environment.
- Location: `apps/web/src/app/[locale]/layout.tsx:17-58`, `apps/web/src/app/[locale]/error.tsx:7-47`.
- Issue: localized error UI can show with `document.title === ""`.
- Fix: add regression; investigate metadata/error-boundary path; use guarded client fallback title if Next cannot preserve metadata.

## Low Findings

### AGG-L1 — Smart-collection cursor pages still pay a full window count

- Sources: `perf-reviewer` PERF-04.
- Severity/confidence: Low / Medium.
- Location: `apps/web/src/lib/data.ts:1388-1430`, `apps/web/src/app/actions/public.ts:161-213`.
- Fix: split first-page count from cursor-page lookahead.

### AGG-L2 — Admin backfill candidate discovery lacks a `pipeline_version` index

- Sources: `perf-reviewer` PERF-05.
- Severity/confidence: Low / Medium.
- Location: `apps/web/src/lib/admin-backfill-runner.ts:370-410`, `apps/web/src/db/schema.ts:111-117`.
- Fix: add `(processed, pipeline_version, id)` index if production backfill status checks warrant schema churn, or remove eager count.

### AGG-L3 — Admin e2e coverage is opt-in locally

- Sources: `test-engineer` TE-06.
- Severity/confidence: Low / High.
- Location: `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/helpers.ts:28-45`.
- Fix: emit clear local skip summary or split public/all scripts with all failing without admin credentials.

### AGG-L4 — `GalleryConfig.avifEffort` comment says 4-9 while validator/UI support 0-9

- Sources: `document-specialist` DOC-C5.
- Severity/confidence: Low / High.
- Location: `apps/web/src/lib/gallery-config.ts:83-84`, validator/UI/messages at documented locations.
- Fix: update comment to `0-9`.

### AGG-L5 — SEO settings hints are visual only

- Sources: `designer` D4.
- Severity/confidence: Low / High.
- Location: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:95-174`.
- Fix: add hint ids and `aria-describedby` relationships, with a source contract test.

## Agent Failures

No required reviewer failed after retry. One initial attempt to start a sixth concurrent agent hit the live agent limit; the remaining roles were run in later waves.

## Final Sweep Result

All current-cycle per-agent review files were read. The aggregate keeps per-agent files as provenance and dedupes only the overlapping OG fallback finding. Historical `.context/reviews/**` and archived plan artifacts were not treated as new cycle findings.
