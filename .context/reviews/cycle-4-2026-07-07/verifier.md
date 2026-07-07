# Run-10 Cycle-4 — Verifier Lane Report

Start/verification HEAD: `ec433dc4` (clean tree, confirmed via `git status --short` empty).
Angle: evidence-based verification of stated behavior vs actual behavior, per instructions
in the cycle-3 aggregate (`.context/reviews/cycle-3-2026-07-07/_aggregate.md`) and plan
(`.context/plans/cycle-3-2026-07-07-plan.md`).

## 1. Gate results at HEAD ec433dc4

| Gate | Result | Evidence |
|------|--------|----------|
| `npm run lint --workspace=apps/web` | PASS (exit 0) | `eslint` — no output, clean |
| `npm run typecheck --workspace=apps/web` | PASS (exit 0) | `typecheck:app` (route-typegen + tsc) + `typecheck:scripts` (8 JS scripts checked) both clean |
| `npm test --workspace=apps/web` | PASS (exit 0) | `Test Files 333 passed \| 2 skipped (335)` / `Tests 3091 passed \| 4 skipped (3095)`, Duration 11.02s |
| `npm run lint:api-auth --workspace=apps/web` | PASS (exit 0) | 2/2 admin API routes OK (`db/download`, `lr/upload`) |
| `npm run lint:action-origin --workspace=apps/web` | PASS (exit 0) | all mutating server actions enforce same-origin provenance (full listing OK/SKIP-exempt, no failures) |
| `npm run lint:public-route-rate-limit --workspace=apps/web` | PASS (exit 0) | 10/10 public routes OK (rate-limited or carry `@public-no-rate-limit-required`) |

All six fast gates are green at HEAD. The vitest count (3091 passed / 4 skipped, 335 files)
is an **exact match** to the cycle-3 plan's "Cycle-3 terminal evidence" claim
(`.context/plans/cycle-3-2026-07-07-plan.md:213`: "vitest 3091 passed / 4 skipped (335 files)").
Per instructions, production build and Playwright e2e were **not** re-run in this lane
(reserved for the implementation phase).

## 2. Service worker sync (sw.js vs sw.template.js)

- `git show HEAD:apps/web/public/sw.template.js` byte-compared (`cmp`) against the working-tree
  file: **identical** — no drift between committed template and working tree.
- Independently recomputed the stamp `build-sw.ts` would produce, without running the script or
  touching the committed file: `sha256(template + "\nPIPELINE=7").slice(0,8) + "-p7"` = `26516421-p7`.
- Committed `apps/web/public/sw.js:26`: `const SW_VERSION = '26516421-p7';` — **exact match**.
- `IMAGE_PIPELINE_VERSION` confirmed as `7` at `apps/web/src/lib/gallery-config-shared.ts:22`.

**Verdict: in sync.** (Note: this hash differs from cycle-3's own reported `a6ad1051-p7` because
cycle-3's WP5 edited the template itself — touchMeta await, size-0 fix — producing a new
content hash. That is expected, not a regression.)

## 3. i18n key parity (en.json / ko.json)

Flattened both catalogs recursively and diffed key sets:
- `en.json`: 856 keys. `ko.json`: 856 keys.
- Missing in ko: 0. Missing in en: 0.

**Verdict: exact parity**, matching cycle-3's verifier claim of "856/856 keys parity."

## 4. Doc-claim verification (CLAUDE.md vs code, cycle-3-touched surfaces)

