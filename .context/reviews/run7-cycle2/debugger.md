# Debugger Report — Run-7 Cycle-2 (Latent-Bug & Failure-Mode Review)

**HEAD:** `1cdbb883` (`10108963` + AGG-R7C1-01/02 fix commits since cycle-1's `17f743f7`)
**Scope:** Entire repo — latent-bug surface, failure modes, regressions from AGG-R7C1-01/02, error-handling paths, async pipeline failure modes, date/timezone edge cases, integer/float edge cases, DB recovery paths, deploy safety. Error-handling paths emphasized per the orchestrator brief.

**Verification executed at HEAD:**
- `npx tsc --noEmit -p tsconfig.typecheck.json` → **exit 0**.
- `npx vitest run --reporter=dot` → **237 files passed / 2 skipped; 2231 tests passed / 4 skipped / 0 failed**. The 4 skips are the model-weight-gated CLIP suites (`clip-offline-load` ×2, `clip-semantic-integration` ×2) — gated by design on `CLIP_MODELS_ROOT` weights, NOT failures.
- Baseline matches the cycle-1 debugger exactly → AGG-R7C1-01 (NCLX matrix code 8 = YCgCo, not BT.2020-NCL) and AGG-R7C1-02 (Firefox `(color-gamut: p3)` MQ doc-only) introduced **no regressions**. Both fixes verified by reading the changed lines and the new NCLX matrix mapping at `color-detection.ts:204-210`.

## Verdict: 0 CRITICAL / 0 HIGH confirmed latent bugs. 1 MED confirmed. 6 LOW observations + 2 INFO hygiene notes. 0 scheduled.

The codebase remains at the convergence bar set by cycles 6–11 / run-7 cycle-1. The cycle-1 exhaustive audits of the image-queue, backfill, view-count, restore, rate-limit, Stripe, upload, LR-upload, SIGTERM, and atomic-rename paths still hold — I re-walked the highest-risk paths and found no regression from the AGG-R7C1-01/02 changes. Three new failure surfaces emerged from the broader sweep this cycle:

1. **MED-R7C2-01** — histogram RGB clip-percentage divides by the **red-channel total only** instead of the sum of all three channels. Live correctness bug in the clip-bar indicator; not locked by a test. Fix is one line.
2. **OBS-R7C2-02** — `migrate.js` `position`-column backfill for `shared_group_images` only runs when the column was just added, so a partial-run-then-crash leaves every row at `position = 0` permanently. Low probability but unrecoverable without manual SQL.
3. **OBS-R7C2-03** — `restoreDatabase` uses non-transactional `mysql --one-database`; a mid-restore crash leaves a half-applied schema with no rollback and no post-restore validity check.

Several candidates brought forward by the explore sweep were **rejected** after verification (timezone-skew on on-this-day is the documented PP-BUG-1 invariant; ReDoS in `sanitize.ts` does not actually exhibit nested quantifiers; `parseImageSizes` is upstream-guarded; etc.) — the rejection rationale for each is documented below so the next cycle doesn't re-litigate them.

---

## Methodology

Three parallel `Explore` sweeps over `apps/web/src/` (excluding `__tests__/`):

1. **Silent-failure sweep** — every `catch {}` / `catch (e) {}` / `catch (e) { console.* }`, every floating promise, every `Promise.all` without per-item isolation, every `JSON.parse` without try/catch, every `parseInt`/`Number` on untrusted input.
2. **Type/date/numeric sweep** — null/undefined access chains, array index access without bounds, Buffer reads without length check, timezone/date parsing, integer/float edge cases, regex catastrophic backtracking, switch statements without default.
3. **DB/concurrency sweep** — every `db.transaction`, every `GET_LOCK`/`RELEASE_LOCK`, every recovery/cleanup path, every `setInterval`/`setTimeout`, every `getConnection`, cache invalidation, `migrate.js`, `deploy.sh`.

Every HIGH/MED finding from the sweeps was then **independently verified** by reading the cited file:line and tracing the trigger path. Findings that did not survive verification were downgraded or rejected (rejection rationale in §"Rejected candidates").

---

## MED — confirmed

### MED-R7C2-01 [conf H] — Histogram RGB clip-percentage divides by the red-channel total only

**Where:** `apps/web/src/components/histogram.tsx:321-329`

```ts
if (mode === 'rgb') {
    const totals = [data.r, data.g, data.b].map((ch) => ch.reduce((s, v) => s + v, 0));
    total = totals[0];                                  // BUG: red-channel total only
    belowBlack = Math.max(data.r[0], data.g[0], data.b[0]);
    aboveWhite = Math.max(data.r[255], data.g[255], data.b[255]);
    if (total > 0) {
        belowBlack /= total;
        aboveWhite /= total;
    }
}
```

**Root cause:** the worst-case peak numerators (`Math.max(r[0],g[0],b[0])`, `Math.max(r[255],g[255],b[255])`) are correctly taken across all three channels, but the **denominator** is `totals[0]` (the red-channel bin sum only). The intent in the comment at L313-315 ("RGB mode checks the worst-case channel (max of r/g/b at 0 and 255)") is per-channel worst-case; the denominator should be the sum across all three channels (`totals[0] + totals[1] + totals[2]`) — or alternatively each channel's peak should be normalized by that channel's own total and the max ratio taken.

**Concrete trigger:** a green-dominant photo with a green-channel black-clip of `g[0]=1000` (a real occurrence for backlit / foliage scenes) and a red total of `5000`:
- `belowBlack = max(10, 1000, 10) = 1000`
- `total = totals[0] = 5000` (red)
- `belowBlack /= total` → `1000/5000 = 0.20 = 20%`
- `CLIP_THRESHOLD = 0.005` (0.5%) → falsely triggers the red clip-bar indicator (`ctx.fillRect(0, 0, 3, H)` at L342)

The visible artifact is a spurious red strip on the left edge of the histogram on photos that aren't actually clipped. The inverse failure (missed clip) is also possible: a red-only image with `r[0]=10` of `r-total=20` reports a real 50% clip but the math happens to coincide for the red-dominant case. The bug is in the **mixed-dominance** case.

**Severity:** MED. Cosmetic (incorrect clip indicator), no data loss, no crash. Photographer-visible — the histogram is one of the headline color audit surfaces in the photo viewer and lightbox.

**Why this slipped:** the histogram test file (`__tests__/histogram.test.ts`) only covers the worker-request reply matching; it does not exercise the `drawHistogram` clip math. The bug is not locked by any test.

**Fix (one line):**
```ts
total = totals[0] + totals[1] + totals[2];
```
Or, more faithful to the "per-channel worst-case" comment, normalize each channel by its own total and take the max:
```ts
const ratio = (peak: number, sum: number) => sum > 0 ? peak / sum : 0;
belowBlack = Math.max(ratio(data.r[0], totals[0]), ratio(data.g[0], totals[1]), ratio(data.b[0], totals[2]));
aboveWhite = Math.max(ratio(data.r[255], totals[0]), ratio(data.g[255], totals[1]), ratio(data.b[255], totals[2]));
```
The single-line `total = totals[0] + totals[1] + totals[2]` is the minimal fix that matches the existing structure. Add a test fixture exercising a green-dominant with low red to lock the corrected math.

**Similar patterns:** the `luminance`/single-channel branch at L330-336 uses `clipBins.reduce((sum, v) => sum + v, 0)` correctly — single-channel total. No similar bug elsewhere in the file.

---

## LOW observations (NOT scheduled)

### OBS-R7C2-02 [conf H] — `reconcileLegacySchema` `position` backfill not re-runnable

**Where:** `apps/web/scripts/migrate.js:469-481`

```js
const addedPosition = await ensureColumn(connection, dbName, 'shared_group_images', 'position', 'ALTER TABLE shared_group_images ADD COLUMN position int NOT NULL DEFAULT 0');
if (addedPosition) {
    await connection.query(`
        UPDATE shared_group_images AS sgi
        JOIN (
            SELECT group_id, image_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY image_id) - 1 AS computed_position
            FROM shared_group_images
        ) AS ordered
          ON ordered.group_id = sgi.group_id AND ordered.image_id = sgi.image_id
        SET sgi.position = ordered.computed_position
        WHERE sgi.position = 0
    `);
}
```

