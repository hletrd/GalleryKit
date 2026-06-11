# Critic Lane — Run-5 Cycle-2 Skeptical Multi-Perspective Review

**Reviewer angle:** Product honesty (does shipped behavior match claims?), risk of the freshest changes, design smells, places the codebase lies to itself.
**Change surface:** `git diff b7d4729b..HEAD` (20 commits, run-5 cycle 1) + the half-shipped feature inventory + docs/UI-copy claims.
**Mode:** Started THOROUGH; escalated to ADVERSARIAL after surfacing 1 product-honesty CRIT-class concern + multiple incomplete-fix MEDs.
**Known-issue suppression honored:** plan-315/316/317 read first; suppressed findings (TZ, idempotency-key-unknown-IP, revalidate=0, getTopics subquery, prev/next OR, serve-upload ETag inertness, geoip robustness, view-event retention, etc.) are NOT re-reported.

---

## Verdict counts
- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4

The cycle-1 diff is, on the whole, careful work — the `retryFailedImage` auth fix, the process-image unlink-on-failure wrap, the keyset backfill, and the FocusTrap fix are all correct and well-tested. The findings below are honesty/completeness gaps in the SAME changes, not correctness regressions.

---

## CRT-R5C2-01 — Public semantic-search toggle serves RANDOM results with no honesty signal, and the route docstring now states the OPPOSITE of the code (HIGH)

**Files:**
- `apps/web/src/app/api/search/semantic/route.ts:178-194` (gate inverted to serve on `'stub'`, reject `'production'`)
- `apps/web/src/app/api/search/semantic/route.ts:17-19` (stale docstring)
- `apps/web/src/lib/clip-inference.ts:70-76` (`embedTextStub` — "cosine similarity ... is essentially random")
- `apps/web/src/components/search.tsx:414-438` (public toggle gated on `semanticSearchMode !== 'disabled'`)
- `apps/web/messages/en.json:412` (`"semanticToggle": "Semantic search"` — no disclaimer)

**Confidence:** High · **Classification:** confirmed.

**Problem.** Cycle 1 inverted the capability gate (CRT-R5C1-01): the route used to require `semanticMode === 'production'`; it now requires `semanticMode === 'stub'` and rejects everything else with 503. The net effect of the whole change:

1. `'stub'` is a storable admin setting (`gallery-config-shared.ts:171`), labelled "Stub (testing only)" in the admin UI.
2. When mode is `'stub'`, `search.tsx:414` renders a **public** "Semantic search" toggle to every visitor (the gate is `!== 'disabled'`, so `'stub'` lights it up).
3. A visitor toggling it and searching hits the route, which now returns **200 with ranked-looking results** computed from `embedTextStub`, whose own doc-comment says: *"stub embeddings are NOT semantically meaningful — cosine similarity between a query and an image embedding is essentially random."*
4. The public toggle label is just `"Semantic search"` — there is no "experimental", "beta", or "results may be random" disclaimer anywhere on the visitor-facing surface.

So the shipped behavior is: a public gallery visitor is presented a feature that ranks photos by apparent relevance, but the ranking is random. That is precisely the class of "codebase lying to itself / to the user" this lane exists to catch. The previous posture (`production`-only, and `production` was a real storable value) at least required an admin to consciously pick the production label.

**Compounding — the route docstring is now factually wrong.** `route.ts:17-19` still says:
> `WARNING: The stub encoder returns RANDOM results. Do NOT enable semantic_search_mode in production until the stub is replaced with real ONNX inference. This endpoint rejects requests when mode is not 'production'.`

The code does the OPPOSITE — it now *serves* on `'stub'` and *rejects* `'production'`. A future maintainer reading the docstring will believe the endpoint is locked down when it is in fact the only publicly-serving mode. The docstring at lines 6-15 ("only 'production' serves public requests") is also stale.

**Failure / embarrassment scenario.** Admin flips semantic search to "Stub (testing only)" on a live gallery to "see how the UI looks", forgetting the toggle is public-facing. Visitors search "sunset" and get a random scatter of unrelated photos presented as semantic matches. The gallery looks broken/dishonest to the photographer's clients, and nothing in the UI warns either party. Or: a maintainer trusts the docstring, assumes the endpoint is `production`-gated-and-rejected, and ships a real ONNX encoder behind `'production'` — which the route now hard-rejects with 503, silently breaking the feature they just built.

**Suggested fix (pick one, in honesty order):**
1. **Preferred:** keep `'stub'` as an admin-only / non-public-serving mode. Gate the public `search.tsx` toggle on a separate "publicly serviceable" predicate (e.g. only show it when a real encoder is present), OR have the route return 503 for `'stub'` too and only serve when a genuine encoder is wired. Until a real encoder exists, the honest state is "no public semantic search."
2. **If stub-serving is a deliberate demo choice:** add an explicit visitor-facing disclaimer to the toggle/results (`search.semanticExperimentalHint` en/ko: "Experimental — results may not be relevant") so the user is not deceived.
3. **Regardless:** rewrite `route.ts:6-19` docstring to match the inverted gate. The current text is actively misleading.