| # | Claim (CLAUDE.md) | Code reality | Verdict |
|---|---|---|---|
| 1 | Single-writer guard: DB-scoped lock name `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>`, held on dedicated connection, 60s unref'd `SELECT 1` keepalive, ~25s re-probe before loud error (CLAUDE.md:236) | `apps/web/src/lib/advisory-locks.ts:69-72` — `getSingleWriterLockName` does exactly `sha256(dbName).slice(0,16)` prefixed by `gallerykit_web_singleton`. `apps/web/src/lib/single-writer-guard.ts:39-40` — `KEEPALIVE_INTERVAL_MS=60_000`, `REPROBE_DELAY_MS=25_000`; keepalive timer is `.unref()`'d (line 124); re-probe logic at lines 147-170 matches exactly. | **Match** |
| 2 | Advisory-lock scope note: all locks server-scoped EXCEPT the DB-scoped singleton guard (CLAUDE.md:414) | `apps/web/src/lib/advisory-locks.ts:51-66` doc comment states the same exception verbatim; all other exported lock constants (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, `getImageProcessingLockName`) are plain un-namespaced strings/templates. | **Match** |
| 3 | `QUEUE_CONCURRENCY` pool-budget clamp formula: `min(requested, max(1, floor((POOL_CONNECTION_LIMIT − max(3, ceil(POOL_CONNECTION_LIMIT/2))) / 2)))`, effective cap 2 at pool 10, warns on clamp (CLAUDE.md:100,269) | `apps/web/src/lib/image-queue.ts:125-138` (`resolveImageQueueConcurrency`) implements exactly this: `reserved = max(3, ceil(limit/2))`, `cap = max(1, floor((limit-reserved)/2))`. At limit=10: reserved=5, cap=2. Clamp warning at lines 151-155 (`console.warn` when `QUEUE_CONCURRENCY < REQUESTED_QUEUE_CONCURRENCY`). | **Match** |
| 4 | `serve-upload.ts` ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`, hash already 8 chars, no extra `.slice(0,8)` at the ETag site (CLAUDE.md:316) | `apps/web/src/lib/serve-upload.ts:254,302` — both ETag constructions use this exact template string. `apps/web/src/lib/settings-hash.ts:61` — `HASH_LENGTH = 8`, `.slice(0, HASH_LENGTH)` applied once inside `settings-hash.ts`, not re-sliced at the call site. | **Match** |
| 5 | SW HEAD-probe bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` at 300ms (CLAUDE.md:430) | `apps/web/public/sw.template.js:39` — `const HEAD_REVALIDATE_TIMEOUT_MS = 300;`, used at line 355 in the `fetch(...)` HEAD call's `signal`. | **Match** |
| 6 | migrate.js: mixed-case batch now baselines ONLY true-drift entries (at/below cursor), leaves the above-cursor pending tail un-baselined so drizzle genuinely applies it; `baselineAllJournalMigrations` refuses (throws) an above-cursor baseline attempt (CLAUDE.md:446) | `apps/web/scripts/migrate.js:857-870` computes `trueDrift` (≤ cursor) vs `pendingTail` (> cursor), warns on the tail, and calls `baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor })`. The function itself (lines 747-781) throws if any insert candidate sits above `options.maxFolderMillis`. Regression test exists: `apps/web/src/__tests__/migrate-pending-migrations.test.ts:129` — `'MIXED batch (drift below cursor + pending above): baselines ONLY the drift entries, never the pending tail (C3-01)'`, plus a dedicated above-cursor-guard test at line 171. | **Match** |
| 7 | Retry-backoff comment: `image-queue.ts` processing-retry site now says "escalating up to 10s" (was wrongly "25s", C3-21) | Line 949: `// escalating up to 10s at this call site` for `PROCESSING_RETRY_DELAY_MS * Math.min(retries, 5)` with `MAX_RETRIES=3` (so `retries` effectively caps at 2, giving 5000×2=10000ms). **Separately**, line 721 still reads "escalating up to 25s" for a *different* schedule (`CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5)`, `MAX_CLAIM_RETRIES=10`); with `CLAIM_RETRY_DELAY_MS=5000`, that cap genuinely is 5000×5=25000ms. This is a distinct, correctly-labeled schedule, not a residual instance of the C3-21 bug — verified both constants (`CLAIM_RETRY_DELAY_MS=5000`, `PROCESSING_RETRY_DELAY_MS=5000` at lines 105,110) to confirm the math for each site. | **Match** (no residual bug; initially looked like a possible miss, ruled out by checking the constants) |

