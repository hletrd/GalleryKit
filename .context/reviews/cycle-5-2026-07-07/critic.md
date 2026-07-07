# Run-10 Cycle 5/100 — CRITIC lane review (2026-07-07)

Start HEAD `d9bcbf4c` (clean tree, == origin/master). Scope: verify cycle-4's
headline fixes actually close their failure class by reading the *committed* code
(not the plan), hunt doc/code/test contradictions, and challenge the quality gates.
Context read first: CLAUDE.md, `deferred-carry-forward.md`, plans README (age
budgets), `cycle-4-2026-07-07/_aggregate.md` (C4-01..C4-47 — NOT re-reported).

Method: read the six named cycle-4 commits (b68d09e2 migrate, ce15103a
single-writer, 12037508 gallery-config, ad1fd22d/31ff51f5 sw-cache,
4afacfa8/0da58d6b photo-viewer, 9dccebcd image-zoom) and the current state of
each touched file; ran the four fix-pinning test files (89/89 green); traced the
web-platform / async-timing semantics each fix depends on.

---

## Verdict on cycle-4's headline fixes (read the code, not the plan)

| Fix (commit) | Closes primary class? | Residual / caveat |
|---|---|---|
| migrate DML guard (b68d09e2) | **Yes** for the reproduced empty-log + below-cursor plain-DML paths | **C5-02**: detector false-negatives on CTE-led / block-comment-led DML (latent) |
| single-writer self-heal (ce15103a) | **Partial** — lapse path yes | **C5-01**: startup-reprobe sibling still permanently disarms on a slow-drain false positive; untested |
| gallery-config invalidate (12037508) | **Yes** for the common case | **C5-03**: in-flight read racing the commit re-caches stale config; "EXACT" claim overstated |
| SW phantom-LRU (ad1fd22d) | **Yes** — cascade gone | **C5-05**: one spurious real eviction remains for a mid-recency phantom |
| SW respondWith de-gate (31ff51f5) | **Yes** | none found |
| photo-viewer hydration (4afacfa8) | **Yes** — #418 gone | **C5-07**: trades mismatch for flash-of-unpinned + post-mount `sizes` re-fetch |
| shared-group shallow sync (0da58d6b) | **Yes** — router.replace→history.replaceState is correct | **C5-04**: the shipped e2e regression NET cannot fail on the bug |
| image-zoom non-passive touchmove (9dccebcd) | **Partial** — drag + console-warning yes | **C5-06**: pinch-from-unzoomed still contested; `touch-action:auto` at gesture start |

Net: every fix is *directionally correct and improves on HEAD^*; none is a
regression. But five of eight ship an unacknowledged residual, and two of those
(C5-01, C5-04) are on the exact failure class the fix's own commit message claims
to have closed. That "fix one sibling, miss the next / test can't fail on the bug"
pattern is the load-bearing theme this cycle.

---

## NEW findings

### C5-01 — single-writer guard: the startup re-probe still permanently disarms on a slow-drain false positive (LOW-MED / **Confirmed**)

