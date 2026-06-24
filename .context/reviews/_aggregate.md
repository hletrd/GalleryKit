# Aggregate Review — review-plan-fix cycle 1

Date: 2026-06-22
HEAD reviewed: `1d5545cb`
Review lanes completed: code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer, product-marketer-reviewer.

## Summary

Raw findings produced this cycle: 49. After deduplication, 43 distinct findings remain. Highest-signal overlaps are:

- Admin photo detail uses `isAdmin=true` UI while fetching the public projection: code-reviewer + architect.
- Guardrail scanner weakness around mutating action origin and public route rate-limit checks: critic + verifier + test-engineer.
- Semantic search production/backfill/serving readiness issues: perf-reviewer + critic + tracer + debugger + document-specialist + product-marketer-reviewer.
- Restore/queue race risks around post-restore stale async work and retry maintenance: tracer + debugger.
- Touch-target policy gaps: verifier + test-engineer + designer.

## Deduped Findings

### AGG-01 — Mutating server-action origin scanner accepts mutation before returning the origin error

Severity: High
Confidence: High
Type: Confirmed issue
Agreement: verifier, critic
Source: `.context/reviews/verifier.md`, `.context/reviews/critic.md`

Evidence/citation: `apps/web/scripts/check-action-origin.ts` validates presence/order too loosely; verifier demonstrated a mutating action can call `requireSameOriginAdmin()` yet mutate before returning its error.

Failure scenario: A future action passes `lint:action-origin` while performing a DB write before origin rejection, weakening CSRF defense-in-depth.

Suggested fix: Make the scanner require a top-level early return on the `requireSameOriginAdmin()` result before recognized mutation calls, with regression fixtures for mutation-before-return.

### AGG-02 — Action-origin scanner silently passes star re-exports

Severity: Medium
Confidence: High
Type: Confirmed issue
Agreement: verifier
Source: `.context/reviews/verifier.md`

Evidence/citation: `apps/web/scripts/check-action-origin.ts` does not fail `export * from './mutating-actions'` style server-action modules.

Failure scenario: A mutating action moves behind a star re-export and exits the scanner's coverage.

Suggested fix: Either resolve star re-exports or fail them with a clear message in action files.

### AGG-03 — Public route rate-limit scanner accepts any rate-limit import instead of proving a pre-increment call

Severity: High
Confidence: High
Type: Confirmed issue
Agreement: critic, verifier, test-engineer
Source: `.context/reviews/critic.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`

Evidence/citation: `apps/web/scripts/check-public-route-rate-limit.ts` can pass files that import rate-limit helpers without calling a pre-increment helper before mutation.

Failure scenario: A public mutating API route ships without a real write limiter but passes the required gate.

Suggested fix: Require an actual pre-increment call in the handler body before mutation, with fixtures for import-only and rollback-only bypasses.

### AGG-04 — CI/configured gate list omits the public-route rate-limit lint

Severity: High
Confidence: High
Type: Confirmed issue
Agreement: test-engineer
Source: `.context/reviews/test-engineer.md`

Evidence/citation: `package.json` exposes `lint:public-route-rate-limit`, but CI coverage was reported missing by test-engineer.

Failure scenario: The required public route mutation guard regresses outside local/manual gate runs.

Suggested fix: Add the gate to CI or the canonical full-check script.

### AGG-05 — Admin photo detail enables admin color UI while fetching only the public image projection

Severity: Medium
Confidence: High
Type: Confirmed issue
Agreement: code-reviewer, architect
Source: `.context/reviews/code-reviewer.md`, `.context/reviews/architect.md`

Evidence/citation: Admin photo page passes `isAdmin=true` into viewer UI, but the data path uses public projection fields from `apps/web/src/lib/data.ts`, omitting admin-only color/GPS/HDR audit fields.

Failure scenario: Admins open a photo expecting color audit/HDR metadata and see incomplete or misleading admin UI.

Suggested fix: Add an admin-safe photo detail query/select or stop enabling admin-only viewer UI when only public data is present; add privacy tests proving admin-only fields do not leak publicly.

### AGG-06 — DB restore accepts DROP-only or incomplete app-table dumps

