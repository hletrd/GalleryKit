# Run-10 Cycle 10b (loop-B) Aggregate Review — 2026-07-08

Review start HEAD: `f4faad29` → advanced to `36a79146` mid-review (peer committed
`fix(cycle29): harden server action scanning`, touching only the action-origin
scanner/tests/ledgers — no product-source drift for the lanes below).

Shared-worktree context: a second Claude loop is at its own ~cycle 29, committing/deploying
rapidly. All 11 lanes reviewed COMMITTED HEAD (`git show HEAD:`), not the dirty tree. At
aggregation time the working tree is CLEAN except this cycle's untracked review dir (the peer
committed its previously-dirty `check-action-origin.ts` + tests in `36a79146`).

## Lanes (11/11 returned)

| Lane | New findings | Notes |
|------|-------------|-------|
| code-reviewer | 1 (Low/High-conf) | whole-repo pass; 1 latent dormant bug |
| security-reviewer | 0 | independent re-audit of 9 areas; `npm audit` 0; LOW risk |
| perf-reviewer | 1 (Med/High) | diffed since loop-B c9; 3 prior perf items confirmed fixed |
| critic | 1 (Major/High) | test-methodology gap on peer's fresh c28 code |
| test-engineer | 1 (High-conf) | full suite green 3384 tests; WP11 batch unlocked |
| architect | 1 (Med/High) | verified ARCH9-01/02/03 all CLOSED at HEAD |
| verifier | 0 (PASS) | 16 CLAUDE.md invariants verified TRUE |
| tracer | 4 (Low / Low-Med) | 4 flows traced; all self-healing, no corruption |
| debugger | 0 | 2 theoretical items traced to ground, unreachable |
| document-specialist | 2 (Med/High, Low/Med) | ~30 doc claims verified; 2 real drifts |
| designer | 0 | admin surfaces spot-read; touch-target + i18n green |

## Merged findings (deduped, highest severity/confidence preserved)

### AGG-C10b-01 — grid-picture-fallback recovery handler has no behavioral test (only source-string assertions)
- **Severity:** Major · **Confidence:** High · Source: critic (CRIT10b-01).
- **Citation:** `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts` (100% `readFileSync`+`.toContain`/`.toMatch`); target `apps/web/src/components/grid-picture-fallback-boundary.tsx` (`onErrorCapture` handler that swaps `img.src` to the base JPEG, removes `<source>` children, and guards re-entry via `dataset.fallbackApplied`). Repo's proven no-jsdom pattern: `apps/web/src/__tests__/editable-target.test.ts`.
- **Problem:** the sole regression net for the public masonry broken-thumbnail recovery (home/shared-groups/timeline/year — the documented CRT-D1 "settings changed without backfill" scenario) never renders the component or dispatches a real `error` event, so a refactor could silently break the swap/guard while the full gate stays green. Code is correct today (traced).
- **Disposition:** DEFERRED (D10b-01). The recommended fix extracts the handler out of the peer's freshly-landed cycle-28 component (`36a79146` lineage) — modifying peer-owned source mid-flight is exactly the conflict the shared-worktree rules say to avoid. Not an active bug (code verified correct). Exit criterion: the next cycle that owns/refactors `grid-picture-fallback-boundary.tsx` (either loop) folds in the extract + behavioral test.

### AGG-C10b-02 — client→server-only boundary test walker only follows `@/lib`/`@/db` edges
- **Severity:** Medium · **Confidence:** High · Source: architect (ARCH10b-01).
- **Citation:** `apps/web/src/__tests__/client-server-only-boundary.test.ts:142` (`isAliased = spec => spec.startsWith('@/lib') || spec.startsWith('@/db')`); real near-miss Server Components already present: `apps/web/src/components/nav.tsx:2` and `apps/web/src/components/on-this-day-widget.tsx:3` (both directly reach `@/lib/data`/`@/lib/data-timeline` → `@/db` → `mysql2`, safe today only because imported solely from Server Component entries).
- **Problem:** the DFS never queues an intermediate `@/components/*` module, so a future `'use client'` file importing `@/components/nav` (or one of these turning interactive) regresses to the opaque `next build`/runtime mysql2-bundling failure the test exists to convert into a fast vitest failure. No compensating ESLint boundary rule exists.
- **Disposition:** SCHEDULED (WP-A). Loop-B owns the test file; widen the edge-follow predicate to also traverse `@/components` (reusing the existing type-vs-value AST classification to avoid false positives) + add a regression fixture.

