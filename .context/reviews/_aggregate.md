# Aggregate Deep Review — Run-8 Cycle 2 (review-plan-fix)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6 photo gallery)
**Cycle:** orchestrator "cycle 2/100" of this run (internally run-8). Working tree CLEAN at start; HEAD `77867144` in sync with origin/master.
**Agents that returned (11/11):** code-reviewer, security-reviewer, perf-reviewer (architect-perf lane), critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer. **No agent failures.**

**Gate baseline measured live this cycle (verifier ran every gate; multiple agents re-ran independently):**
- `npm run lint` → **exit 0** (clean)
- `npm run typecheck` (app + scripts) → **exit 0**
- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → **all exit 0**
- `npx vitest run` → **cold run: 1 failed / 2034 passed** (the `client-server-only-boundary.test.ts` 15 s timeout); **warm rerun: 2035/2035 pass.** The failure is a cache-warmth flake, not a logic regression — but it is RED on a cold/contended CI runner and is this cycle's only blocking-class item (see AGG-R8-01).

> The previous run-7 cycle-1 aggregate has been superseded by this file. Per-agent files were overwritten by this cycle's fan-out (security-reviewer + perf-reviewer could not write — Write disabled for those read-only agents; their full reviews are captured in the orchestrator transcript and summarized here).

---

## TOP-LEVEL FINDING: the prior run-7 fix batch landed clean and honest