No doc-claim mismatches found among the six cycle-3-touched surfaces named in the task, plus the retry-comment spot check. This differs from cycle-3's own doc-claim sweep (VER3-01/VER3-03), which *did* find mismatches — those were the ones fixed this cycle, and the fixes hold up under direct code inspection.

## 5. Cycle-3 plan "Done" evidence accuracy

| WP | Plan claim | Verification | Verdict |
|----|---|---|---|
| Terminal evidence | "17 implementation commits `e08b6f97..24c46745`" | `git rev-list --count e08b6f97..24c46745` = **16**, not 17. `git rev-list --count e08b6f97..ec433dc4` = 17, but `ec433dc4` ("docs(review): close run-10 cycle-3 ledger with post-deploy evidence") is *outside* the stated range and is a docs-only ledger-closing commit, not an "implementation" commit. | **FINDING (VER4-01)** — miscount, same class as cycle-3's own VER3-02 |
| WP15 | "`[x]` C3-28 + C3-29 (LOW): micro-perf pair" — marked fully done | C3-29 (serve-upload `realpath` memoization) **is** implemented: `apps/web/src/lib/serve-upload.ts:20-32` caches `cachedResolvedUploadRoot` with a `PERF3-07 / C3-29` comment. C3-28 (CSP module-level memoization) is **not** implemented: `apps/web/src/lib/content-security-policy.ts` has zero commits touching it anywhere in `e08b6f97..24c46745` (`git log` for that path/range is empty), and the file still parses `IMAGE_BASE_URL` per-call via a default parameter (no module-level cache). The carry-forward register correctly lists `C3-28` as still open with a reasoned deferral note ("CSP memoization conflicts with pinned per-call fail-degrade semantics") — but the **plan's own WP15 checkbox marks the whole line `[x]` done**, which overstates completion for C3-28. | **FINDING (VER4-02)** — plan/register disagree; register is the accurate one |
| WP1/WP2/WP3/WP4/WP5/WP6/WP7/WP8/WP9/WP10/WP11/WP13/WP14 | Various `[x]` done claims | Spot-checked implementation for WP1 (migrate.js), WP2 (single-writer guard), WP4 (404 robots — confirmed `apps/web/src/app/[locale]/layout.tsx:55-61` removed the explicit `robots: {index:true,follow:true}`, only a comment remains; `not-found.tsx` carries no conflicting robots field), WP5 (SW hash sync, §2 above), WP8 (defensive copy — confirmed `apps/web/src/app/api/search/similar/[id]/route.ts` `targetEmbedding = new Float32Array(decoded)`), WP10 (nginx — confirmed `limit_req_zone ... zone=nextimage:10m rate=30r/s` and `limit_req zone=nextimage burst=120 nodelay` on `location ^~ /_next/image` in `apps/web/nginx/default.conf:19,252,260`), WP11 (all four claimed new test files exist: `not-found-layout-restore-maintenance.test.ts` with a 12-case matrix across three layouts exceeding the claimed 2×2, `clip-inference.test.ts`, `csp-nonce.test.ts`, `settings-normalization.test.ts`). | **Accurate** for everything checked except WP15 above |

## 6. Carry-forward register internal consistency (`deferred-carry-forward.md`)

- **Structural consistency**: every ID in the "Rows that left a register recently" section
  (`C77-ARCH-01`, `C94-11`, `C2-31` concrete instance, `C3-25`) is correctly *absent* from the
  "Open carry-forward rows" table — no resurrected or duplicated IDs found.
- **C3-28 row is correct** (see VER4-02 above): the register's own open-row listing for C3-28
  is the accurate account; the plan's WP15 checkbox is the outlier.
