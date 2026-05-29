# Critic / Verifier / Tracer Review — Run-2 Cycle 1 (HEAD eaee58dc)

Faithful-delivery surface. This repo has converged before; honesty over activity. Most surfaces verified clean; the substantive finding is the backfill resume-claim falsification.

---

## SECTION 1 — VERIFIER (claims vs implementation)

### CVT-01 — CLAUDE.md / runner-comment resume claim is FALSE on the detection-failure path (MED, High confidence)

**Claim** (`admin-backfill-runner.ts:31-37` header + script docstring): "If the process is killed mid-backfill, the next invocation will pick up where this one left off (rows are selected by `pipeline_version < CURRENT` so already-completed rows are filtered out automatically)."

**Verification:** The resume claim holds for the kill-mid-batch case (un-touched rows stay at the old version). BUT for a row whose encode SUCCEEDED and whose detection THEN FAILED, the runner advances `pipeline_version = 7` (lines 253-263) even though the row was NOT fully completed (color columns stale). That row is then permanently filtered out of every future backfill — the OPPOSITE of "pick up where it left off." The claim is falsified for that path. See DBG-01 / CR-03. The operator script does the correct thing (no version bump on detection failure), so the two implementations disagree on the very invariant the comment asserts.

**Resolution:** fix the runner to not bump version when `signals === null`.

### CVT-02 — Non-blocking GET_LOCK + already_running semantics — VERIFIED CORRECT

`acquireBackfillLock` (lines 116-135) uses `GET_LOCK(?, 0)`; returns null on contention; `triggerAdminBackfill` maps null → `already_running` (line 353-355). The in-process `state.running` guard (line 345-348) is belt-and-braces. Lock released on the no-candidates fast path (line 359) and on handoff failure (line 380-382). Verified correct.

### CVT-03 — `getTopSharedGroupsByViews` comment about counted rows — VERIFIED ACCURATE

`analytics-data.ts:121-167`: comment says only INITIAL shared-group loads (no `?p=`) increment `shared_group_views`, and intra-share nav doesn't. This matches the CLAUDE.md runtime-topology note. The query joins `sharedGroupViews.groupId → sharedGroups.id` and groups by `sharedGroups.key`, returning the public key. Accurate and admin-only (analytics page is admin-gated). Verified.

### CVT-04 — Post-encode NCLX verification expected-values — VERIFIED CORRECT (audit-only)

`process-image.ts:1214-1218` expects primaries=12 (Display P3) / transfer=13 for all `avifIcc === 'p3'` decisions. Since every wide-gamut source (DCI-P3, Adobe RGB, ProPhoto, Rec.2020) is DELIVERED as Display P3, expecting 12 is correct for the output bytes. Warnings are non-blocking. Verified.

---

## SECTION 2 — CRITIC (skeptical multi-perspective)

### CVT-05 — Operator confusion: two backfill entry points with different semantics, no cross-reference (LOW, Medium confidence)

From an **operator's** view: CLAUDE.md documents the sidecar `--rm` script as THE production backfill path, then a separate "in-app button" landed (R27-UX-HIGH-1). They have different recovery semantics (DBG-01), different persisted columns (ARCH-01), and different concurrency defaults (script 2, runner 1). An operator who reads CLAUDE.md will use the script and get stale `avif_10bit`; one who uses the button gets correct data. Nothing warns them the two differ. **Critique → action:** unify the persisted column set + failure semantics (covered by ARCH-01/DBG-01), and add a one-line CLAUDE.md note that the in-app button and sidecar script are equivalent once unified.

### CVT-06 — Photographer's view: in-app backfill gives no completion signal (LOW, Medium confidence)

The button fires fire-and-forget and toasts "queued (N photos)". There is `getBackfillStatus` (`admin-backfill.ts:65-83`) exposing `running` + `candidateCount`, and `settings-client.tsx` shows a spinner during the request transition — but NOT during the actual background encode (which can run for minutes/hours). A photographer clicks, sees "queued", and has no in-UI way to know when it finished or whether errors occurred (`state.lastError`/`completedRuns` are tracked but not surfaced). Not a bug; a UX gap. Recorded for designer (UX-section). The `candidateCount` polling would let the UI show progress; deferring is acceptable given scope.

---

## SECTION 3 — TRACER (end-to-end flows)

### Trace A — Backfill failure-state matrix (resolves to DBG-01)
- acquire-lock throws → released in catch, state never set running. ✓
- fetchCandidates throws → caught in `triggerAdminBackfill` catch, lock released. ✓
- getGalleryConfig throws (inside runBackfill try) → finally releases lock + state. ✓ (R29-CRIT-1)
- encode throws → `reprocessOne` catches, returns, row stays `< 7` (re-picked). ✓
- **detect throws after encode succeeds → version bumped, row stranded.** ✗ (DBG-01)
Competing hypothesis "maybe stranding is intentional to avoid infinite retry on a permanently-corrupt original" — refuted: the script chose the retry semantics, and a permanently-corrupt original would fail the ENCODE (caught, row stays `<7`) not just detection; detection-only failure is the transient case worth retrying.

### Trace B — forceSrgbDerivatives wiring — CLEAN
admin setting `force_srgb_derivatives` → `config.forceSrgbDerivatives` → share route page (`s/[key]/page.tsx:128`, `g/[key]/page.tsx:162`) → `<Lightbox forceSrgbDerivatives>` (prop line 81) → child components (line 627). This is a delivery-config boolean, not an admin-only image field; no admin-only signal leaks to public render. The value only selects which derivative URL/variant is requested. Verified clean — no finding.
