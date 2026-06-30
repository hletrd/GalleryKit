# summary

Reviewed current repo HEAD `11c4337fce35e3fcab789228a445960d6f573261` as the Cycle 51 debugger/tracer lane. Scope was causal tracing of latent failure modes, races, stale state, and competing hypotheses across upload -> queue -> process -> DB update, failed-image retry, service-worker template/generated parity, restore maintenance, processing-affecting settings, semantic search routes, and public rate-limit wrappers.

No actionable new defects found in the traced runtime flows. The Cycle 50 service-worker test gap is closed at this HEAD: the test now evaluates concrete route cases against both `sw.template.js` and generated `sw.js`.

Focused validation passed:

- `npm test --workspace=apps/web -- sw-template-contract.test.ts failed-image-retry.test.ts image-queue-settings-wiring.test.ts settings-image-sizes-lock.test.ts upload-processing-contract-lock.test.ts semantic-route.test.ts similar-route.test.ts` - pass, 6 files / 67 tests.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass; all public API routes were either rate-limited or explicitly exempted by the scanner.

# inventory

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-50-2026-07-01-plan.md`
- `.context/plans/cycle-50-2026-07-01-deferred.md`
- Cycle 50 review artifacts in `.context/reviews/cycle-50-2026-07-01/`
- Code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Traced source surfaces:

- Browser upload -> queue -> DB update: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker-state.ts`
- Lightroom/PAT upload parity: `apps/web/src/app/api/admin/lr/upload/route.ts`
- Failed-image retry: `apps/web/src/app/actions/images.ts`, `apps/web/src/__tests__/failed-image-retry.test.ts`
- Service worker template -> generated worker -> tests: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts`
- Restore maintenance and queue quiesce/resume: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/image-queue.ts`
- Settings that affect processing: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker-state.ts`
- Semantic search and similar-image routes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Public rate-limit wrappers and scanner output: `apps/web/src/app/api/**/route.{ts,tsx}`, `apps/web/src/lib/rate-limit.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`

# findings

No actionable defects found.

Non-defect observations:

- Browser uploads claim quota before the first awaited validation, settle failed/partial claims, save pending rows with `processed: false`, persist `processing_settings_json`, and enqueue a job carrying the upload-time settings snapshot (`apps/web/src/app/actions/images.ts:252`, `apps/web/src/app/actions/images.ts:258`, `apps/web/src/app/actions/images.ts:480`, `apps/web/src/app/actions/images.ts:520`, `apps/web/src/app/actions/images.ts:528`).
- The queue uses an in-process enqueue set plus a MySQL per-image advisory lock, checks the row is still `processed=false` before work, verifies all derivative outputs, conditionally marks the row processed, and deletes newly written variants if the row disappeared mid-processing (`apps/web/src/lib/image-queue.ts:513`, `apps/web/src/lib/image-queue.ts:543`, `apps/web/src/lib/image-queue.ts:579`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/image-queue.ts:679`, `apps/web/src/lib/image-queue.ts:683`).
- Permanent failures remain visible for admin retry: after max queue retries, `processing_error` and `failed_at` are persisted (`apps/web/src/lib/image-queue.ts:807`), while `retryFailedImage` clears failure columns only after reading a fresh strict settings snapshot and restores a visible failed state if enqueue is rejected (`apps/web/src/app/actions/images.ts:1253`, `apps/web/src/app/actions/images.ts:1264`, `apps/web/src/app/actions/images.ts:1284`, `apps/web/src/app/actions/images.ts:1314`).
- Lightroom upload mirrors the browser path on the traced state transitions: it preclaims upload budget, acquires the upload-processing contract lock, loads strict config before save/insert/enqueue, writes `processing_settings_json`, forwards the same processing settings to the queue, and releases the lock in `finally` (`apps/web/src/app/api/admin/lr/upload/route.ts:160`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/api/admin/lr/upload/route.ts:291`, `apps/web/src/app/api/admin/lr/upload/route.ts:478`, `apps/web/src/app/api/admin/lr/upload/route.ts:506`, `apps/web/src/app/api/admin/lr/upload/route.ts:575`).
- Restore takes the relevant locks before durable maintenance and quiesce, keeps failed imports in maintenance when migration/import verification fails, and clears/resumes only after verified success or recoverable setup failure (`apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:495`, `apps/web/src/app/[locale]/admin/db-actions.ts:508`, `apps/web/src/app/[locale]/admin/db-actions.ts:731`).
- Processing-affecting `image_sizes` / `strip_gps_on_upload` changes are fenced by active upload-claim checks and the same upload-processing contract advisory lock; once any image exists, actual changes to those lock-once settings are rejected (`apps/web/src/app/actions/settings.ts:68`, `apps/web/src/app/actions/settings.ts:70`, `apps/web/src/app/actions/settings.ts:74`, `apps/web/src/app/actions/settings.ts:103`, `apps/web/src/app/actions/settings.ts:124`).
- The Cycle 50 service-worker concern is now covered behaviorally. Both worker copies classify concrete normal photo paths as non-revocable and share/object/map paths as revocable, and generated `sw.js` carries the same classifier shape as the template (`apps/web/src/__tests__/sw-template-contract.test.ts:32`, `apps/web/src/__tests__/sw-template-contract.test.ts:48`, `apps/web/src/__tests__/sw-template-contract.test.ts:124`, `apps/web/public/sw.template.js:59`, `apps/web/public/sw.js:59`).
- Semantic search charges the public-search limiter before the DB-backed mode lookup, gates disabled mode closed, filters embeddings by active model version, and uses the shared privacy-guarded enrichment select (`apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:189`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/semantic/route.ts:330`).
- Similar-image search is production-only, pre-increments the same semantic limiter before DB work, filters production embeddings by model version, excludes the target image, and reuses the shared enrichment projection (`apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:114`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/app/api/search/similar/[id]/route.ts:191`, `apps/web/src/app/api/search/similar/[id]/route.ts:233`).
- The public route rate-limit scanner passed for semantic, similar, OG, uploads, feeds, health, and live routes. I did not find a missing public wrapper in the scanner-covered inventory.

Not re-raised:

- `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain carry-forward deferred items. I found no new evidence changing severity or making them scheduled now.
- The Cycle 50 plan-ledger drift already appears in other Cycle 51 artifacts, but it is not a latent runtime bug in the causal flows assigned to this debugger/tracer lane, so I did not file it here.

Final sweep:

- Checked current HEAD, current diff since the Cycle 50 baseline, upload quota/lock/settle paths, queue claim/retry/permanent-failure paths, failed-image retry transitions, Lightroom upload parity, restore lock/maintenance lifecycle, settings-change fences, service-worker template/generated/test parity, semantic/similar route gates, and the public rate-limit scanner.
- Intentionally skipped full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, Playwright e2e, live DB restore drills, production deployment state, `node_modules`, `.next`, runtime upload/data directories, and historical review archives beyond the required Cycle 50/current aggregate context.