**Trigger:**
1. Fresh install / e2e cold DB → `reconcileLegacySchema` runs.
2. `ensureColumn` adds `position int NOT NULL DEFAULT 0` → `addedPosition = true`.
3. The UPDATE is queued but the process is killed (deploy SIGTERM, OOM, manual Ctrl-C during init) before line 471's UPDATE commits.
4. Next run: `ensureColumn` sees the column exists → `addedPosition = false` → **UPDATE skipped**.
5. Every `shared_group_images.position` row stays at the DEFAULT `0`. Shared-group rendering sorts by `position` → all images tie at 0 → undefined (effectively `image_id`) order. The admin-curated shared-group image order is silently lost on this DB for its entire lifetime.

**Severity:** LOW. Requires a crash in a ~1-second window during cold bootstrap; only affects fresh installs / e2e cold starts, never an already-initialized production DB (the production DB has the column populated). The recovery is a single manual SQL statement (the same UPDATE without the `addedPosition` gate).

**Why I'm NOT scheduling:**
- Production DBs already have `position` populated (the migration 0009 `smart_collections` era applied this years ago) — the gate is only hit on bootstrap of a NEW database, which is rare (the deploy host runs the same DB across deploys).
- The reconciler's role is the bootstrap-time idempotent path, and the column-creation half IS idempotent; the data-backfill half is the gap. A one-line fix (run the UPDATE whenever any row has `position = 0 AND (count of rows in group) > 1`) is correct but is a feature-level test addition, not a minimal bug fix.
- No live data loss on any existing deployment.