Severity: High
Confidence: High
Type: Confirmed issue
Agreement: tracer
Source: `.context/reviews/tracer.md`

Evidence/citation: `apps/web/src/app/[locale]/admin/db-actions.ts` / restore validation allow a dump that drops required tables without recreating/populating the complete app schema.

Failure scenario: An admin restores a malformed dump that passes preflight and destroys required tables/data.

Suggested fix: Strengthen restore scanner/post-restore checks to require the committed app table set and reject DROP-only/incomplete dumps before execution.

### AGG-07 — Late caption/embedding hooks can write into a freshly restored database

Severity: High
Confidence: High
Type: Confirmed issue
Agreement: debugger
Source: `.context/reviews/debugger.md`

Evidence/citation: Detached post-processing hooks in `apps/web/src/lib/image-queue.ts` can continue after queue quiescence and write by numeric image id after DB restore.

Failure scenario: Restore imports a different photo under the same id, then stale async work writes an embedding/caption for the pre-restore original into the restored row.

Suggested fix: Track and await/cancel detached hooks during restore maintenance, or fence writes with a generation/original filename token.

### AGG-08 — Retrying failed images ignores restore maintenance

Severity: Medium
Confidence: Medium
Type: Likely issue
Agreement: debugger
Source: `.context/reviews/debugger.md`

Evidence/citation: `retryFailedImage` in `apps/web/src/app/actions/images.ts` can clear failure state and enqueue while restore maintenance is active.

Failure scenario: Admin retry races with restore, causing inconsistent failure state or a lost enqueue.

Suggested fix: Return a maintenance error before mutation when `isRestoreMaintenanceActive()` is true; add regression coverage.

### AGG-09 — Permanent failed-image retry state is not durable across restarts

Severity: High
Confidence: High
Type: Confirmed design issue
Agreement: architect
Source: `.context/reviews/architect.md`

Evidence/citation: Failed/retry control maps are process-local in `apps/web/src/lib/image-queue.ts`.

Failure scenario: A process restart forgets permanent failure/retry throttle state and can leave rows requiring manual recovery.

Suggested fix: Persist retry/permanent-failure state in DB columns or rebuild process-local maps from DB at startup.

### AGG-10 — Sidecar color backfill has unsafe memory/concurrency and live-processing races

Severity: Medium
Confidence: High
Type: Confirmed issue
Agreement: perf-reviewer, architect
Source: `.context/reviews/perf-reviewer.md`, `.context/reviews/architect.md`

Evidence/citation: `apps/web/scripts/backfill-color-pipeline.ts` loads broad candidate sets and does not share the per-image processing lock used by live queue paths.

Failure scenario: Two operator backfills or a backfill plus live retry re-encode the same image, wasting memory/CPU and risking stale derivative metadata.

Suggested fix: Stream candidates in bounded batches, enforce operator concurrency lock, and share per-image locking with live processing/retry.

### AGG-11 — Semantic search has per-IP limits but no global CPU/concurrency guard

Severity: Medium
Confidence: Medium
Type: Likely issue
Agreement: perf-reviewer
Source: `.context/reviews/perf-reviewer.md`

Evidence/citation: `apps/web/src/app/api/search/semantic/route.ts` can run real CLIP text embedding and scan candidates concurrently across many IP buckets.

Failure scenario: Distributed traffic fans out CPU-heavy embedding/scoring work and degrades image serving.

Suggested fix: Add a small process-global semantic-search concurrency limiter or queue with clear 503/429 behavior.

### AGG-12 — Semantic search refunds rate-limit tokens after expensive failures

Severity: Medium
Confidence: High
Type: Confirmed issue
Agreement: debugger
Source: `.context/reviews/debugger.md`

Evidence/citation: `apps/web/src/app/api/search/semantic/route.ts` rolls back rate-limit attempts after some expensive embedding/search failure paths.

Failure scenario: Repeated expensive failing requests avoid consuming limiter budget, amplifying DoS cost.

Suggested fix: Only roll back before expensive work starts; after embedding/scanning begins, keep the consumed attempt.

### AGG-13 — Semantic search scans only newest 5000 embeddings and silently ignores older rows

