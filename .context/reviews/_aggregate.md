# Run-15 Cycle-15 Convergence — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 2f886351
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities; gates GREEN (verifier: eslint clean, tsc clean, vitest 2075 pass / 4 skip, build OK, 3 lint gates OK) |
| HIGH | 0 | None runtime. (TE-15-01 is a HIGH-*priority* broken/missing test gate, not a runtime HIGH.) |
| MEDIUM | 2 | **DBG-15-01** (HEADLINE) `convertDMSToDD` NaN guard lets a `0/0` GPS rational reach the DB insert as `NaN` → `ER_BAD_FIELD_ERROR` → a valid photo is silently rejected at upload (both ingest paths, default config); **CR-15-01** `BoundedMap.get()` shallow-copy is mutated in three rate-limit fast paths (`sharing`, `admin-users`, `embeddings`) so the in-memory counter never advances. |
| LOW | ~12 | SEC-15-01/Critic-F2 (`icc_profile_name`+`bit_depth` un-`isAdmin`-gated, 2-agent), Critic-F1 (orphaned reactions-drop migration never runs), DES-15-01 (dialog/sheet/dropzone/topic-manager `focus:ring`→`focus-visible`), A15-01/A15-02 (boundary-test next/* blind spot; `searchFields` unguarded), PERF-15-02 (histogram resize no rAF debounce), PERF-15-06 (bootstrap per-job config read), DOC-15-01..04 (4 stale CLAUDE.md cites + 1 byte value), plus code-reviewer LOWs (auth log level, load-more `'invalid'` toast, tag-input NFKC, lightbox-pip execCommand fallback, viewCountRetryCount stale entry). |
| TEST-GATE | 4 | TE-15-01 (LR `bavail` not source-locked — revert passes), TE-15-02/TRC-15-01 (`currentFlushPromise` shutdown fix has ZERO coverage — revert passes, 2-agent), TE-15-03 (`revalidatePath`/`revalidateTag` absent from action-origin scanner), TE-15-04/A15-03 (SIGTERM wiring + `NEXT_MANUAL_SIG_HANDLE` Dockerfile env untested). |
| INFO/DEFER | — | PERF-15-01/04 + carry-over PERF-14-01/13-07 (index migrations); PERF-15-03/05 (structural); upload-tracker key namespace (BY-DESIGN DEF-C4-03); DES-15-02 LightboxColorPip (lead-verified NOT a defect); DES-15-03 + a11y cluster; DBG-15-02/03, TE-15-05/06 (INFO/additive). |

**Verdict:** Mature, well-hardened codebase. All gates GREEN; all ten cycle-14 fixes verified individually correct. This cycle's signal: one genuine correctness bug (DBG-15-01, a NaN-survives-relational-comparison defect — the SAME class as the cycle-14 `bavail`-mock bug), one dead-fast-path code defect (CR-15-01), and the recurring **"fix one sibling, miss the next"** theme hitting THREE places (admin-field gating `bit_depth`/`icc_profile_name`; the reactions-drop migration mirrored for `entitlements` but not `reactions`; the cycle-14 shutdown + LR-bavail fixes left without their own regression locks).

---

## Lead verification (read against installed code before planning)

1. **DBG-15-01 — CONFIRMED.** `process-image.ts:1446-1455`: `convertDMSToDD` guard is `if (dms[0] < 0 || dms[0] > maxDegrees || dms[1] < 0 || dms[1] >= 60 || …)` — every comparison is `false` for `NaN`; `Math.abs(NaN) > maxDegrees` also `false` → returns `NaN`. `cleanNumber` (`:1423-1428`) is the in-file finite-guard pattern that should have been applied. Default `strip_gps_on_upload=false` → GPS is extracted; both browser (`images.ts`) and LR (`lr/upload/route.ts`) call `extractExifForDb`. **MEDIUM, High conf.**
2. **CR-15-01 — CONFIRMED.** `bounded-map.ts:64` returns `{ ...value }`. `sharing.ts:48` `entry.count++` + `admin-users.ts:39` `entry.count++` + `embeddings.ts:40` `entry.count++` all mutate the discarded copy; stored count frozen at 1. sharing/admin-users have a DB-backed second layer (`incrementRateLimit`/`checkRateLimit` 112-113/128-129/226-227) so limits ARE enforced; embeddings has none (admin-gated). Reference pattern `.set(key, { count: entry.count+1, … })` at `public.ts:56,264,333`. **MEDIUM code defect / LOW user-impact.**
3. **SEC-15-01 / Critic-F2 — CONFIRMED (2-agent).** `color-details-section.tsx:233` (`iccName`, rendered `:369`/`:383`) + `:469` (`bit_depth`) + `info-bottom-sheet.tsx:442` render admin-only fields with nullness-only guards, while 6+ siblings (`:402,408,449,458,479,582`) carry `isAdmin &&`. Clipboard snapshot (`:274,281`; `lightbox-color-pip.tsx:93,100`) folds them in ungated. Latent (data-layer omission protects). `color-details-section-delivered.test.ts:24` pins the un-gated bit-depth form → must update. **LOW.**
4. **Critic-F1 — CONFIRMED.** `drizzle/0014_drop_reactions.sql` exists but journal `0014` = `0014_add_icc_profile_name` → file never applied. `grep -c reaction migrate.js` = 0 → `reconcileLegacySchema` doesn't drop it (entitlements WAS mirrored). `migration-journal.test.ts:29-32` permits the orphan on a false "out-of-band cleanup" premise. Dead `image_reactions` table + `images.reaction_count` persist on legacy-migrated DBs (incl. production). **LOW.**
5. **DES-15-01 — CONFIRMED.** `ui/dialog.tsx:82`, `ui/sheet.tsx:84`, `upload-dropzone.tsx:370`, `topic-manager.tsx:333` use `focus:ring-2` (fires on mouse click). **LOW.**
6. **DES-15-02 — NOT A DEFECT (lead).** `lightbox.tsx:654` `LightboxColorPip` lacks `controlVisibilityProps`, but `lightbox-color-pip.tsx:140` root has NO opacity/controlsVisible wiring → the pip is PERSISTENTLY VISIBLE. A visible control SHOULD be keyboard-focusable; adding `tabIndex:-1`/`aria-hidden` would itself violate WCAG. The designer's HIGH premise (pip fades with controls) is false. Recorded as not-a-defect; no code change.
7. **TE-15-01 — CONFIRMED.** `lr-upload-hdr-gate.test.ts:195-206` asserts `statfs` + `507` + `1GiB` but NOT `stats.bavail`; a revert of `route.ts:185` to `bfree` passes. **Broken/incomplete gate, HIGH priority.**
8. **TE-15-02 / TRC-15-01 — CONFIRMED (2-agent).** `grep currentFlushPromise|flushBufferedSharedGroupViewCounts|gracefulShutdown` over `__tests__` = 0 hits. The cycle-14 R14-01 shutdown-flush fix has zero coverage; a revert passes every test. Same class as cycle-14 TE-02. **Test gate.**
9. **TE-15-03 — CONFIRMED.** `check-action-origin.ts` `MUTATING_FUNCTION_NAMES` lists the `revalidateLocalizedPaths` wrapper but not raw `revalidatePath`/`revalidateTag`. Scanner-completeness gap; no live instance. **Test/gate hardening.**
10. **A15-01 — CONFIRMED.** `client-server-only-boundary.test.ts` denylist (`server-only`/mysql2/sharp/transformers/argon2) does not match `next/headers`/`next/cache`/`next-intl/server`; `lib/revalidation.ts`/`csp-nonce.ts`/`action-guards.ts` sit outside the net. Latent. **LOW seam.**
11. **A15-02 — CONFIRMED.** `data.ts:1481` `searchFields` is the one public image-row literal with no `Extract<…,PrivacySensitiveKeys>` guard. Clean today. **LOW seam.**
12. **Upload-tracker key namespace (CR MEDIUM #2) — BY-DESIGN.** `lr/upload/route.ts:200-210` (DEF-C4-03) deliberately keys the LR window separately on the verified token user; trusted multi-root-admin model. Downgraded to deferred/by-design.

---

## Cross-Agent Agreement Matrix (higher agreement = higher signal)

| Finding | Agents | Severity |
|---------|--------|----------|
| `icc_profile_name`/`bit_depth` un-`isAdmin`-gated (un-mirrored cycle-13/14 sibling) | security (SEC-15-01), critic (F2) | **LOW** (2 agents) |
| `currentFlushPromise` shutdown fix has zero test coverage | test-engineer (TE-15-02), tracer (TRC-15-01) | **TEST-GATE** (2 agents) |
| LR `bavail` not source-locked / SIGTERM wiring untested | test-engineer, architect (A15-03) | TEST-GATE |
| GPS NaN → upload rejection | debugger (DBG-15-01) | **MEDIUM** (headline) |
| BoundedMap shallow-copy dead fast path | code-reviewer (CR-15-01) | **MEDIUM** |

---

## NEW findings — full list (provenance)

### MEDIUM
- **DBG-15-01** `convertDMSToDD` NaN guard → `0/0` GPS rational reaches DB as `NaN` → `ER_BAD_FIELD_ERROR` → valid photo silently rejected at upload. `process-image.ts:1446-1455`. (debugger)
- **CR-15-01** BoundedMap shallow-copy mutated → in-memory rate-limit fast path frozen. `sharing.ts:48`, `admin-users.ts:39`, `embeddings.ts:40`. (code-reviewer)

### LOW (new)
- **SEC-15-01 / Critic-F2** `icc_profile_name` + `bit_depth` un-`isAdmin`-gated (+ clipboard snapshot). `color-details-section.tsx:233/469`, `info-bottom-sheet.tsx:442`. (security, critic)
- **Critic-F1** orphaned `0014_drop_reactions.sql` never runs; reconcile doesn't mirror it; test comment false. (critic)
- **DES-15-01** `focus:ring`→`focus-visible:ring` in `ui/dialog.tsx:82`, `ui/sheet.tsx:84`, `upload-dropzone.tsx:370`, `topic-manager.tsx:333`. (designer)
- **A15-01** boundary test blind to `next/headers`/`next/cache`/`next-intl/server`. (architect)
- **A15-02** `searchFields` no privacy `Extract` guard. (architect)
- **PERF-15-02** `histogram.tsx:440-448` resize listener no rAF debounce → redraw per pixel. (perf)
- **PERF-15-06** bootstrap `getGalleryConfig()` per job outside request scope → up to N sequential `admin_settings` reads. `image-queue.ts:~383`. (perf)
- **DOC-15-01..04** CLAUDE.md: `NEXT_UPLOAD_BODY_MAX_BYTES` 279620608→278921216; `process-image.ts:1131-1135`→`:1157`; `color-detection.ts:99-107`→`:99-108`; `settings-hash.ts:41-53`→`:42-54`. (document-specialist)
- **CR LOWs** auth.ts `console.debug`→`error` (`:194`); load-more `'invalid'` no toast; tag-input `filteredTags` NFKC; lightbox-pip execCommand fallback; `viewCountRetryCount` stale on capacity-drop. (code-reviewer)

### TEST-GATE
- **TE-15-01** LR `bavail` source-lock (`lr-upload-hdr-gate.test.ts`). (test-engineer)
- **TE-15-02 / TRC-15-01** `currentFlushPromise` fixture (`data-view-count-flush.test.ts`). (test-engineer, tracer)
- **TE-15-03** action-origin scanner `revalidatePath`/`revalidateTag` + fixture (`check-action-origin.ts`). (test-engineer)
- **TE-15-04 / A15-03** SIGTERM wiring + `NEXT_MANUAL_SIG_HANDLE` Dockerfile env source-scan test. (test-engineer, architect)

### INFO (no action)
- **DBG-15-02** two ISOBMFF walkers (`color-detection.ts:249`, `gain-map-detection.ts:72`) omit MAX_SAFE_INTEGER guard (harmless; downstream catches). **DBG-15-03** Unicode sanitizer omits U+2028/2029/061C (non-exploitable completeness). (debugger)
- **TE-15-05/06** Badge asChild scale-token blind spot (no live instances); csv-escape U+FFF9-FFFB test missing (covered cross-lib). (test-engineer)

---

## DEFERRED — recorded, not dropped (bound by repo policy; see cycle-15-plan.md for citations + exit criteria)

- **PERF-15-01 — `images` missing `(processed, updated_at)` index** (`getLatestImageUpdatedAt` MAX scan + `getImagesForFeed` filesort; public Atom feed at `revalidate=0` + sitemap). Sev MEDIUM. Needs a schema migration. **ESCALATION:** this is the strongest index case yet (public path, not admin-only). Batch with carry-over PERF-14-01 (`sharedGroupViews`), PERF-13-07 (`topicViews`), and PERF-15-04 (`image_views (bot,viewed_at,imageId)`) into a dedicated index-migration cycle. Exit: a query-perf migration cycle is scheduled OR feed/analytics latency regresses at scale.
- **PERF-15-03** `getSharedGroup` 3 sequential round-trips; **PERF-15-05** `getImage` leftJoin→innerJoin. LOW structural/micro. Exit: profiling on a hot path.
- **Upload-tracker key namespace** (`lr/upload/route.ts:210` vs `images.ts`). BY-DESIGN (DEF-C4-03 documented intent + trusted multi-root-admin model). Exit: a role/capability model lands OR untrusted upload surface added.
- **DES-15-02** LightboxColorPip `controlVisibilityProps`. NOT a defect (pip persistently visible; hiding would violate WCAG). No action.
- **DES-15-03** `info-bottom-sheet` aria-live for sheet state transitions. LOW a11y; joins the deferred a11y cluster (DES-13-02..06, DES-14-03 position-counter). Exit: an a11y-focused cycle OR SR-user report.
- **DBG-15-02/03, TE-15-05/06** INFO/additive. Exit: a real input path reaches them OR a test-hardening cycle.
- **Carry-overs (unchanged):** SEC-13-02/TRC-13-04 (`hasTrustedSameOriginWithOptions`), SEC-13-03/SEC-14-02 (GET rate-limit CI gate / LR err.message), PERF-13-01..07, DES-13-02..06 + DES-14-03 (a11y cluster), R13-ARCH-* structural debt (god-modules, lib/storage integration, single-instance topology BY-DESIGN), DBG-05/07 (decimalToRational subnormal, admin-token length-timing). All re-confirmed latent/by-design; original citations in cycle-13/14 plans.

## AGENT FAILURES
None. All 11 agents returned; 6 read-only agents' reviews persisted by the lead, 5 writable agents wrote their own under `.context/reviews/`.