- **File:** `apps/web/src/lib/single-writer-guard.ts:238-269` (`reprobeOnce`), contrast with `scheduleReacquire`/`reacquireOnce:167-216`.
- **Assumption challenged:** commit ce15103a's headline — "a lapse no longer disarms the guard permanently … schedules an unref'd 60s re-acquire loop." That is true ONLY for the keepalive-failure / `conn.on('error')` LAPSE path. The **startup re-probe** path (lock contended at boot → wait `REPROBE_DELAY_MS=25s` → `reprobeOnce`) has NO equivalent retry: on persistent contention it calls `emitLoudTopologyError()` then `conn.end()` and returns (`:260-261`) with nothing scheduled.
- **Why it matters:** the 25 s re-probe delay is explicitly sized to swallow a rolling-deploy drain ("old process holds the lock for up to ~15 s"). But a *slow* clean shutdown — long-running restore drain, a wedged `SIGTERM` handler, a paused container — can hold the lock past 25 s. When that happens the NEW (soon-to-be-sole) process fires the loud error as a **false positive**, then never acquires the lock for the rest of its lifetime. It now runs as the single instance with NO liveness signal, so a genuinely-erroneous third instance that boots later acquires cleanly and silently — the exact detection this guard exists to provide is now permanently off. The guard is WARN-ONLY, so the blast radius is "missed future warning," not a correctness break — hence LOW-MED, not MED.
- **Failure scenario:** instance A draining a big restore holds the lock 40 s into B's boot. B re-probes at 25 s → contended → emits topology error and gives up. A finishes draining and exits; B is now sole but lock-less. Operator later fat-fingers a second `docker run` → C boots, acquires the free lock, zero warning. The misconfiguration the guard is for goes undetected.
- **Suggested fix:** on reprobe contention, hand off to the SAME `scheduleReacquire()` loop the lapse path uses (emit the loud error once, keep retrying quietly; a genuine second instance keeps it contended and the operator already has their warning, a transient slow-drain self-heals into a held lock). One-line change: replace the terminal `conn.end()` in `reprobeOnce`'s else-branch with `emit-once + scheduleReacquire()` semantics.
- **Test gap:** `single-writer-guard.test.ts:384` covers "loud error once per lapse" for the LAPSE path only. No test drives startup-reprobe → persistent contention → assert a retry is scheduled (there is none to assert). Add one.

### C5-04 — the C4-04 shallow-routing e2e regression net cannot fail on the bug it guards (MED / **High**)

- **File:** `apps/web/e2e/swipe-visual-reset.spec.ts:108-131` (Phase 4, added by 0da58d6b); constant `apps/web/src/lib/rate-limit.ts:97` (`SHARE_MAX_REQUESTS = 60`).
- **Contradiction:** the commit message and plan present Phase 4 ("Step repeatedly and assert … the viewer stays alive, never the 404") as the regression evidence that in-place stepping is now shallow and no longer burns the share limiter. But Phase 4 does **6** steps. The pre-fix bug burned ~1 slot per step against a **60/min** budget. 6 ≪ 60, so the loop **passes identically against the broken `router.replace()` code** — it cannot distinguish fixed from broken. It is a viewer-liveness smoke, not a share-limiter-burn net.
- **Why it matters:** this is the *same false-positive-test class cycle-4 itself just flagged and fixed* (C4-05, the serve-upload fd-close stale-spy). The lesson ("a regression test must be able to fail on the bug") did not propagate to the sibling e2e authored in the same cycle. The C4-04 code fix is genuinely correct (history.replaceState is App-Router-supported shallow routing; Next re-injects its own history state even with a `null` state arg), so there is no product regression — but the *guard* protecting it is hollow, so a future refactor back to `router.replace()` would ship green.
- **Failure scenario:** someone later "simplifies" the sync effect back to `router.replace(..., {scroll:false})`; all e2e stays green; recipients of large shared groups start hitting 404-mid-browse again in production.
- **Suggested fix:** either (a) assert the mechanism directly — `page.on('request')`/route-intercept and assert ZERO document GET to `/g/[key]` fires on an in-place step; or (b) drive >60 steps and assert the viewer survives (slow, brittle). (a) is the real net. Confidence High: the arithmetic (6<60) and per-step-one-slot mechanism are both established in-repo.

### C5-02 — `journalSqlContainsDml` false-negatives on CTE-led and block-comment-led DML (LOW / **Confirmed**, latent)

