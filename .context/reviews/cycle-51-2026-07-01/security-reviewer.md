# summary

Cycle 51 security/privacy review for HEAD `11c4337fce35e3fcab789228a445960d6f573261`.

No actionable security or privacy defects found.

The only application-source change since the Cycle 50 baseline is the service-worker contract test fix in `apps/web/src/__tests__/sw-template-contract.test.ts`; it closes the Cycle 50 generated-worker/classifier parity gap by executing `isRevocableShareHtmlRoute` from both the template and generated worker against concrete route cases (`apps/web/src/__tests__/sw-template-contract.test.ts:32`, `apps/web/src/__tests__/sw-template-contract.test.ts:48`, `apps/web/src/__tests__/sw-template-contract.test.ts:124`). I found no new evidence changing severity or scheduling for carry-forward deferred items `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.

Validation run in this lane:

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm audit --omit=dev --workspace=apps/web` - 0 vulnerabilities.
- `npm test --workspace=apps/web -- check-api-auth.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts privacy-fields.test.ts search-route-privacy.test.ts tracked-secrets.test.ts api-auth-response-headers.test.ts request-origin.test.ts backup-download-route.test.ts serve-upload.test.ts upload-paths.test.ts semantic-route.test.ts similar-route.test.ts og-photo-fallback.test.ts seo-og-url.test.ts map-privacy.test.ts sw-template-contract.test.ts` - pass, 15 files / 315 tests.
- `npm run lint --workspace=apps/web` - pass.
- `npm run typecheck --workspace=apps/web` - pass.
- `git diff --check` - pass.

# inventory

