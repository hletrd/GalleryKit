# Architect + Debugger + Tracer Review

Scope: PROMPT 1, review-plan-fix cycle 1/100.

## Inventory

Required docs and policy surfaces examined:
- `AGENTS.md` instructions supplied in prompt.
- `CLAUDE.md` project contract, especially upload, restore, semantic search, runtime topology, quality gates, and security architecture.
- `.context/plans/README.md` and existing `.context/reviews/` / `.context/plans/` inventory at max depth 3 for review history shape.
- `package.json`, `apps/web/package.json`, deployment files, migrations, and scripts inventory.

Relevant code/docs inventoried:
- 474 TypeScript/TSX/JS/MJS source files under `apps/web/src`.
- All route/action/script/migration entry points under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/components`, `apps/web/scripts`, and `apps/web/drizzle`.
- High-risk cross-file flows fully traced: DB restore scanner -> restore action -> mysql subprocess; browser upload -> queue -> embeddings; Lightroom upload -> queue -> embeddings; semantic API -> request body parsing -> rate limit -> CLIP scan; auth/origin/rate-limit helpers; config propagation and semantic-mode gates; related regression tests.

## Findings

### 1. HIGH - SQL restore scanner misses dangerous statements with comments between keywords

- Location: `apps/web/src/lib/sql-restore-scan.ts:39-105`, `apps/web/src/lib/sql-restore-scan.ts:113-137`; restore enforcement at `apps/web/src/app/[locale]/admin/db-actions.ts:408-436`.
- Severity: High.
- Confidence: High.
- Status: Confirmed.
- Role lens: debugger + tracer.

The restore scanner removes ordinary block comments with:

`const withoutComments = withoutConditionals.replace(/\/\*.*?\*\//gs, '');`

Then it applies dangerous-statement patterns such as `/\bDROP\s+TABLE\b/i`, `/\bCREATE\s+DATABASE\b/i`, `/\bCALL\s+\w+/i`, and similar. Removing comments as an empty string lets comment-separated token boundaries collapse. The tests cover `GR/**/ANT` because that collapses into `GRANT` and is caught (`apps/web/src/__tests__/sql-restore-scan.test.ts:16-27`), but the same normalization breaks multi-token patterns: `DROP/**/TABLE images;` becomes `DROPTABLE images;`, which no longer matches `DROP\s+TABLE`.

Failure scenario:
An admin restores a malicious or tampered SQL dump. The pre-restore scan at `db-actions.ts:413-425` calls `containsDangerousSql()`, sees no match for `DROP/**/TABLE`, and proceeds to pipe the file into `mysql --one-database` at `db-actions.ts:454-518`. MySQL treats comments as token separators in executable SQL contexts, so the destructive statement can still execute inside the app database. The scanner's stated protection against arbitrary table drops/deletes/truncates is bypassed.

Concrete fix:
Preserve a token separator when stripping ordinary comments for multi-token scanning, or scan a second normalized form. Add regression tests for comment-separated multi-token dangerous statements: `DROP/**/TABLE`, `DROP/**/DATABASE`, `CREATE/**/DATABASE`, `CREATE/**/USER`, `DELETE/**/FROM`, `TRUNCATE/**/TABLE`, `CALL/**/proc()`, `RENAME/**/USER`, and `SQL/**/SECURITY/**/DEFINER`. Be careful not to regress the existing `GR/**/ANT` in-token detection; the safest shape is likely to scan both comment-as-empty and comment-as-space normalized variants before allowing restore.

### 2. MEDIUM - Lightroom uploads skip semantic embedding because semantic mode is not forwarded to the queue

- Location: browser enqueue includes the snapshot at `apps/web/src/app/actions/images.ts:467-502`, queue consumes it at `apps/web/src/lib/image-queue.ts:391-413` and `apps/web/src/lib/image-queue.ts:512-531`, Lightroom enqueue omits it at `apps/web/src/app/api/admin/lr/upload/route.ts:425-465`.
- Test gap: `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:39-43` only asserts browser upload wiring; `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:318-336` asserts six Lightroom config fields but not `semanticSearchMode`.
- Severity: Medium.
- Confidence: High.
- Status: Confirmed.
- Role lens: architect + tracer.

The queue intentionally avoids a config read for normal upload jobs that already carry `quality` and `imageSizes`. For embedding mode, it uses:

`resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled'`

and only fetches config when both `resolvedSemanticMode === null` and `job.semanticSearchMode === undefined`. Browser uploads pass `semanticSearchMode: uploadConfig.semanticSearchMode`; Lightroom uploads pass the other queue config fields but omit `semanticSearchMode`. Because Lightroom jobs do include `quality` and `imageSizes`, the bootstrap config-load gate does not run, and the embedding hook defaults to disabled.

Failure scenario:
Production semantic search is enabled and backfilled. A photographer publishes new photos through the Lightroom PAT endpoint. The image processing job marks the images processed, but the embedding hook sees missing `job.semanticSearchMode` and returns at `image-queue.ts:531`. Those new photos never appear in natural-language or similar-photo search until an operator manually reruns the CLIP backfill.

Concrete fix:
Add `semanticSearchMode: config.semanticSearchMode` to the Lightroom `enqueueImageProcessing` payload. Extend `lr-upload-hdr-gate.test.ts` or add a dedicated source-contract test asserting the LR enqueue block forwards `semanticSearchMode: config.semanticSearchMode`, mirroring the browser upload test.

### 3. MEDIUM - Semantic search reads the request body before a reliable byte/rate-limit gate

- Location: `apps/web/src/app/api/search/semantic/route.ts:128-155`, `apps/web/src/app/api/search/semantic/route.ts:159-164`, and rate-limit placement at `apps/web/src/app/api/search/semantic/route.ts:208-216`.
- Tests: content-length errors are covered at `apps/web/src/__tests__/semantic-search-route.test.ts:134-150`; chunked casing, missing content-length, and byte-vs-character body caps are not covered.
- Severity: Medium.
- Confidence: Medium.
- Status: Likely.
- Role lens: debugger + tracer.

The route tries to reject chunked bodies and oversized payloads before parsing, but the guard is incomplete:

- `transferEncoding?.includes('chunked')` is case-sensitive even though HTTP header values are case-insensitive.
- If `Content-Length` is absent, the route calls `await request.text()` before any rate-limit pre-increment.
- After reading, it compares `rawBody.length` to `MAX_SEMANTIC_BODY_BYTES`; that is UTF-16 code units, not bytes.

The limiter protecting semantic work is not reached until line 210, after the whole request body has already been read into memory and parsed.

Failure scenario:
A client sends same-origin-looking requests with no `Content-Length` or a non-lowercase transfer encoding value and a very large JSON body. The handler materializes the body in `request.text()` before it can charge the semantic rate-limit bucket. Even if JSON parsing eventually fails or the post-read length check rejects, memory and CPU were already consumed outside the intended limiter.

Concrete fix:
Move a cheap rate-limit pre-increment immediately after same-origin and maintenance checks, or add a separate pre-body read limiter. Normalize transfer encoding with lower-case comma-token parsing. Treat missing `Content-Length` as unsupported unless the body is read through an explicit byte-limited stream. When checking after read, use `Buffer.byteLength(rawBody, 'utf8')` or stream-count bytes, not string length. Add tests for `Transfer-Encoding: Chunked`, missing content-length with oversized text, and multibyte bodies whose character count is below the limit but byte count exceeds it.

## Final Sweep

Commonly missed issue classes checked:
- Auth/origin wrappers: admin API routes use `withAdminAuth`; mutating server actions route through `requireSameOriginAdmin()` or documented exemptions.
- Path traversal and upload serving: `serve-upload.ts` validates top-level dirs, safe path segments, symlinks, realpath containment, extension/content-type alignment, and HEAD/ETag behavior.
- Upload races: browser and Lightroom paths both hold the upload-processing contract lock, use restore-maintenance gates, disk pre-checks, quota claim/settle, and original cleanup. The remaining drift found is semantic-mode forwarding.
- Background queue races: processing claims, delete-mid-processing cleanup, bootstrap retries, permanent failure tracking, restore quiesce/resume, and retry action were traced. The main durability risk is the non-durable fire-and-forget embedding hook noted through the Lightroom drift; a broader durable embedding queue would be a future hardening path.
- SQL/raw query surfaces: Drizzle parameterization is dominant. The restore scanner is the material exception because it is intentionally parsing SQL text before feeding `mysql`.
- Public expensive routes: semantic search and similar-image search are rate-limited and same-origin-gated after syntactic validation; the body-read-before-limit gap remains for semantic POST.
- Privacy field guards: public select fields, map select fields, search enrichment select, and related compile-time guards were reviewed; no new PII leak found in this pass.
- Migrations/journal: migration files and `_journal.json` were inventoried; no monotonicity or missing-journal issue investigated deeply because this review found higher-signal runtime/security defects first.
- UI/visual areas: repo contains a UI, but this subagent role is architect/debugger/tracer, not designer. I did not run browser visual QA; static UI-adjacent checks were limited to flows tied to the findings and existing source-contract tests.
- Skipped/irrelevant: generated binary/image fixtures, `.next`, `node_modules`, live production deploy, and external services were not exercised. Existing dirty review artifacts (`.context/reviews/test-engineer.md`, `.context/reviews/critic-verifier.md`) were left untouched.