- **File:** `apps/web/scripts/migrate.js:194-208` (`journalSqlContainsDml`).
- **Assumption challenged:** the detector's own comment says "false positives are acceptable" — implying the only error mode is over-flagging. But the anchor `^(INSERT|UPDATE|DELETE|REPLACE)\b` on each split statement produces **false NEGATIVES** for two real SQL shapes: (1) a CTE-prefixed writer `WITH cte AS (…) UPDATE t …` (starts with `WITH`); (2) a block-comment-prefixed writer `/* backfill */ UPDATE …` (line-comment stripping only removes lines starting with `--`, never `/* */`; the split statement then starts with `/*`). Both slip through and get silently baselined — i.e. hash recorded, SQL never executed — reintroducing the exact swallow class C4-01 was written to close, on the legacy-bootstrap / true-drift path where this guard is the LAST defense.
- **Why it matters / reachability:** verified LATENT today — scanning `apps/web/drizzle/*.sql`, only `0001_sync_current_schema` carries DML (the allowlisted exception) and NO migration uses a CTE or block-comment DML shape, and drizzle-kit does not emit either. So no current bug — but a future hand-authored backfill (CTEs are a natural way to write a conditional/derived backfill) would defeat the guard silently. A guard billed as "refuse DML-bearing baselines on **every** path" should not have SQL-shape blind spots that re-open the silent-loss door.
- **Suggested fix:** scan for the keywords anywhere as whole-word tokens after stripping strings/comments (e.g. `\b(INSERT\s+INTO|UPDATE\s+\S|DELETE\s+FROM|REPLACE\s+INTO|MERGE)\b` over the comment-stripped body), not just at statement start; strip `/* */` blocks too. Keep the "false positives acceptable" posture — broadening only adds safe over-flagging.

### C5-03 — gallery-config invalidation races an in-flight detached read; "flip-then-act is EXACT" is overstated (LOW / **Medium-High**)

- **File:** `apps/web/src/lib/gallery-config.ts:219-250`; caller `apps/web/src/app/actions/settings.ts:234`.
- **Contradiction:** commit 12037508 / the docstring claim "flip-setting-then-act is EXACT again in the shipped single-process topology (not just bounded at 2 s)." The invalidation nulls `uncachedConfigCache` and `uncachedConfigInFlight`, but a detached read whose promise is **already in flight across the commit** holds a local reference to that promise and, on resolve, unconditionally writes `uncachedConfigCache = { value: <pre-flip>, expiresAt: now + 2s }` (`:230`) — AFTER the invalidation ran. The cache is re-poisoned with stale config for up to the full TTL.
- **Why it matters:** the canonical use is exactly a background per-image side-effect gate reading config while an admin flips a setting mid-processing. If a gate read was in flight at commit time, the next image can still be processed at pre-flip settings for up to 2 s — the very C3-04 staleness the invalidation advertises it eliminated. Not a regression (the 2 s TTL bound is the same worst case as before invalidation), so LOW; but the "EXACT" framing denies a real interleaving.
- **Suggested fix:** guard the cache write with a generation counter — `invalidate...()` bumps a module `generation`; the in-flight IIFE captures `gen` before the read and only writes the cache if `gen === generation` on resolve. Then an invalidation that lands mid-read genuinely wins. Alternatively soften the docstring/commit claim to "observed within TTL; immediate for reads that START after the commit."

### C5-05 — SW phantom-LRU residual: a mid-recency phantom still forces one extra real eviction (LOW / **Medium**)