Required context read before source review:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-50-2026-07-01-plan.md`
- `.context/plans/cycle-50-2026-07-01-deferred.md`
- `.context/reviews/cycle-50-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/code-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/security-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/perf-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/verifier-test-debugger.md`
- `.context/reviews/cycle-50-2026-07-01/document-specialist.md`
- `.context/reviews/cycle-50-2026-07-01/ui-ux-designer.md`

Security/privacy source surfaces inspected:

- Auth/session/token handling: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`.
- Admin API wrappers and server-action provenance: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, and the three scanner gates listed in the summary.
- Public route rate limits and expensive public APIs: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, upload route handlers, and feed routes via `lint:public-route-rate-limit`.
- Upload/file path handling: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/process-image.ts`, and the LR upload route.
- SSRF/open redirects and rendered metadata sinks: `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/safe-json-ld.ts`, both OG routes, and JSON-LD/privacy tests.
- CSV/JSON-LD/OG sanitization: `apps/web/src/lib/csv-escape.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/og-sanitize.ts`, plus the relevant tests in the focused suite.
- DB backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Privacy field guards: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/search-route-privacy.test.ts`, `apps/web/src/__tests__/map-privacy.test.ts`.
- Deployment scripts/config: `scripts/deploy-remote.sh`, `.env.deploy.example`, `.dockerignore`, `apps/web/.dockerignore`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`.

Non-defect observations:

- Cookie-backed admin API requests still require same-origin provenance before session auth (`apps/web/src/lib/api-auth.ts:114`), while PAT requests only bypass same-origin after presenting a token on a route that opted into a required scope (`apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:83`). Successful admin API responses are forced no-store/nosniff when handlers omit those headers (`apps/web/src/lib/api-auth.ts:134`).
- Production sessions fail closed without a sufficiently long `SESSION_SECRET` (`apps/web/src/lib/session.ts:19`, `apps/web/src/lib/session.ts:30`), session tokens are HMAC-signed (`apps/web/src/lib/session.ts:82`), and verification uses `timingSafeEqual` plus DB-backed hashed-token lookup and expiry checks (`apps/web/src/lib/session.ts:117`, `apps/web/src/lib/session.ts:136`, `apps/web/src/lib/session.ts:145`).
- Token verification rejects malformed tokens before DB work (`apps/web/src/lib/admin-tokens.ts:141`), looks up by hash with an owning admin join (`apps/web/src/lib/admin-tokens.ts:146`), compares hashes in constant time (`apps/web/src/lib/admin-tokens.ts:160`), and enforces expiry (`apps/web/src/lib/admin-tokens.ts:161`).
- Lightroom upload remains bounded before multipart parsing: it rejects chunked transfer and missing/oversized `Content-Length` (`apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:109`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:123`), serializes multipart parsing (`apps/web/src/app/api/admin/lr/upload/route.ts:152`), sanitizes user filename/title/description (`apps/web/src/app/api/admin/lr/upload/route.ts:209`, `apps/web/src/app/api/admin/lr/upload/route.ts:221`, `apps/web/src/app/api/admin/lr/upload/route.ts:229`), strips GPS from retained originals when configured (`apps/web/src/app/api/admin/lr/upload/route.ts:394`), and re-checks restore maintenance after save before DB insert (`apps/web/src/app/api/admin/lr/upload/route.ts:422`).
- Public semantic endpoints still require same-origin and rate-limit before protected work: semantic search checks same-origin/content type/body limits before pre-incrementing the semantic limiter (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:117`, `apps/web/src/app/api/search/semantic/route.ts:147`, `apps/web/src/app/api/search/semantic/route.ts:173`), and similar search checks same-origin/id before pre-incrementing (`apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:86`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`).
- Upload serving rejects non-derivative directories, mismatched extensions, unsafe path segments, symlinks, and realpath escapes before streaming from the validated descriptor (`apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:143`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`, `apps/web/src/lib/serve-upload.ts:189`). Private originals resolve only through basename-safe filenames, owner-only original directories, symlink rejection, and realpath containment (`apps/web/src/lib/upload-paths.ts:49`, `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:129`, `apps/web/src/lib/upload-paths.ts:160`, `apps/web/src/lib/upload-paths.ts:165`).
- OG SSRF/open-redirect controls remain in place: the photo OG route pins internal derivative fetches to the trusted canonical origin, not request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:109`), the fetch helper uses fixed `/uploads/jpeg/` paths plus timeout/body caps (`apps/web/src/lib/og-photo-fetch.ts:69`, `apps/web/src/lib/og-photo-fetch.ts:72`, `apps/web/src/lib/og-photo-fetch.ts:81`, `apps/web/src/lib/og-photo-fetch.ts:85`), and fallback redirects are same-origin only (`apps/web/src/app/api/og/photo/[id]/route.tsx:249`, `apps/web/src/app/api/og/photo/[id]/route.tsx:267`). Relative OG URLs reject scheme-relative and backslash bypasses (`apps/web/src/lib/seo-og-url.ts:9`, `apps/web/src/lib/seo-og-url.ts:20`).
- Public data projection guards still omit admin-only/GPS/internal fields from public selects (`apps/web/src/lib/data.ts:368`, `apps/web/src/lib/data.ts:375`), type-check the sensitive-key exclusion (`apps/web/src/lib/data.ts:473`, `apps/web/src/lib/data.ts:475`), and apply the same compile-time guard to semantic/similar search enrichment (`apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/lib/search-enrichment-fields.ts:43`). The symmetric runtime fixture verifies admin-only keys exactly match the sensitive contract (`apps/web/src/__tests__/privacy-fields.test.ts:86`) and search enrichment omits every sensitive key (`apps/web/src/__tests__/privacy-fields.test.ts:126`).
- DB backup/restore remains admin + same-origin gated (`apps/web/src/app/[locale]/admin/db-actions.ts:164`, `apps/web/src/app/[locale]/admin/db-actions.ts:170`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:367`), writes backup/temp files with owner-only modes (`apps/web/src/app/[locale]/admin/db-actions.ts:192`, `apps/web/src/app/[locale]/admin/db-actions.ts:230`, `apps/web/src/app/[locale]/admin/db-actions.ts:591`), scans restore SQL for disallowed statements before import (`apps/web/src/app/[locale]/admin/db-actions.ts:620`, `apps/web/src/app/[locale]/admin/db-actions.ts:637`, `apps/web/src/lib/sql-restore-scan.ts:61`, `apps/web/src/lib/sql-restore-scan.ts:242`), and keeps restore/processing/backfill locks plus durable maintenance around the restore window (`apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`).
- Deployment helpers still avoid common secret/data hazards: the remote helper refuses group/world-readable deploy env files before sourcing (`scripts/deploy-remote.sh:65`), production deploy checks required env/config before build (`apps/web/deploy.sh:15`, `apps/web/deploy.sh:22`), Docker cleanup runs only after health success and only prunes unused artifacts (`apps/web/deploy.sh:34`, `apps/web/deploy.sh:50`, `apps/web/deploy.sh:76`), persistence is bind-mounted (`apps/web/docker-compose.yml:24`), nginx denies `/uploads/original/` (`apps/web/nginx/default.conf:165`), and the LR upload API gets the larger body cap before the generic `/api/admin/` cap (`apps/web/nginx/default.conf:133`, `apps/web/nginx/default.conf:150`).

Final sweep:

- Checked current diff and recent history: `11c4337f` on `master` / `origin/master`; changes since Cycle 50 baseline are docs/review artifacts, `.gitignore`, and `sw-template-contract.test.ts`.
- Checked auth/session/token handling, admin API wrappers, server-action origin guards, public route rate limits, upload/path traversal controls, SSRF/open redirect defenses, CSV/OG/JSON-LD sanitization, DB backup/restore controls, privacy field guards, deploy scripts, nginx caps, dependency audit, tracked-secret regression test, lint, and typecheck.
- Intentionally skipped generated/runtime/vendor data: `node_modules/`, `apps/web/.next/`, runtime upload/resource/data directories, historical review/plan archives beyond the required Cycle 50/current aggregate context, real DB restore drills, e2e browser flows, `npm run deploy`, commit/push operations, and destructive production checks.

# findings

No actionable defects found.

No findings are filed for Cycle 51 from this security/privacy lane.
