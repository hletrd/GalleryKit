# Critic Deep Review — Cycle 8 Prompt 1

Date: 2026-04-25
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewer posture: skeptical whole-repo critique (docs + config + source + tests + deploy surface)

## Inventory reviewed

I inventoried and reviewed the tracked, non-generated repo surface:

- Top-level docs/config: `README.md`, `CLAUDE.md`, root `package.json`, deploy helper scripts, repo `AGENTS.md`
- App docs/config: `apps/web/README.md`, `package.json`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `tsconfig*.json`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `.env.local.example`, `site-config*.json`
- Runtime source: all files under `apps/web/src/app`, `src/components`, `src/db`, `src/i18n`, `src/lib`, `src/proxy.ts`, `src/instrumentation.ts`
- Tests: all 59 Vitest files under `apps/web/src/__tests__` and all 6 Playwright specs/helpers under `apps/web/e2e`
- Scripts/migrations/messages: all files under `apps/web/scripts`, `apps/web/drizzle`, `apps/web/messages`
- Change-surface context: recent git history and existing `.context/reviews/*` artifacts were inventoried to look for repeated blind spots / overfit tendencies

Excluded as non-authoritative/generated/binary: `node_modules/`, `.next/`, `test-results/`, image/font binaries, and historical review archives beyond inventory-level cross-checking.

## Verification snapshot

- `npm run lint --workspace=apps/web` ✅
- `npm run typecheck --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (59 files / 370 tests)

That green test state matters, but several gaps below are specifically about where the current suite can still give false confidence.

---

## Findings

### 1) Split configuration sources create operator-facing contradictions
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** **Confirmed**
- **Citations:**
  - `README.md:41-58`
  - `apps/web/src/lib/data.ts:870-890`
  - `apps/web/src/app/[locale]/layout.tsx:76-123`
  - `apps/web/src/components/nav-client.tsx:14,51-53`
  - `apps/web/src/components/footer.tsx:3,37`
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:16-23,95-175`
- **Why this is a problem:** The README says “Site configuration lives in `apps/web/src/site-config.json`”, but runtime behavior is actually split:
  - SEO title/description/nav title/author/locale/OG image are read from DB-backed `admin_settings` with file fallbacks.
  - `home_link`, `footer_text`, and `google_analytics_id` are still file-only.
- **Failure scenario:** An operator updates branding/SEO in the admin UI and expects the whole site to move together, but the nav title changes while footer text, home link, and analytics stay on stale file values. The inverse also happens: editing `site-config.json` may appear ineffective because DB overrides still win.
- **Concrete fix:** Pick one source of truth per setting family. Either:
  1. move the remaining file-only runtime knobs into admin-managed settings, or
  2. explicitly document the split in README/admin UI and label file-only knobs as file-only.

### 2) `parent_url` is a documented config field with no runtime consumer
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** **Confirmed**
- **Citations:**
  - `README.md:43-58`
  - `apps/web/src/site-config.example.json:1-11`
  - `apps/web/src/site-config.json:1-11`
- **Why this is a problem:** `parent_url` is presented as real configuration, but there is no runtime usage in the app source. It is stale surface area that teaches operators to believe a nonexistent feature exists.
- **Failure scenario:** A deployer sets `parent_url` expecting parent-site navigation/canonical behavior and silently gets nothing.
- **Concrete fix:** Remove `parent_url` from the docs/examples/config schema, or implement and test the intended behavior.

### 3) Core correctness still depends on a single-process deployment assumption
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** **Likely risk** (the code matches the documented assumption; the risk is what happens when reality drifts)
- **Citations:**
  - `README.md:145-148`
  - `apps/web/src/lib/upload-tracker-state.ts:7-21,23-61`
  - `apps/web/src/lib/restore-maintenance.ts:1-55`
  - `apps/web/src/app/actions/public.ts:35-65,76-111`
  - `apps/web/src/lib/data.ts:11-40,48-95`
  - `apps/web/src/lib/image-queue.ts:67-131`