- **File:** `apps/web/src/lib/sw-cache.ts:125-155` and the `public/sw.template.js` mirror (`:121-137`).
- **Assumption challenged:** the fix comment says phantom entries "no longer force eviction of REAL fresh entries." The **cascade** is fixed (unconditional `total -= entry.size` means phantoms get paid down as the walk reaches them). But `total` is summed up-front over ALL entries *including phantoms* (`:125-128`), and the head-walk only pays a phantom down WHEN IT REACHES IT. A phantom sitting BEHIND the eviction victims in recency order inflates the initial `total`, so the walk evicts one more real (older) entry than strictly necessary before it reaches and discounts the phantom.
- **Failure scenario:** cap 100. Recency order R1(50,oldest), P(10,phantom-in-meta-not-in-cache), R2(50,newest). Real cache is only R1+R2=100 (at cap, no eviction needed). But `total`=110>100 → walk evicts R1 (real) → total 60 → stop. R1 was evicted needlessly; the phantom's uncounted-until-reached bytes drove it.
- **Why it matters:** far milder than the original bug (which could evict everything), and it self-heals (P leaves meta once reached). But it means the fix's "real entries no longer evicted by phantoms" is not strictly true for phantoms positioned mid/late in recency. In practice browsers quota-evict LRU-ish (phantoms tend to be at the head → paid down first), so real-world bite is small — hence LOW/Medium.
- **Suggested fix:** if cheap, verify each meta entry against `cache.match`/`keys()` reconciliation before summing `total` (or subtract a phantom's bytes the moment `cache.delete` returns false during a pre-pass). Given the whole-blob re-parse model this may be out of scope; at minimum soften the claim to "no eviction CASCADE from phantoms."

### C5-06 — image-zoom C4-12 fix is necessary but insufficient for its named "pinch-from-unzoomed fights page zoom" case (LOW-MED / **Needs-validation** on device)

- **File:** `apps/web/src/components/image-zoom.tsx:262-318` (native non-passive touchmove) + `:370` (`style={{ touchAction: isZoomed ? 'none' : 'auto' }}`) + `:233-251` (pinch begins while unzoomed).
- **Assumption challenged:** the fix assumes "React's listener was passive so preventDefault was a no-op; register non-passive and the pinch-from-unzoomed page-zoom conflict is resolved." The non-passive listener is genuinely required and fixes the drag-pan case + kills the Chrome console warning. BUT for the **pinch-from-unzoomed** case the commit explicitly names, `touch-action` is `'auto'` at gesture start (it is bound to `isZoomed`, which is still false until the pinch crosses the zoom threshold). With `touch-action: auto` the browser is authorized to own pinch-zoom, and Chrome marks touchmove events during an in-progress compositor pinch as `cancelable:false` — so `preventDefault()` is ignored REGARDLESS of passive/non-passive. `touch-action`, not the listener, is the authoritative control for pinch-zoom suppression.
- **Why it matters:** the first pinch from rest — the exact gesture the fix targets — can still trigger browser page-zoom on mobile, because the container only flips to `touch-action:none` AFTER the image is already zoomed. The fix improves the console noise and the drag path but likely does not deliver the named UX outcome.
- **Suggested fix:** set `touch-action: none` (or `pan-x pan-y` to keep single-finger pan while disabling pinch) whenever a 2-finger gesture is possible — e.g. flip it on `touchstart` with `touches.length === 2`, or just always on the container if single-finger scroll isn't needed there. Label Needs-validation: confirm on a real iOS Safari + Android Chrome device that pinch-from-unzoomed now zooms the image, not the page.

### C5-07 — photo-viewer hydration fix trades #418 for a flash-of-unpinned + post-mount `sizes` re-fetch (LOW / by-design tradeoff, **Confirmed**)

- **File:** `apps/web/src/components/photo-viewer.tsx:111-133`, interacts `:194-195` (`showInfo = isPinned` → `getPhotoViewerImageSizes(showInfo)`).
- **Observation:** the fix correctly renders `isPinned=false` first (SSR-deterministic) then restores in a mount effect — killing the #418 mismatch. Unacknowledged cost: on desktop where the user had pinned=true, the FIRST client paint shows the info panel CLOSED, then the effect flips it open → a visible layout shift on every desktop photo load. Because `showInfo` feeds `getPhotoViewerImageSizes`, the `<Image sizes>` attribute ALSO changes post-mount, which can prompt the browser to pick a different candidate and re-fetch (compounds C4-23, the info-toggle neighbor re-fetch that d79f6f70 only partially addressed).
- **Why it matters:** correctness (no hydration mismatch) is the right call and this is genuinely by-design, but the plan/aggregate frames it as a clean win with no downside. The flash + potential extra fetch is the downside. LOW.
- **Suggested fix (optional):** none required. If the flash is objectionable, gate the panel's mount/measure on a CSS-only `@media (min-width:1024px)` default that matches the eventual desktop state, so the server/first-paint already approximates the pinned layout without reading client storage. Otherwise just record the tradeoff honestly.

---

## Process / contradiction observations (no code change required)

- **P-1 (reinforces C5-04):** cycle-4 discovered C4-05 (a test asserting a stale spy — "can't fail on the bug") AND, in the same cycle, shipped C5-04 (an e2e that can't fail on the bug). The "test must exercise the failure" lesson is being applied *backward* (to prior cycles' tests) but not *forward* to the same cycle's new tests — the identical shape the aggregate's own C4-44 note ("the honesty lens was applied backward … not forward to cycle-3's own closures") called out. The pattern is now recurring across the review→fix boundary itself.
- **P-2 (age budget — checked, clean):** re-ran the 8-cycle High check. No open High carry-forward row remains (register lines 39-106); `C1-25(a)` was reworded (C4-34) so it no longer reads as an open High. The MED 16-cycle checkpoint fires only on `C80-06` (~15), re-justified as a genuine config-precedence product decision. C4-33's age-arithmetic slip (C80-06 vs C94-10 identical ~10) is corrected in the current register (C80-06 ~15, C94-10/C88-03 ~11). No gaming detected; the ordering is internally consistent. One nit: the "~4 age-units per 8 review-cycles compressed scale" note (register lines 13-17) is unfalsifiable by construction ("absolute magnitude is a fuzzy estimate") — acceptable as documented, but it means the MED-checkpoint window for pre-c96 items can never mechanically *fire* on a precise count, only on reviewer judgment. Not a finding, just a limit of the mechanism.
- **P-3 (doc/code now consistent):** verified b68d09e2 healed the C4-35/C4-39/C4-41 doc contradictions — CLAUDE.md's DDL-only invariant is now qualified with the `shared_group_images.position` exception, `trueDrift` is spelled correctly, and the stale "drizzle per-entry hash check" claim is corrected in both the migrate.js comment (`:776-778`) and matches CLAUDE.md's "only checks MAX(created_at) — not per-entry hashes." No lingering contradiction found in that surface.
- **P-4 (invalidation coverage — checked, clean):** confirmed `invalidateDetachedGalleryConfigCache()` needs to fire only from `updateSettings` — the other `admin_settings` writers (`seo.ts`, `session.ts` bootstrap) write keys disjoint from `GALLERY_SETTING_KEYS`/`buildGalleryConfig`, and `embeddings.ts` only READS config. So there is no *missing-writer* gap (only the in-flight race C5-03). Recording this so a future reviewer doesn't re-flag a false "seo.ts must invalidate too."

---

## Summary

Cycle-4's eight headline fixes are all directionally correct and none regresses HEAD^; the four fix-pinning test files are 89/89 green. The critique is that five ship an unacknowledged residual, and two of those (C5-01 single-writer startup-reprobe, C5-04 hollow e2e net) sit on the exact failure class the fix's own commit message claims to close — the repo's recurring "fix one sibling / test that can't fail on the bug" theme, now recurring *within* a single review→fix cycle (P-1). Highest-priority NEW item: **C5-04** (MED) — the shallow-routing regression net is hollow and would ship a revert green. Then **C5-01** (LOW-MED) — the guard's self-heal is one-sided. C5-02/03/05/06/07 are LOW residuals worth folding into their next respective touching cycle.

**NEW finding counts:** 1 MED (C5-04) · 1 LOW-MED (C5-01) · 1 LOW-MED/needs-validation (C5-06) · 4 LOW (C5-02, C5-03, C5-05, C5-07) = **7 NEW findings**, plus 4 process/contradiction observations (P-1..P-4). Confidence: 4 Confirmed, 1 High, 1 Medium-High, 1 Medium, 1 Needs-validation. No new CRIT/HIGH. Age budget clean; no deferred-register gaming.