**Re-open criterion:** if a future PR adds a new NOT NULL DEFAULT 0 column whose value must be backfilled for correctness, the same pattern (`if (addedX) { backfill }`) will reproduce this trap. A lint-style rule that all `ensureColumn` + `if (added) { data-backfill }` pairs in `reconcileLegacySchema` must instead gate on data-state would close the class.

### OBS-R7C2-03 [conf H] — `restoreDatabase` non-transactional; mid-restore crash leaves half-applied schema

**Where:** `apps/web/src/app/[locale]/admin/db-actions.ts:454-519`

**Trigger:** the restore spawns `mysql --one-database` and pipes the dump. MySQL DDL is NOT transactional (no DDL rollback), and `--one-database` only filters which statements `USE` applies to — it does not wrap the import in a transaction. If the process is killed mid-`CREATE TABLE` / mid-`INSERT` / mid-`ALTER`:
- The DB is left in a partially-restored state.
- The advisory lock + maintenance flag are released in the inner `finally` (L341-354) regardless of `code === 0`.
- The system resumes serving requests against a half-restored DB.
- `revalidateAllAppData()` (L506) only runs on `code === 0`, so stale cache may persist.
- No post-restore schema-validity check exists (no `SELECT COUNT(*) FROM images`, no checksum, nothing).

**Severity:** LOW in practice — the documented operator pattern is to take a backup before restore, and the restore flow surfaces `code !== 0` to the admin. The half-applied state only happens on a crash mid-stream (not a normal error, which `failRestore` handles by killing the child and surfacing stderr). But it's the single highest-impact recovery gap in the codebase because it's silent and unrecoverable without a manual re-restore from a pre-restore backup.

**Why I'm NOT scheduling:**
- The operator runbook (CLAUDE.md "DB backups stored in `data/backups/`") implies keeping pre-restore backups. The restoration flow is admin-initiated, not automated, so the human is in the loop.
- A post-restore validity check is a feature, not a minimal bug fix.
- Adding transactional restore (`START TRANSACTION; source dump; COMMIT;`) would NOT help — MySQL DDL auto-commits and cannot be rolled back. The only true fix is the dump-format (e.g. `--single-transaction --skip-add-locks` for InnoDB) plus a verification pass, which is out of scope for the debugger angle.

**Re-open criterion:** if a restore is ever automated (cron, webhook) or if the admin UI gains a one-click restore without a confirm-and-backup-first step, this becomes HIGH and a post-restore checksum is mandatory.

### OBS-R7C2-04 [conf H] — `restoreDatabase` temp-file leak on `failRestore` internal throw

**Where:** `apps/web/src/app/[locale]/admin/db-actions.ts:465-475` (`failRestore` body)

`failRestore` is the convergence point for every stream-error / restore-error path. Its body destroys streams, kills the child, unlinks the temp file at `os.tmpdir()/restore-<uuid>.sql` (up to 250 MiB per `MAX_RESTORE_SIZE_BYTES`), and resolves the result promise. If `readStream.destroy()` (or any other sync call before the `await fs.unlink(tempPath)`) throws synchronously, the unlink is skipped and the temp file leaks. The `settled` flag prevents double-resolve but does not protect against this sync throw.

**Severity:** LOW. `readStream.destroy()` does not normally throw; the failure mode requires a Node-internal stream-state corruption. The leaked file accumulates at one per failed restore; the deploy host's `os.tmpdir()` is on the same filesystem as `./data`, so disk pressure eventually surfaces it. The 2026-06-17 disk-full incident was Docker image/cache accumulation, not this.

