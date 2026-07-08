# Cycle 36 Verifier Review

Role: cycle-36 verifier + test-engineer review worker
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Mode: review-only; no production-code edits

## Inventory / Scope Reviewed

Required guidance read first:

- `AGENTS.md` from the prompt for this workspace.
- `CLAUDE.md:1-765`.
- Code-review skill: `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Inventory before findings:

- App source: 627 TypeScript/TSX files under `apps/web/src`.
- Unit tests: 363 Vitest files under `apps/web/src/__tests__`.
- E2E files: 10 files under `apps/web/e2e` (9 specs plus helper).
- App scripts: 29 files under `apps/web/scripts`.
- Key reviewed surfaces: repo/package scripts, CI workflows, custom lint gates, public/admin route inventory, public server actions, proxy/nginx/deploy topology, migration bootstrap/reconcile, semantic/CLIP activation path, upload memory notes, and current `.context/reviews/{verifier,test-engineer}.md`.

Fresh validation run:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
```

Results: all three custom blocking scanners passed on current HEAD. I also swept for focused tests and found no `.only`; only documented local/admin E2E skips appeared.

## Findings

### VER-C36-01 - Live nginx limiter behavior is not proven by repo gates

- Severity: Medium
- Confidence: High
- Classification: Risk / manual verification gap
- File/region: `CLAUDE.md:514-526`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:274-307`, `apps/web/deploy.sh:51-108`, `scripts/check-proxy-topology.mjs:12-16`, `scripts/check-proxy-topology.mjs:131-134`
- Evidence: the nginx template defines `public` and `nextimage` zones and applies `zone=public` in the catch-all location, but `CLAUDE.md` states deploys do not touch host nginx. `deploy.sh` rebuilds/restarts Docker and prunes; it does not sync/reload nginx. The proxy topology checker explicitly reports that effective client-IP bucket/XFF overwrite is not verified.
- Failure scenario: a deploy ships with app gates green while the host still runs stale nginx config, or the limiter keys on an upstream load balancer IP. Public SSR pages and `/_next/image` may be unthrottled, or all visitors may share one bucket and receive unrelated 429s.
- Suggested fix/test: add an executable local/nginx-container smoke when nginx is available, and keep the live-host runbook: `nginx -t`, reload, burst `/` and `/_next/image` until overflow returns 429, then verify normal page loads do not 429 and real-IP logs show distinct client keys.

### VER-C36-02 - CLIP production readiness remains outside normal release evidence

- Severity: Medium
- Confidence: High
- Classification: Confirmed gate gap
- File/region: `CLAUDE.md:558-626`, `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`
- Evidence: CLIP weights are not baked into the image and the real offline/ranking tests skip unless model env is present. The dedicated workflow seeds weights and runs `test:clip:preflight`, but it is scheduled/manual only; the main quality workflow never invokes it.
- Failure scenario: code touching model paths, manifests, `@huggingface/transformers`, semantic production mode, or embedding backfill passes PR/push quality but breaks offline production model loading. Production activation later returns 503/errors or meaningless results until the manual preflight is run.
- Suggested fix/test: make CLIP preflight path-triggered for CLIP/model/semantic files and dependency-lock changes, or require an explicit activation checklist artifact before setting `semantic_search_mode='production'`.

### VER-C36-03 - Fresh/reconciled DB schema parity is still not structurally proven

- Severity: Medium
- Confidence: Medium
- Classification: Risk / test-depth gap
- File/region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-103`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-180`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:216-225`, `apps/web/scripts/migrate.js:877-897`
- Evidence: fresh DB bootstrap goes through `reconcileLegacySchema` then baselines every journal row. The test file calls itself a source tripwire, not a structural validator; it has useful high-risk pins, but most checks still verify name/executable-text presence rather than MySQL metadata equivalence.
- Failure scenario: a migration changes a column type/default/nullability, FK action, generated expression, or index order while `migrate.js` still mentions the same names. Source tests pass, a fresh DB baselines, and later runtime behavior diverges from migrated databases.
- Suggested fix/test: add a disposable MySQL parity harness comparing `information_schema.columns`, indexes, and FKs after migrate-vs-reconcile bootstrap for high-risk tables first: `images`, `image_embeddings`, `admin_tokens`, analytics tables, and `pending_file_deletions`.

### VER-C36-04 - Max-size multipart upload RSS remains an operational assertion

- Severity: Medium
- Confidence: High
- Classification: Risk / manual verification gap
- File/region: `CLAUDE.md:661-663`, `apps/web/src/app/actions/images.ts:154-262`, `apps/web/src/app/api/admin/lr/upload/route.ts:143-191`
- Evidence: CLAUDE states multipart bodies are framework-buffered on heap and notes pending on-host RSS measurement. Upload actions do enforce count/byte windows, but no gate exercises concurrent near-cap uploads and Sharp processing under production memory limits.
- Failure scenario: several admins or PAT clients upload near-200 MB files concurrently; framework buffering plus image processing exceeds container memory and restarts the app even though unit/build gates pass.
- Suggested fix/test: run a controlled production-like upload load test at documented caps, record RSS/restart behavior, and convert the measured safe concurrency budget into either an ops runbook invariant or an automated smoke with reduced fixture sizes.

## Confirmed Non-Findings / Updates

- Admin API auth, server-action origin/barrier, and public route rate-limit scanners passed on current HEAD.
- I did not carry forward the prior semantic scan-limit test gap: current `semantic-search-route.test.ts:553-560` and `similar-route.test.ts:345-355` assert executed `.limit(SEMANTIC_SCAN_LIMIT)` behavior.
- Public share metadata intentionally avoids share-key DB lookups in `generateMetadata`; the page body rate-limits lookups once, matching the documented no-double-charge contract in `s/[key]/page.tsx:44-52` and `g/[key]/page.tsx:49-56`.

## Missed-Issue Sweep

- Checked for `.only` tests: none found.
- Checked public route inventory against `lint:public-route-rate-limit`: all protected route handlers either pre-increment or carry explicit exemptions.
- Checked admin API route inventory: both admin route handlers wrap with `withAdminAuth`.
- Checked action-origin scanner output: all mutating server actions either enforce same-origin/barrier or carry reasoned exemptions; public analytics actions are recognized as rate-limited.
- Skipped: full `npm test`, typecheck, build, Playwright, deploy, live proxy checks, CLIP preflight, and destructive/runtime production checks. Product source was not edited.
