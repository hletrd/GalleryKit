# Plan 213 — Cycle 5 Review Hardening Fixes

**Status:** DONE / archived
**Source reviews:** `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`
**Goal:** Fix the current cycle’s non-deferrable security/correctness findings with focused regression coverage while keeping the diff bounded and reversible.

## Findings mapped to this plan

| Finding | Severity | Confidence | Action | Status |
|---|---|---|---|---|
| AGG5-01 | HIGH | HIGH | IMPLEMENT | DONE |
| AGG5-02 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG5-03 | LOW | HIGH | IMPLEMENT | DONE |
| AGG5-04 | LOW | HIGH | IMPLEMENT | DONE |
| AGG5-05 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG5-06 | HIGH | HIGH | IMPLEMENT | DONE |
| AGG5-07 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG5-08 | MEDIUM | HIGH | IMPLEMENT | DONE |

## Completed items

### 213-01 — Enforce admin-user confirmation on the server and lock it with direct tests — DONE
**Findings:** AGG5-01
**Files:**
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/__tests__/admin-users.test.ts`

**Changes completed:**
1. `createAdminUser()` now reads `confirmPassword` and rejects mismatches before hashing/insertion.
2. The client-side mismatch toast remains for UX, but the server is now authoritative.
3. Added direct regression coverage for mismatched submissions.

### 213-02 — Give each dropped upload item a true unique identity — DONE
**Findings:** AGG5-02
**Files:**
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/__tests__/upload-dropzone.test.ts`

**Changes completed:**
1. Replaced metadata-derived upload IDs with stable generated per-item IDs.
2. Switched preview/tag/removal/upload bookkeeping to the generated IDs.
3. Added regression coverage proving distinct files with matching metadata keep separate IDs.

### 213-03 — Tighten same-origin enforcement for backup downloads — DONE
**Findings:** AGG5-03
**Files:**
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`

**Changes completed:**
1. Added an optioned same-origin helper so sensitive routes can reject requests without provenance headers.
2. Applied the strict mode to the backup-download route.
3. Added regression coverage for headerless backup-download requests being rejected while same-origin requests still succeed.

### 213-04 — Harden asset/metadata origin validation around deployment fallbacks — DONE
**Findings:** AGG5-04, AGG5-07
**Files:**
- `apps/web/next.config.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `README.md`
- `apps/web/README.md`

**Changes completed:**
1. Production config now rejects plaintext `IMAGE_BASE_URL` values.
2. SEO OG URL validation now enforces same-origin absolute URLs even when `BASE_URL` is unset by falling back to `site-config.json.url`.
3. Added focused regression coverage for both validation surfaces and updated operator-facing docs/messages.

### 213-05 — Remove the vulnerable dev-tool lockfile path — DONE
**Findings:** AGG5-05
**Files:**
- `apps/web/package.json`
- `package.json`
- `package-lock.json`

**Changes completed:**
1. Upgraded `drizzle-kit` to a non-vulnerable beta line that no longer pulls the flagged `@esbuild-kit/*` chain.
2. Kept a root `esbuild` override to prevent older vulnerable resolutions from reappearing.
3. Re-ran `npm audit` and cleared the reported advisories.

### 213-06 — Serialize topic slug / alias namespace mutations — DONE
**Findings:** AGG5-06
**Files:**
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`

**Changes completed:**
1. Added a shared advisory-lock guard for topic-slug / alias mutations.
2. Applied the lock to topic create/update and alias create flows so cross-table route-segment checks cannot race.
3. Added focused tests for the shared lock path and fixed a surfaced TypeScript narrowing issue in the topic manager while exercising the updated return types.

### 213-07 — Make production/deploy builds fail fast when the real site config is missing — DONE
**Findings:** AGG5-08
**Files:**
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `README.md`
- `CLAUDE.md`
- `apps/web/README.md`

**Changes completed:**
1. Added an explicit site-config validation script.
2. Replaced silent example-config fallback behavior in build/deploy paths with fail-fast checks.
3. Updated docs to reflect the stricter contract.

## Progress
- [x] 213-01 — Server-side admin-user confirmation validation
- [x] 213-02 — Unique upload item identity
- [x] 213-03 — Backup download provenance enforcement
- [x] 213-04 — Asset/metadata origin hardening
- [x] 213-05 — Vulnerable dev-tool upgrade
- [x] 213-06 — Topic/alias mutation serialization
- [x] 213-07 — Site-config build contract hardening

## Verification evidence
- `npm run build --workspaces` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npx tsc --noEmit -p apps/web/tsconfig.json` ✅
- `npm run test --workspace=apps/web` ✅ (41 files / 214 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped)

- Architect verification ✅ (`APPROVED` — architect subagent re-check after the scheme-relative OG fix)