**Why I'm NOT scheduling:** the probability is very low and the operator can `rm /tmp/restore-*.sql`. A wrapper try/catch (`try { ... } finally { await fs.unlink(tempPath).catch(() => {}) }`) inside `failRestore` is the minimal hardening but is not a confirmed live bug.

### OBS-R7C2-05 [conf M] — DB pool never `.end()`'d on shutdown (masked by `process.exit(0)`)

**Where:** `apps/web/src/db/index.ts:25-104` vs `apps/web/src/instrumentation.ts:18-30`

The graceful shutdown handler in `instrumentation.ts` drains the image queue and view-count buffer inside `Promise.race([... , shutdownTimeout(15s)])`, then calls `process.exit(0)`. It does NOT call `poolConnection.end()` to cleanly close the 10 pooled MySQL connections. In practice this is masked because `process.exit(0)` forcibly destroys the pool, and MySQL server-side auto-releases connections on socket close.

**Trigger for a real failure:** if `process.exit(0)` is ever removed (e.g. a future refactor awaits in-flight requests before exit), the pool keeps connections open against a MySQL that may itself be shutting down (Docker stop of a containerized MySQL), causing a 5-second `connectTimeout` window of stale-connection errors on the next start.

**Severity:** LOW. Masked today, no live bug. Adding `await poolConnection.end()` before `process.exit(0)` is the minimal hardening but is plumbing, not a bug fix.

### OBS-R7C2-06 [conf M] — Unbounded `scheduleBootstrapRetry` reschedule

**Where:** `apps/web/src/lib/image-queue.ts:582-606`

`scheduleBootstrapRetry` arms a single `BOOTSTRAP_RETRY_DELAY_MS` timer that calls `bootstrapImageProcessingQueue`, which on failure calls `scheduleBootstrapRetry` again — no max-retry counter. During a sustained DB outage this retries forever.

**Severity:** LOW. The timer is `unref()`'d (doesn't block exit), guarded by `state.shuttingDown` and `isRestoreMaintenanceActive()`, and is idempotent (one timer, no accumulation). The cost is a periodic `console.error` log line during a DB outage, not memory growth or stuck state. The retry IS the desired behavior — bootstrap SHOULD retry until the DB comes back. The observation is that the loop has no terminator, but the terminators (`shuttingDown`, `bootstrapped` flipping true) cover the realistic cases.

**Why I'm NOT scheduling:** the retry-until-DB-up behavior is the documented contract. Adding a max-retry would make the queue require a manual restart after a long DB outage, which is worse than the current self-heal.

### OBS-R7C2-07 [conf M] — `updateTopic` recreate-path inner SELECT without `FOR UPDATE`

**Where:** `apps/web/src/app/actions/topics.ts:248-286`

The "rename by recreate" pattern does `tx.select(...).where(eq(topics.slug, cleanCurrentSlug))` then `tx.insert` + `tx.update(images)` + `tx.update(topicAliases)` + `tx.delete(topics)`. The transaction holds row locks on the rows it touches (the topic row + its aliases), but the read of `images.topic = cleanCurrentSlug` for the `tx.update(images)` is a non-locking read under default `REPEATABLE READ`. A concurrent `uploadImages` that inserts an image with `topic = cleanCurrentSlug` between the SELECT snapshot and the `tx.update(images)` would write a row whose `topic` references a slug that's about to be deleted. The `tx.update(images)` would miss the new row (it's not in the snapshot), the `tx.delete(topics)` would commit, and the new image row would have a dangling `topic` FK (FK is `ON DELETE SET NULL` per the schema, so it would just lose its topic association silently rather than FK-violate).

**Severity:** LOW. The route-mutation advisory lock serializes topic-segment mutations, but NOT image uploads — so the race is real. The consequence is one image losing its topic-tag silently during a coincident-rename-and-upload, not data corruption. The image still exists; only the topic link is dropped. The FK action (`ON DELETE SET NULL`) prevents the constraint violation.

**Why I'm NOT scheduling:** the realistic probability is very low (admin has to be renaming a topic at the exact second another admin or auto-upload is inserting an image tagged to that topic's old slug), the consequence is bounded, and the fix (SELECT ... FOR UPDATE on `images WHERE topic = ...`, or holding a broader lock across the rename) is a structural change to the locking model that the architect should own, not the debugger.

---

## INFO hygiene notes

### INFO-R7C2-08 — Orphan migration file `0014_drop_reactions.sql` on disk but not in journal