- **"No open High row" claim**: scanned every `Sev/Conf` cell in the open-rows table; no row
  reads a bare `HIGH` severity. Two rows are ambiguous on a literal string match:
  - `C1-25(a)`: labeled `HIGH-attached-to-doc (fixed)/product` — the `(fixed)` qualifier
    clarifies the HIGH-severity mechanism was already remediated elsewhere and what remains
    open is a **product decision** (ship a Collections admin UI), not an open HIGH defect.
    Read correctly, this does not violate the claim, but the label is easy to misread at a
    glance — **minor clarity nit**, not a correctness bug.
  - `C3-12op`: labeled `MED-HIGH contingent` — consistent with the table's existing
    `MED-HIGH` convention used elsewhere (e.g. cycle-3's own `C3-01`/`C3-11` used
    `MED-HIGH/High`), not a bare `HIGH`. No violation.
- **Age-accounting minor inconsistency (low confidence)**: the register's stated convention is
  that age increases with distance from the current cycle (explicit worked example: cycle-96
  items are `~6` at r10c3). Under that convention, `C80-06` (first deferred at cycle **c80**)
  and `C94-10/C88-03` (first deferred at cycle **c88**, 8 cycles later than c80) both show
  `Age @ r10c3 = ~10` — identical ages despite an 8-cycle gap between their first-deferred
  points, whereas the earlier `C76-04/C76-05/C75-08` row (first deferred c75/76, further back
  than both) correctly shows a larger age (`~12`). This looks like an arithmetic/copy-paste
  slip on either the C80-06 or the C88-03 row. Flagged as low-severity given the register's
  own repeated use of `~` (approximate) ages and the explicit disclaimer that old-run item
  ages are estimates across a renumbering boundary — but the two specific rows don't fit even
  the register's own approximate ordering.
- **Age-budget policy cross-check**: `.context/plans/README.md:14-16` states the age-budget
  rule applies specifically to "a deferred **High-severity** finding that crosses 8 cycles."
  The register's summary line ("no open High row is at or past the 8-cycle budget") is
  consistent with this policy scope and with the absence of any bare-HIGH row in the table.

## Summary of findings

- **VER4-01** (LOW/High confidence): Cycle-3 plan's terminal evidence claims "17 implementation
  commits `e08b6f97..24c46745`"; `git rev-list --count` shows **16** in that exact range (17
  only if the out-of-range, docs-only ledger commit `ec433dc4` is included). Bookkeeping-only,
  no behavioral impact.
- **VER4-02** (LOW-MED/High confidence): Cycle-3 plan's WP15 checkbox marks "C3-28 + C3-29"
  as `[x]` done as one unit, but C3-28 (CSP module-level memoization) was **not** implemented
  (zero commits touch `content-security-policy.ts` in the whole cycle-3 range) while C3-29
  was. The carry-forward register's own C3-28 open-row entry is accurate and contradicts the
  plan's checkbox — future cycles reading the plan in isolation would wrongly believe C3-28
  shipped. Recommend annotating the plan's WP15 line to split the outcome (mirroring how other
  WPs note partial completion) rather than trusting the register alone to carry the correction.
- **VER4-03** (INFO/Low confidence): `deferred-carry-forward.md` shows identical `~10` ages
  for `C80-06` (deferred c80) and `C94-10/C88-03` (deferred c88, 8 cycles later), inconsistent
  with the register's own age-ordering convention demonstrated elsewhere in the same table.
  Approximate values, low impact, worth a one-line correction next time the register is touched.
- **VER4-04** (INFO): `C1-25(a)`'s `HIGH-attached-to-doc (fixed)/product` label is technically
  correct but easy to misread against the register's "no open High row" summary claim; a
  small rewording (e.g. "product-decision-only, prior HIGH mechanism already fixed") would
  remove the ambiguity for future readers.

No CRIT/HIGH findings. All six fast gates pass cleanly; SW hash, i18n parity, and every
sampled doc-claim / WP-done-evidence line checked out correct except the two LOW/LOW-MED
bookkeeping items above (VER4-01, VER4-02).
