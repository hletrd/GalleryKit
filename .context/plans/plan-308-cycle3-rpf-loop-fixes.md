# Plan 308 — Cycle 3 RPF loop fixes (HEAD `839d98c`)

Source review: `.context/reviews/_aggregate.md` (cycle 3).

## Scope

Address every cycle-3 finding from the aggregate. All findings are real
(no false positives this cycle) and all are addressable in the same
loop. Per repo policy (CLAUDE.md, Git Commit Rules) every commit will be
GPG-signed (`-S`), use Conventional Commits + gitmoji, and be pushed
immediately after each iteration.

## Tasks

### TASK-308-1 — Fix touch-target audit multi-line `<Button>` blind spot (AGG3-M01)

- **Severity:** Medium / **Confidence:** High
- **Files:**
  - `apps/web/src/__tests__/touch-target-audit.test.ts` (scanner)
  - `apps/web/src/components/upload-dropzone.tsx:405-413` (raise to 44 px)
  - update `KNOWN_VIOLATIONS` map for the new true-positive set (admin
    table icon buttons stay documented under existing
    keyboard-primary rationale)

**Approach:** add a one-line normalization pass before splitting:
`text.replace(/<(Button|button)\b([^>]*?)>/gs, m => m.replace(/\s+/g, ' '))`.
Then re-baseline `KNOWN_VIOLATIONS`. Add a meta-test that asserts the
scanner catches a known multi-line `h-6 w-6` synthetic fixture.

**Action items:**
1. Update `scanFile` to normalize multi-line JSX `<Button>` / `<button>`
   openings into single logical lines before splitting.
2. Raise `upload-dropzone.tsx:408` REMOVE button to `h-11 w-11`.
3. Run audit; collect new true-positive set; update `KNOWN_VIOLATIONS`
   for admin-protected-area buttons (each entry MUST keep the existing
   "keyboard-primary" rationale comment + re-open criterion).
4. Add meta-test fixture: a multi-line `<Button size="icon" className="h-6 w-6">`
   string fed to `scanFile` (or its extracted `scanSource`) must produce
   ≥1 issue.

**Done when:** vitest green; the meta-test exists; upload-dropzone REMOVE
clears 44 px; `KNOWN_VIOLATIONS` reflects the new true-positive set.

### TASK-308-2 — Drop / fix the no-op `.toSQL()` sub-test (AGG3-L01)

- **Severity:** Low / **Confidence:** High
- **File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts:140-156`

**Approach:** convert the sub-test into a real `.toSQL()` inspection.
Drizzle's `db.select(...).leftJoin(...).limit(1).toSQL()` is synchronous
and returns `{ sql: string, params: unknown[] }`. Build the same query
shape that `getImagesLite` builds and assert the SQL string contains
`group_concat(distinct \`tags\`.\`name\` order by \`tags\`.\`name\`)`
(or the dialect-specific casing) and that the FROM clause has the
expected `left join`.

**Done when:** sub-test calls `.toSQL()` and asserts on the returned
string; the docstring matches the implementation.

### TASK-308-3 — Throttle `assertBlurDataUrl` warn output (AGG3-L02)

- **Severity:** Low / **Confidence:** Medium
- **File:** `apps/web/src/lib/blur-data-url.ts:58-75`

**Approach:** introduce a small bounded `Map<string, number>` keyed by
`(typeof,len,head)` tuple. On rejection, increment the counter; emit the
warn only when the counter transitions from 0→1 (first sighting) and
periodically thereafter (e.g., every 1000 hits). Cap the map at 256
entries; oldest-entry eviction.

**Done when:** repeated rejections of the same value produce a single
warn line per process lifetime (within bounded growth); existing tests
remain green.

### TASK-308-4 — Add upload-action assertBlurDataUrl wiring fixture (AGG3-L03)

- **Severity:** Low / **Confidence:** Medium
- **Files:** new test (`apps/web/src/__tests__/images-action-blur-wiring.test.ts`)

**Approach:** fixture-style grep test: open
`apps/web/src/app/actions/images.ts`, assert it imports `assertBlurDataUrl`
from `@/lib/blur-data-url`, and that `blur_data_url:` is followed by
`assertBlurDataUrl(`.

**Done when:** test exists and passes; lock against future refactors
that bypass the barrier.

### TASK-308-5 — Document touch-target audit + blur-data-url contract in CLAUDE.md (AGG3-L04 / AGG3-I02)

- **Severity:** Low + Info
- **File:** `CLAUDE.md` ("Lint Gates" / "Image Processing Pipeline" sections)

**Approach:** add a "Touch-Target Audit" subsection under "Lint Gates"
describing scope (`SCAN_ROOTS`), pattern coverage (multi-line + shadcn
+ HTML button), and exemption protocol. Add a one-line pointer to
`lib/blur-data-url.ts` from the existing Image Processing Pipeline
section.

**Done when:** CLAUDE.md has both subsections.

## Deferred

None this cycle. All 7 findings are scheduled in TASK-308-1 through
TASK-308-5. The two INFO-grade items (AGG3-I01 MySQL CHECK, AGG3-I02
docs) are folded into existing tasks (I01 left as informational since
it requires a schema migration; I02 covered by TASK-308-5).

### AGG3-I01 — MySQL CHECK constraint on `blur_data_url`

- **Severity:** Informational / **Confidence:** High
- **File citation:** `apps/web/src/db/schema.ts:51`
- **Reason for deferral:** schema migration touching the live `images`
  table requires a coordinated rollout (drizzle-kit push + `db:push`
  step in deploy). The existing application-layer guard
  (`assertBlurDataUrl` at producer + consumer) blocks the common attack
  surface; a CHECK constraint is defense-in-depth, not a fix for a known
  exploit. Both write paths (server action + DB restore) are admin-only.
- **Original severity preserved:** Informational (NOT downgraded).
- **Repo policy citation:** CLAUDE.md "Permanently Deferred" section
  authorizes deferring informational defense-in-depth items when no
  exploit path is open. The existing layered guards (write-time validator
  in `actions/images.ts:307`, read-time validator in `photo-viewer.tsx`,
  CSP `img-src` enumeration of `data:`) are documented as the primary
  enforcement; CHECK would be redundant insurance.
- **Exit criterion:** re-open if (a) a new write path that bypasses
  `assertBlurDataUrl()` is added, or (b) a CHECK-constraint migration is
  scheduled for unrelated schema work.

## Quality-gate plan

After each TASK lands:
1. `npm run lint --workspace=apps/web`
2. `npm run lint:api-auth --workspace=apps/web`
3. `npm run lint:action-origin --workspace=apps/web`
4. `npm test --workspace=apps/web`

After all TASKs land:
5. `npm run build --workspace=apps/web`
6. `npm run deploy` (per cycle, per orchestrator DEPLOY_MODE)

## Progress

- [x] TASK-308-1 — touch-target audit multi-line scanner — commit `5d5a0e2`
- [x] TASK-308-2 — .toSQL() sub-test — commit `c46bec0`
- [x] TASK-308-3 — assertBlurDataUrl warn throttle — commit `40c5f5a`
- [x] TASK-308-4 — upload-action wiring fixture — commit `8105895`
- [x] TASK-308-5 — CLAUDE.md docs — commit `1234be7`

All cycle-3 plan items implemented. Gates green: lint, lint:api-auth,
lint:action-origin, vitest (65 files / 447 tests).