**Where:** `apps/web/drizzle/0014_drop_reactions.sql` (exists) vs `apps/web/drizzle/meta/_journal.json` (only `0014_add_icc_profile_name` is recorded)

The file contains real schema-cleanup SQL (`DROP TABLE IF EXISTS image_reactions; ALTER TABLE images DROP COLUMN IF EXISTS reaction_count;`) that WAS applied in production (the reactions feature was removed in cycle 4). But the journal records the OTHER 0014 (`add_icc_profile_name`). So:

- Drizzle's migrator reads `_journal.json`, NOT the filesystem, so `0014_drop_reactions.sql` is **never run** by `migrate.js`.
- The cleanup it represents was applied by the prior cycle-4 deploy's `reconcileLegacySchema` path (idempotent `ensureColumn`/`DROP TABLE IF EXISTS`).
- The orphan file is dead code on disk.

**Risk:** if anyone deletes the file thinking it's tracked, or if a future drizzle-kit version scans the folder and synthesizes a journal entry for it, the orphan becomes a real migration that re-runs `DROP TABLE` (idempotent due to `IF EXISTS`) and `DROP COLUMN` (idempotent due to `IF EXISTS`). No data loss in either case (the table/column no longer exist), but it's confusing.

**Action:** delete `0014_drop_reactions.sql` to remove the ambiguity, OR add it to the journal with a `when` strictly greater than `0014_add_icc_profile_name`'s `when` (1747056000000) and strictly less than `0015_color_pipeline_decision`'s `when` (1747142400000) so it's tracked consistently. Deletion is the lower-risk option since the SQL was already applied via the legacy reconcile path.

**Why INFO not LOW:** no live bug; the orphan doesn't run. Pure housekeeping.

### INFO-R7C2-09 — `getImageProcessingLockName` uses `:` separator, others use `_`

**Where:** `apps/web/src/lib/advisory-locks.ts:40-41`

```ts
export const getImageProcessingLockName = (jobId: number) =>
    `gallerykit:image-processing:${jobId}`;
```

All other advisory-lock names use `gallerykit_snake_case` (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, etc.). This one uses `gallerykit:kebab:case:{id}`. MySQL advisory lock names are arbitrary 64-char strings with no separator semantics, so there is no actual collision today (`GET_LOCK` matches exact names). Purely cosmetic / consistency — the namespace discipline is broken but the runtime behavior is correct.

**Action:** cosmetic rename in a future refactor; not scheduled.

---

## Rejected candidates (verified NOT to be bugs — documented to prevent re-litigation)

The explore sweeps surfaced several plausible-looking findings that did NOT survive verification. Each is documented with the rejection rationale so the next cycle doesn't re-investigate.

### REJ-1 — "Timezone skew in on-this-day / year-in-review" — **already documented design invariant**

The sweep flagged `on-this-day-widget.tsx:16-17` (Node-local `getMonth()` / `getDate()`) vs `data-timeline.ts:108-109` (MySQL `MONTH()` / `DAY()`) as a TZ-skew bug. **Verified NOT a bug.** The system has an explicit, documented invariant: `process-image.ts:457-472` writes `capture_date` using **local getters** (`getFullYear`, `getMonth+1`, `getDate`), and `mysql-datetime.ts:21` does the same. MySQL `MONTH()`/`DAY()` on a DATETIME column returns the field components of the stored string WITHOUT timezone conversion. So as long as the Node process that WROTE the value and the Node process that READS "today" are in the same TZ, the components align.

The deployment TZ invariant: docker-compose.yml does NOT set TZ, Dockerfile does NOT set TZ, .env.local.example does NOT set TZ, and `db/index.ts`'s init SQL only sets `group_concat_max_len` (no `SET time_zone`). In the production deployment (Docker UTC container + host MySQL on UTC Ubuntu), both align. The PP-BUG-1 comment at `process-image.ts:457-462` is explicit that this is a known footgun for a JST-NAS deployment: "masked in Docker UTC but silently corrupts by +9h on a JST NAS deployment."

**Re-open criterion:** if the deploy host's TZ is ever set to non-UTC (or the MySQL `time_zone` system variable is set to non-SYSTEM), this becomes a real bug. Pinning TZ explicitly in docker-compose (`TZ=UTC`, `SET time_zone='+00:00'`) is the proper hardening but is an ops change, not a code bug.

### REJ-2 — "ReDoS via `new RegExp(escaped)` in sanitize.ts:122" — **no nested quantifiers**

