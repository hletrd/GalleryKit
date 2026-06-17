# Aggregate Review — Run-6 Cycle-10 (HEAD `0502ae86`)

**Date:** 2026-06-17
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Gate state (verifier, fresh foreground run):** ESLint exit 0; typecheck exit 0; Vitest **2227 passed / 4 skipped / 0 failed** (238 files); lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0. The 4 skips are the model-weight-gated `clip-offline-load` + `clip-semantic-integration` suites (gated by design).

## Context

The pre-activation code converged at cycle-7 (0 findings). Cycle-8 turned CLIP semantic search LIVE in production and found+fixed 13 activation-surface findings (plan-360, archived). Cycle-9 found+fixed 5 (downloader loader-fatal idempotency, short-query test, similar-route test symmetry, SimilarResult interface, stale comment). This cycle-10 independently re-verified the cycle-9 fixes AND swept the whole system.

**Verdict: near-total convergence.** 8 of 11 agents (code-reviewer, security-reviewer, perf-reviewer, critic, tracer, architect, debugger, and verifier's blocker count) report **0 findings**. Two NEW real findings landed (one HIGH operational, one MEDIUM test-gap). One designer finding was **rejected** after authoritative-source verification (it contradicts MDN/ARIA guidance), and one designer finding is **deferred LOW**.

All NEW HARD GUARDS were respected by every agent — no `server-only` re-added to `clip-model.ts`/`@/db`; the `semantic_search_mode: 'disabled'` code default left intact; no weakening of `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / the revision pin / `allowRemoteModels=false` / model_version isolation. The security reviewer and code-reviewer both explicitly rejected the `server-only` temptation and cited the guard.

**All 5 cycle-9 findings (AGG-C9-01..05) independently verified CLOSED at HEAD** by verifier (foreground gate run + line-level checks), critic, and tracer:
- AGG-C9-01 (loader-fatal manifest): `LOADER_FATAL_FILES` + `verifyLoaderFatalFiles()` present, dual-gated fast-path, 3 dedicated tests (commit 26609da8).
- AGG-C9-02 (short-query test): `search-short-query-guard.test.ts` pins constant + countCodePoints + invalidSemantic + return-before-fetch + en/ko parity.
- AGG-C9-03 (similar-route symmetry): 503/429/404 cases added (commit 2b7ca75e).
- AGG-C9-04 (SimilarResult interface): `lens_model` + `capture_date` added, typecheck passes (commit 2fb8e4e7).
- AGG-C9-05 (stale "deployed DARK" comment): zero hits repo-wide.

**Findings trend across run-6:** cycle-1 ~30 → … → cycle-7 **0** → cycle-8 **13** → cycle-9 **5** → cycle-10 **2 schedulable (1 HIGH + 1 MED)** + 1 deferred-LOW + 1 rejected.

---

## Merged findings (deduped; highest severity/confidence preserved; cross-agent agreement noted)

### AGG-C10-01 [HIGH] — nginx `client_max_body_size 2M` on `/api/admin/` 413-blocks the Lightroom Classic publish-plugin upload (`/api/admin/lr/upload`) for any real photo
**Agent:** document-specialist (DS-C10-01, HIGH/conf-H). Independently confirmed by aggregator (read nginx config + LR route).

**Where:**
- `apps/web/nginx/default.conf:124-137` — `location ^~ /api/admin/ { client_max_body_size 2M; ... }`. This catch-all matches `POST /api/admin/lr/upload`. There is no preceding, more-specific location that raises the cap for the LR route.
- `apps/web/src/app/api/admin/lr/upload/route.ts` — the route accepts a multipart photo upload and re-uses `saveOriginalAndGetMetadata` + `enqueueImageProcessing` (the same infra as the browser upload path), enforcing the app-level `MAX_UPLOAD_FILE_BYTES = 200 MiB` (`lib/upload-limits.ts`). Comment block (lines 10-17) documents this as the server-side counterpart to the Lightroom plugin's `GalleryKitAPI.lua` (US-P53).
- `nginx/default.conf:91-104` shows the precedent fix: `/admin/dashboard` already carries a dedicated `client_max_body_size 216M` block for the same reason (browser dashboard uploads).

**Failure scenario:** nginx enforces `client_max_body_size` BEFORE proxying to Node. A Lightroom Classic publish exports a rendered JPEG (typical 24 MP export 8-15 MiB; originals far larger). Every upload over 2 MiB returns HTTP **413 Request Entity Too Large** at the edge, before the route runs. The app-layer 200 MiB cap and the upload-tracker checks are dead code for real photos. The LR publish plugin — a shipped feature (US-P53) — is non-functional behind the documented/shipped reverse proxy for essentially all real photos. Silent to the app (no audit log, no diagnostic) because the request never reaches Node.

**Fix (config + doc):**
1. Add a dedicated location for `/api/admin/lr/upload` with `client_max_body_size 216M` (mirroring `/admin/dashboard`), ordered so it wins over the `^~ /api/admin/` catch-all. Keep the `admin` rate-limit zone + the security/proxy headers. (nginx longest-prefix `^~` vs. regex ordering: an exact-path regex location, or a more-specific `^~ /api/admin/lr/upload` prefix, must be ordered to match first.)
2. Add the LR upload cap to the CLAUDE.md body-cap table (line ~514) so operators know the LR route needs the larger cap.

**Repo-policy note:** Operational/availability defect on a shipped feature — schedule, do not defer. **Confidence: H.**

**Severity-calibration caveat for the plan step:** the fix is a reverse-proxy config change shipped in the repo (`apps/web/nginx/default.conf`); the running deploy's effective nginx may already carry a hand-patched cap. The repo's committed config is what new deployments and the documented setup use, so the committed config must be corrected regardless. Verify location-ordering semantics (the more-specific block must take precedence over the `^~ /api/admin/` prefix).

### AGG-C10-02 [MEDIUM] — `similar-route.test.ts` 200-path is false-confidence: the `@/db` mock omits `lens_model`/`capture_date`, so a SELECT-drop regression passes silently
**Agents:** test-engineer (TE-C10-01, MEDIUM). Corroborated by tracer (Path 2 — confirmed the route DOES select+return both fields) and verifier (confirmed the cycle-9 SimilarResult interface fix that this test should now guard).

**Where:**
- `apps/web/src/__tests__/similar-route.test.ts` — the `vi.mock('@/db', ...)` `images` schema stub declares only `id, title, description, filename_jpeg, width, height, topic, processed, camera_model`. It omits `lens_model` and `capture_date`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:205-206,227-228` — the production route SELECTs `lens_model: images.lens_model` + `capture_date: images.capture_date` and maps both into the enriched result (parity with the semantic route, AGG-C8-10).
- `apps/web/src/components/similar-photos.tsx:29-30` — `SimilarResult` interface requires both fields (the cycle-9 AGG-C9-04 fix), with a comment that the interface must match the wire shape.

**Problem:** the 200-path test only asserts `res.status` and `body.results[0].imageId`. A future refactor that drops either field from the route SELECT passes every test silently, re-opening the cycle-8 AGG-C8-10 "blank lens/date on similar cards" defect with no failing test. This is a coverage gap on a LIVE-surface contract that was deliberately established two cycles ago.

**Fix:** add `lens_model: 'lens_model'` and `capture_date: 'capture_date'` to the mock `images` schema, populate both in `imageRows`, and add `toHaveProperty('lens_model')` / `toHaveProperty('capture_date')` (and value) assertions on the result item in the 200-path test.

**Repo-policy note:** genuinely-missing regression guard on a LIVE-surface contract — schedule, do not defer. **Confidence: H** (the gap is real; severity MEDIUM because the guards/route are correct, only the test is weak).

---

## Deferred (existing findings; severity/confidence preserved per deferred-fix rules)

### DEF-C10-01 [LOW] — Search dialog `<Input>` is 32 px tall (`h-8`), below the repo's documented 44 px touch-target floor
**Agent:** designer (FIND-D2, originally MEDIUM/conf-M). **Aggregator re-graded to LOW** and deferred (rationale below; original severity preserved on record).

**Where:** `apps/web/src/components/search.tsx:374` — `className="border-0 p-0 h-8 shadow-none ..."` on the search combobox `<Input>` (inside a `flex items-center gap-2 p-4 border-b` row).

**Why deferred (not fixed-now), real-world severity LOW:**
- The control is a single-line **text-entry field** spanning the full dialog width (~470 px). The tappable target is enormous horizontally; only the vertical extent is 32 px. WCAG 2.5.5 (AAA, 44 px — the repo's stated bar) and 2.5.8 (AA, 24 px — which 32 px already clears) target discrete tap targets; a full-width text input behaves differently (tap anywhere in the field; on mobile the keyboard opens on focus).
- This `h-8` has existed since commit `1312d29b` and survived 9 review cycles including dedicated photographer-rN UI passes and the blocking `touch-target-audit.test.ts`. The audit deliberately scans `Button`/`button`/`Badge asChild`/`select` but NOT `<Input>` (text fields are intentionally out of scope).
- Promoting this to fix-now would be either a one-line `h-8`→`h-11` change with negligible UX benefit on an already-large target, or audit-fixture churn. The orchestrator's strong anti-manufacturing directive applies.

**Original severity/confidence (not downgraded for the record):** designer rated MEDIUM/conf-M. Aggregator assessment: a genuine but marginal vertical-only sub-44 on a wide text field, LOW real-world impact.

**Exit criterion (re-open):** re-open and fix (h-8→h-11 + extend the audit to cover `<Input>` sub-44 heights) IF (a) the search field is reworked into a multi-control composite where the input is no longer full-width, OR (b) a real mobile-usability report cites the search field height, OR (c) the repo decides to bring `<Input>` under the touch-target-audit scope (at which point this becomes a hard test failure that must be fixed). **File+line:** `apps/web/src/components/search.tsx:374`.

---

## Rejected findings (recorded with rationale — NOT scheduled, NOT deferred)

### REJ-C10-01 — designer FIND-D1 (claimed HIGH, WCAG 4.1.2): `aria-controls` referencing a conditionally-unmounted element
**Agent:** designer (FIND-D1, claimed HIGH/conf-H). **Rejected by aggregator after authoritative-source verification.**

**Claim:** `similar-photos.tsx:116` (`aria-controls="similar-photos-results"`) and `color-details-section.tsx:290` (`aria-controls={colorDetailsId}`) always set `aria-controls`, but the referenced `<div>` is only in the DOM when the disclosure is open (`similar-photos.tsx:126`, `color-details-section.tsx:329`). Designer claimed JAWS/NVDA cannot navigate to a non-existent target → WCAG 4.1.2 failure.

**Why rejected (MDN/ARIA authoritative guidance, verified 2026-06-17):** MDN's `aria-controls` page states verbatim: *"The `aria-controls` only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible."* Referencing a not-currently-present/visible controlled element is **explicitly valid and recommended** — NOT a WCAG conformance failure. The cycle-8 wiring (AGG-C8-11) chose exactly the pattern MDN endorses: keep `aria-controls` set consistently + conditionally render the controlled region. When collapsed (`aria-expanded=false`) there is correctly nothing to navigate to; when expanded the element exists and the reference resolves. Both call sites already pair `aria-controls` with the correct `aria-expanded` state.

**Disposition:** No change. Acting on this would introduce churn that contradicts MDN/ARIA guidance and the orchestrator's anti-manufacturing directive. The designer correctly verified the rest of the a11y surface clean (i18n parity, lightbox, tag chips, masonry alt text, admin forms, histogram, color pip, search combobox aria-controls correctly omitted when listbox absent).

---

## Documentation-accuracy notes (non-findings — optional doc-only touch-ups, no behavioral defect)

Doc-code drifts flagged by multiple agents. None is a defect. Not counted as findings. Per the convergence directive, doc nitpicks are NOT findings; they may be folded into an opportunistic doc-touch-up but do not block convergence. (The LR body-cap doc half of AGG-C10-01 IS load-bearing and rides that scheduled finding.)

- **DOC-N1** (verifier): CLAUDE.md line ~139 tags `avif_10bit` "admin-only (AGG-D6/DOC-06)", but the code deliberately exposes it publicly (`data.ts:275-277`, R10-M4); `privacy-fields.test.ts` + `color-details-section.tsx` are consistent treating it public-safe. Fix → "public-safe (R10-M4)".
- **DOC-N2** (verifier): CLAUDE.md cites `settings-hash.ts:37-49` for `COLOR_IMPACTING_KEYS`; the array starts at `:41`. Count (9) and key names correct; only the line ref is off.
- **DOC-N3** (perf-reviewer): CLAUDE.md describes the masonry grid as using "useMemo for reorder", but it's pure CSS columns now. Doc drift, no perf impact.

---

## Per-agent finding counts

| Agent | New findings | Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — honest convergence; verified dotProduct unit-vector path, buffer round-trip, inArray guard, operator-gate, lazy-singleton retry, backfill NaN guard. 63/63 CLIP tests pass. |
| security-reviewer | 0 | LOW risk — 11 routes + 14 actions + auth core + CLIP surface examined; no SQLi/SSRF/path/privesc/PII-leak; 3 lint gates + 72/72 security fixtures pass. |
| perf-reviewer | 0 | Semantic scan hard-capped at 5000 + composite-index-backed; no N+1; SW LRU O(n); bounded retry Maps. (1 cosmetic doc nit → DOC-N3.) |
| critic | 0 | ACCEPT — disproved 2 self-hunted candidate doc-mismatches (COLOR_IMPACTING_KEYS count, phantom 7th advisory lock); verified all 5 cycle-9 fixes closed + live-feature invariants. |
| verifier | 0 blockers | PASS — full suite 2227 pass; all 5 cycle-9 fixes + documented invariants verified at line level. (2 doc-only nits → DOC-N1, DOC-N2.) |
| test-engineer | 1 | TE-C10-01 → **AGG-C10-02** (MEDIUM). |
| tracer | 0 | All 4 end-to-end paths clean at HEAD; capture_date `mode:'string'` serialization verified; downloader checks all 4 loader-fatal files. |
| architect | 0 | Sound at documented single-writer scale; CLIP model-load singleton + model_version query-layer isolation + config double-gate all consistent fail-closed. |
| debugger | 0 | 15 runtime-critical paths examined; no crash/throw/hang/corruption; decodeEmbeddingColumn case-2, libheif probe, advisory-lock release, view-count flush all correct. |
| document-specialist | 1 | DS-C10-01 → **AGG-C10-01** (HIGH). All other load-bearing doc claims (IMAGE_PIPELINE_VERSION=7, 9 color keys, 6 advisory locks, rate limits, upload caps, backfill column set, env var names, CLIP guards) verified accurate. |
| designer | 2 | FIND-D1 → **REJ-C10-01** (rejected, MDN-cited). FIND-D2 → **DEF-C10-01** (deferred LOW). Rest of a11y surface verified clean. |

**Net schedulable findings this cycle: 2 (AGG-C10-01 HIGH, AGG-C10-02 MEDIUM).**
**Deferred: 1 (DEF-C10-01 LOW).**
**Rejected: 1 (REJ-C10-01).**

## AGENT FAILURES

None. All 11 agents returned and persisted. (tracer + debugger returned mid-investigation messages on the first pass and were each resumed once via SendMessage; both then wrote complete cycle-10 reports — tracer at HEAD 0502ae86 across all 4 mandated paths, debugger across 15 runtime-critical paths.)
