# Plan 235 — Cycle 5 review-plan-fix implementation

Status: implemented — archived 2026-04-25
Created: 2026-04-25
Source review: `.context/reviews/_aggregate.md` plus per-agent files in `.context/reviews/`.

## Repo-policy inputs consulted before planning

- `CLAUDE.md`: Node 24+, TypeScript 6, formal gates, security lint gates, local-only storage warning, single-instance runtime note, git workflow.
- `AGENTS.md`: commit + push all changes; use gitmoji; keep diffs small/reviewable/reversible; no new dependencies unless explicitly requested.
- `.context/**` and existing `plan/**`: existing RPF loop conventions preserve broad architecture/perf/UX work as deferred items with severity and exit criteria while scheduling narrow correctness/security fixes.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files: not present / no additional policy files found.

Every aggregate finding is either scheduled below, verified/closed, or recorded in `plan/plan-236-cycle5-rpf-deferred.md`.

## Master disposition map

| Finding | Original severity / confidence | Disposition |
|---|---:|---|
| AGG-C5-01 | High / High | Implemented C5RPF-01 |
| AGG-C5-02 | Medium / High | Implemented C5RPF-02 |
| AGG-C5-03 | Medium / High | Implemented direct PostCSS remediation in C5RPF-03; upstream Next nested PostCSS remains tracked as D-C5RPF-43 |
| AGG-C5-04 | Medium / High | Implemented C5RPF-04 |
| AGG-C5-05 | High / High | Implemented C5RPF-05 |
| AGG-C5-06 | Medium / High | Implemented C5RPF-06 |
| AGG-C5-07 | Medium / High | Implemented C5RPF-07 |
| AGG-C5-08 | High / High | Deferred D-C5RPF-01 (repo single-instance constraint) |
| AGG-C5-09 | Medium / High | Implemented C5RPF-08 |
| AGG-C5-10 | Medium / High | Deferred D-C5RPF-02 (ops-scope asset backup) |
| AGG-C5-11 | Low / Medium | Deferred D-C5RPF-03 |
| AGG-C5-12 | Medium / High | Deferred D-C5RPF-04 (already documented as JPEG derivative behavior in prior plan; UX copy audit follow-up) |
| AGG-C5-13 | Medium / High | Deferred D-C5RPF-05 |
| AGG-C5-14 | Medium / High | Deferred D-C5RPF-06 |
| AGG-C5-15 | Medium / High | Deferred D-C5RPF-07 |
| AGG-C5-16 | High / Medium | Deferred D-C5RPF-08 |
| AGG-C5-17 | Medium / High | Deferred D-C5RPF-09 |
| AGG-C5-18 | Low / High | Deferred D-C5RPF-10 |
| AGG-C5-19 | Low / High | Deferred D-C5RPF-11 |
| AGG-C5-20 | High / High | Implemented C5RPF-09 |
| AGG-C5-21 | High / High | Implemented C5RPF-10 |
| AGG-C5-22 | Medium / High | Deferred D-C5RPF-12 |
| AGG-C5-23 | Medium / High | Implemented C5RPF-11 |
| AGG-C5-24 | Medium / High | Implemented C5RPF-12 |
| AGG-C5-25 | Low / High | Implemented C5RPF-13 |
| AGG-C5-26 | Low / High | Deferred D-C5RPF-13 |
| AGG-C5-27 | Medium / High | Deferred D-C5RPF-14 |
| AGG-C5-28 | Low / High | Deferred D-C5RPF-15 |
| AGG-C5-29 | Low / High | Deferred D-C5RPF-16 |
| AGG-C5-30 | High / High | Deferred D-C5RPF-17 |
| AGG-C5-31 | High / High | Deferred D-C5RPF-18 |
| AGG-C5-32 | High / High | Deferred D-C5RPF-19 |
| AGG-C5-33 | Medium / High | Deferred D-C5RPF-20 |
| AGG-C5-34 | High / High | Deferred D-C5RPF-21 |
| AGG-C5-35 | High / High | Deferred D-C5RPF-22 |
| AGG-C5-36 | Medium / High | Deferred D-C5RPF-23 |
| AGG-C5-37 | Medium / High | Deferred D-C5RPF-24 |
| AGG-C5-38 | Medium / High | Deferred D-C5RPF-25 |
| AGG-C5-39 | Medium / High | Deferred D-C5RPF-26 |
| AGG-C5-40 | Medium / High | Deferred D-C5RPF-27 |
| AGG-C5-41 | High / High | Deferred D-C5RPF-28 |
| AGG-C5-42 | High / High | Deferred D-C5RPF-29 |
| AGG-C5-43 | Medium / High | Deferred D-C5RPF-30 |
| AGG-C5-44 | Medium / High | Deferred D-C5RPF-31 |
| AGG-C5-45 | Medium / High | Deferred D-C5RPF-32 |
| AGG-C5-46 | Medium / High | Deferred D-C5RPF-33 |
| AGG-C5-47 | Medium / High | Deferred D-C5RPF-34 |
| AGG-C5-48 | Medium / High | Deferred D-C5RPF-35 |
| AGG-C5-49 | High / High | Implemented C5RPF-14 |
| AGG-C5-50 | Medium / High | Implemented C5RPF-15 |
| AGG-C5-51 | Medium / High | Deferred D-C5RPF-36 |
| AGG-C5-52 | Medium / High | Implemented C5RPF-16 |
| AGG-C5-53 | Medium / Medium | Deferred D-C5RPF-37 |
| AGG-C5-54 | Medium / High | Deferred D-C5RPF-38 |
| AGG-C5-55 | Low-medium / High | Implemented C5RPF-10 (actions header copy) |
| AGG-C5-56 | Low-medium / High | Deferred D-C5RPF-39 |
| AGG-C5-57 | Low-medium / Medium | Deferred D-C5RPF-40 |
| AGG-C5-58 | Low / High | Deferred D-C5RPF-41 |
| AGG-C5-59 | Medium / Medium | Deferred D-C5RPF-42 |
| AGG-C5-60 | Low / High | Implemented C5RPF-17 |