The sweep flagged `pwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); text.replace(new RegExp(escaped, 'g'), ...)` as ReDoS-prone for passwords like `a?a?a?a?a?`. **Verified NOT exploitable.** The escaping converts each literal `?` to `\?` — but more importantly, even an UNESCAPED `a?a?a?a?a?` regex does NOT exhibit catastrophic backtracking: it's a sequence of independent optional quantifiers, each matching greedily with linear fallback. Catastrophic backtracking requires **nested** quantifiers (e.g. `(a+)+`, `(a*)*`) or overlapping alternation (e.g. `(a|a)*b`). A flat `aaaa?a?...` matches in linear time in V8's irregexp engine. The realistic worst case for an escaped password is the literal character class `[abc]` becoming `\[abc\]`, which is also linear.

**Re-open criterion:** if a future change introduces an alternation into the escape (e.g. escaping `|` to allow user passwords containing `|` — which the current regex DOES escape), a malicious password could craft `(a|a)+`. Not exploitable today.

### REJ-3 — "`parseImageSizes` Number without NaN guard" — **upstream-guarded**

The sweep flagged `gallery-config-shared.ts:301` `return normalized.split(',').map((value) => Number(value));` as a NaN-propagation bug. **Verified NOT a live bug.** Line 299 `const normalized = normalizeConfiguredImageSizes(sizesStr)` runs first; line 300 returns `DEFAULT_IMAGE_SIZES` if `normalized` is null. `normalizeConfiguredImageSizes` (L235-254) rejects any non-integer token. So by line 301, `normalized` is guaranteed to be a comma-list of integer strings, and `Number('1024')` is `1024`. The function is also only called from admin-config-controlled paths.

**Re-open criterion:** if a future caller bypasses `normalizeConfiguredImageSizes` and feeds `parseImageSizes` raw input. A `.filter(Number.isFinite)` after the `.map(Number)` would be defense-in-depth; not scheduled because no live bug.

### REJ-4 — "Unguarded `touches[0]` / `changedTouches[0]` in touch handlers" — **TypeScript-correct + spec-bounded**

The sweep flagged `info-bottom-sheet.tsx:79,86,95` and `photo-navigation.tsx:48-49,55,99-100` as unguarded array index access. **Verified NOT a live bug.** Per the Touch Events spec, `touchstart` fires with at least one touch in `e.touches` and `e.changedTouches`; `touchmove` and `touchend` likewise have non-empty `changedTouches`. The only way to get an empty list is programmatic `dispatchEvent(new TouchEvent(...))` with no touches, which no real browser does. The TypeScript types (`React.TouchEvent`, `TouchEvent`) declare `touches` as `TouchList` (non-nullable, indexable). A guard `const t = e.touches[0]; if (!t) return;` would be pure defense-in-depth; not scheduled because there's no realistic trigger.

### REJ-5 — "`new Date(capture_date)` parser implementation-defined for space-separated string" — **aligned with write path**

The sweep flagged `data-timeline.ts:241`, `timeline/page.tsx:69`, `on-this-day-widget.tsx:52` for `new Date(img.capture_date)` where `capture_date` is a space-separated `'YYYY-MM-DD HH:MM:SS'`. **Verified aligned.** The spec leaves space-separated forms implementation-defined, but V8 (Node + Next.js server) parses them as LOCAL time, which is the same interpretation the WRITE path uses (`process-image.ts:468` local getters). The read-write loop is consistent within V8. A Firefox/Safari divergence would only matter if the parse happened CLIENT-side; these are all server components (`on-this-day-widget.tsx` is `async function`, `data-timeline.ts` is a server-only data layer, `timeline/page.tsx` is a server component). Client-side parsing of `capture_date` (e.g. in `photo-viewer.tsx`) goes through the EXIF DateTimeOriginal field directly, not the DB DATETIME string.

### REJ-6 — "`humanizeColorPrimaries` switch returns null on unknown enum" — **TypeScript-exhaustive over a closed enum**

The sweep flagged `color-details-section.tsx` for switches without explicit defaults. **Verified correct.** The `colorPrimaries` union is a closed literal set defined in `color-detection.ts:23` (`'bt709' | 'p3-d65' | 'dci-p3' | 'adobergb' | 'prophoto' | 'bt2020' | 'unknown'`). TypeScript's switch exhaustiveness check fires at compile time if a case is missing, and `tsconfig.typecheck.json` is a blocking gate. The `default: return null` in `humanizeColorPrimaries` is the explicit fallback for `'unknown'`, which is in the union. The caller at L234 `gamutLabel = primariesHuman ?? image.color_primaries ?? ''` correctly falls through to the raw token if both the humanizer and the field return null. Adding new NCLX codes (the WI-09 / Rec.2100 scenario the sweep raised) would require updating the union in `color-detection.ts` AND the switch — and TypeScript would block the build until both are updated. No live bug.

