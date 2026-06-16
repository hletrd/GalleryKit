# Test Engineer Review — Run 6 / Cycle 6

**HEAD:** `4eb83aab`
**Agent:** test-engineer
**Date:** 2026-06-17

## Verdict: 0 actionable coverage gaps. 0 flaky tests. Suite green.

The cycle-5 finding (AGG-C5-01 — data layer uncovered by the client→server-only
boundary guard) was implemented correctly AT HEAD and closed cleanly. I found
no new HEAD-verified coverage gap or flaky test that warrants a code change.
This continues the convergence trend (11 → 45 → 14 → 5 → 1 → **0**); an honest
0/0 is the correct, desirable outcome here.

---

## What I verified

### 1. Full suite is green and fast (no contention flake this run)
```
npm test --workspace=apps/web
 Test Files  233 passed | 1 skipped (234)
      Tests  2181 passed | 2 skipped (2183)
   Duration  43.14s
```
43s this run vs the ~206s cycle-5 run under contention — no slowness, no
contended-flake signal, exit code 0.

### 2. The 1 skipped file / 2 skipped tests are the intentional CLIP env-gating
`clip-semantic-integration.test.ts` uses `const d = RUN ? describe : describe.skip`
gated on model-weights presence ("CI (no model weights) skips the whole suite").
This is the documented HARD GUARD (CLIP disabled by design) — NOT a gap.

### 3. All 12 CLAUDE.md-claimed locked-contract tests exist and are non-vacuous
| Test file | it() | expect() | non-vacuous evidence |
|---|---|---|---|
| data-tag-names-sql.test.ts | 9 | 52 | asserts `tagNamesAgg` GROUP_CONCAT shape |
| sw-template-contract.test.ts | 15 | 33 | pins template vs sw-cache reference |
| touch-target-audit.test.ts | 26 | 28 | 1244-line scanner, FORBIDDEN regex set |
| privacy-fields.test.ts | 8 | 13 | `publicSelectFieldKeys).not.toContain(GPS/PII)` + symmetric set equality |
| process-image-blur-wiring.test.ts | 3 | 3 | producer-side blur MIME wrap |
| images-action-blur-wiring.test.ts | 3 | 4 | write-time blur assertion |
| backfill-color-pipeline.test.ts | 6 | 25 | persisted column set |
| admin-backfill-runner-detection-failure.test.ts | 1 | 7 | no version bump on detection failure |
| client-server-only-boundary.test.ts | 9 | 31 | AST value-import + mysql2-in-closure |
| check-api-auth.test.ts | 10 | 25 | withAdminAuth wrap fixtures |
| check-action-origin.test.ts | 27 | 70 | requireSameOriginAdmin early-return |
| check-public-route-rate-limit.test.ts | 18 | 39 | pre-increment / exempt-tag fixtures |

### 4. AGG-C5-01 (the HEAD commit) closed the cycle-5 gap the right way
`client-server-only-boundary.test.ts` now:
- treats a `mysql2` / `mysql2/promise` import anywhere in the transitive closure
  as a server-only-equivalent signal (the unambiguous server-only Node driver
  that `@/db` imports), closing the `'use client' → @/lib/data → @/db → mysql2`
  leak that previously passed green;
- replaced the regex import-extractor with a TypeScript-AST **value-import**
  classifier that drops both statement-level (`import type`) and inline
  (`import { type X }`) type-only forms — fixing a latent over-fire the regex
  always had;
- correctly left `@/db/index.ts` WITHOUT `import 'server-only'` (HARD GUARD #1 —
  `server-only@0.0.1` throws under tsx and would break the backfill sidecar +
  DB init/seed scripts). The mysql2-in-closure check closes the same gap with
  zero runtime risk. This is exactly the safe fix; the rejected unsafe variant
  is documented in plan-356.

### 5. Every recent source change (last 12 commits) ships with a regression test
Only 3 non-test `src` files changed in the window, all low-risk and covered:
- `app/actions/images.ts` — one-line import-source move (`isWideGamutPrimary`
  now from `@/lib/color-primaries` instead of the dropped `@/lib/color-detection`
  re-export). Covered by `client-server-only-boundary.test.ts` +
  `wide-gamut-primaries.test.ts`.
- `lib/color-detection.ts` — comment-only (dropped the re-export). Covered by
  the same two tests.
- `components/ui/switch.tsx` — thumb-travel fix (`translate-x-full` in a nested
  h-6/w-11 pill). Covered by the new `switch-geometry-contract.test.ts`
  (99 lines, added in `9a262e3f`) AND the touch-target audit (Root stays 44px).

### 6. No flaky-test patterns
- **Zero** raw-timer sleeps (`new Promise(r => setTimeout(...))`) anywhere in
  `__tests__/`.
- **Every** `vi.waitFor` carries an explicit `{ timeout: 20_000, interval: 25 }`
  — the generous 20s timeout is the exact hardening from commit `6ab40644`
  ("fix flaky bootstrap-continuation wait under full-suite load"). The 25ms
  poll keeps resolution snappy while tolerating CPU starvation under load. This
  is the correct pattern; the cycle-5 unbounded-wait concern is resolved.
- `useRealTimers` files (`image-queue`, `sw-cache`, `audit-retention`,
  `view-retention`, `serve-upload-settings-debounce`, `bounded-map`) pair real
  timers with `vi.waitFor` polls or deterministic completion, not fixed sleeps.

### 7. High-risk security invariants are densely + non-vacuously covered
- `strip-gps-from-original.test.ts` (28 it / 93 expect) — runs the REAL strip
  function against GPS-tagged JPEG/AVIF fixtures; asserts GPS IFD gone via
  `exifReader`, non-GPS EXIF (`Make`/`Model`) retained, pixels byte-identical
  (no re-encode). Not vacuous.
- `validation.test.ts` (52 it / 136 expect) — slug/filename/traversal +
  `containsUnicodeFormatting`/`stripUnicodeFormatting` (the EXIF-caption bidi
  strip from `a294c333` is regression-fixtured here as the commit message claims).
- `advisory-locks.test.ts` (4 it / 10 expect) — pins all 5 lock-name constants
  + the parameterized `gallerykit:image-processing:{id}` name against drift.
- `csv-escape.test.ts` (20/32), `session-verify.test.ts` (16/32),
  `rate-limit.test.ts` (27/48), `auth-rate-limit-ordering.test.ts` (12/30) —
  all substantive.

---

## HARD GUARDS respected
1. Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks
   tsx backfill). The AT-HEAD fix already uses the safe mysql2-closure approach.
2. Did NOT touch the 2 self-skipping CLIP integration tests (intentional
   env-gating, not a gap).
3. Did NOT re-report any cycle-1–5 item. All claims verified against HEAD
   `4eb83aab`.

## Bottom line
The test surface is mature, the security-critical invariants are pinned with
non-vacuous fixtures, the suite is green and fast, and there are no flaky-test
patterns. **No test changes recommended this cycle.**