## Scheduled implementation tasks

### C5RPF-01 — Trusted proxy hop selection and docs [AGG-C5-01]
- **Files:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/__tests__/rate-limit.test.ts`, README/env docs as needed.
- **Fix:** add an explicit trusted-hop count for `X-Forwarded-For` parsing, preserving secure one-hop default while allowing documented multi-hop deployments to select the client IP behind a known chain.
- **Acceptance:** tests cover default one-hop behavior, two-hop Cloudflare/LB→nginx behavior, invalid env fallback, and missing proxy headers.
- **Status:** Done 2026-04-25 — added `TRUSTED_PROXY_HOPS`, one-hop/two-hop tests, and README/env guidance.

### C5RPF-02 — Restore SQL header and split-scanner hardening [AGG-C5-02]
- **Files:** `apps/web/src/lib/db-restore.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, tests.
- **Fix:** move restore-header validation into a tested helper with correctly grouped alternation anchored at the beginning of the trimmed file, and add tests for malformed prefixes.
- **Acceptance:** malformed text before `CREATE` is rejected; normal mysqldump-style headers still pass; SQL scanner tests stay green.
- **Status:** Done 2026-04-25 — extracted anchored SQL-dump header helper and covered malformed-prefix rejection.

### C5RPF-03 — PostCSS dependency verification/remediation [AGG-C5-03]
- **Files:** `package-lock.json`, `apps/web/package.json` if needed.
- **Fix:** run audit/lockfile verification; update existing PostCSS dependency/override if an actionable vulnerable resolved version exists. If no vulnerable resolved PostCSS remains, record closure in this plan.
- **Acceptance:** `npm audit`/lockfile evidence captured; gates remain green.
- **Status:** Done/partially upstream-blocked 2026-04-25 — direct app PostCSS was updated to 8.5.10 and root override added; `npm audit --omit=optional` still reports Next 16.2.3's nested exact `postcss@8.4.31` with only a breaking/invalid audit fix path, so the remaining upstream dependency risk is recorded as D-C5RPF-43.

### C5RPF-04 — `createAdminUser` rate-limit rollback symmetry [AGG-C5-04]
- **Files:** `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/__tests__/admin-users.test.ts`, `apps/web/src/__tests__/admin-user-create-ordering.test.ts` if useful.
- **Fix:** replace full bucket resets after success/duplicate/unexpected errors with a one-attempt rollback helper so concurrent attempts are not erased.
- **Acceptance:** tests prove success/duplicate/error paths decrement rather than reset the whole bucket.
- **Status:** Done 2026-04-25 — replaced whole-bucket resets with one-attempt rollback/decrement coverage.

### C5RPF-05 — Image queue retry/rescan after terminal failures [AGG-C5-05]
- **Files:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/__tests__/image-queue.test.ts` or bootstrap tests.
- **Fix:** when a job exhausts processing or claim retries, mark bootstrap stale and schedule a bounded retry scan so pending rows are rediscovered without process restart.
- **Acceptance:** unit coverage verifies terminal failure schedules bootstrap retry and leaves no permanent in-memory dead end.
- **Status:** Done 2026-04-25 — terminal queue failures now mark bootstrap stale and schedule a bounded rescan.

### C5RPF-06 — Auth rate-limit cleanup ordering [AGG-C5-06]
- **Files:** `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/__tests__/auth-rate-limit.test.ts`.
- **Fix:** reset DB buckets before deleting in-memory fast-path entries for successful login/password change cleanup.
- **Acceptance:** tests prove in-memory state remains if DB reset fails and clears only after DB reset succeeds.
- **Status:** Done 2026-04-25 — DB reset now completes before memory cleanup; failure leaves memory state intact.

### C5RPF-07 — Locale-independent tag slug normalization [AGG-C5-07]
- **Files:** `apps/web/src/lib/tag-records.ts`, `apps/web/src/__tests__/tag-records.test.ts`.
- **Fix:** use locale-independent lowercasing and add a Unicode regression.
- **Acceptance:** Turkish/Unicode slug test is deterministic.
- **Status:** Done 2026-04-25 — tag slug normalization is locale-independent with Turkish Unicode coverage.

### C5RPF-08 — Fail closed on disk-space precheck errors [AGG-C5-09]
- **Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/__tests__/images-actions.test.ts`.
- **Fix:** do not proceed with uploads when `statfs` cannot inspect the original upload root; surface the existing disk-space error.
- **Acceptance:** tests cover low-space and statfs-failure rejection.
- **Status:** Done 2026-04-25 — statfs failures now fail closed with the existing disk-space error path.