Severity: Medium
Confidence: High
Type: Confirmed product/performance risk
Agreement: critic, product-marketer-reviewer
Source: `.context/reviews/critic.md`, `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `SEMANTIC_SCAN_LIMIT` in CLIP/search paths bounds search to newest rows without clear public/admin disclosure.

Failure scenario: Large galleries produce empty/missing relevant results for older photos, making the feature appear unreliable.

Suggested fix: Disclose the limit, add pagination/vector index strategy, or provide admin status showing indexed/searchable coverage.

### AGG-14 — Stub and production semantic embeddings can overwrite or strand each other

Severity: Medium
Confidence: High
Type: Likely issue
Agreement: tracer
Source: `.context/reviews/tracer.md`

Evidence/citation: `image_embeddings` model-version semantics and backfill/upsert paths can leave mode-specific rows missing or overwritten.

Failure scenario: Switching from stub to production leaves existing photos unavailable to production search/similar results.

Suggested fix: Enforce `(image_id, model_version)` uniqueness and mode-specific writes, or make backfill replace/verify the active model version explicitly.

### AGG-15 — Documented CLIP production backfill command is a no-op before activation

Severity: Medium
Confidence: High
Type: Confirmed docs/operator issue
Agreement: document-specialist, product-marketer-reviewer
Source: `.context/reviews/document-specialist.md`, `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `apps/web/README.md` / semantic-search docs show `--production`, while `apps/web/scripts/backfill-clip-embeddings.ts` exits without work unless production is already enabled or `--force` is used.

Failure scenario: Operator runs the documented sequence, enables production, and existing photos have no production embeddings.

Suggested fix: Add `--force` to pre-activation docs or alter the script to treat `--production` as an explicit operator override.

### AGG-16 — Semantic-search production env knobs are missing from `.env.local.example`

