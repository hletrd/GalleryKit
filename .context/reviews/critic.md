# Critic — Deep Review (Run-8 Cycle-2)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `77867144` — working tree CLEAN, synced with origin/master.
**Angle:** multi-perspective whole-system critique. Invariant violations, code-vs-doc contradictions, half-applied fixes, asymmetric fixes, dishonest UX, missing test obligations, stale plan/doc tables.

**Mode:** THOROUGH (did NOT escalate to ADVERSARIAL — no CRITICAL and < 3 MAJOR; the prior cycle's work is high-quality and the change surface is clean).

**Gate baseline (re-verified LIVE this cycle, all green at HEAD):**
- `npm run lint` → **exit 0**
- `npm run typecheck` (app + scripts) → **exit 0**
- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → **all exit 0**
- `npx vitest run` (full suite) → **exit 0**; targeted re-run of the new a11y tests → 9/9 pass
- i18n key parity en↔ko → **837 = 837**, zero asymmetry

---

## Pre-commitment predictions (made before detailed investigation)

1. A half-applied fix landed in one place but not the symmetric place (the recurring run-6/run-7 theme). → **Investigated all 12 prior findings; none remain half-applied. The pool-formula fix is now consistent across all 3 sites + CLAUDE.md.**
2. CLAUDE.md count/attribution claims drifted again after 10d77324. → **Re-verified all 4 sub-items against code; all correct now.**
3. The new regression tests (d035de10) assert the wrong thing. → **Both tests are correct and genuinely fail the reverted shape.**
4. The home-OG base-JPEG fix (4852bcf5) introduced its own correctness issue. → **CONFIRMED — see CRT-1. The fix traded a transient 404 for a permanent oversized-social-card regression and broke consistency with 4 sibling OG paths.**
5. The pool-formula recalculation has a remaining stale site. → **No — all sites consistent.**

Net: 4 of 5 predictions found the prior cycle did clean work; prediction 4 surfaced the one genuinely-NEW finding.

---

## Prior findings VERIFIED CLOSED at HEAD (run-7 cycle-1 → all 12 open + 1 partial)

All run-7 findings (AGG-R7-01 … AGG-R7-13) are either landed with a verified commit or deferred with a concrete, severity-preserved exit criterion. Each was independently re-verified against HEAD this cycle — not taken on the plan's word:

| Finding | Commit | Verification at HEAD |
|---|---|---|
| AGG-R7-01 (stale pool formula x3 sites) | `0d17a362` | `admin-backfill-runner.ts` header docblock (28-40), function-body docblock (96-128), `db/index.ts:13-22` comment, AND `CLAUDE.md:291` ALL state cap=2 / RESERVED=max(3,ceil(LIMIT/2)). No stale `(LIMIT-2)/2`/`=4` site remains. Arithmetic internally consistent (10-5-1)/2=2, holds 1+2x2=5, leaves 5. **CLOSED.** |
| AGG-R7-02 (setTimeout unmount leak) | `f11746cd` | `settings-client.tsx:83` timer-id ref + `:122-131` dedicated empty-deps unmount effect clearing all timers + `:87/96` `backfillMountedRef` gating the already-fired-promise setState. Both halves landed. **CLOSED.** |
| AGG-R7-03 (error-shell visible heading) | `0d2312cd` | Both `error.tsx` twins render a visible `<h1 className="text-3xl font-semibold">` carrying `t('error.title')`; `aria-labelledby` resolves; no faint `/30` glyph survives. Consistent across both shells. **CLOSED.** |
| AGG-R7-04 (remaining aria-describedby) | `61cfd235` | 18 `aria-describedby` refs, each resolving to exactly one `id="...-help"` (16 unique; `license-price-help` shared by 3 inputs as designed). Zero dangling refs, zero dup ids. **CLOSED.** |
| AGG-R7-05 (AGG-9/AGG-10 regression tests) | `d035de10` | `error-shell-heading.test.ts` (source-fixture, fails the AGG-9 sr-only/`/30` shape) + `home-metadata-title.test.ts` (pins `title:{absolute}` in both branches + filtered). 9/9 pass. **CLOSED.** |
| AGG-R7-06 (401/403 deferral-note correction) | `57f17229` | `plan-330` lines 66-72 carry a precise `[CORRECTION run-7]` note: wrong-scope=**401** (`api-auth.ts:85`, pinned by `api-auth-response-headers.test.ts:103`), cross-origin=**403** (`:95`, residual LOW, plan-332 deferred #6). No contradictory 403-for-wrong-scope test was written. **CLOSED (correctly deferred residual).** |
| AGG-R7-07 (dropzone disabled affordance) | `35d07f0b` | `upload-dropzone.tsx:413` conditional `tabIndex={-1}` (spread AFTER `getRootProps()` so it wins) + `:416` conditional `cursor-pointer`. `aria-disabled` retained. **CLOSED.** |
| AGG-R7-08 (doc-drift batch x4) | `10d77324` | (a) `COLOR_IMPACTING_KEYS`=9 in `settings-hash.ts:37-49` and CLAUDE.md:260 with line ref; (b) Sharp clone() wording corrected (CLAUDE.md:216 now matches WI-14 reality + `process-image.ts` line ref); (c) `IMAGE_PIPELINE_VERSION` attributed to `gallery-config-shared.ts:21`; (d) both backfill env vars documented (CLAUDE.md:291-292). **CLOSED.** |
| AGG-R7-09 (home-OG on-disk fallback) | `4852bcf5` | The 404 IS fixed (base JPEG always exists). **BUT the fix introduced a new regression — see CRT-1.** |
| AGG-R7-10 / -11 / -12 (load-more unmount / test depth / containIntrinsicSize) | deferred | plan-332 deferred #2/#3/#4 — original severity preserved (LOW), concrete next-edit exit criteria. Re-confirmed sound. |
| AGG-R7-13 (Stripe async_payment_succeeded) | deferred | plan-332 deferred #7 — already-owned by plan-316, CLAUDE.md-documented. Re-confirmed deferred. |
| Plan hygiene (stale 329/330 tables AGG-8/10/13/16/18) | `57f17229` | `[CORRECTION run-7: verified DONE at HEAD]` annotations added in-place to plan-329 (line 55) and plan-330 (lines 58, 80). **CLOSED.** |

The run-7 cycle was honest and thorough: every landed fix carries its symmetric counterpart and (where a regression risk existed) a regression test. This is materially better discipline than the run-6 cycle the prior aggregate criticized.

---

## OPEN / NEW findings

### CRT-1 — Home-page `og:image` now points at the full-resolution base JPEG (multi-MB), silently breaking the social card on Twitter/LinkedIn for default-config galleries; also inconsistent with all 4 sibling OG paths

**Severity:** MED (lower bound LOW for small-`image_sizes` galleries; see Realist Check) · **Confidence:** HIGH (facts) / MEDIUM (real-world severity) · **Class:** regression introduced by the AGG-R7-09 fix (`4852bcf5`)

**Where:**
- `apps/web/src/app/[locale]/(public)/page.tsx:109-115` — the home `generateMetadata` latest-photo branch:
  - `url: absoluteImageUrl(`/uploads/jpeg/${latestImage.filename_jpeg}`, seo.url)`
  - `width: latestImage.width, height: latestImage.height`
- `filename_jpeg` is the BASE filename = `sortedSizes[sortedSizes.length - 1]` = the **LARGEST** configured size (`process-image.ts:1196-1206`). Default largest = **7680 px** (`DEFAULT_IMAGE_SIZES`, CLAUDE.md), default JPEG quality = **90** (`gallery-config-shared.ts:99`).

**Why it matters / failure scenario:**
- A 7680x5120 quality-90 JPEG of a detailed photo is routinely **6-12 MB**. Social-card scrapers enforce byte limits: **Twitter/X rejects images > 5 MB** (card renders with NO image), LinkedIn ~5 MB practical, Facebook downsamples but can skip very large ones. So sharing the home URL yields a broken/image-less social preview on the highest-SEO surface, **permanently**, for any gallery on the DEFAULT `image_sizes`.
- This is the OPPOSITE extreme from what the codebase already decided is correct. The per-photo OG route's own helper documents the rule explicitly (`og-photo-fetch.ts:11-14, 31`): "The OG canvas is 1200x630. Any derivative >= 1024 px is sufficient. Iterating sizes ASCENDING biases toward smaller files that comfortably fit under the 1 MB byte cap" — `OG_PHOTO_MAX_BYTES = 1 MB`.
- **Inconsistency with every sibling OG path** (the strongest signal this is a mistake, not a deliberate tradeoff):
  - `p/[id]/page.tsx:96-101` → `/api/og/photo/${id}` (Satori, **1200x630**, <=1 MB embedded, ascending-picked, degrades to site-default on backfill miss).
  - `[topic]/page.tsx:87-89` → `/api/og?...` (Satori, **1200x630**).
  - `c/[slug]/page.tsx:50` → admin site OG image at **1200x630** (or none).
  - The home page is the ONLY one pointing `og:image` at a raw multi-MB derivative at full source resolution.
- The fix's stated rationale ("a SIZED derivative does not guarantee it exists on disk") is **over-stated** — `og-photo-fetch.ts` proves sized derivatives DO reliably exist for `processed = true` photos (it iterates them); the only gap is the transient backfill/reconfigure window, which the per-photo route bridges by ascending-iterate-then-fall-back-to-site-default. The home fix solved a TRANSIENT 404 by creating a PERMANENT oversized-card problem.

**Note (NOT a bug):** the JSON-LD `contentUrl`/`thumbnailUrl` correctly use the base JPEG (`p/[id]/page.tsx:198,206`, `[topic]/page.tsx:194,198`) — JSON-LD `contentUrl` is the canonical full-resolution image, so large is correct THERE. The distinction the fix missed is that `og:image` is a social-card EMBED (must be small + ~1200x630), not the canonical image.

**Fix (pick one, in preference order):**
1. **Match the topic pattern** — render the home card via the existing `/api/og` Satori route (1200x630, byte-capped). Most consistent, fixes both 404 and byte-size, declares correct dimensions.
2. **Use a mid-sized derivative** — point at a ~1536/2048-px sized derivative (`absoluteImageUrl(sizedImageFilename(latestImage.filename_jpeg, 2048, config.imageSizes), seo.url)`), declaring `width/height` for that size. Still ~always-present for processed photos; far under scraper limits. (Re-introduces the `getGalleryConfig`/`sizedImageFilename` the fix removed — acceptable.)
3. **Minimal:** keep the base JPEG URL but clamp the declared `width`/`height` to a sane card aspect AND document the byte-size caveat inline. (Weakest — does not fix the actual byte payload the scraper fetches.)

**Realist Check (applied):** Worst realistic case = image-less social card on Twitter/LinkedIn for default-config galleries; title+description still render, so the share is degraded, not broken; no crash, no data loss. Silently detected (no log; operator notices only on a manual share test). For galleries that reduce `image_sizes` to <= ~2048 px, the base JPEG is < 1 MB and the card works — hence the LOW lower bound. Net: kept at **MED** because (a) it regresses the DEFAULT configuration's highest-SEO surface, (b) it is silently undetected, and (c) it is trivially avoidable by matching any sibling path. Mitigated-down to not-HIGH by: title/description still present, no functional breakage, and config-dependent blast radius.

---

## What's Missing (gaps — none rise to a standalone scored finding)

- **No regression test pins the home-OG image SIZE/shape.** `home-metadata-title.test.ts` covers only `title:{absolute}`; its fixture uses `width: 1200` (a benign small case) so it would not catch CRT-1. If CRT-1 is fixed, the fix should be pinned (assert the home `og:image` URL is a Satori route OR a sized derivative, NOT the bare `filename_jpeg` base) so a future revert to the base can't ship silently. (This mirrors exactly the AGG-R7-05 test-obligation logic the prior cycle applied to AGG-9/AGG-10.)
- **`home-metadata-title.test.ts:75` mocks `getGalleryConfig`** which the metadata function no longer calls post-`4852bcf5`. Harmless dead mock, slightly misleading. Trivial; fold into the CRT-1 test update if touched.

## Multi-Perspective Notes

- **Executor:** every landed fix is followable from its commit + inline comment; the pool-formula single-source-of-truth pointer ("see resolveBackfillConcurrency") is good practice. No executor would get stuck on the closed items.
- **Stakeholder (photographer):** CRT-1 directly undermines the "share my gallery" surface — the home page is what a photographer pastes into social/chat. An image-less preview on the default config is a real (if cosmetic) product regression on the highest-traffic share target.
- **Skeptic:** I tried to find a half-applied or asymmetric fix among the 12 closed items (the prior-cycle failure mode) and could not — the pool formula, both error twins, all aria-describedby refs, and both sanitizer sites are symmetric. The one thing the cycle got wrong is CRT-1, and it got it wrong by NOT looking at the 4 sibling OG paths it was inconsistent with — a cross-surface-consistency gap, not a half-applied fix.

## Verified-clean (stress-tested this cycle, NO action)

- **SW version stamp lag** (`sw.js` = `61607572-p7`, HEAD = `77867144`): inherent stamp-then-commit lag (you cannot embed your own future SHA). The `prebuild` hook re-stamps on every production build, the committed value only needs to DIFFER from the prior deploy's (it does), and `-p7` matches `IMAGE_PIPELINE_VERSION = 7`. NOT a defect.
- **Privacy guard intact:** home OG `latestImage` comes from `getImagesLite` (public select — no `filename_original`/`user_filename`/GPS); the OG `alt` guards filename-as-title leak via `isLatestTitleFilename` and falls back to `t('latestPhoto')`. `images.title` is bidi/zero-width-rejected at the write layer (`validation.ts`), and the OG `alt` is an escaped HTML attribute, so the missing `sanitizeForOg` on the home `alt` (unlike the per-photo route) is not exploitable. No finding.
- **Dropzone `tabIndex` ordering** (`upload-dropzone.tsx:409` spreads `getRootProps()` then `:413` conditionally overrides `tabIndex`): correct precedence; relies on documented + verified react-dropzone disabled behavior; belt-and-braces `aria-disabled` retained. Solid.
- **i18n parity** 837=837, no orphan keys.

## Verdict

**ACCEPT-WITH-RESERVATIONS.** The run-7 cycle closed all 12 open + 1 partial findings with verified, symmetric, test-backed fixes and honest severity-preserved deferrals — materially clean work. The single reservation is **CRT-1** (MED): the AGG-R7-09 home-OG fix corrected a transient 404 by introducing a permanent oversized-social-card regression that is also inconsistent with all 4 sibling OG paths. It is config-dependent (MED for the default 7680-px largest size, LOW for small `image_sizes`), silently detected, and trivially avoidable by matching any sibling path. Schedule CRT-1 (with a pinning test) next cycle; nothing here blocks the current state.

## Open Questions (unscored)

- Does any production gallery currently run the default 7680-px largest size? If `image_sizes` is reduced in practice, CRT-1's blast radius is LOW and it can be batched with other LOW work; if the default ships, treat the MED rating as live. (Cannot determine from the repo — depends on the operator's admin settings.)