### AGG-C10b-03 — `deleteImages` runs up to 100 sequential single-row INSERTs inside the delete transaction
- **Severity:** Medium · **Confidence:** High · Source: perf-reviewer (PERF10b-01).
- **Citation:** `apps/web/src/app/actions/images.ts:808-836` (`for` loop of `await tx.insert(pendingFileDeletions)...` before the batched `imageTags`/`images` DELETEs); batch capped at 100 (`images.ts:754-756`). Single-image `deleteImage` (`images.ts:674-694`) unaffected.
- **Problem:** side effect of cycle-21's `pending_file_deletions` durability feature — the per-row insert loop extends the transaction's pinned-connection + row/gap-lock critical section by up to ~100 round trips (tens of ms same-host; ~100-500 ms on remote MySQL), counter to the repo's pool-budget discipline, worst under concurrent admin activity.
- **Disposition:** SCHEDULED (WP-B). Replace with one multi-row `INSERT` + one read-back `SELECT ... WHERE image_id IN (...)` to recover per-row ids (safer than relying on AUTO_INCREMENT contiguity); preserves the durability guarantee (rows still committed in the same transaction).

### AGG-C10b-04 — CLAUDE.md omits the `pending_file_deletions` table + recent index additions
- **Severity:** Medium · **Confidence:** High · Source: document-specialist (DOC-C10b-01).
- **Citation:** `CLAUDE.md` "Database Schema (Key Tables)" + "Database Indexes" sections; wired since `apps/web/drizzle/0030_pending_file_deletions.sql` (cycle 21), drained by `maintenance-scheduler.ts` alongside the three documented purge tables. Also missing: index additions from migrations 0028/0029.
- **Problem:** a real, committed, wired-in durable retry queue for failed on-disk cleanup is undocumented, including that it has NO retention/TTL (a persistently-failing row accumulates) — exactly the operational fact CLAUDE.md documents for every other maintenance table.
- **Disposition:** SCHEDULED (WP-C). Add the table + its no-TTL operational note + the 0028/0029/0030 indexes to CLAUDE.md.

### AGG-C10b-05 — CLAUDE.md misstates `lint:public-route-rate-limit` scan scope
- **Severity:** Low · **Confidence:** Medium · Source: document-specialist (DOC-C10b-02).
- **Citation:** `CLAUDE.md` Lint Gates section says it scans `apps/web/src/app/api/**`; the actual scanner (`apps/web/scripts/check-public-route-rate-limit.ts`) recurses all of `apps/web/src/app/` (proven by non-`api/` compliant routes `app/uploads/[...path]/route.ts`, `app/feed.xml/route.ts`). `AGENTS.md` already states the correct broader scope.
- **Disposition:** SCHEDULED (WP-C, folded with AGG-C10b-04). Correct the CLAUDE.md wording to match the scanner + AGENTS.md.

### AGG-C10b-06 — `archiveRange()` December off-by-one (dormant)
- **Severity:** Low · **Confidence:** High · Source: code-reviewer (F1).
- **Citation:** `apps/web/src/lib/data-timeline.ts:93-101` — `endMonth` ternary checks only `month === undefined`, not `month === 12`, so `archiveRange(2025, 12)` yields `end = "2026-13-01 00:00:00"` (invalid MySQL DATETIME); `endYear` correctly wraps.
- **Problem:** a per-month December archive query would bind an invalid datetime and silently return zero rows or error. Currently UNREACHABLE — no live caller passes `month` (timeline + year-in-review are year-only) — a latent landmine that bites the moment a per-month view is wired; no test checks the range values.
- **Disposition:** SCHEDULED (WP-D). One-line fix `month === undefined || month === 12 ? 1 : month + 1` + a unit test pinning the range values.

### AGG-C10b-07 — WP11 UX/a11y batch (5 fixes) shipped with zero behavioral test locks
- **Severity:** Medium (test gap; underlying items up to High/High) · **Confidence:** High · Source: test-engineer (C10b-TEST-01).
- **Citation:** cycle-9b WP11 fixes with no referencing test: `lightbox.tsx` `handleTouchEnd` interactive-target guard (AGG9B-23, High/High — a re-fix of a previously-shipped touch/click slideshow-restart race), `image-zoom.tsx` `touchAction` (AGG9B-24), `photo-viewer.tsx`/`info-bottom-sheet.tsx` `aria-pressed`/`aria-expanded`/`aria-controls` (AGG9B-15), `image-manager.tsx` optimistic per-row tag revert-on-failure (AGG9B-27), `search.tsx` Cmd/Ctrl+K focused-input guard (AGG9B-28).
- **Disposition:** DEFERRED (D10b-02). The recommended locks (pure-predicate extraction + fake-DOM behavioral test) modify the peer loop's freshly-landed WP11 component files — same peer-ownership conflict as AGG-C10b-01, and the underlying code is verified correct today. Same test-infrastructure investment class as the open D9b-01/D9b-05 rows. Exit criterion: the next cycle that owns/refactors any of these components adds the extracted behavioral test; any real regression re-opens immediately as scheduled.

