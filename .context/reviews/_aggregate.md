# Run-16 Cycle-16 Convergence — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 1f5fb245
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates:** eslint clean, tsc clean, vitest **2088 pass / 4 skip**, 3 security lint gates OK (verifier-confirmed).

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities. Security surface converged (security-reviewer: 0 new findings, `npm audit` 0 vulns). |
| HIGH | 0 | None runtime. (TE-16-01 is a HIGH-*priority* missing test gate, not a runtime HIGH.) |
| MEDIUM | 3 | **DBG-16-01 (HEADLINE, data-loss)** topic slug rename CASCADE-deletes all `topic_views` analytics (re-points `images`+`topicAliases`, misses `topicViews`); **CR-16-01** upload-tracker TOCTOU — limit checks (`images.ts:196,227`) separated from the claim (`:255`) by 3 `await`s, so concurrent same-key uploads can both pass; **DES-16-01** back-to-top `<button>` (`home-client.tsx:466`) has no `focus-visible:ring`/`outline-none` (WCAG 2.4.7/2.4.11). |
| LOW | ~14 | C16-F1/A16-02/TE-16-02 (reactions-drop only runs via reconcile, which is SKIPPED on already-baselined prod — never fires; needs journaled trigger + regression pin, **3-agent**); DES-16-02/C16-F2 (`photo-viewer.tsx:887` `bit_depth` + `:955`/`info-bottom-sheet:499` `isP3Pipeline` un-`isAdmin`-gated — missed siblings of SEC-15-01, **2-agent**); A16-01 (public `api/search/**` selects lack `PrivacySensitiveKeys` compile guard — safe today, defense-in-depth); DBG-16-02 (`og-photo-fetch.ts:57` Content-Length `parseInt` no `Number.isFinite`); DBG-16-03 (topic rename doesn't rewrite `smart_collections` rules → silently-empty collection); PERF-16-01 (`image-queue.ts:501` embedding IIFE redundant `getGalleryConfig` per image); DOC-16-01/02 (CLAUDE.md `/s/[slug]`→`/c/[slug]` for smart collections + tree omission); CR-16-02 (`bounded-map.ts:115` `entries()` yields live refs, latent); A16-03 (boundary-test denylist lags — `node:fs`/`node:crypto` server libs invisible, latent). |
| TEST-GATE | 6 | TE-16-01 (BoundedMap `count: entry.count+1` not source-locked — revert passes, **2-agent w/ verifier**), TE-16-02 (reactions-drop not pinned in `migrate-reconcile-coverage.test.ts`, **3-agent**), TE-16-03 (CSV `U+FFF9-FFFB` untested), TE-16-04 (`COLOR_IMPACTING_KEYS` exhaustiveness unpinned), TE-16-05 (GPS `Infinity`/coord-boundary untested), TE-16-06 (`normalizeExposureTime` NaN/zero-denom untested). |
| INFO/DEFER | — | PERF-15-01/16-03 + carry index migrations (data.ts:527,840 `(processed, updated_at)`); PERF-16-02/04 (admin-only / structural); CR-16-03 (`QUEUE_CONCURRENCY=0` coerced to 1); OBS-16-01..05 (iso int truncation, exposure `NaN,NaN` string, backfill skippedLocked test gap, COLOR_IMPACTING_KEYS author-obligation comment, SIGTERM-timeout operational); SEC-16-01 (header-case cosmetic, non-defect); C16-F4 (orphaned `0014_drop_reactions.sql` invalid MySQL DDL — delete). |

**Verdict:** Mature, well-hardened codebase. All cycle-15 fixes verified individually correct AND their 4 new test gates are non-vacuous (fail on revert). This cycle's signal: ONE genuine data-loss bug (DBG-16-01 — the recurring "fix one sibling, miss the next" theme: rename protected `images`+`topicAliases` FK children but missed the later-added `topicViews` analytics child), ONE confirmed concurrency over-admission window (CR-16-01), ONE real a11y gap (DES-16-01), and the discovery that the cycle-15 reactions-drop fix is structurally INEFFECTIVE on production (C16-F1, 3-agent) because reconcile is skipped once a DB is baselined.

---

## Lead verification (read against installed code before planning)

1. **DBG-16-01 — CONFIRMED (MEDIUM, data-loss).** `schema.ts:236` `topicViews.topic → topics.slug { onDelete: 'cascade' }`. `topics.ts:248-287` rename = recreate: re-points `images.topic` (:282) + `topicAliases.topicSlug` (:283), then `tx.delete(topics)` (:285) — `topic_views` rows are NOT re-pointed → CASCADE wipes up to `VIEW_RETENTION_DAYS` (395 d) of analytics for that topic. Fix: `await tx.update(topicViews).set({ topic: slug }).where(eq(topicViews.topic, cleanCurrentSlug));` before the delete. NOT deferrable (data-loss).
2. **CR-16-01 — CONFIRMED (MEDIUM).** `images.ts:196` (count) + `:227` (bytes) checks; claim at `:255-257`; 3 `await`s between (`ensureUploadDirectories` :204, `statfs` :205, `db.select(topics)` :243). Two concurrent same-key `uploadImages()` both pass the checks before either claims. The up-front `set()` (:190-194) only closes the cold-IP literal race, not check-then-claim. `settleUploadTrackerClaim` reconciles at completion. Fix: compute `totalSize` early, run all 3 checks, then claim synchronously before any `await`, with rollback on the disk/topic early-returns.
3. **C16-F1 — CONFIRMED (LOW, 3-agent: critic+test-engineer+architect).** `migrate.js:707-713`: when `journalCovered===true` (a baselined prod DB) `prepareLegacyDatabaseIfNeeded` returns at :712 BEFORE `reconcileLegacySchema`. The cycle-15 reactions-drop (`:636-637`) lives only in reconcile → never fires on already-baselined production. The dead `image_reactions` table + `images.reaction_count` (journaled `0007`) persist forever there. **Correct completion:** add a journaled `drizzle/0024_drop_reactions.sql` (+ journal entry, monotonic `when`) — its presence flips `journalCovered=false` on prod → reconcile re-runs → guarded drop fires. The SQL file is baselined-not-run on both fresh + already-baselined paths (same design as 0023, verified line 701 "drizzle.migrate() is a verified no-op"). Delete the orphaned `0014_drop_reactions.sql` (invalid `DROP COLUMN IF EXISTS`, C16-F4).
4. **DES-16-02 / C16-F2 — CONFIRMED (LOW, 2-agent: designer+critic).** `photo-viewer.tsx:887` `{hasExifData(image.bit_depth) && …}` — no `isAdmin` (siblings `info-bottom-sheet.tsx:443` + `color-details-section.tsx:481` carry it, cycle-15). `isP3Pipeline(image.color_pipeline_decision)` download label bare at `photo-viewer.tsx:955` + `info-bottom-sheet.tsx:499`, gated at `color-details-section.tsx:534` + `lightbox-color-pip.tsx:264`. Both admin-only fields are `null` publicly so no live leak; defense-in-depth symmetry.
5. **A16-01 — CONFIRMED (LOW, defense-in-depth).** `api/search/semantic/route.ts:293-309` + `api/search/similar/[id]/route.ts:195-211` are public anonymous routes hand-picking image columns inline with NO `Extract<…,PrivacySensitiveKeys>` guard. Today they select only public fields (verified: id/title/description/filename_jpeg/width/height/topic/topic_label/camera_model/lens_model/capture_date — no GPS/PII). A future `latitude:` add would leak with zero tsc/test signal. Fix: shared guarded const or a fixture test scanning `api/search/**`.
6. **DES-16-01 — CONFIRMED (MEDIUM a11y).** `home-client.tsx:466-478`: keyboard-reachable (`tabIndex` managed) `<button>` with `min-h-11 min-w-11` but NO `focus-visible:ring`/`outline-none` — relies on browser default `:focus` (fires on mouse, weak contrast on `--primary` `#18181b`). Every other control uses the focus-visible convention.
7. **TE-16-01 — CONFIRMED (test-gate, 2-agent).** `sharing.ts:54`/`admin-users.ts:41`/`embeddings.ts:44` use `count: entry.count + 1` + `.set()` (cycle-15 CR-15-01). No test scans for it → revert to `entry.count++` passes all 2088. Verifier flagged the same gap.
8. **DBG-16-02 — CONFIRMED (LOW).** `og-photo-fetch.ts:57` `parseInt(contentLength,10) > MAX` — `NaN` slips (caught later by post-buffer cap :59, no user impact). Un-mirrored sibling of the correct `Number.isFinite` guard at `search/semantic/route.ts:137`.
9. **DBG-16-03 — CONFIRMED (LOW).** Topic rename leaves `smart_collections` JSON rules `{column:'topic',value:'<oldslug>'}` dangling → collection silently empties. Same root as DBG-16-01.
10. **PERF-16-01 — CONFIRMED (LOW-MEDIUM).** `image-queue.ts:501` embedding fire-and-forget IIFE calls `getGalleryConfig()` independently; React `cache()` is request-scoped (no effect in the queue worker) → a redundant `SELECT admin_settings` per processed image when semantic search is on. Hoist + pass `semanticMode` in.
11. **DOC-16-01 — CONFIRMED (LOW-MED doc).** CLAUDE.md L148 says smart collections render at `/s/[slug]`; actual is `/c/[slug]` (`app/[locale]/(public)/c/[slug]/page.tsx`; `/s/[key]` is shared-links). Tree (DOC-16-02) omits `c/[slug]`.
12. **TE-16-02 — CONFIRMED (3-agent).** `migrate-reconcile-coverage.test.ts` pins entitlements/license_tier DROP but NOT reactions (cycle-15 `:636-637`). Revert passes.
13. **CR-16-02 / A16-03 — CONFIRMED (LOW, latent).** `bounded-map.ts:115` `entries()` returns raw refs (no current mutator). Boundary-test denylist doesn't catch `node:fs`/`node:crypto`-only server libs (A15-01 lineage; `next build` is the backstop).

---

## Cross-agent agreement (higher signal)

- **C16-F1 / TE-16-02 / A16-02** (reactions-drop ineffective + unpinned) — **3 agents** (critic, test-engineer, architect).
- **DES-16-02 / C16-F2** (`bit_depth` + `isP3Pipeline` un-gated siblings) — **2 agents** (designer, critic).
- **TE-16-01** (BoundedMap increment unpinned) — **2 agents** (test-engineer, verifier).
- **A16-01** (search-route privacy guard) — architect (verifier confirmed `searchFields` guard exists; these 2 routes are the missed siblings A15-02 didn't count).

---

## Positive signals (verified converged)

- All cycle-15 fixes correct AND non-vacuous (verifier 14/14; critic Tasks 1/2/3/5 fully swept, no missed sibling within their scope; 4 new test gates fail on revert).
- Security surface: 0 new findings, 0 npm-audit vulns, every mutating action authZ-gated, SSRF/path-traversal/redirect/header/CORS swept (security-reviewer).
- Tracer: 6 high-value flows traced, **0** confirmed defects; the two signature bug classes (NaN-survives-comparison, fix-one-sibling) have no NEW instances in those flows (the new instances surfaced in DBG/DES/CR areas instead).
- gallery-config layering clean; `@/lib/storage` quarantine enforced; no NEW undocumented process-local state (architect).
- i18n EN/KO parity perfect; contrast tokens AA+; reduced-motion handled; touch targets floored at 44px (designer).

---

## AGENT FAILURES
None. All 11 agents completed and wrote their per-agent file.