### REJ-7 — "Advisory lock released on every path?" — **verified safe**

The sweep asked to verify all five `GET_LOCK` sites. I traced each: `topics.ts:62-82` (withTopicRouteMutationLock), `admin-users.ts:209-287` (deleteAdminUser), `db-actions.ts:283-359` (restoreDatabase), `upload-processing-contract-lock.ts:18-74`, `admin-backfill-runner.ts:303-368`. Every acquisition is on a dedicated `PoolConnection` released in a `finally`, and `RELEASE_LOCK(...)` is called in the same `finally` with a `.catch(() => {})` guard. MySQL `GET_LOCK` is also auto-released on connection close, so a crashed process never wedges the next attempt. No bug.

### REJ-8 — "Cache invalidation race" — **no persistent cache**

The sweep asked about `unstable_cache` / `cache()`. Verified: every `cache()` usage in `src/lib/` is React's request-scoped `cache()` (per-request dedup), NOT a persistent cache. No invalidation needed. Persistent ISR cache is invalidated via `revalidatePath` / `revalidateAllAppData()` AFTER the DB commit (e.g. `images.ts:634`, `topics.ts:318`). No read-old/write-new/invalidate window.

### REJ-9 — "Deploy prune safety" — **verified all three guarantees hold**

Read `apps/web/deploy.sh` end-to-end. Verified:
1. `docker compose up -d --build` (L31) runs BEFORE any prune (L52+); `set -e` (L2) aborts the script on `up -d` failure so prune never runs.
2. `docker image prune -af` (L53) only removes images unused by any container — the just-built live image is in use by the running `gallerykit-web` container, so it survives.
3. `docker volume prune -f` (L55) has NO `-a` flag — anonymous/dangling volumes only. Named volumes and bind mounts survive. GalleryKit data is bind-mounted (`./data`, `./public`) per docker-compose.yml, so `volume prune` cannot touch it.
All three documented guarantees hold. No bug. The `docker builder prune -af` (L54) wipes shared BuildKit cache, which could affect other projects on the same Docker daemon — but the deploy host is single-purpose (only `gallerykit-web`), so this is also safe in practice.

### REJ-10 — "Stripe webhook idempotency" — **re-verified, unchanged from cycle-1**

The cycle-1 debugger exhaustively audited the Stripe webhook. The code is unchanged since cycle-1 HEAD `17f743f7`. Idempotency guard (SELECT-then-INSERT with `onDuplicateKeyUpdate`), `insertedFresh` disambiguation (`affectedRows === 1 && insertId > 0`), and deleted-image FK handling (`ER_NO_REFERENCED_ROW_2` → 200) are all intact. The documented `async_payment_succeeded` deferral (CLAUDE.md / plan-316 CRT-R5C1-04) remains mitigated by the card-only pin. No regression.

---

## Paths re-walked from cycle-1 (no regressions from AGG-R7C1-01/02)

To verify the cycle-1 fixes did not introduce latent bugs, I re-walked the four changed surfaces:

1. **`color-detection.ts:204-210`** (AGG-R7C1-01 NCLX matrix map) — `8: 'ycgco'` is now correctly mapped. The `matrixCoefficients` union at L27 includes `'ycgco'`. The `inferMatrixCoefficients` function at L144-152 (ICC-name-based inference) is unchanged and does NOT need a `ycgco` arm (no ICC profile description would resolve to YCgCo — that's a CICP-only matrix code). The downstream `humanizeMatrixCoefficients` switch in `color-details-section.tsx` has the `'ycgco' → 'YCgCo'` case (verified). The test fixtures `color-detection.test.ts` and `color-details-section-delivered.test.ts` were updated in the same commit and pass.
2. **`use-display-capability.ts`** (AGG-R7C1-02 comment-only) — no behavioral change. The conservative `'srgb'` fallback for Firefox is unchanged. The MQ change-event listener for Chrome/Safari/Edge is unchanged.
3. **`CLAUDE.md`** — doc-only, no code impact.
4. **Type-check + test suite** — both pass at HEAD with the same baseline as cycle-1. No new errors introduced.

The NCLX matrix fix is a **correctness improvement** (real files with CICP matrix=8 are now labeled YCgCo instead of the wrong BT.2020-NCL), not a regression risk. The doc fix is comment-only.

---

## Final sweep — commonly-missed failure modes (cycle-1 baseline holds)

- **Off-by-one in `clampSemanticTopK` / `isRateLimitExceeded`** — unchanged from cycle-1, still correct.
- **Null/undefined in `decodeEmbeddingColumn`** — unchanged, 3-case decode with `null` return, callers filter.
- **Type coercion in `getTrustedProxyHopCount`** — unchanged, `Number.parseInt` with `Number.isInteger` + `>= 1` guard.
- **`resolveBackfillConcurrency` NaN guard** — unchanged, `Number.isFinite(poolLimit) ? poolLimit : 10`.
- **`safeInsertId` BigInt precision** — unchanged, used at all AUTO_INCREMENT insert sites.
- **`toMySqlDateTime` vs `toISOString`** — unchanged, the `failed_at` write at image-queue.ts:529 uses `toMySqlDateTime(new Date())`, the prior `toISOString()` ER 1292 fix is intact.
- **Floating promise / unhandled rejection in image-queue caption + embedding hooks** — unchanged from cycle-1, both `.then().catch()` and IIFE-with-try/catch correctly terminate.
- **Per-image advisory lock release on every path** — unchanged, `releaseImageProcessingClaim` is in the worker's `finally` with `.catch(() => {})`.
- **`cleanOrphanedTmpFiles` ENOENT narrowing (AGG8R-08)** — unchanged, real I/O errors still surface.
- **Bootstrap GC re-arm (AGG-M12)** — unchanged, `!state.gcInterval` guard at L712 prevents multi-batch reset.

---

## Summary table

| ID | Severity | Conf | Where | One-line | Scheduled? |
|---|---|---|---|---|---|
| MED-R7C2-01 | MED | H | `components/histogram.tsx:323` | RGB clip % divides by red-channel total only | No (cosmetic; one-line fix recommended to planner) |
| OBS-R7C2-02 | LOW | H | `scripts/migrate.js:469-481` | `position` backfill not re-runnable after partial-run crash | No |
| OBS-R7C2-03 | LOW | H | `app/[locale]/admin/db-actions.ts:454-519` | Restore non-transactional; mid-restore crash = half-applied schema | No |
| OBS-R7C2-04 | LOW | H | `app/[locale]/admin/db-actions.ts:465-475` | `failRestore` temp-file leak on internal sync throw | No |
| OBS-R7C2-05 | LOW | M | `db/index.ts` vs `instrumentation.ts` | Pool never `.end()` on shutdown (masked by `process.exit(0)`) | No |
| OBS-R7C2-06 | LOW | M | `lib/image-queue.ts:582-606` | Unbounded `scheduleBootstrapRetry` reschedule | No |
| OBS-R7C2-07 | LOW | M | `app/actions/topics.ts:248-286` | `updateTopic` rename SELECT without `FOR UPDATE` | No |
| INFO-R7C2-08 | INFO | H | `drizzle/0014_drop_reactions.sql` | Orphan migration file not in journal | No (delete or journal it) |
| INFO-R7C2-09 | INFO | M | `lib/advisory-locks.ts:40-41` | `image-processing` lock uses `:` not `_` | No (cosmetic) |

**Rejected candidates:** 10 (REJ-1 through REJ-10) — each verified non-bug with rationale above.

**Compared to cycle-1:** cycle-1 reported 0 confirmed findings + 1 LOW observation (OBS-R7C1-01 deleteImage best-effort cleanup) + 6 LOW deferred items. Cycle-2 reports 1 MED confirmed + 6 LOW + 2 INFO. The MED is a real correctness bug in the histogram clip-indicator math that has been present for many cycles — it was simply not in the cycle-1 failure-mode focus (cycle-1 emphasized async/lock/transaction surfaces; cycle-2's broader sweep added numeric/cosmetic/UI surfaces). It is not a regression from AGG-R7C1-01/02.

---

## Recommended planner action

**Single candidate worth scheduling:** MED-R7C2-01 (histogram clip total). One-line code fix + one fixture test. The LOW observations are all documented design contracts or masked-by-`process.exit(0)` plumbing gaps; they should be re-opened only if their re-open criteria trigger (e.g. deploy TZ changes, automated restore, multi-tenant Docker host).