**Note on the test suite.** `semantic-search-route.test.ts:205-264` now asserts the route returns 200-with-results in `'stub'` mode — i.e. the test suite has *cemented* "serve random results publicly" as the contract. That is a test pinning a dishonest behavior; if fix (1) is taken, that test must change too.

---

## CRT-R5C2-02 — `[AUTO]` stub-prefix strip is incomplete: `applyAltSuggested` copies the prefix verbatim into admin titles/descriptions (MED)

**Files:**
- `apps/web/src/lib/photo-title.ts:108-119` (the strip — only fires in the `getConcisePhotoAltText` fallback, only when `!hasMeaningfulTitle && !hasTags`)
- `apps/web/src/app/actions/images.ts:969-986` (`applyAltSuggested` copies `row.alt_text_suggested` verbatim into `title`/`description`)
- `apps/web/src/lib/caption-generator.ts:34-39` (`generateCaptionStub` produces `'[AUTO] Photo taken with ...'`)
- `apps/web/src/lib/image-queue.ts:385-393` (caption hook writes that string to `alt_text_suggested`)

**Confidence:** High · **Classification:** confirmed.

**Problem.** CRT-R5C1-02 claims to ensure "`[AUTO] ...` never reaches visible titles, `<title>`, or OG meta tags." But the strip is applied at only ONE consumer: the `getConcisePhotoAltText` fallback branch. There is a second, fully-reachable path that bypasses it entirely:

The admin bulk-edit action `applyAltSuggested === 'title'` (or `'description'`) copies `row.alt_text_suggested` **verbatim** into the `title` column (`images.ts:974, 980`). The source value, when `auto_alt_text_enabled` is on, is `"[AUTO] Photo taken with Canon EOS R5"` (caption-generator stub). Once copied into `title`, it becomes a genuine admin-set title. From then on `getConcisePhotoAltText` sees `hasMeaningfulTitle === true` and never strips — and the title flows to the page `<title>`, OG meta, JSON-LD `name`, the masonry alt, the viewer, and the lightbox. The very surfaces CRT-R5C1-02 promised to protect.

Reachability requires two admin opt-ins (`auto_alt_text_enabled` + the bulk "apply suggested → title" action), which is why this is MED not HIGH — but it is squarely within the scope of the fix that was shipped, and the fix's own header comment overstates its coverage.

**Failure scenario.** Admin enables auto-alt-text, uploads 200 photos, then uses "Apply suggested alt → Title" to populate titles in one click. Every public photo page now shows `[AUTO] Photo taken with <camera>` as its `<title>` and OG title. Google indexes `[AUTO]` titles; social shares show the literal stub marker.

**Suggested fix.** Strip `ALT_TEXT_STUB_PREFIX` at the copy site in `images.ts` `applyAltSuggested` (push `caption.replace(ALT_TEXT_STUB_PREFIX_RE, '')` and skip rows that strip to empty), so the prefix is removed before it becomes persisted admin content. Centralize the strip in one exported helper (`stripStubPrefix`) used by both `photo-title.ts` and `images.ts` so they cannot drift. Then tighten the CRT-R5C1-02 header comment to state the actual coverage.

---

## CRT-R5C2-03 — Stale/misleading code comment: "raw value is still returned for alt='' by callers that use alt_text_suggested directly" — no such caller exists (MED)

**Files:**
- `apps/web/src/lib/photo-title.ts:112-113` (comment)
- grep for `alt_text_suggested` in `components/**` + `app/**/*.tsx` → zero direct `alt=""` consumers

**Confidence:** High · **Classification:** confirmed.

**Problem.** The CRT-R5C1-02 comment justifies NOT stripping the raw value by claiming "The raw value is still returned for alt='' attributes by callers that use `alt_text_suggested` directly." I grepped every `.tsx` under `components/` and `app/` — `alt_text_suggested` is consumed in exactly three non-test places: `data.ts:264` (public select projection), `image-queue.ts:392` (write), and `images.ts:962-974` (the bulk-apply that copies into title/description — see CRT-R5C2-02). **No component renders `alt_text_suggested` directly into an `alt=""` attribute.** The comment invents a justification for a design decision that isn't actually exercised, which will mislead the next maintainer into believing the raw-prefix value is intentionally surfaced somewhere safe.

This matters because it's the codebase asserting a property about itself ("we keep the prefix because alt='' wants it") that is false. If that imaginary requirement were ever real, the `[AUTO]` prefix WOULD be leaking into alt text — and the comment would have you believe that's fine.

