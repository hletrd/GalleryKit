# Plan 333 — Run-8 Cycle-2 fixes (MED + scheduled LOW)

**Source:** `.context/reviews/_aggregate.md` (run-8 cycle-2 fan-out, 11 agents, no failures).
**Commit discipline (CLAUDE.md / AGENTS.md):** GPG-signed (`git commit -S`), Conventional Commits + gitmoji, one commit per item, `git pull --rebase` then push after each, full gate run before cycle close. NO `Co-Authored-By`. No `--no-verify`, no force-push. Run `npm run typecheck --workspace=apps/web` before committing any test change.

**Context:** The prior run-7 fix batch landed clean — all AGG-R7-01..09 + AGG-10/11/12/13 verified CLOSED at HEAD by every agent. This cycle's open set is 5 MED + 8 LOW, all NEW or carried. No plan-table hygiene needed.

---

## Item 1 — AGG-R8-01: de-flake `client-server-only-boundary.test.ts` (MED · 3 agents · RED-in-CI class · DO FIRST)

- **Sources:** VER-1 (verifier — observed cold-fail + warm-pass live), TEST-0 (test-engineer — 42.7 s isolated), perf-noted.
- **Where:** `apps/web/src/__tests__/client-server-only-boundary.test.ts` (~line 120). A synchronous full-`src` import-graph walk (~440 files) with no explicit per-test `testTimeout`; runs ~6.5 s warm but 25–43 s cold, exceeding the default 15 s `testTimeout`.
- **Why it matters:** the gate is RED on a cold/contended CI runner AND blind — a REAL client→server-only leak would also time out (identical red), so the gate cannot distinguish a flake from a genuine violation. The boundary invariant itself is intact (0 violations whenever the test completes).
- **Change:**
  1. Add an explicit generous `testTimeout` to this test (e.g. `60_000`) so a cold/contended run does not false-fail. Per repo policy this is NOT a suppression — the assertion still runs to completion and still fails on a real violation; we are only correcting an under-sized timeout that masks the real result. Document the reason inline.
  2. Memoize the per-file `fs.readFileSync` + closure traversal (read each source file once into a `Map`, reuse across the dependency walk) so the cold run drops to single-digit seconds. This is the root-cause fix; the timeout bump is belt-and-braces.
- **NO suppression** (no `.skip`, no `xfail`). Root-cause: cut the redundant re-reads.
- **Acceptance:** `npx vitest run client-server-only-boundary` passes on a COLD run (fresh process, no warm cache) well under the timeout; full suite green; the test still fails if a synthetic client-importing-server-only fixture is introduced (manually reason this, or add a transient fixture and revert).

## Item 2 — AGG-R8-02: home `og:image` must not be the BASE (largest) JPEG (MED · 2 agents · regression)

- **Sources:** CRT-1 (critic), TEST-1 (test-engineer).
- **Where:** `apps/web/src/app/[locale]/(public)/page.tsx:109-115` — `og:image` URL built as `/uploads/jpeg/${latestImage.filename_jpeg}` (base = largest configured size, default 7680 px @ q90 ≈ 6–12 MB).
- **Why it matters:** AGG-R7-09 (commit 4852bcf5) fixed a transient 404 but introduced a permanent oversized card. Twitter/X reject >5 MB images (card renders image-less); LinkedIn similar. ALL 4 sibling OG paths (`p/[id]`, `[topic]`, `c/[slug]`, per-photo route) emit a proper 1200×630 / ≤1 MB card. The home page is the sole outlier.
- **Change:** point the home `og:image` at the existing `/api/og` Satori route URL — it renders a 1200×630 card server-side and already iterates sizes via `pickFirstAvailablePhotoBuffer` (on-disk fallback across the backfill window, ≤ `OG_PHOTO_MAX_BYTES`). This both fixes the size AND keeps the AGG-R7-09 no-404 guarantee. Set `og:image` width/height to 1200/630 and keep the existing `alt`. Confirm `/api/og` (the home/site OG route, `apps/web/src/app/api/og/route.tsx`) accepts the needed params (or pass the latest image id so it can embed the photo).
  - If wiring the latest photo into `/api/og` is non-trivial, the acceptable fallback is a mid-sized derivative (~2048 px) with a width>2048 guard — but the Satori route is preferred because it cannot 404 and is already capped.