### C5RPF-09 — Production localhost/placeholder canonical URL guard [AGG-C5-20]
- **Files:** `apps/web/scripts/ensure-site-config.mjs`, docs/tests if feasible.
- **Fix:** reject `localhost`, loopback, and placeholder site URLs during production prebuild when no overriding `BASE_URL` is provided.
- **Acceptance:** script inspection/test command verifies production placeholder rejection; normal local build still passes.
- **Status:** Done 2026-04-25 — production prebuild rejects localhost/loopback placeholder public URLs when not overridden.

### C5RPF-10 — Admin privilege/action copy clarity [AGG-C5-21, AGG-C5-55]
- **Files:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/components/admin-user-manager.tsx` if needed.
- **Fix:** warn in the Add Admin dialog that every admin is root-equivalent; give admin action columns non-empty accessible labels.
- **Acceptance:** copy exists in both locales and UI still renders.
- **Status:** Done 2026-04-25 — admin creation copy warns about root-equivalent access and action headers have non-empty labels.

### C5RPF-11 — Omit blank author fields in photo metadata/JSON-LD [AGG-C5-23]
- **Files:** photo metadata/JSON-LD route and tests if available.
- **Fix:** trim author and omit `authors`, `creditText`, `creator`, and `copyrightNotice` when blank.
- **Acceptance:** metadata/JSON-LD no longer emits empty author structures.
- **Status:** Done 2026-04-25 — photo metadata/JSON-LD omit blank author structures.

### C5RPF-12 — Derive OG locale from route locale [AGG-C5-24]
- **Files:** locale helper and metadata routes/layout.
- **Fix:** map `en -> en_US`, `ko -> ko_KR` for Open Graph locale metadata and alternate locales.
- **Acceptance:** tests/helper coverage for supported locale mapping.
- **Status:** Done 2026-04-25 — Open Graph locale and alternate locales now derive from the active route locale.

### C5RPF-13 — Upload copy includes per-file cap [AGG-C5-25]
- **Files:** `apps/web/src/components/upload-dropzone.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, upload limit tests if present.
- **Fix:** show both per-file and total-window limits in helper/error copy.
- **Acceptance:** both locales include the 200 MB per-file cap and 2 GiB window cap.
- **Status:** Done 2026-04-25 — upload helper/error copy includes the 200 MB per-file cap and 2 GiB total cap.

### C5RPF-14 — Visible focus ring for zoomable photo [AGG-C5-49]
- **Files:** `apps/web/src/components/image-zoom.tsx`.
- **Fix:** add `focus-visible` ring styles to the focusable zoom container.
- **Acceptance:** keyboard focus indicator is visible without affecting pointer behavior.
- **Status:** Done 2026-04-25 — zoomable photo container now has a visible keyboard focus ring.

### C5RPF-15 — Semantic upload progress [AGG-C5-50]
- **Files:** `apps/web/src/components/upload-dropzone.tsx`.
- **Fix:** expose progress as `role="progressbar"` with ARIA values and live text.
- **Acceptance:** progress is accessible to assistive tech.
- **Status:** Done 2026-04-25 — upload progress exposes progressbar semantics and ARIA values.

### C5RPF-16 — Category alias input label [AGG-C5-52]
- **Files:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`.
- **Fix:** add an `sr-only`/visible label tied to the alias input.
- **Acceptance:** alias input has a stable accessible name.
- **Status:** Done 2026-04-25 — category alias input now has a stable accessible label.

### C5RPF-17 — Move upload limit toast out of state updater [AGG-C5-60]
- **Files:** `apps/web/src/components/upload-dropzone.tsx`.
- **Fix:** compute rejected uploads before `setFiles` and emit toast outside the functional updater.
- **Acceptance:** no side effects inside state updater; existing selection behavior preserved.
- **Status:** Done 2026-04-25 — upload rejection/toast computation moved outside the state updater.

## Required gates

Run against the whole repo after implementation:
- `npm run lint` — passed 2026-04-25.
- `npm run typecheck` — passed 2026-04-25.
- `npm run build` — passed 2026-04-25.
- `npm run test` — passed 2026-04-25 (58 files / 354 tests).
- `npm run test:e2e` — passed 2026-04-25 (20 Chromium tests) after restoring the local gitignored E2E `.env.local` and reseeding the admin password for the existing `gallerykit-e2e-mysql` container; the exact gate command was then rerun successfully.

Additional dependency evidence:
- `npm audit --omit=optional` still reports the Next 16.2.3 nested `postcss@8.4.31` advisory; see D-C5RPF-43 for the upstream-blocked residual.

Deployment: `DEPLOY_MODE=none`, so no deploy this cycle.