Severity: Low
Confidence: Medium
Type: Likely docs/onboarding issue
Agreement: document-specialist, product-marketer-reviewer
Source: `.context/reviews/document-specialist.md`, `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `apps/web/.env.local.example` omits `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT`, while docs/scripts require them.

Failure scenario: Operators seed weights/backfill incorrectly or point runtime at the wrong model root.

Suggested fix: Add commented production-only env examples with warnings.

### AGG-17 — Semantic search is marketed as broadly live while fresh installs default disabled/operator gated

Severity: High
Confidence: High
Type: Confirmed product-truth issue
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `README.md` feature bullets emphasize semantic search; `gallery-config-shared.ts` defaults disabled and `gallery-config.ts` heals production to disabled without env opt-in.

Failure scenario: Self-hosters expect turnkey AI search, get 503/stub output, and lose trust.

Suggested fix: Reword README to "operator-enabled/demo-live" with activation checklist.

### AGG-18 — Auto Alt-Text presents a stub as an AI accessibility feature

Severity: Medium-High
Confidence: High
Type: Confirmed product/copy issue
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `apps/web/messages/en.json` frames local Florence-2 AI alt text while `caption-generator.ts` emits generic EXIF-derived placeholders.

Failure scenario: Admin bulk-applies non-visual placeholder text to public titles/descriptions.

Suggested fix: Rename/hide stub feature or block applying stub suggestions to public metadata.

### AGG-19 — Similar photos panel keeps stale results across in-place photo navigation

Severity: Medium
Confidence: High
Type: Confirmed issue
Agreement: debugger
Source: `.context/reviews/debugger.md`

Evidence/citation: `apps/web/src/components/similar-photos.tsx` keeps prior results while photo id changes in the viewer.

Failure scenario: A user navigates to another photo and sees similar-photo suggestions for the previous image.

Suggested fix: Reset state on image id changes and discard stale responses.

### AGG-20 — Similar-photo route accepts partially numeric ids

Severity: Low
Confidence: High
Type: Confirmed issue
Agreement: debugger
Source: `.context/reviews/debugger.md`

Evidence/citation: `apps/web/src/app/api/search/similar/[id]/route.ts` parses ids with `parseInt`, accepting strings such as `123abc`.

Failure scenario: Ambiguous URLs hit valid rows unexpectedly and complicate cache/log analysis.

Suggested fix: Require a full decimal integer regex before parsing.

### AGG-21 — View-retention purge cannot use existing view-time indexes

Severity: Medium
Confidence: High
Type: Confirmed performance issue
Agreement: perf-reviewer
Source: `.context/reviews/perf-reviewer.md`

Evidence/citation: `apps/web/src/lib/view-retention.ts` purges by `viewed_at`, but documented indexes are suffix columns such as `(bot, viewed_at, ...)`.

Failure scenario: Hourly retention deletes degrade on large analytics tables.

Suggested fix: Add leading `viewed_at` indexes or revise purge predicates to match existing indexes.

### AGG-22 — Rate-limit bucket purge has the same suffix-index problem

Severity: Medium
Confidence: High
Type: Confirmed performance issue
Agreement: perf-reviewer
Source: `.context/reviews/perf-reviewer.md`

Evidence/citation: DB-backed rate-limit cleanup/decrement paths cannot use indexes efficiently if `expires_at`/time columns are not leading.

Failure scenario: Cleanup queries become full scans under sustained traffic.

Suggested fix: Add purpose-built expiration indexes or bounded chunking keyed by indexed columns.

### AGG-23 — Container has no runtime CPU/RSS guard for combined Sharp + CLIP + request load

Severity: Low
Confidence: Medium
Type: Runtime risk
Agreement: perf-reviewer
Source: `.context/reviews/perf-reviewer.md`

Evidence/citation: Docker compose/deploy surfaces lack explicit resource limits for image processing plus CLIP load.

Failure scenario: Large processing/backfill/search workload exhausts constrained host memory.

Suggested fix: Add documented resource guidance and optional compose resource limits.

### AGG-24 — Production dependency tree contains vulnerable PostCSS via Next.js

Severity: Medium
Confidence: High
Type: Confirmed dependency issue
Agreement: security-reviewer
Source: `.context/reviews/security-reviewer.md`

Evidence/citation: `npm audit --workspace=apps/web --omit=dev` reported vulnerable nested `postcss`.

Failure scenario: Known parser vulnerability remains in production dependency tree until upstream fix/override.

Suggested fix: Upgrade Next/PostCSS when a fixed compatible release exists or add a targeted override if safe.

### AGG-25 — Dev dependency tree contains vulnerable Vite, Babel, and js-yaml packages

Severity: Medium
Confidence: High
Type: Confirmed dependency issue
Agreement: security-reviewer
Source: `.context/reviews/security-reviewer.md`

Evidence/citation: `npm audit --workspace=apps/web --include=dev` reported dev advisories.

Failure scenario: Developer/test tooling remains exposed to known vulnerabilities.

Suggested fix: Upgrade affected dev dependencies or document unavoidable transitive advisory constraints.

### AGG-26 — Production CSP allows inline styles

Severity: Low
Confidence: Medium
Type: Manual-validation security risk
Agreement: security-reviewer
Source: `.context/reviews/security-reviewer.md`

Evidence/citation: `apps/web/src/lib/content-security-policy.ts` / headers allow inline style posture.

Failure scenario: A future style injection sink has weaker CSP containment.

Suggested fix: Move toward nonced/hashes for inline styles where practical, or document why framework constraints require this.

### AGG-27 — Public search LIKE escaping relies on MySQL SQL mode

Severity: Low
Confidence: Medium
Type: Manual-validation risk
Agreement: security-reviewer
Source: `.context/reviews/security-reviewer.md`

Evidence/citation: Public search escaping uses backslash semantics that depend on `NO_BACKSLASH_ESCAPES` not being enabled.

Failure scenario: Different DB SQL mode changes wildcard escaping behavior and broadens search scans.

Suggested fix: Add explicit `ESCAPE` clauses or SQL-mode invariant checks.

### AGG-28 — Credential-management admin page is outside nginx admin mutation throttle

Severity: Medium
Confidence: High
Type: Confirmed security/perimeter issue
Agreement: critic
Source: `.context/reviews/critic.md`

Evidence/citation: `apps/web/nginx/default.conf` throttling patterns do not include the admin token/credential management route.

Failure scenario: Token-management mutations receive less edge throttling than other admin mutation surfaces.

Suggested fix: Extend nginx throttle patterns or rely on application-level throttles with documented parity.

### AGG-29 — Token management exists but is absent from admin navigation

Severity: Low
Confidence: Medium
Type: Manual-validation IA risk
Agreement: critic
Source: `.context/reviews/critic.md`

Evidence/citation: Token page exists under admin but is not discoverable in `admin-nav` according to critic.

Failure scenario: Admins cannot find/revoke Lightroom tokens promptly.

Suggested fix: Add a nav entry or another obvious entry point.

### AGG-30 — Legacy public original-upload symlinks may survive production startup

Severity: Medium
Confidence: Medium
Type: Manual-validation risk
Agreement: tracer
Source: `.context/reviews/tracer.md`

Evidence/citation: Legacy `public/uploads/original` symlink/path cleanup needs manual validation against startup migration.

Failure scenario: Private originals become reachable under public uploads on upgraded deployments.

Suggested fix: Add startup assertion/removal and test for legacy symlink containment.

### AGG-31 — Storage abstraction can place private originals under public upload root if adopted

Severity: High when adopted; latent currently
Confidence: High
Type: Latent architectural issue
Agreement: architect, product-marketer-reviewer noted storage is not public-supported
Source: `.context/reviews/architect.md`

Evidence/citation: `apps/web/src/lib/storage/local.ts` supports local URLs under upload roots while storage abstraction is not integrated into main upload path.

Failure scenario: A future migration to the abstraction writes originals to a public path.

Suggested fix: Split private-original and public-derivative storage roots/contracts before adopting the abstraction.

### AGG-32 — Search modal is clipped inside sticky nav and does not cover/inert the page

Severity: High
Confidence: High
Type: Confirmed UI/a11y issue
Agreement: designer
Source: `.context/reviews/designer.md`

Evidence/citation: `apps/web/src/components/search.tsx` renders fixed overlay/dialog inside `nav-client.tsx` sticky filtered nav; live browser measured overlay height equal to nav height.

Failure scenario: Search claims `aria-modal=true` while page content remains pointer/accessibility reachable.

Suggested fix: Portal search to body or use Radix Dialog; assert viewport coverage and inert background.

### AGG-33 — Tag filter "All" chip renders below 44 px width in English

Severity: Medium
Confidence: High
Type: Confirmed UI/a11y issue
Agreement: designer, verifier/test-engineer on audit gap
Source: `.context/reviews/designer.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`

Evidence/citation: `apps/web/src/components/tag-filter.tsx` has `min-h-11` but not `min-w-11`; live English button measured `41x44`.

Failure scenario: Public gallery filter violates repo touch-target floor.

Suggested fix: Add `min-w-11 justify-center`; extend tests to catch rendered short-label targets.

### AGG-34 — Footer Admin link is below 44 px width

Severity: Medium
Confidence: High
Type: Confirmed UI/a11y issue
Agreement: designer
Source: `.context/reviews/designer.md`

Evidence/citation: `apps/web/src/components/footer.tsx` Admin link measured `36x44` English and `31x44` Korean.

Failure scenario: Repeated public footer target violates project touch-target policy.

Suggested fix: Add `min-w-11 justify-center` or padding.

### AGG-35 — Touch-target audit stale budgets can mask future regressions

Severity: Medium
Confidence: High
Type: Confirmed test gap
Agreement: test-engineer, verifier, designer
Source: `.context/reviews/test-engineer.md`, `.context/reviews/verifier.md`, `.context/reviews/designer.md`

Evidence/citation: Static touch-target audit passed while live browser found sub-44px rendered targets.

Failure scenario: New short-label controls pass class-based audit but fail actual touch size.

Suggested fix: Tighten static budgets and add browser/rendered-size checks for representative controls.

### AGG-36 — Admin data tables lack local horizontal overflow containment

Severity: Medium
Confidence: Medium
Type: Likely UI issue/manual validation
Agreement: designer
Source: `.context/reviews/designer.md`

Evidence/citation: `topic-manager.tsx`, `tag-manager.tsx`, and `analytics-client.tsx` render dense tables without `overflow-x-auto` wrappers.

Failure scenario: Narrow admin viewport clips action columns or causes document-level horizontal scroll.

Suggested fix: Wrap tables in max-width overflow containers or provide stacked mobile layouts.

### AGG-37 — Custom modal surfaces rely on focus trap but do not hide/inert background

Severity: Medium
Confidence: Medium
Type: Manual-validation a11y risk
Agreement: designer
Source: `.context/reviews/designer.md`

Evidence/citation: `lightbox.tsx` and `info-bottom-sheet.tsx` use custom `FocusTrap`; browser accessibility snapshots still exposed background controls.

Failure scenario: Screen reader browse mode reaches background controls while a modal claims `aria-modal=true`.

Suggested fix: Apply inert/aria-hidden to background siblings or migrate to a modal primitive that manages it.

### AGG-38 — Persisted light theme causes nav theme-button hydration mismatch

Severity: Medium
Confidence: High
Type: Confirmed UI/runtime issue
Agreement: designer
Source: `.context/reviews/designer.md`

Evidence/citation: `nav-client.tsx` renders theme icon/title from `useTheme()` before mount; browser logs showed hydration mismatch with `gallery_theme=light`.

Failure scenario: Returning visitors get nav flicker/subtree regeneration and dev overlay noise.

Suggested fix: Render stable placeholder until mounted or scope hydration suppression.

### AGG-39 — `retryFailedImage` has a hardcoded English error

Severity: Low
Confidence: High
Type: Confirmed i18n issue
Agreement: code-reviewer
Source: `.context/reviews/code-reviewer.md`

Evidence/citation: `apps/web/src/app/actions/images.ts` returns one English retry error in a translated action contract.

Failure scenario: Korean admin receives English error text.

Suggested fix: Add message key and use the existing translator.

### AGG-40 — Root color/HDR claims are easy to misread as shipped public HDR support

Severity: Medium
Confidence: High
Type: Confirmed product-truth issue
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `README.md` compresses wide-gamut delivery, HDR detection, and HDR ingest into one "photographer-grade" claim; code/docs keep public HDR delivery deferred.

Failure scenario: Operators expect public HDR output but visitors receive SDR derivatives.

Suggested fix: Split wide-gamut and HDR-detection claims and explicitly state public HDR delivery is not shipped.

### AGG-41 — High-performance positioning lacks public proof or sizing guidance

Severity: Medium
Confidence: Medium
Type: Product/docs risk
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `README.md` says high-performance without benchmarks, throughput, or host sizing.

Failure scenario: Operators deploy undersized hosts and interpret expected heavy processing as a product failure.

Suggested fix: Add benchmark/sizing guidance or soften the claim.

### AGG-42 — Demo-specific deploy defaults leak into self-hosting posture

Severity: Medium
Confidence: High
Type: Confirmed docs/config issue
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: `apps/web/src/site-config.json` and `apps/web/nginx/default.conf` include `gallery.atik.kr` defaults while README is self-hosting oriented.

Failure scenario: Self-hoster copies demo config and ships incorrect domain/static paths.

Suggested fix: Move demo config to demo-specific examples and make checked-in defaults placeholder/operator-safe.

### AGG-43 — Public GitHub/support trust signal needs launch validation

Severity: Low-Medium
Confidence: Medium
Type: Manual-validation product risk
Agreement: product-marketer-reviewer
Source: `.context/reviews/product-marketer-reviewer.md`

Evidence/citation: README/footer point at `github.com/hletrd/gallerykit`; packages are `private`.

Failure scenario: Demo visitors click a footer repo link and hit a private/missing repo.

Suggested fix: Verify repo publicness before launch or make the footer repo URL configurable/removable.

## Agent Failures

None. The `test-engineer` lane initially could not be spawned because the active-agent limit was reached; it was launched successfully after a completed lane was closed.

## Final Sweep

All per-agent review files listed above were present before aggregation. The aggregate preserves provenance and elevates duplicates by agreement. Implementation planning must either schedule each aggregate finding or explicitly defer it with original severity/confidence, reason, and exit criterion under `.context/plans/`.