**Suggested fix.** Either delete the misleading clause, or (better) actually wire `alt_text_suggested` → `alt=""` somewhere with the prefix stripped, making the comment true. Given CRT-R5C2-02, the cleaner path is: strip everywhere, drop the "we keep it raw on purpose" rationale entirely.

---

## CRT-R5C2-04 — Backfill batching test pins batch COUNT but not keyset cursor correctness; it would pass for OFFSET pagination too (LOW)

**Files:**
- `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-242`
- (implementation it claims to guard: `apps/web/src/lib/admin-backfill-runner.ts:319-354`)

**Confidence:** High · **Classification:** confirmed.

**Problem.** Test (c) is titled "cursor advances strictly across 2 batches" and the file header (line 7-8) claims it verifies "cursor advances strictly: second batch query is issued with cursor = 100." It does NOT. The mock dispatches responses by an internal `batchIndex` counter and slices `allRows` by its OWN offset (`(callIndex - 1) * BATCH_SIZE`) — it never reads the `cursor` value the implementation bound into the `WHERE id > ${cursor}` SQL. The test's own comment (line 15-16) concedes "drizzle sql template objects do not serialise to a searchable string in this context." So the assertion `minIdBatch2 > maxIdBatch1` is comparing two slices the TEST chose, not what the implementation requested. The implementation could use `OFFSET`/`LIMIT`, a constant cursor, or even a buggy cursor that re-reads rows, and this test would still pass as long as it issues 2 queries returning the pre-sliced pages.

The actual implementation cursor logic IS correct (I verified by reading `admin-backfill-runner.ts:347-348` — `cursor = batch[batch.length-1].id`, with `WHERE id > cursor ORDER BY id ASC LIMIT 100`). The gap is that the **test does not protect it**: a future refactor to OFFSET pagination (which re-scans and is O(n²) on large galleries, the exact thing PERF-R5C1-01 was fixing) would not be caught.