### AGG-C10b-08 — tracer: 4 self-healing boundary races (all Low / Low-Med)
- Source: tracer. All four absorbed by pre-existing safety nets into clean failures, no corruption/data-loss.
  - **T1 (Low):** `process-image.ts` reopens the source per size; a delete mid-encode → `ENOENT` → caught/rolled-back/retried cleanly, but emits a spurious "processing failed" log + one wasted retry. Distinct from the already-tested post-completion `affectedRows===0` race.
  - **T2 — DROPPED (not new):** settings-hash ETag being inert on the static-serve path is the DOCUMENTED CRT-D1 "operational gotcha" in CLAUDE.md (static path serves majority of traffic; settings-hash only affects the serve-upload path). No wrong bytes ever served. Not a finding.
  - **T3 (Low-Med):** restore drain — a late fire-and-forget `logAuditEvent(...)` can enter the mutation Set after stage-3 (`background-db-writes`) already drained it, and stage-5 waits only on mutation slots. Fails LOUD (no `--force`, import aborts), not silent. Narrow structural gap.
  - **T4 (Low):** `uploadImages()` topic-existence check (`images.ts:265-278`) is an unlocked SELECT with a long window before INSERT, racing a concurrent topic rename/delete; resolved safely by the `images.topic` FK-restrict + per-file error handling. Undocumented/untested.
- **Disposition:** DEFERRED (D10b-03). All Low/Low-Med, self-healing, no data loss — bounded-race polish below this cycle's actionable bar, consistent with the repo's precedent for self-healing narrow-race deferrals. Exit criteria per row in the deferred register.

## Already-fixed (peer) — recorded, neither scheduled nor deferred
- **WP10 / ARCH9-03 (mutation-barrier scanner):** CLOSED by peer — `check-action-origin.ts:292,1641` now requires `acquireAdminMutationSlot()` on every mutating admin action export (or `@mutation-barrier-exempt`). My cycle-9b WP10 is superseded.
- **ARCH9-01 (`ActionResult<T>` dead contract):** CLOSED via deletion (`lib/action-result.ts` gone).
- **ARCH9-02 (`pending-session-revocations.ts` globalThis guard):** CLOSED (`lib/pending-session-revocations.ts:27-39`).
- **PERF-22 / PERF8-BF-01 (pipeline_version index):** fixed (`db/schema.ts:127`).
- **PERF9-01 (tag-filter re-render storm):** fixed (`tag-filter.tsx` memoized).
- **C28-PERF-01 (masonry base-JPEG fallback):** fixed (`masonry-card.tsx:106-116`, `grid-picture.tsx`).
- **Peer cycles 22-28:** restore/session hardening, action-origin scanner scope (AGG-C28-02), grid fallbacks, ARIA (cycle-26), pending-file-deletion retry — deduped, not re-filed.

## Carry-forward / pre-existing (not re-filed as new)
- **WP6 (cross-admin PAT visibility + revocation, AGG9B-06, Med/Med):** genuinely unimplemented at HEAD (`revokeToken`/`listTokensForUser` owner-scoped), BUT `admin_tokens.user_id` FK is `onDelete: 'cascade'`, so a remaining admin already has a coarse escape hatch (deleting the departed admin's account cascades their tokens). Feature gap, not an unpatched security bug. → DEFERRED (D10b-04).
- **C27-02** (concurrent-restore auth-check ordering, Med) and **C28-08** (nginx real-IP/proxy operator validation, Med): already tracked in `deferred-carry-forward.md`; not re-filed (security-reviewer confirmed).

## Cycle disposition
- **New findings produced:** 8 merged (AGG-C10b-01..08; T2 dropped as documented).
- **Scheduled this cycle:** AGG-C10b-02 (WP-A), -03 (WP-B), -04/-05 (WP-C), -06 (WP-D).
- **Deferred:** AGG-C10b-01 (D10b-01), -07 (D10b-02), -08/T1/T3/T4 (D10b-03), WP6 (D10b-04).
- **Already-fixed (peer):** WP10/ARCH9-03 + the list above.
- Codebase remains exceptionally converged; zero new CRITICAL/HIGH unpatched correctness/security/data-loss defects.