**Independently re-verified by every agent against HEAD (not on the plan's word):** all run-7 actionable findings (AGG-R7-01 through AGG-R7-09, plus AGG-10/11/12/13) are either CLOSED with a verified, symmetric, test-backed commit, or correctly deferred with a severity-preserved exit criterion. This is high-signal cross-agent agreement (code-reviewer, critic, verifier, tracer, designer, document-specialist, architect, debugger all converged on "closed").

| Prior finding | Status at HEAD | Closing commit | Verified by |
|---|---|---|---|
| AGG-R7-01 stale pool formula ×3 sites | **CLOSED** — runner header+body, `db/index.ts:16-22`, CLAUDE.md all agree (`cap=max(1,floor((LIMIT−RESERVED−1)/2))`, `RESERVED=max(3,ceil(LIMIT/2))`) | 10d77324 / 0d17a362 | critic, verifier, architect, perf, document-specialist |
| AGG-R7-02 backfill setTimeout leak | **CLOSED** — `backfillMountedRef` gates setState + unmount effect clears tracked `backfillPollTimers` | f11746cd | debugger (line-by-line), critic, verifier |
| AGG-R7-03 error-shell visible heading | **CLOSED** — both shells render a visible `text-3xl <h1>` | 0d2312cd | designer, critic, verifier |
| AGG-R7-04 settings aria-describedby remainder | **CLOSED** — 8→18 wired, every ref resolves, no dups | 61cfd235 | designer, critic, verifier |
| AGG-R7-05 AGG-9/AGG-10 regression tests | **CLOSED** — `error-shell-heading.test.ts` + `home-metadata-title.test.ts` pin the correct invariant | d035de10 / 61607572 | test-engineer, critic, verifier |
| AGG-R7-06 401/403 deferral note | **CLOSED** — note corrected | (run-7) | critic |
| AGG-R7-07 dropzone aria-disabled | **CLOSED** — handlers removed + `tabIndex=-1` when disabled | 35d07f0b | designer, code-reviewer, critic |
| AGG-R7-08 doc-drift batch (a–d) | **CLOSED** — COLOR_IMPACTING_KEYS=9, fresh-`sharp()` wording, IMAGE_PIPELINE_VERSION location, backfill env vars all correct | 10d77324 | document-specialist (each sub-item), critic |
| AGG-R7-09 home-OG fallback | **ADDRESSED but over-corrected** → see AGG-R8-02 (CRT-1) | 4852bcf5 | critic, verifier, test-engineer |
| AGG-1 backfill honesty | **CLOSED (verified)** — real processed/errors mirrored, lastError on fatal+encode-fail | 13ae79ca | tracer, debugger, verifier |
| AGG-3/AGG-4 Unicode strip | **CLOSED (verified)** — both halves + both `sanitizeForOg` use `/g` strip | (run-5/170297ed) | security-reviewer, tracer |
| AGG-6/AGG-7 test obligations | **CLOSED (verified)** — status-shape + fatal-counters + migration-monotonicity tests pass | 13ae79ca / bb463062 | test-engineer, verifier |

**Consequence for PROMPT 2:** there is NO stale-plan-table problem this cycle (unlike run-7). The plan-328/329/330 tables already reflect DONE. Schedule only the genuinely-open findings below.

---

## Cross-agent convergence map — GENUINELY OPEN this cycle (highest signal first)

| Agg ID | Finding | Severity (max) | Conf | Agents | Status |
|---|---|---|---|---|---|
| **AGG-R8-01** | **`client-server-only-boundary.test.ts` is a cold-run timeout flake → RED in CI AND blind.** A synchronous full-`src` import-graph walk (~440 files) runs ~6.5 s warm but 25–43 s cold, exceeding the default 15 s `testTimeout` (no explicit per-test override). Worse: a REAL client→server-only leak would also time out — identical red, so the gate cannot distinguish a flake from a genuine violation. Fix: add an explicit generous `testTimeout` to this test AND memoize the per-file read/closure traversal so it runs in single-digit seconds cold. | **MED** (test-infra; RED-in-CI class) | High (verifier saw cold-fail + warm-pass; test-engineer saw 42.7 s isolated) | **3** (VER-1, TEST-0, perf-noted) | NEW — top priority |
| **AGG-R8-02** | **Home `og:image` points at the BASE JPEG (largest configured size, default 7680 px @ q90 ≈ 6–12 MB).** The AGG-R7-09 fix (commit 4852bcf5) swapped a transient 404 for a permanent oversized social card: Twitter/X reject >5 MB (card renders image-less), LinkedIn similar. ALL 4 sibling OG paths (`p/[id]`, `[topic]`, `c/[slug]`, per-photo route) use a proper 1200×630 / ≤1 MB card. The home page is the sole outlier. Right fix: emit the existing `/api/og` Satori route URL (1200×630, on-disk fallback via `pickFirstAvailablePhotoBuffer`) as the home `og:image`, OR a mid-sized (~2048 px) derivative — NOT the base. | **MED** (UX/SEO; config-dependent — MED on default `image_sizes`, LOW if admin reduced ≤2048 px) | High (facts) / Med (severity) | **2** (CRT-1, TEST-1) | NEW — regression introduced by AGG-R7-09 |
| **AGG-R8-03** | **`image-manager.tsx:418,444` select-all + per-row checkboxes have a 32×32 px tap target** (`min-h-8 min-w-8` label wrapping a 20 px `<input type=checkbox>`), below the repo's documented 44 px floor (WCAG 2.5.5 AAA, CLAUDE.md Touch-Target policy). **The blocking `touch-target-audit.test.ts` FORBIDDEN regex scans `<Button>/<button>/<Badge>/<select>` but NEVER raw `<input type="checkbox">`** — a structural enforcement blind spot that let this slip every prior cycle. Fix: bump both labels to `min-h-11 min-w-11` AND add a raw-checkbox FORBIDDEN pattern to the audit so the floor is actually enforced. | **MED** (a11y; violates policy AND defeats the enforcement test) | High (static) | 1 (DES-1) | NEW |
| **AGG-R8-04** | **`tag-filter.tsx:95` active-chip photo-count fails contrast on the PUBLIC home page.** The `({n})` `<span class="text-xs text-muted-foreground">` over the selected chip's `bg-primary` computes **2.94:1 (light) / 2.45:1 (dark)** — fails WCAG 1.4.3 4.5:1 small-text. Inactive chips pass (6.03:1); failure is exclusive to the selected/active state. Fix: drop the explicit `text-muted-foreground` so the count inherits the chip's `text-primary-foreground` when active (and stays muted when inactive). | **MED** (a11y, WCAG 1.4.3; only public-surface contrast failure) | High (computed) | 1 (DES-2) | NEW |
| **AGG-R8-05** | **PERF: the image SW awaits a HEAD round-trip per cached image BEFORE serving cached bytes.** `sw.template.js:207-230` `staleWhileRevalidateImage` does `await fetch(url,{method:HEAD,If-None-Match})` before `return cached` whenever the entry has an ETag. A warm-cache masonry paint (~30 tiles) pays one network HEAD RTT per tile before painting bytes already in CacheStorage; a slow/hung network stalls up to the fetch timeout before falling through to stale-serve. **TENSION:** this was a DELIBERATE freshness choice (R11-M1/R4C9 comment: serve fresh colors immediately after an admin color-setting change). Flipping to background-only reintroduces a one-paint color-staleness window the code warns about. Safer middle ground: bound the HEAD with `AbortSignal.timeout(~300 ms)` and serve stale on abort (keeps fast-network freshness, removes the worst-case stall). | **MED** (perf/INP-LCP on the offline-resilient surface) | High | 1 (PERF-1) | NEW — but contradicts a documented prior decision; needs weighing |
| **AGG-R8-06** | **Color-detection NCLX↔ICC precedence is internally inconsistent (admin-only audit columns).** (a) COR-1: `color-detection.ts:370-374` unconditionally overrides transfer/matrix to `'unknown'` when an NCLX `colr` box carries CICP code **2 ("unspecified")**, clobbering an ICC-derived value. (b) COR-2: `color-detection.ts:371` makes NCLX win, while `process-image.ts:661-695/736-766` makes the ICC NAME win — opposite precedence, so a file with conflicting ICC-name + NCLX stores a `color_primaries` that disagrees with `color_pipeline_decision`. Delivered image bytes stay correct; only the admin audit columns contradict each other and CLAUDE.md's documented "NCLX > ICC chromaticity > ICC name" order. Fix: skip NCLX fields that map to code 2/unknown; have the resolvers consult `signals.colorPrimaries` first. | **LOW** (admin-only audit accuracy; no delivered-byte impact) | High | 1 (code-reviewer) | NEW |
| **AGG-R8-07** | **`load-more.tsx:36-88` setState-after-unmount.** An in-flight `loadMoreImages()` resolving post-unmount still runs the setState block; `queryVersionRef` guards a stale query KEY but not unmount. React silently no-ops it (dev-warning/hygiene only). Fix: `isMountedRef`/`AbortController`, symmetric with the settings-client fix. | **LOW** (hygiene) | High | **3** (COR-3, VER-2, BUG-1) | CARRY (= AGG-R7-10), still open |
| **AGG-R8-08** | **`home-client.tsx:280` `containIntrinsicSize` divides by `image.width`** → `Infinitypx` (and `aspectRatio:"0 / 0"` at `:278`) for a 0-width row → lost CLS reservation for that card. `estimatedCardWidth` was hardened but the bare `/ image.width` denominator was not. Near-impossible given NOT NULL Sharp metadata. Fix: `width>0` fallback. | **LOW** (latent/theoretical) | High (theoretical) | **3** (COR-4, BUG-2, PERF-3) | CARRY (= AGG-R7-12), still open |
| **AGG-R8-09** | **Backfill forwards `row.width` into `processImageFormats` with no `>0` re-validation** (unlike the upload path `process-image.ts:825-830`). A legacy/corrupt `width=0` row makes Sharp `.resize({width:0})` throw → counted as generic `encode-failed`, no version bump, silently never backfills. No crash/corruption — observability edge under a near-impossible precondition. `admin-backfill-runner.ts:402-462`. | **LOW** (observability; near-impossible precondition) | Med | 1 (BUG-3) | NEW (latent) |
| **AGG-R8-10** | **TEST depth gaps:** (a) TEST-1/TEST-3: no MIXED backfill run test (`processed>0 && errors>0` in one run) to lock the success/fatal counter partition (harness already exists); (b) AGG-R8-02 home-OG fix has no regression test (`home-metadata-title.test.ts` checks only `meta.title`, never `og:image`); (c) TRC-1: migration coverage test asserts column-NAME + `CREATE TABLE` but NOT `CREATE INDEX <name>` ↔ `ensureIndex` — an index-only/type-change/DROP migration whose author forgets `reconcileLegacySchema` is silently dropped on existing deploys (latent; 0021's indexes ARE mirrored today). | **LOW** (test depth) | Med/High | **3** (test-engineer, code-reviewer, tracer) | NEW |
| **AGG-R8-11** | **Doc drift (AGENTS.md):** (a) DOC-1: `AGENTS.md:36` says "Vitest 1300+ unit tests"; real suite ~2035 (~35% understated). (b) DOC-2: `AGENTS.md:18` hardcodes deploy SSH key `~/.ssh/atik.pem` while CLAUDE.md + `.env.deploy.example` keep deploy creds config-driven via `.env.deploy`. | **LOW** (doc) | High | 1 (document-specialist) | NEW |
| **AGG-R8-12** | **ARCH-1: `advisory-locks.ts:8-14` cross-tenant docblock omits `gallerykit_color_pipeline_backfill`** from its enumerated serialization blast-radius list ("restores, upload-contract changes, topic renames, admin-user deletes, image-processing claims") even though the constant is defined in the same file at `:43` and CLAUDE.md's mirror DOES include "backfill runs". A co-location operator reading the in-code note would under-scope the cross-tenant coupling. One-line doc fix. | **LOW** (doc/maintainability) | High | 1 (architect) | NEW |
| **AGG-R8-13** | **SEC-1: `/api/og/route.tsx:77` (home OG) omits `sanitizeForOg` on `siteTitle`** while the per-photo sibling wraps the equivalent value. NOT exploitable today (admin-controlled + `containsUnicodeFormatting`-rejected at write, and Satori renders text nodes in an image — no script sink). Pure defense-in-depth symmetry gap; a future loosened SEO validator would let bidi/C0 chars render in the home card. Fix: wrap `siteTitle`/`topicLabel`/tags in `sanitizeForOg`; ideally extract a shared `lib/og-sanitize.ts`. | **LOW** (security hygiene; non-exploitable) | Low | 1 (security-reviewer) | NEW |

### Perf/architecture observations — record-only (re-confirmed unchanged, NOT defects)

| Agg ID | Finding | Severity | Disposition |
|---|---|---|---|
| **AGG-R8-A1** | PERF-2: Atom feed `getImagesForFeed` (`data.ts:771-794`) orders by `updated_at DESC` with no covering index (`images` indexes lead with capture_date/created_at) → filesort per origin miss. Bounded by `FEED_LIMIT=50` + route `Cache-Control: max-age=600, s-maxage=1800`; no shipped CDN. | LOW (perf) | DEFER/record — add `(processed,updated_at,created_at,id)` index OR document accepted cost. Low traffic + cached. |
| **AGG-R8-A2** | A2/PERF-03 decode-once-per-format (`process-image.ts:1052-1097` fresh `sharp()` per format×size, ~18 decodes/image) — `lastRendered` hard-link dedup partially mitigates. | LOW (perf) | DEFER — scope/CPU-only, **SAFE** (architect refutes "unsafe"); background-queue, concurrency-1 default. |
| **AGG-R8-A3** | A1/A3/A4 inherent single-pool / single-writer tradeoffs (pool reserve protects one getImage fan-out; getImage 3 concurrent scans under revalidate=0; backfill PQueue + live queue share libvips). | MED | RECORD — deliberate single-writer topology, documented in CLAUDE.md. Not defects. |

---

## VERIFIED-CLEAN (explicitly stress-tested this cycle, NO action)

- **All 19 gates green on a warm run** (lint, typecheck app+scripts, 3 security lint gates, full vitest 2035/2035). i18n key parity 837=837.
- **Security (security-reviewer + tracer, hand-verified at HEAD):** EXIF Unicode strip both halves; `sanitizeForOg` global strip both per-photo sites; session/cookie crypto (length pre-check + `timingSafeEqual` + shape-assert-after-crypto, no oracle); smart-collections deserialization allowlist; JSON-LD `</script>` escaping (all 8 sites via `safeJsonLd`); path-traversal/symlink containment on all 3 fs routes (startsWith + lstat + realpath, streams from opened handle); byte-level GPS strip (no Sharp `withMetadata()`); all 3 lint-gate invariants; login dual-bucket pre-increment TOCTOU + constant-time dummy hash + session-fixation transaction; `getClientIp` TRUST_PROXY-gated XFF; ReDoS (all fixed-count quantifiers); SSRF/open-redirect (same-origin + `\`-backslash-bypass closed); download single-use atomic CAS; PII compile-time guards (`_privacyGuard`/`_mapPrivacyGuard`).
- **npm audit:** 3 HIGH (esbuild via drizzle-kit/tsx) + 2 MODERATE (postcss via next) — ALL build/dev-time only, absent from prod runtime container. INFO only, unchanged.
- **resolveBackfillConcurrency arithmetic** (debugger + architect + tracer, machine-verified): robust for all pathological inputs; the CODE is correct (comments now also correct post-AGG-R7-01).
- **Backfill honesty** (tracer, 25 tests): 1:1 outcome→counter mapping; detection-fail never bumps version (mutually-exclusive UPDATE branches); fatal-catch populates `lastError`.
- **Color/HDR privacy + ETag** (tracer): triple-layer admin-only enforcement; `color_primaries` correctly public; ETag invalidation honest on both serve-upload (9-key hash) + static (mtime+size) paths.
- **All 4 ISOBMFF/ICC parsers** (debugger): `parseCicpFromHeif`, `extractIccProfileName`, `detectGamutFromIccChromaticity`, `hasGainMap` — depth/scan-capped, bounds-checked, NaN/÷0-guarded, degrade to "unknown/typed-error" on adversarial input.
- **`@/lib/storage` abstraction** (architect): import-dead outside its own test — not leaking; accurately self-documented as unwired.
- **No new second writer** (architect): `view_count`, `pipeline_version`, the Lightroom upload route all have exactly the documented writer set.
- **Designer fundamentals** (designer): masonry `columns-N` safelisted; back-to-top aria-hidden triad; focus-trapped lightbox; reduced-motion + forced-colors; the prior-closed DES-01/02/03 fixes hold.

---

## ALREADY-OWNED / pre-acknowledged (recorded, not newly actionable)

### AGG-R8-OWNED-1 — Stripe `async_payment_succeeded` never writes an entitlement (HIGH/High · confirmed, = AGG-R7-13)
- **Where:** `api/stripe/webhook/route.ts:88,105` handles only `checkout.session.completed` + `payment_status==='paid'`; `api/download/[imageId]/route.ts:166` returns 404 forever for ACH/bank-transfer settled payments.
- **Agents:** security-reviewer, tracer — re-confirmed correct security posture (mints NO false entitlement for unpaid funds).
- **Disposition:** **ALREADY-OWNED by plan-316 CRT-R5C1-04**, explicitly documented in CLAUDE.md (`entitlements` note scopes support to card/immediate-payment until plan-316 ships). Per the deferred-fix rule, security/correctness findings may be deferred when the repo's own rules explicitly allow — CLAUDE.md does. No data loss (funds settle in Stripe; entitlement row recoverable manually). Interim mitigation: disable async payment methods in Stripe Checkout. **Re-confirmed deferred to plan-316; NOT re-owned this cycle.** Exit criterion unchanged: plan-316 picked up, OR a real settled-but-undownloadable ACH purchase reported → escalate.

---

## AGENT FAILURES

None. All 11 spawned review agents returned successfully on the first attempt. (security-reviewer + perf-reviewer are read-only agents whose Write tool is disabled; their per-agent `.md` files were not written by them — their complete reviews are preserved in the orchestrator transcript and fully summarized in this aggregate. document-specialist wrote its file via Bash heredoc; all other agents wrote directly.)

---

## Summary for PROMPT 2 (planning)

**Genuinely actionable this cycle (13 open):**
- **MED (5):** AGG-R8-01 (cold-run test flake — top priority, RED-class), AGG-R8-02 (home-OG oversized social card), AGG-R8-03 (checkbox 32px + audit blind spot), AGG-R8-04 (active tag-chip contrast 2.94:1 on public page), AGG-R8-05 (SW HEAD-on-display-path — weigh against the documented freshness decision; prefer bounded-timeout over full background flip).
- **LOW (8):** AGG-R8-06 (NCLX/ICC precedence ×2, admin audit), AGG-R8-07 (load-more unmount), AGG-R8-08 (containIntrinsicSize divide), AGG-R8-09 (backfill width re-validate), AGG-R8-10 (test depth ×3: mixed backfill run, home-OG regression, migration index-coverage), AGG-R8-11 (AGENTS.md doc drift ×2), AGG-R8-12 (advisory-lock docblock), AGG-R8-13 (OG home sanitize hygiene).

**Deferrable (record-only, with justification):** AGG-R8-A1 (feed updated_at index — bounded+cached), AGG-R8-A2 (decode-once perf — scope/CPU-only, safe), AGG-R8-A3 (inherent single-pool/single-writer tradeoffs), AGG-R8-OWNED-1 (Stripe ACH — already plan-316).

**No plan-table hygiene needed** this cycle — the run-7 fixes are honestly reflected as DONE in plan-328/329/330.

**Cross-agent agreement (highest signal):** AGG-R8-07 (3 agents), AGG-R8-08 (3 agents), AGG-R8-01 (3 agents), AGG-R8-10 (3 agents) — these duplicates raise confidence. The 5 MED items are the cycle's substantive work; the LOW items are cheap hygiene/test-lock fixes.
