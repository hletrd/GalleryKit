# GalleryKit — Verifier Review (run-10 cycle-3)

## Scope and method

Claim-by-claim verification of STATED behavior (root `CLAUDE.md`, `apps/web/README.md`, commit
messages in `git log 642c5091..e08b6f97`, test names/assertions, code comments, and
`.context/plans/cycle-2-2026-07-07-plan.md`'s WP0-WP26 completion claims) against the current
source tree at HEAD (`e08b6f97`). Predecessor: `.context/reviews/cycle-2-2026-07-07/verifier.md`
(3 LOW/INFO doc-precision findings, all still valid and not re-checked here since nothing in
cycle-2 touched those files). Deferred registers consulted (`cycle-2-2026-07-07-deferred.md`,
`cycle-1-2026-07-06-deferred.md`) — no deferred item is re-reported absent new evidence.

Method: read the diff for every commit in the range, cross-referenced each cycle-2 plan WP's
"Done" line against the actual current code (not just the commit that introduced it, to catch
later regressions), ran the full test/typecheck/lint-gate suite, and independently recomputed the
three "final sweep" artifacts (SW hash, migration journal monotonicity, i18n key parity) rather
than trusting prior reports' numbers.

**Live verification run at current HEAD:**
- `npm test` — **3032 passed, 4 skipped, 0 failed** (326 test files).
- `npm run typecheck` — clean (typecheck:app + typecheck:scripts, both 0 errors).
- `npm run lint:api-auth` — both admin API routes OK.
- `npm run lint:action-origin` — all mutating server actions OK (one documented exempt read-only export).
- `npm run lint:public-route-rate-limit` — all public routes OK (rate-limited or documented-exempt).
- i18n key parity (`messages/en.json` vs `messages/ko.json`, recomputed via a flatten+diff script,
  not trusting the predecessor's number): **856 keys each side, 0 missing either direction.**
- `public/sw.js` vs `public/sw.template.js`: recomputed `build-sw.ts`'s hash formula
  (`sha256(template + "\nPIPELINE=" + IMAGE_PIPELINE_VERSION).slice(0,8) + "-p" + IMAGE_PIPELINE_VERSION`)
  independently in a node one-liner: **`a6ad1051-p7`, matches the `SW_VERSION` constant literally
  embedded in the committed `public/sw.js`.** In sync.
- `drizzle/meta/_journal.json` monotonicity: 29 entries, exactly one non-monotonic pair (idx 7,
  `0007_image_reactions`, the documented historical inversion) — matches the
  `ALLOWLISTED_NONMONOTONIC_IDX = new Set([7])` in `migration-journal-monotonicity.test.ts`
  exactly, and that test (plus `migration-journal.test.ts`) passes live.

No regression was found in any of the invariants CLAUDE.md documents in detail: ETag composition
(`serve-upload.ts:230`, `` `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` ``,
byte-for-byte as documented), the 8 named MySQL advisory locks plus the new
`gallerykit_web_singleton` (all present in `src/lib/advisory-locks.ts`, matching the CLAUDE.md
list exactly including the newly-added one), the `_PrivacySensitiveKeys` admin-only column guard
(spot-checked `processing_settings_json`, a pre-existing column unrelated to cycle-2's work — still
correctly listed at `data.ts:472` and omitted from every public field set), the blur-data-url
contract, and the touch-target `KNOWN_VIOLATIONS` audit (the full vitest run, including
`touch-target-audit.test.ts`, passes, so no undocumented violation exists at current HEAD).

---

## Findings

### VER3-01 — CLAUDE.md's single-writer-guard claim ("holds it for the process lifetime") does not survive a MySQL `wait_timeout` lapse; corroborates ARCH3-01 from an independent doc-claim angle
- **Severity:** MEDIUM (operational — silent loss of the one diagnostic signal for the documented single-writer topology) **Confidence:** High **Status:** Confirmed
- **Claim:** `CLAUDE.md:236`: *"at startup the web process best-effort-acquires the `gallerykit_web_singleton` advisory lock on a dedicated non-pool connection... and **holds it for the process lifetime**. If the lock is already held, a LOUD `console.error` announces that a second live instance shares this MySQL server..."*
- **Code:** `apps/web/src/lib/single-writer-guard.ts:24-99`. The dedicated connection, once the lock is acquired, is never queried again — no periodic `SELECT 1`, no keepalive query of any kind. The only defensive wiring is `conn.on('error', ...)`, which sets `heldConnection = null` and warns **once** if the connection object itself errors. MySQL closes a connection after `wait_timeout` (server default 28800s / 8h) of *query* inactivity, releasing any advisory locks it held server-side. At that point: (a) whether mysql2 actually surfaces an `'error'` event for a server-initiated idle-close depends on how the TCP session is torn down and is not exercised by any test in this repo (no integration test drives an 8h-idle connection); (b) even in the best case where the warning fires, it fires at the ORIGINAL instance's boot-time-adjacent moment, not when the actual second instance boots — and a **second instance booting after the first's connection has already lapsed will find the lock free, `GET_LOCK` will succeed, and it will log nothing at all**, which is exactly the silent-scale-out scenario the guard exists to catch.
- **Concrete failure scenario:** operator runs one GalleryKit instance for >8h (trivial — this is a personal gallery expected to run for weeks), then scales to a second instance (or runs `docker compose up -d --scale web=2`, or starts a second host pointed at the same MySQL server) months later. The original instance's guard connection has silently lapsed by then; the new instance's `GET_LOCK` succeeds; no `console.error` is ever printed anywhere; the two instances proceed to corrupt the restore-mutation fence / upload-quota tracking / rate-limit fast paths that CLAUDE.md explicitly says are not multi-instance-safe, with zero diagnostic trail.
- **Relationship to existing findings:** this is the same root cause as `architect.md`'s ARCH3-01 (same file, same mechanism) — I reached it independently by checking the literal CLAUDE.md wording ("holds it for the process lifetime") against the connection-liveness code rather than via architectural review, so I'm folding it in as a corroboration rather than a competing finding. Two independent lanes reaching the same conclusion via different methods raises confidence this is real, not a false positive.
- **Suggested fix:** either (a) send a periodic no-op query (e.g. `SELECT 1`) on the held connection at an interval well under `wait_timeout` to keep it alive and detect drops promptly, or (b) reword the CLAUDE.md claim to state the actual guarantee ("...holds the lock only as long as the connection survives MySQL's `wait_timeout`; the guard does not currently keep the connection alive, so detection can silently lapse after ~8h of idle time"). (a) is the more valuable fix since it restores the guard's actual purpose; (b) is the doc-only fallback if (a) is out of scope for this cycle.

### VER3-02 — cycle-2 plan's own "Done" line overstates the WP1 (DBG-01) test count: claims 9 crafted-buffer tests, file contains 4
- **Severity:** LOW (documentation-precision only — the underlying security fix is real and IS tested for both attack and regression on both affected functions) **Confidence:** High **Status:** Confirmed
- **Claim:** `.context/plans/cycle-2-2026-07-07-plan.md:42` (WP1 "Done" line): *"Done: containerEnd threaded through readBoxHeader/parseIinf/parseIref/walk; parseCicpFromHeif bounds against walk end; **isobmff-parent-bounds.test.ts (9 crafted-buffer tests)**. Commit 9ce5cf96."*
- **Code:** `apps/web/src/__tests__/isobmff-parent-bounds.test.ts` (added in full by commit `9ce5cf96`, confirmed via `git show --stat` — no other test file was touched by that commit) contains exactly **4** `it(...)` blocks: 2 negative (crafted-overflow) cases — one for `hasGainMap`'s `infe`/`iinf` overflow, one for `parseCicpFromHeif`'s `colr`/`ipco` overflow — and 2 positive-control cases (one per function) proving the fix doesn't regress well-formed containers. `npx vitest run` on the file confirms `Tests 4 passed (4)`.
- **Impact:** none on runtime correctness — I independently read the diff to `color-detection.ts` and `gain-map-detection.ts` in the same commit and confirmed the `containerEnd`/`limit` threading through `readBoxHeader`, `parseCicpFromHeif`'s inline walker, `parseIinf`, and `parseIref`'s call sites is correct and matches the `gps-exif-strip.ts` `walkChildren()` pattern the commit message says it ports. Both directions (malicious-buffer rejected, well-formed-buffer still accepted) are exercised for both functions, so coverage is adequate even at 4 tests — this is purely the plan's own bookkeeping being wrong about the count, not a coverage gap.
- **Suggested fix:** correct the plan's historical record (informational; the plan is a point-in-time artifact, not a doc that needs active maintenance) — or, if a convention exists of treating cycle plans as durable records other cycles cite, correct the "9" to "4" for accuracy.

### VER3-03 — corroboration only, no new ID: `admin-backfill-runner.ts:691` still reads the request-cached `getGalleryConfig()` in its detached background task, one file over from where `02bea8d6` fixed the identical class in `image-queue.ts`
- I independently grepped every `getGalleryConfig`/`getGalleryConfigUncached` call site to check whether WP19's claimed fix ("uncached accessor... used at the three detached-queue call sites") left a sibling detached-context caller un-migrated. It does: `image-queue.ts` uses `getGalleryConfigUncached()` at all 3 call sites (:450, :708, :826), while `admin-backfill-runner.ts:691` (inside `runBackfill`, itself launched detached/fire-and-forget at `:907`) still calls the cached `getGalleryConfig()`. This is exactly `architect.md`'s **ARCH3-02** — reported there first with full detail, so I am not re-scoring it as a separate finding; recording only that independent verification from the "does WP19 fully close its own stated scope" angle confirms the same gap.

---

## Verified-true claims (this cycle's commits, representative but not exhaustive)

- **WP0 (Docker nested node_modules build fix, `223b3836`)** — carried over from cycle-1, already deployed successfully per the plan's post-deploy checklist; not re-verified here (no source changed this cycle).
- **WP4 (`requiresBackfill` flag, commits `4e2ca838`/`9d6675ee`/`f899edec`)** — read `settings.ts` end to end: `SETTINGS_BACKFILL_WARNING_KEYS` is genuinely `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS.filter(k => k !== 'image_sizes')` (8 of the 9 color-impacting keys; `image_sizes` is excluded because it already has its own hard fence a few lines above), `hasBackfillRelevantDifference` is checked against a **fresh DB read** (not the client's own diff) and gated on at least one already-`processed` image existing, and the response genuinely returns `requiresBackfill: true/false`. The settings UI (`settings-client.tsx:285-290`) consumes it. The `restoreBlockedByUpload`/`restoreBlockedByBackfill` i18n keys (WP9) exist verbatim in both `en.json`/`ko.json` and are wired at the three `db-actions.ts` call sites (:451, :469, :491). **Matches the plan's claim exactly**, and directly contradicts the (apparently stale, pre-dating this fix) `TRC-01` finding sitting in the top-level `.context/reviews/tracer.md` file, which asserts "no staleness marker" exists for these keys — that file is out of my review's required source list, so not filed as a finding here, but worth flagging in case it gets merged into this cycle's aggregate without a freshness check.
- **WP1 (ISOBMFF bounds, `9ce5cf96`)** — the actual bounds-check fix (see VER3-02) is correct; container-end threading verified by direct diff read.
- **WP2 (focus restore, `2c82a69c`/`fc21007a`)** — `photo-viewer.tsx:989,1003` passes `restoreFocusRef` into both `Lightbox` (:989) and `InfoBottomSheet` (:1003); `lightbox.tsx:460` falls back to `previouslyFocusedRef.current` when the prop is absent; `info-bottom-sheet.tsx:86-93` explicitly re-focuses the target on close via a body-containment check. Matches the plan's description of the `search.tsx` triggerRef pattern.
- **WP17 (CSP fail-open, `a4a2d250`)** — `content-security-policy.ts` exports `buildCspSafely` wrapping the build in try/catch (confirmed at `:39-46`); `proxy.ts:44-47` calls it directly with a comment citing C2-37.
- **WP18 (sitemap URL budget, part of `9bd2daf3`)** — `sitemap.ts` now reserves budget for feed + per-topic-feed rows in the `reservedNonImageUrls` computation (:53-57) AND applies a defensive `.slice(0, MAX_SITEMAP_URLS)` clamp on the final array (:135) — belt-and-braces, matching the plan's stated approach exactly.
- **`b4e986c3` (migrate.js pending-vs-drift fix)** — this commit is notably **absent from every WP entry** in `cycle-2-2026-07-07-plan.md` (it lands chronologically after WP26's ledger-upkeep commits in the git log), but it is legitimately accounted for by WP26's provision to "fold the pending feature-dev code-reviewer message... when it arrives" — the commit references `.context/reviews/cycle-2-2026-07-07/fd-code-reviewer.md` (a real file, added in the same commit) and "Closes FDR-01 (run-10 c2 replacement review lane)". I independently re-read the full diff: the new cursor-based split (`missing.every(m => folderMillis > cursor)` → skip baselining, let `drizzle.migrate()` genuinely apply pending SQL) is sound, the mixed-case tail-swallow warning is present and correctly scoped, and — importantly — **CLAUDE.md's Migration Runbook section was updated in the SAME commit** to describe the new pending-vs-drift split accurately (`CLAUDE.md:446`, includes the correct new test file reference `migrate-pending-migrations.test.ts`, which exists and passes 5/5). No doc/code mismatch here despite the missing WP entry — just a plan-bookkeeping gap, not worth a separate LOW finding since the actual artifact (CLAUDE.md) is accurate.

---

## Summary table

| ID | Severity | Confidence | Status | File:line | Title |
|---|---|---|---|---|---|
| VER3-01 | MEDIUM | High | Confirmed | `apps/web/src/lib/single-writer-guard.ts:24-99`; claim at `CLAUDE.md:236` | Single-writer-guard connection has no keepalive; "holds it for the process lifetime" claim doesn't survive MySQL `wait_timeout`; corroborates ARCH3-01 |
| VER3-02 | LOW | High | Confirmed | `.context/plans/cycle-2-2026-07-07-plan.md:42` vs `apps/web/src/__tests__/isobmff-parent-bounds.test.ts` | Plan's own "Done" line claims 9 crafted-buffer tests; file has 4 (adequate coverage, wrong count) |
| VER3-03 | (no new severity — corroboration) | High | Confirmed | `apps/web/src/lib/admin-backfill-runner.ts:691` | Independently reconfirms architect's ARCH3-02 (detached-context cached-config read left un-migrated in one sibling file) |

**Bottom line:** cycle-2's shipped work is solid. Every WP claim I independently checked against current source matched, the full gate suite (3032 tests, typecheck, 3 security lint gates) is green at HEAD, and all three "final sweep" generated-artifact parity checks (SW hash, migration journal monotonicity, i18n key parity) hold exactly. No new CRIT/HIGH finding, no security regression, no data-loss divergence. The one MEDIUM finding (VER3-01) is a real gap in a warn-only diagnostic's durability, not a currently-exploitable defect — the guard still catches the common "both instances boot close together" case; it only loses coverage for the slower, arguably more likely "scale up after running solo for a long time" case. The one LOW finding (VER3-02) is pure plan-bookkeeping.