This is the "tests mirror implementation rather than pin behavior" pattern (pre-commitment prediction #5, confirmed here). It is LOW because the shipped code is correct; the risk is purely future-regression coverage.

**Suggested fix.** Capture the bound cursor. The runner calls `db.execute(sql\`... id > ${cursor} ...\`)`; the drizzle `sql` object exposes `.queryChunks` / params — assert the second batch's bound param equals `100` (max id of batch 1). If the sql object is genuinely opaque in the harness, refactor `fetchCandidateBatch` to take `cursor` as an injectable seam the test can spy on directly, and assert `fetchCandidateBatch` was called with `(0)` then `(100)`.

---

## CRT-R5C2-05 — Dead i18n + dead conditional after `production` removed from the Select (LOW)

**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:545-549` (conditional on `semantic_search_mode === 'production'`)
- `apps/web/messages/en.json:729-730` / `ko.json` (`semanticSearchModeProduction`, `semanticSearchProductionWarning`)

**Confidence:** High · **Classification:** confirmed (cosmetic).

**Problem.** Cycle 1 removed the `'production'` `<SelectItem>` (settings-client.tsx:540-541 comment) and the validator now rejects `'production'` so it can never be stored via the UI. But the warning block at `:545` (`settings.semantic_search_mode === 'production'` → render `semanticSearchProductionWarning`) remains. It can now only fire from a stale DB row that predates the validator tightening — which is exactly the defense-in-depth case, so keeping it is arguably fine. However, the two i18n keys (`semanticSearchModeProduction`, `semanticSearchProductionWarning`) are now unreachable from any selectable state, and the `semanticSearchModeProduction` key in particular is fully dead (the SelectItem that used it is gone). The settings-client comment says the key is "kept for forward compatibility," which is a reasonable intent — but `semanticSearchModeProduction` (the Select label) has no forward path because the gate is being inverted, not re-enabled, when ONNX ships.

**Suggested fix.** Keep the stale-value warning conditional (it is legitimate defense-in-depth) but verify both i18n keys remain referenced; if `semanticSearchModeProduction` is truly orphaned, either remove it or add a code comment pinning it to the WI-09 re-enable. This is bookkeeping, not a bug.

---

## What's Missing (gap analysis)

- **No honesty disclaimer on the public semantic toggle** (core of CRT-R5C2-01). The admin UI warns about stub randomness (`semanticSearchEnabledHint`); the visitor-facing toggle says nothing.
- **No test for the `applyAltSuggested` → title prefix leak** (CRT-R5C2-02). The new `photo-title-stub-prefix-strip.test.ts` covers only the display-fallback path; the copy-to-title path is untested AND unfixed.
- **No assertion that the route docstring matches the gate.** A contract test could pin "route rejects mode X / serves mode Y" against a documented constant, preventing the docstring/code divergence in CRT-R5C2-01.
- **Keyset cursor value is unguarded** (CRT-R5C2-04) — the regression that PERF-R5C1-01 fixed (full O(gallery) scan) could silently return via an OFFSET refactor.

## Multi-Perspective Notes

- **Photographer-user:** CRT-R5C2-01 is the headline — a feature that lies about relevance to the photographer's audience. CRT-R5C2-02 puts `[AUTO]` literal markers into client-facing titles.
- **Gallery visitor:** toggles "Semantic search," receives random photos with zero indication they are random. Erodes trust in the gallery.
- **Admin operator:** "Stub (testing only)" sounds internal; nothing tells the admin the stub mode is publicly serving. The admin-side hint warns about randomness but not about public exposure.
- **Attacker:** half-shipped paid-download / Stripe / webhook surfaces are genuinely fail-closed (`getStripe()` throws without key; `priceCents <= 0` rejected; webhook is signature-verified). No new attack surface found in the diff. (The unknown-IP idempotency-key sharing is the suppressed TRC-R5C1-16, not re-reported.)
- **Future maintainer:** three self-deceiving comments shipped this cycle — the route docstring (CRT-R5C2-01), the "raw value returned for alt=''" comment (CRT-R5C2-03), and the batching-test "verifies cursor advances" header (CRT-R5C2-04). Each will mislead the next reader about a property the code does not actually have.

## Things verified CORRECT this cycle (no finding)

- `retryFailedImage` (images.ts:1042-1050): the real fix is the added `isAdmin()` check — same-origin alone never proved authentication. Return-shape normalization to `{error}` is compatible with the dashboard caller (`dashboard-client.tsx:46` checks `'success' in result`). Correct, well-tested (`retry-failed-image-auth.test.ts`).
- `saveOriginalAndGetMetadata` try/catch unlink wrap (process-image.ts:862-913): single hunk, no hidden behavior change; test asserts the externally-observable outcome (no orphan file on disk), not implementation. Solid.
- Keyset backfill IMPLEMENTATION (admin-backfill-runner.ts:319-354): cursor on PK, `id > cursor`, ASC, LIMIT, `batch.length < BATCH_SIZE` break — no infinite loop, no skip/repeat, picks up concurrently-uploaded rows benignly. Correct (the test is the weak link, not the code — CRT-R5C2-04).
- FocusTrap change (info-bottom-sheet.tsx:191-196): `initialFocus` lands on the always-rendered, visible close button (`:244-252`, in the "always rendered" peek block) in both peek and expanded states. Removed effects were redundant churn. No focus-restore regression. Correct.
- Lightbox counter (lightbox.tsx:665-674): inline opacity transition preserves the control-visibility behavior; `controlVisibilityProps` still used elsewhere (`:368`). Adds a proper `aria-label`. Correct.
- Migration journal 0021 (`_journal.json`): `when=1781183604120` strictly exceeds the prior max (idx 20 = 1779494400001); all idx>7 strictly increasing. Will not be silently skipped by the drizzle cursor. Correct.
- HDR feature-flag removal (feature-flags.ts deleted, hdr-filenames.ts banner): honesty invariant correctly re-grounded on the `_PrivacySensitiveKeys` guard, not a flag. Consistent with CLAUDE.md.

## Verdict Justification

VERDICT for the cycle-1 diff: **ACCEPT-WITH-RESERVATIONS.** The correctness work is sound and well-tested. The reservations are honesty/completeness gaps in the same changes: one HIGH (semantic stub serves random results publicly with a contradicting docstring), and three MED/LOW incomplete-fix or self-deceiving-comment issues. Escalated to ADVERSARIAL after CRT-R5C2-01 surfaced — that escalation directly produced CRT-R5C2-02 (chased the `[AUTO]` value to ALL its sinks instead of trusting the fix's coverage claim) and CRT-R5C2-03/04 (challenged every "this is fine because…" comment). Realist check applied: CRT-R5C2-01 held at HIGH not CRIT because it requires an admin to flip a non-default setting and causes reputational/UX damage rather than data loss or security breach — but it earns HIGH because the deception is invisible to both admin and visitor and the docstring actively misleads maintainers. No downgrades involving data loss/security/financial impact were made.

## Open Questions (unscored)
- Was inverting the gate to serve `'stub'` (vs. the prior `'production'`-only) a deliberate "demo the UI" product decision, or a mechanical consequence of "production isn't ready so flip to stub"? If deliberate, CRT-R5C2-01 fix (2) (disclaimer) suffices; if mechanical, fix (1) (don't serve stub publicly) is correct. The route docstring must be fixed either way.
- Is `auto_alt_text_enabled` + the bulk "apply suggested → title" workflow actually used in the live deployment? If never used, CRT-R5C2-02 is latent; if used, the `[AUTO]` titles may already be in production data and need a one-time cleanup pass.
