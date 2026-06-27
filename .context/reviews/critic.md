# Critic Review — Cycle 19 (GalleryKit)

**VERDICT: ACCEPT-WITH-RESERVATIONS.** Zero CRITICAL, zero net-new functional bugs. Reservations = two recurring STRUCTURAL roots that point-patches keep treating symptomatically.

## MAJOR

### MAJOR-1 — Public search routes are the only public image-select surface without a compile-time PII guard; the two routes are duplicated and have already drifted (High)
`apps/web/src/app/api/search/semantic/route.ts:293-315` and `apps/web/src/app/api/search/similar/[id]/route.ts:194-216`. Repo has THREE public image-select surfaces; two carry the `_PrivacySensitiveKeys` compile guard (`publicSelectFields` data.ts:463-464; `searchFields` data.ts:1500-1503). The third (semantic+similar) hand-writes an identical 10-column inline `db.select` twice, bypassing both. Cycle-18's `search-route-privacy.test.ts` is a runtime denylist (catches at test time, not tsc time). Structural root not closed: (1) no compile-time protection; (2) duplication already bit (lens_model+capture_date added to semantic AGG-C10-11a, back-ported to similar AGG-C8-10 later) and the denylist doesn't assert the two routes share the same public field set → functional drift possible; (3) denylist's `images\.${col}\b` regex only catches a PII column that is ALSO in adminSelectFields. Mitigated not closed. Fix: extract one `searchEnrichmentFields` const in data.ts with `Extract<keyof, _PrivacySensitiveKeys>` compile guard; both routes `db.select(searchEnrichmentFields)`.

### MAJOR-2 — Focus-visible rings have no enforcement harness while their identical-class invariant (touch-targets) does → "fix one sibling, miss the next" structurally recurs (High)
`__tests__/focus-visible-rings-cycle17.test.ts` (frozen per-control pin) vs `__tests__/touch-target-audit.test.ts` (general SCAN_ROOTS walker + KNOWN_VIOLATIONS ledger). No `check-focus.ts` script, no general focus vitest scanner. The test file documents its own recurrence (:116-122). Git log confirms reactive cadence (R16 back-to-top, R17 3 controls, R18 nav theme/locale). Cycle 19 will discover the next missed control by eye, not gate (designer confirms D19-01/07/08/09). Self-corrected false-positive: tag-filter chips DO get a ring from badgeVariants cva base. Fix: general scanner parallel to touch-target audit with KNOWN_FOCUS_EXEMPTIONS ledger; retire per-cycle frozen pins.

## MINOR

### MINOR-1 — Both search routes silently return empty 200 with no log when enrichment query fails (High)
`semantic/route.ts:333-336`, `similar/[id]/route.ts:234-237`. After scoring succeeds, transient enrichment `db.select` failure swallowed by bare `catch { enrichedResults = []; }` — no console.error. Caller gets `{ results: [] }`, indistinguishable from "no matches," after rate-limit budget consumed. Scan-query catches DO return 500/503; enrichment catch returns 200 with zero observability. Duplicated both routes. Fix: `console.error('search enrichment failed', e)` in both.

### MINOR-2 (LOW) — settleUploadTrackerClaim is windowless; stale settle after concurrent window reset under-counts the fresh window (Med)
`apps/web/src/lib/upload-tracker.ts:19-33`; claim images.ts:226-228, settles :244/249/273/277/542/564. Settle reconciles `count += (success − claimed)` against whatever entry is under the key without re-checking windowStart. Scenario: request A claims +10 at windowStart=T0 (slow batch); ~1h later request B triggers resetUploadTrackerWindowIfExpired (zeroes entry, windowStart=T1) + claims; A finishes success=8 and settles `count = B.count + (8−10)`, subtracting from B's fresh window. Direction always under-count (mild quota evasion of one window, self-healing). Admin-only surface. Fix: capture windowStart at claim; settle no-ops if claimWindowStart != currentEntry.windowStart.

## Known-and-deferred (assessed)
- Topic-slug rename: re-verified FULLY transactional (topics.ts:249-331), FK+ordering prevent CASCADE-wipe; FK-registry test is a sound tripwire for new FK children. Residual (Med, deferred): registry can't catch a future non-FK string referrer. No new non-FK referrer today.
- deleteOriginalUploadFile "unguarded await leaks claim" (images.ts:520-522) — KNOWN FALSE POSITIVE, not reported.

## Cross-cutting note
The cycle-18 "add a derived test" pattern (denylist for search PII; FK registry for slug) is the right tactical move but is becoming the default answer to structural drift. Worth a deliberate "convert net-tests to structural guards" sweep.

## Findings
- MAJOR-1 | High | search/semantic+similar routes — enrichment selects duplicated + only public select surface lacking compile-time PII guard
- MAJOR-2 | High | focus-visible-rings-cycle17.test.ts vs touch-target-audit.test.ts — no general focus-visible enforcement harness
- MINOR-1 | High | semantic:333-336 + similar:234-237 — enrichment failure → empty 200 no log
- MINOR-2 (LOW) | Med | upload-tracker.ts:19-33 — window-identity-blind settle under-counts fresh window
- DEFERRED | Med | topics.ts:301-327 + topic-slug-fk-registry.test.ts — FK registry can't catch future non-FK slug referrer