- **Why this is a problem:** The repo documents “single web-instance/single-writer”, but several security/availability-sensitive controls are still process-local: upload quota tracking, restore maintenance flag, load-more throttling, buffered shared-group view counts, queue state.
- **Failure scenario:** A second web process gets introduced during scale-out, blue/green deploy, or an ops mistake. One process may accept uploads while another thinks restore maintenance is inactive; rate limits and quotas diverge by process; queue/bootstrap state becomes nondeterministic. Green unit tests won’t catch this because they all run single-process.
- **Concrete fix:** Either hard-enforce single-instance runtime (startup guard / deploy check), or move these states into shared storage (DB/Redis/advisory-lock-backed coordination) before permitting multi-instance deployment.

### 4) The E2E suite is strong on seeded happy paths, weak on real deployment/proxy drift
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** **Manual-validation risk**
- **Citations:**
  - `apps/web/playwright.config.ts:18-30,60-67`
  - `apps/web/e2e/public.spec.ts:101-118`
  - `apps/web/e2e/admin.spec.ts:66-89`
  - `apps/web/scripts/seed-e2e.ts:36-42,249-253`
  - `apps/web/docker-compose.yml:1-15`
  - `apps/web/nginx/default.conf:1-137`
  - `apps/web/scripts/entrypoint.sh:1-35`
- **Why this is a problem:** Playwright defaults to a locally built direct app server with seeded data. Specs hardcode deterministic fixtures like `e2e-smoke` and `Abc234Def5`. Meanwhile the real deployment risks live in nginx/header forwarding, host-network compose behavior, writable volume ownership, and remote entrypoint startup.
- **Failure scenario:** CI stays green while a production deploy fails because `TRUST_PROXY`/forwarded headers/body caps/permissions/compose behavior drifted. The current E2E suite is excellent at “this checkout works with the seed script”, not “the documented deployment still works end-to-end”.
- **Concrete fix:** Add at least one deployment smoke lane that exercises the documented compose+nginx topology, plus one non-seeded smoke using a restored/imported DB shape.

### 5) The storage abstraction is still dead weight and can mislead future changes
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** **Confirmed**
- **Citations:**
  - `apps/web/src/lib/storage/index.ts:4-18`
  - `apps/web/src/lib/storage/types.ts:4-15`
  - `apps/web/src/lib/process-image.ts:6-13,45-60`
  - `apps/web/src/lib/serve-upload.ts:1-21,28-99`
  - `apps/web/src/__tests__/storage-local.test.ts:10-27`
- **Why this is a problem:** The storage module explicitly says it is not wired into the live pipeline, while the actual upload/processing/serving path still uses direct filesystem code. That means the abstraction and its tests can drift independently from production reality.
- **Failure scenario:** A future cycle “fixes storage” in `src/lib/storage/*`, sees tests pass, and assumes upload/serve behavior changed — but production still bypasses that code entirely.
- **Concrete fix:** Either delete the unused abstraction until the migration is real, or clearly quarantine it behind an ADR + follow-up issue and forbid presenting it as a supported extension point.

---

## Commonly-missed-issues sweep

### Security regressions I specifically looked for and did **not** confirm
- No clear current auth-wrapper hole on `/api/admin/*` (scanner + route wrapper present)
- No obvious public PII leak regression in `publicSelectFields`
- No fresh path-traversal regression in upload-serving or backup-download paths
- No lint/typecheck/unit-test failure hiding in the current tree

### Places the repo can still fool reviewers despite green tests
- Seeded E2E data hides real-world DB drift
- Single-process assumptions are documented but not mechanically enforced
- Deployment/proxy stack remains mostly outside automated verification
- Stale config/dead abstractions increase “looks supported” surface area

## Bottom line

The codebase is not showing a fresh obvious auth/data-loss regression in the tested local path, and the automated checks are strong. The main risks now are **operational truth drift**:

1. config/docs say one thing while runtime sources are split,
2. deployment assumptions remain implicit rather than enforced,
3. tests are increasingly optimized around the seeded local model.

If I were prioritizing follow-up work, I would do it in this order:
1. unify or explicitly document runtime config ownership,
2. add one real deployment smoke test / guardrail for single-instance assumptions,
3. remove or quarantine dead config + dead storage surface.