- **Acceptance:** home page metadata `og:image` resolves to a ≤5 MB, ~1200×630 card; regression test (Item 8) asserts the URL is NOT the base `filename_jpeg` and carries 1200×630 dims (or the `/api/og` route). Manual: `curl` the home page, confirm `og:image` points at the capped card.

## Item 3 — AGG-R8-03: checkbox 44px touch target + close the audit blind spot (MED a11y · 1 agent)

- **Source:** DES-1 (designer).
- **Where:** `apps/web/src/components/image-manager.tsx:418,444` — select-all + per-row checkboxes wrap a 20 px `<input type="checkbox">` in a `min-h-8 min-w-8` (32 px) `<label>`. Below the CLAUDE.md Touch-Target policy 44 px floor (WCAG 2.5.5 AAA). The blocking `apps/web/src/__tests__/touch-target-audit.test.ts` FORBIDDEN regex scans `<Button>/<button>/<Badge>/<select>` but NEVER raw `<input type="checkbox">` — structural enforcement blind spot.
- **Change:**
  1. Bump both label wrappers from `min-h-8 min-w-8` to `min-h-11 min-w-11` (keep the inner 20 px checkbox visible; the label provides the 44 px hit area, consistent with the repo's existing icon-button-in-larger-hitzone pattern).
  2. Add a raw-checkbox FORBIDDEN pattern to `touch-target-audit.test.ts`: flag `<input type="checkbox">` whose wrapping interactive element (label/div) carries `min-h-[0-43]`/`h-8`/`h-9`/`h-10` or no min-h ≥ 44. Follow the existing multi-line-tag normalization approach. Per CLAUDE.md "Adding a documented exemption", any intentional sub-44 checkbox must then be added to `KNOWN_VIOLATIONS` with a re-open criterion — there should be none after the fix.
- **Acceptance:** the two `image-manager.tsx` checkboxes render a ≥44 px hit area; `npm test --workspace=apps/web` passes including the extended audit; introducing a synthetic 32 px raw checkbox in a scanned file trips the new pattern. Run `npm run typecheck` before committing the test change.

## Item 4 — AGG-R8-04: active tag-chip count contrast (MED a11y · 1 agent · public surface)

- **Source:** DES-2 (designer).
- **Where:** `apps/web/src/components/tag-filter.tsx:95` — the photo-count `<span className="text-xs text-muted-foreground">({tag.count})</span>` sits inside a chip that becomes `bg-primary text-primary-foreground` when active. `text-muted-foreground` over `bg-primary` computes 2.94:1 (light) / 2.45:1 (dark) — fails WCAG 1.4.3 4.5:1 small-text. Inactive chips pass (6.03:1). This is the public home page.
- **Change:** remove the explicit `text-muted-foreground` from the count `<span>` so it inherits the chip foreground — `text-primary-foreground` (high-contrast) when active, normal foreground when inactive. If a slightly-muted look is desired on inactive chips, gate the muted class on `!currentTags.includes(tag.slug)` instead of applying it unconditionally. Verify both states meet 4.5:1.
- **Acceptance:** active chip count contrast ≥ 4.5:1 in both light and dark; inactive chip count still ≥ 4.5:1. Manual contrast check with the computed token hexes (primary-foreground on primary).

## Item 5 — AGG-R8-05: bound the SW HEAD revalidation on the display path (MED perf · 1 agent · weigh vs documented decision)

- **Source:** PERF-1 (perf-reviewer).
- **Where:** `apps/web/public/sw.template.js:207-230` (`staleWhileRevalidateImage`) — awaits a `HEAD` round-trip per cached image before `return cached` whenever the entry has an ETag.
- **Why it matters:** a warm-cache masonry paint (~30 tiles) pays one network HEAD RTT per tile before painting bytes already in CacheStorage; a slow/hung network stalls each tile up to the fetch timeout. Inflates LCP/INP on the offline-resilient surface the SW exists to speed up.
- **TENSION (must respect):** the synchronous HEAD was a DELIBERATE freshness choice (R11-M1/R4C9 comment — serve fresh colors immediately after an admin color-setting change). A full flip to background-only reintroduces a one-paint color-staleness window the comment explicitly warns about. Therefore:
- **Change (conservative, keeps the documented freshness intent):** wrap the HEAD `fetch` with `AbortSignal.timeout(~300 ms)` (or a small constant). On abort/timeout, fall through to serve-stale-immediately + background revalidate (the existing `catch` path already does this). This keeps synchronous freshness on a fast network (the common case the freshness decision targets) while removing the worst-case multi-second stall. Do NOT remove the synchronous HEAD entirely — that would regress the documented color-freshness behavior without sign-off.
  - After editing `public/sw.template.js`, regenerate `public/sw.js` via the prebuild stamp (`scripts/build-sw.ts`) and commit both (CLAUDE.md SW section). Keep `lib/sw-cache.ts` (the reference impl) and `__tests__/sw-template-contract.test.ts` in sync — if the contract test pins the HEAD logic shape, update it to reflect the bounded timeout.
- **Acceptance:** SW template + generated `sw.js` carry the bounded HEAD; `sw-template-contract.test.ts` passes (updated if needed); manual reasoning: fast network keeps freshness, slow/hung network serves stale within ~300 ms. Note in the commit body that the synchronous-freshness intent is preserved (bounded, not removed).

## Item 6 — AGG-R8-06: color-detection NCLX↔ICC precedence consistency (LOW · 1 agent · admin audit)

- **Source:** code-reviewer COR-1 + COR-2.
- **Where:**
  - COR-1: `apps/web/src/lib/color-detection.ts:370-374` — unconditionally overrides transfer/matrix to `'unknown'` when an NCLX `colr` box carries CICP code 2 ("unspecified"), clobbering an ICC-derived value.
  - COR-2: `color-detection.ts:371` (NCLX-wins) vs `apps/web/src/lib/process-image.ts:661-695 / 736-766` (ICC-name-wins) — opposite NCLX↔ICC precedence; a file with conflicting ICC-name + NCLX stores `color_primaries` disagreeing with `color_pipeline_decision`.
- **Why it matters:** admin-only audit columns contradict each other and CLAUDE.md's documented "NCLX > ICC chromaticity > ICC name" order. Delivered image bytes are unaffected.
- **Change:**
  1. COR-1: apply each NCLX field only when it maps to a KNOWN value — when CICP transfer/matrix code is 2 ("unspecified"), do NOT override the ICC-derived value with `'unknown'`; leave the lower-precedence signal in place.
  2. COR-2: have `resolveColorPipelineDecision` / `resolveAvifIccProfile` consult `signals.colorPrimaries` (the NCLX-derived value) FIRST so the resolver matches the documented precedence, making `color_primaries` and `color_pipeline_decision` agree on conflicting sources.
- **Acceptance:** unit fixture: a synthetic source with NCLX code-2 transfer + a valid ICC transfer → stored transfer is the ICC value, not `'unknown'`; a source with conflicting ICC-name + NCLX primaries → `color_primaries` and the decision agree per "NCLX first". Existing color-detection / decision-matrix tests stay green.

## Item 7 — AGG-R8-07/08/09: latent-bug hardening batch (LOW · multi-agent carries + 1 new)

- **Sources:** COR-3/VER-2/BUG-1 (load-more unmount, 3 agents); COR-4/BUG-2/PERF-3 (containIntrinsicSize divide, 3 agents); BUG-3 (backfill width re-validate, 1 agent).
- **Where + change:**
  1. **AGG-R8-07** `apps/web/src/components/load-more.tsx:36-88` — add an `isMountedRef` (set false in an effect cleanup) and guard the post-`await` setState block on it (in addition to the existing `queryVersionRef`). Symmetric with the settings-client unmount fix.
  2. **AGG-R8-08** `apps/web/src/components/home-client.tsx:278,280` — guard the `image.width` denominator: when `image.width <= 0`, fall back to a sane aspect (e.g. `1 / 1`) and skip the `containIntrinsicSize` divide (omit the property or use a fixed estimate) so no `"0 / 0"` / `Infinitypx` is emitted.
  3. **AGG-R8-09** `apps/web/src/lib/admin-backfill-runner.ts:402-462` — before calling `processImageFormats`, re-validate `row.width > 0 && row.height > 0` (mirror `process-image.ts:825-830`); a `width=0` legacy row should be recorded as a typed skip/error with a clear reason rather than an opaque `encode-failed`, OR detection re-run so it can recover. Keep it idempotent (no version bump on the failure).
- **Acceptance:** load-more no longer setState's after unmount (reason through it; optional transient test); home-client emits valid CSS for a 0-width fixture; backfill width-0 path yields a clear typed outcome (small unit assertion on the branch). These are hygiene/latent — keep changes minimal and behavior-preserving for the normal (width>0) path.

## Item 8 — AGG-R8-10: test-depth batch (LOW · 3 agents)

- **Sources:** test-engineer (TEST-1/TEST-3), code-reviewer (COR-5), tracer (TRC-1).
- **Change:**
  1. **Mixed backfill run** (TEST-3/COR-5): extend `__tests__/admin-backfill-runner-fatal-counters.test.ts` (harness exists) with a MIXED run where some rows succeed and some throw on the per-row UPDATE → assert `processed > 0 && errors > 0` simultaneously and that `processed` is the REAL success count (not the candidate snapshot). Locks the success/fatal counter partition for the realistic production shape.
  2. **Home-OG regression** (TEST-1): after Item 2 lands, add to `__tests__/home-metadata-title.test.ts` (or a new sibling) an assertion that `og:image` is NOT the base `filename_jpeg` URL and is the capped card (1200×630 / `/api/og`).
  3. **Migration index coverage** (TRC-1): extend `__tests__/migrate-reconcile-coverage.test.ts` to assert that every `CREATE INDEX <name>` (or `ADD INDEX`) in the journal SQL has a matching `ensureIndex('<name>')` (or equivalent idempotent guard) in `reconcileLegacySchema`, so an index-only/type-change/DROP migration whose author forgets `reconcileLegacySchema` fails the test instead of silently dropping on existing deploys. 0021's indexes ARE mirrored today, so the test is green at HEAD.
- **Acceptance:** all three tests added and green; each fails against a synthetic regression (mixed-run mis-attribution; base-JPEG og:image; an index missing from reconcile). Run `npm run typecheck` before committing.

## Item 9 — AGG-R8-11/12 + plan-330 Unit B: doc/comment honesty batch (LOW · single docs commit)

- **Sources:** document-specialist (DOC-1/DOC-2), architect (ARCH-1), plus the still-open plan-330 Unit B (AGG-19/AGG-20 code-comment honesty notes — never landed).
- **Change (one or two docs/comment commits; no behavior change):**
  1. **AGG-R8-11a** `AGENTS.md:36` — "Vitest 1300+ unit tests" → "2000+" (real ~2035) or drop the count.
  2. **AGG-R8-11b** `AGENTS.md:18` — replace the hardcoded deploy SSH key `~/.ssh/atik.pem` with a pointer to config-driven `.env.deploy` (matching CLAUDE.md + `.env.deploy.example`).
  3. **AGG-R8-12** `apps/web/src/lib/advisory-locks.ts:8-14` — add `gallerykit_color_pipeline_backfill` ("backfill runs") to the enumerated cross-tenant serialization blast-radius list (the constant is defined at `:43`; CLAUDE.md's mirror already includes it).
  4. **plan-330 Unit B** (carried, still open): add the two LOW honesty comments — `admin-backfill-runner.ts` `state.lastError` write site (last-writer-wins across workers at concurrency>1; counts stay correct, only the scalar message reflects the last writer) and `admin-backfill.ts` `triggerAdminBackfill` (benign count-then-handoff TOCTOU, self-healing on next status poll).
- **Acceptance:** all are doc/comment-only; gates unaffected. Verify the AGENTS.md count is plausible (re-run vitest count if convenient). Mark plan-330 Unit B DONE in plan-330's progress table.

---

## Deferred from this cycle (recorded in plan-334)

AGG-R8-13 (SEC-1 OG home sanitize hygiene — LOW, non-exploitable), AGG-R8-A1 (feed updated_at index — LOW perf, bounded+cached), AGG-R8-A2 (decode-once perf — LOW, scope/CPU-only), AGG-R8-A3 (single-pool/single-writer tradeoffs — record-only), AGG-R8-OWNED-1 (Stripe ACH — already plan-316). See plan-334 for severity-preserved entries + exit criteria. Note: SEC-1 is deferrable per CLAUDE.md only because it is non-exploitable hygiene, not a live vulnerability — it is SCHEDULED as a hardening item if the cycle has capacity (Item 10 below), else recorded.

## Item 10 (optional, capacity-permitting) — AGG-R8-13: shared `sanitizeForOg` for the home OG route (LOW security hygiene)

- **Source:** security-reviewer SEC-1.
- **Where:** `apps/web/src/app/api/og/route.tsx:77` — `siteTitle` (and `topicLabel`/tags) rendered without the `sanitizeForOg` wrap the per-photo sibling uses.
- **Change:** extract a shared `apps/web/src/lib/og-sanitize.ts` (`sanitizeForOg` using `stripUnicodeFormatting` + `OG_C0_CONTROL_CHARS`) and have BOTH OG routes import it (matches the repo's "derive, don't copy" discipline for `UNICODE_FORMAT_CHARS`). Pin with a fixture asserting both routes strip a bidi-laden `seo.title`.
- **Acceptance:** both OG routes share one sanitizer; fixture passes. If not done this cycle, recorded in plan-334 with exit criterion.

---

## Progress

| # | Finding | Severity | Commit | Status |
|---|---|---|---|---|
| 1 | AGG-R8-01 (cold-run test flake) | MED | 02af4f95 | DONE — memoized file reads (~43s→0.9s) + 60s explicit timeout; assertion unchanged |
| 2 | AGG-R8-02 (home-OG oversized card) | MED | 73496d2f | DONE — home og:image now /api/og/photo/{id} (1200x630, capped); regression test added |
| 3 | AGG-R8-03 (checkbox 44px + audit pattern) | MED | fbf91baa | DONE — both labels min-h-11 min-w-11; raw-checkbox FORBIDDEN scan + fixture test |
| 4 | AGG-R8-04 (active tag-chip contrast) | MED | ee0f38bd | DONE — active count inherits text-primary-foreground/90 (≥4.5:1 both themes) |
| 5 | AGG-R8-05 (SW HEAD bounded timeout) | MED | 9b7bb240 | DONE — AbortSignal.timeout(300ms); synchronous freshness bounded, not removed; sw.js regenerated |
| 6 | AGG-R8-06 (NCLX/ICC precedence ×2) | LOW | 74235265 | DONE — COR-1 NCLX code-2 no longer clobbers ICC values (test); COR-2 documented (not flipped) |
| 7 | AGG-R8-07/08/09 (latent-bug batch) | LOW | e8fce327 | DONE — load-more mountedRef; home-client 0-width guard; backfill width re-validate |
| 8 | AGG-R8-10 (test-depth ×3) | LOW | f3667858 (+73496d2f home-OG) | DONE — mixed backfill run; migration index-coverage tripwire; home-OG regression (Item 2) |
| 9 | AGG-R8-11/12 + plan-330 Unit B (doc/comment) | LOW | 007768c3 | DONE — AGENTS deploy creds + test count; advisory-lock backfill scope; lastError + TOCTOU notes |
| 10 | AGG-R8-13 (shared sanitizeForOg) | LOW | (this cycle) | DONE — extracted @/lib/og-sanitize; both OG routes import it; fixture test |

**All 10 items DONE.** No item deferred from plan-333 (Item 10 implemented rather than deferred).
