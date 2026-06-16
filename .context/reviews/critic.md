# Critic — Deep Multi-Perspective Critique (Cycle 2)

**Repo:** GalleryKit @ `8ccc8806` · **Date:** 2026-06-16 · **Mode:** Started THOROUGH, escalated to ADVERSARIAL after the async-payment money path + multiple MEDIUM systemic findings surfaced.

**Scope:** Whole-system holistic audit — correctness, security, durability, a11y, doc/code drift, test-suite quality, deferred-finding hygiene. CLIP feature reviewed **code-only** (not activated, per directive).

**Method note (why this review is worth reading):** I ran 7 deep sub-investigations and then **personally re-verified every CRITICAL/HIGH claim against source**. That verification pass **refuted 5 would-be findings** that a rubber-stamp review would have shipped (see "Refuted Findings" at the end). The surviving findings below are the ones that withstood adversarial re-checking. This is a mature codebase with unusually disciplined invariant-enforcement; the genuine issues are systemic/operational, not happy-path bugs.

---

## Severity Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 2 | CRT-01, CRT-02 |
| MEDIUM | 5 | CRT-03, CRT-04, CRT-05, CRT-06, CRT-07 |
| LOW | 4 | CRT-08, CRT-09, CRT-10, CRT-11 |
| DOC/CODE DRIFT | 3 | CRT-D1, CRT-D2, CRT-D3 |

No CRITICAL findings. The system has no happy-path-breaking defect I could find. The HIGH findings are a known-but-live customer-money gap and an unbounded anonymous-write surface; the rest are durability/operational design smells and weak (indirectly-enforced) invariants that will bite a future refactor.

---

## HIGH

### CRT-01 — Async-payment customers are charged but never get an entitlement (live money bug)
**Confidence: High.** Evidence: `apps/web/src/app/api/stripe/webhook/route.ts` handles `checkout.session.completed` and *only* proceeds when `session.payment_status === 'paid'`; `payment_status === 'unpaid'` logs a warn and returns 200 with no entitlement. There is **no** handler for `checkout.session.async_payment_succeeded` or `…async_payment_failed`. CLAUDE.md (line ~122 and the `entitlements` schema note) already admits this and ties the fix to plan-316 CRT-R5C1-04.

**Skeptic view:** This is documented, and paid-downloads (US-P54) are an optional, off-by-default-feeling feature on a single-photographer gallery, so the blast radius is small *today*. But "documented" is not "mitigated." If Stripe is live and a customer pays via SEPA/ACH/bank-transfer/OXXO/Boleto, Stripe fires `completed` with `unpaid`, the bank clears days later, `async_payment_succeeded` fires, GalleryKit ignores it — the customer is charged and the `entitlements` row, download token, and download access never exist. That is the single worst customer-facing failure class in the system: silent money-taken-no-goods.

**Failure scenario:** Buyer purchases a $50 editorial license via SEPA. `completed/unpaid` → no entitlement. 3 days later transfer clears → `async_payment_succeeded` → ignored. Buyer's download link returns 404. Manual Stripe reconciliation + refund required, with no automated alert that it happened.

**Remediation:** (a) Until plan-316 ships, configure Stripe Checkout to **restrict payment methods to card / immediate-capture only** (`payment_method_types: ['card']`) so async methods can't be initiated — this closes the gap operationally in one line and is the honest interim posture. (b) Add the `async_payment_succeeded` handler (mirror the `completed/paid` entitlement+token path; idempotency via the existing `sessionId` UNIQUE already covers replay). (c) Handle/log `async_payment_failed`. (d) Add a regression test — the gap is currently guarded only by a CLAUDE.md sentence.

### CRT-02 — Anonymous analytics writes are unbounded; no pruning/retention job for view-event tables
**Confidence: High.** Evidence: `apps/web/src/app/actions/public.ts` records `image_views` / `topic_views` / `shared_group_views` with a per-IP in-memory limiter (`VIEW_RECORD_MAX_REQUESTS = 120`/min, bounded map capped at `VIEW_RECORD_RATE_LIMIT_MAX_KEYS = 2000`). The limit is **per-IP only**; there is no global write ceiling and no scheduled prune of these analytics tables anywhere in the repo (the hourly background job purges expired sessions, not analytics rows).

**Ops view:** A botnet of N rotating IPs each gets a fresh 120/min budget. At a few thousand IPs that is millions of analytics rows/minute, all durable INSERTs into the single MySQL writer. There is no TTL, no partition rotation, no retention sweep. Over time this grows `image_views` unbounded, degrading the analytics aggregation queries (which already carry dedicated composite indexes per migration 0021 — those indexes also bloat) and eventually the whole DB. Bot detection is `isbot()` UA-string-only (`apps/web/src/lib/analytics.ts`), trivially spoofed, and only affects whether rows are *counted* in the admin UI — bot rows are still **written**.

**Failure scenario:** Sustained low-and-slow scrape from a residential-proxy pool writes ~hundreds of GB of `image_views` over weeks; disk hygiene playbook (Docker prune) doesn't touch the DB volume; analytics dashboard queries slow from index bloat; eventual disk pressure on the DB.

**Remediation:** Add a retention/prune job (cron or the existing hourly sweep) that deletes `*_views` rows older than a configurable window (e.g. 13 months for year-in-review). Consider a global per-minute write ceiling for anonymous view-record, and/or persisting only sampled events above a threshold. Even a documented manual `DELETE … WHERE viewed_at < …` runbook entry would be an improvement over "grows forever."

---

## MEDIUM

### CRT-03 — `sharedGroups.view_count` (denormalized) silently diverges from the durable `shared_group_views` event log
**Confidence: High.** Evidence: two independent recording paths fire on the same condition (`!photoId && images.length > 0`): the **in-memory buffered** counter `bufferGroupViewCount()` inside `getSharedGroup()` (`apps/web/src/lib/data.ts` ~1266) which flushes asynchronously (5 s base interval, exponential backoff to 5 min on DB outage, 1000-entry buffer cap, drop-on-overflow), and the **durable** `recordSharedGroupView()` INSERT (`apps/web/src/app/actions/public.ts` ~392). A process kill loses the entire in-memory buffer; the event-log row survives.

**Architect view:** Maintaining two counters of the same quantity with different durability guarantees is a design smell. CLAUDE.md honestly labels `view_count` "best-effort approximate," but the system already has a durable source of truth (`COUNT(*) FROM shared_group_views WHERE bot=false`). The denormalized column will drift downward after every crash/restart and never self-heal. Anyone who reads `view_count` (admin UI, API) gets a number that is structurally an undercount of the durable log.

**Remediation:** Pick one source of truth. Either (a) derive `view_count` from the event log (a periodic reconcile job that sets `view_count = COUNT(*)`), making the buffer a pure latency optimization that self-heals; or (b) drop the denormalized column and compute on read with a cached aggregate. Document which counter is authoritative for billing-grade vs display-grade use.

### CRT-04 — No mechanism enforces the single-writer topology the whole coordination model depends on
**Confidence: High.** Evidence: process-local state that is correctness-relevant under scale-out includes the view buffer (`data.ts:12-17`, a module-level `let … Map`), the in-memory rate-limit fast-path maps, the upload tracker, the image-queue `PQueue` + enqueued/failed sets, and restore-maintenance flags. CLAUDE.md states "do not horizontally scale … unless those coordination states are moved to a shared store" — but there is **no startup guard, advisory-lock-on-boot, or config assertion** preventing a second web instance from booting.

**Ops view:** The safety of at least four subsystems rests on a sentence in a markdown file. A future operator adding a second replica behind a load balancer (the natural scaling move) gets: independent view buffers (lost increments), independent rate-limit fast-paths (per-replica 5-attempt budgets → effective brute-force budget multiplied by replica count when the DB path degrades), and two queue workers that *do* serialize via the per-image advisory lock but whose in-memory enqueued-sets disagree. Some of this is DB-lock-protected; the rate-limit and view-buffer parts are not.

**Remediation:** Acquire a MySQL advisory lock (e.g. `gallerykit_singleton_web`) on a dedicated connection at boot; refuse to start (or log a loud WARN and disable the in-memory fast-paths) if it can't be acquired. This converts a docs-only invariant into an enforced one and gives a clear signal the moment someone scales out.

### CRT-05 — HDR "honesty invariant" (admin-only until WI-09) is enforced indirectly by field-nullness, not by an explicit gate
**Confidence: Medium.** Evidence: `apps/web/src/components/color-details-section.tsx:169` derives `const isHdr = image.transfer_function === 'pq' || 'hlg'`, and the public HDR badge renders on `{isHdr && …}` at line 511 — **not** gated on `isAdmin`. It works today only because `transfer_function` / `is_hdr` are stripped from `publicSelectFields`, so for public viewers those fields arrive `null`/`undefined` and `isHdr` is coincidentally false. The same indirect pattern repeats in `lightbox-color-pip.tsx`, `info-bottom-sheet.tsx`.

**Skeptic view:** This is a load-bearing invariant ("the public never sees an HDR badge whose bytes don't fulfill it," CLAUDE.md Color/HDR section) defended by a *coincidence two layers away*. The `_PrivacySensitiveKeys` compile guard does protect the select-field layer (so a regression would fail typecheck — good), but the moment any legitimate future feature surfaces `transfer_function` publicly (e.g. a public "color science" panel), the HDR badge starts rendering on the public surface and the WI-09 honesty rule breaks **with no test catching it**, because the badge gate itself never asserted admin-ness.

**Remediation:** Gate the public HDR badge on `isAdmin && isHdr` explicitly (it's already admin-only intent), so the honesty invariant is enforced at the point of rendering rather than relying on upstream nullness. Add a test that renders `ColorDetailsSection` with `is_hdr=true` and `isAdmin=false` asserting no `.hdr-badge` in output.

### CRT-06 — Content-Security-Policy has no `wasm-unsafe-eval`; CLIP production mode will silently break under a strict CSP
**Confidence: Medium (latent — only bites if CLIP `production` is ever enabled).** Evidence: `apps/web/src/lib/content-security-policy.ts:105-117` emits `script-src 'nonce-…' 'self' [GA]` with **no** `wasm-unsafe-eval`. The CLIP stack ships `@huggingface/transformers` + `onnxruntime-node`. If inference ever runs in a context that uses the WASM backend (or any future client-side embedding/onnxruntime-web path), `WebAssembly.instantiate` on compiled modules is blocked by CSP without `'wasm-unsafe-eval'`.

**New-hire view:** Today CLIP is server-side (`onnxruntime-node`, native binding) and gated to `disabled`, so this is dormant. But it's a trap: a future engineer who flips `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` + enables production mode (or moves any embedding to the client) will hit an opaque CSP violation with no breadcrumb in the CSP file pointing at the CLIP dependency.

**Remediation:** Leave the CSP strict (correct default), but add a comment in `content-security-policy.ts` documenting that production CLIP / any onnxruntime-web usage requires conditionally appending `'wasm-unsafe-eval'`, and wire that conditional behind the same env gate so enabling production search also relaxes CSP exactly as much as needed and no more.

### CRT-07 — Test suite is ~35% source-text fixture/contract tests; high drift-detection coverage, lower behavioral coverage; only 5 e2e specs
**Confidence: High (factual composition).** Evidence: 231 test files / 1965 `it`/`test` blocks; **82 test files (35%) read source via `readFileSync`/`fs.readFile`** (the `cycleN-rpf-source-contracts`, `*-wiring`, `check-*`, touch-target audit families). Only **5 Playwright e2e specs**.

**Verifier view:** The fixture/contract tests are genuinely valuable as drift sentinels (they're why the migration journal, blur MIME, privacy fields, touch targets, and tag-names SQL can't silently regress) — credit where due. But a third of the suite asserts that *source text matches a pattern*, not that *behavior is correct*. Two risks: (1) **false confidence** — a green suite can coexist with a behavioral bug the greps don't probe (e.g. the async-payment money path in CRT-01 had no test until now); (2) **brittleness** — benign refactors (renaming a variable, reformatting) break grep-fixtures, training engineers to update fixtures reflexively, which erodes their signal. The thin e2e layer (5 specs) means whole-flow regressions (login → upload → process → view → share → purchase) are under-covered relative to the unit/fixture mass.

**Remediation:** Treat new fixture tests as a last resort; prefer a behavioral test that exercises the real function. Backfill e2e coverage for the money path and the upload→process→serve happy path. Periodically audit the `source-contract` families and retire ones whose invariant is now also covered behaviorally.

---

## LOW

### CRT-08 — Service-worker `SW_VERSION` stamp committed stale (9 commits behind HEAD)
**Confidence: High.** Evidence: `apps/web/public/sw.js` has `SW_VERSION = 'ec50158b-p7'`; HEAD is `8ccc8806`; `git log ec50158b..HEAD` = 9 commits (all CLIP). The `prebuild` hook (`scripts/build-sw.ts`) re-stamps from the git short-SHA at build time, and per the per-iteration deploy policy every push is followed by a build+deploy, so the *served* SW self-corrects. But the **committed** artifact is stale, so anyone inspecting the repo (or any environment that serves `public/sw.js` without running prebuild) gets a cache namespace that doesn't match the code. Minor, but it's a recurring footgun — the stamp is meaningful state checked into git that's allowed to drift from HEAD.
**Remediation:** Either stop committing the generated `sw.js` (gitignore it, generate at build) or add a CI check that fails if `sw.js`'s stamp != current short-SHA. Today it relies on the human remembering to run prebuild before committing.

### CRT-09 — In-memory rate-limit buckets evict oldest entries past 5000 keys (distributed-attack pressure relief)
**Confidence: Medium.** Evidence: `LOGIN_RATE_LIMIT_MAX_KEYS = 5000` with oldest-entry eviction in `bounded-map.ts`. An attacker spoofing >5000 distinct IPs/accounts evicts the oldest in-memory buckets, so the *fast-path* loses pressure on early targets. Mitigated because the **DB-backed bucket is the source of truth** (`auth-rate-limit.ts:16-18`) and is consulted every attempt — so this only degrades the in-memory optimization, not the actual limit, unless the DB is *also* unavailable. CLAUDE.md doesn't document the 5000-key cap.
**Remediation:** Document the cap and the DB-authority relationship in CLAUDE.md's rate-limit section so future readers don't mistake the in-memory map for the limit.

### CRT-10 — Share-key enumeration is throttled only per-IP (60/min); distributed enumeration is botnet-bounded
**Confidence: Medium.** Evidence: 10-char base56 keys (56^10 ≈ 3.6e17 space — strong) with per-IP `SHARE_MAX_REQUESTS = 60`/min the only anti-enumeration guard (`rate-limit.ts`); collision handling is MySQL UNIQUE + 5 retries. Sequential enumeration is infeasible; the residual is a large distributed attack, which the topology (single-writer, per-IP limit) only partially constrains. Shares have no per-share access cap or analytics-based anomaly detection. This is acceptable for a personal gallery — flagged for completeness, not alarm.
**Remediation:** None required at current threat model. If shares ever protect sensitive content, add per-share access counters + optional expiry-by-access-count.

### CRT-11 — `style-src 'unsafe-inline'` in production CSP
**Confidence: High (accepted risk).** Evidence: `content-security-policy.ts:108` ships `style-src 'self' 'unsafe-inline'`. Standard for Next.js/Tailwind inline styles and far lower-risk than script-src inline (which IS nonce-gated correctly). Flagged only so it's a conscious, documented trade-off rather than an oversight.
**Remediation:** None blocking; revisit if/when Next.js makes nonce-based style isolation ergonomic.

---

## DOC / CODE DRIFT

This codebase's CLAUDE.md is unusually accurate — most claims I spot-checked held. The drifts below are the residue.

### CRT-D1 — `serve-upload` ETag staleness on the static path is technically documented but easy to misread as universal
**Confidence: High.** CLAUDE.md (line 263) says "flipping any color-, quality-, or size-impacting admin setting invalidates cached variants **on that path** automatically." That is true **only on the serve-upload path** (locale-prefixed `/{locale}/uploads/…` + files missing from `public/`). For the *production* serving path — Next's static server delivering existing files from `public/uploads/` with a `W/"{size}-{mtime}"` ETag — flipping `avif_effort` (or any `COLOR_IMPACTING_KEYS` member) does **not** change the on-disk bytes, so the mtime+size ETag is unchanged and **stale bytes keep serving until a backfill re-encode rewrites the file**. The doc states this in the very next sentence ("On the static path, invalidation rides the mtime+size ETag: a backfill re-encode rewrites the file"), so it's not *wrong* — but the two-sentence structure invites the reader to conclude "settings flip ⇒ cache invalidated everywhere," which is false for the path that serves the overwhelming majority of real traffic.
**Remediation:** Add one explicit sentence: "Flipping a color/quality/size setting does NOT invalidate already-served static derivatives until you run a backfill; the settings-hash ETag only affects the serve-upload path." This is an operational gotcha (admin changes a setting, expects new bytes, sees old ones) worth stating bluntly.

### CRT-D2 — `image_quality_webp/avif/jpeg` are in `COLOR_IMPACTING_KEYS` but absent from the admin-tunables table
**Confidence: High.** `gallery-config-shared.ts:27-29,97-99,157-159` defines and validates `image_quality_webp` (90), `image_quality_avif` (85), `image_quality_jpeg` (90) as admin settings that change encoded bytes (and are correctly in `settings-hash.ts` `COLOR_IMPACTING_KEYS`). But CLAUDE.md's "Admin tunables (color/HDR)" table lists only the 5 color keys + chroma/effort/pixels — the three quality keys aren't in that table even though they're admin-tunable and byte-impacting. Minor completeness gap; the settings-hash docstring (line 4) and line 263 do mention them.
**Remediation:** Add `image_quality_webp/avif/jpeg` rows to the admin-tunables table for completeness, or note they're documented under the deployment/setup section.

### CRT-D3 — Stale `git status` snapshot referenced plan-328/329/330; actual committed artifacts are plan-348/349
**Confidence: High (process/hygiene, not code).** The session-start git snapshot listed untracked `plan/plan-328…330-run6-cycle1-*.md` and ~16 modified files; the working tree is now clean at `8ccc8806` with `plan-348-run6-cycle1-fixes.md` / `plan-349-run6-cycle1-deferred.md` as the run-6 artifacts. Not a code issue — but the plan directory has **60 deferred-finding files** accumulated across runs. That's a deferred-finding-hygiene smell: a 60-file deferral backlog is hard to reason about as a whole, and individual deferrals (like CRT-01's async-payment gap) can sit "tracked but unshipped" indefinitely while reading as "handled."
**Remediation:** Periodically triage `plan/*deferred*.md` — close/merge resolved ones, and surface the still-open high-impact deferrals (async payment, any other money/security items) into a single living "open risks" doc so they don't get lost in a 60-file pile.

---

## Refuted Findings (verification refuted these — recorded so they aren't re-raised next cycle)

These looked like findings during fan-out investigation but were **refuted by direct source re-check**. Documenting them prevents the next cycle from re-flagging.

1. **"`color_primaries` doc/code drift (admin-only vs public)"** — REFUTED. CLAUDE.md line 134 explicitly lists `color_primaries` as **public**, and code (`data.ts:241`, not in the `publicSelectFields` omit set, not in `_PrivacySensitiveKeys`) agrees. Doc and code are consistent. (The schema-section table calling color columns "admin-only" is a *summary* that the detailed line 134 overrides.)
2. **"`COLOR_IMPACTING_KEYS` is 5 not 9"** — REFUTED. The list is 9 keys (`settings-hash.ts:37-49`) and CLAUDE.md line 263 already says **9** (AGG-R7-08 corrected the old "5"). No drift.
3. **"Delete-during-processing orphans the original file (CRITICAL)"** — REFUTED. `deleteImage` reads `image.filename_original` (`images.ts:557-560`) before its transaction and unconditionally calls `deleteOriginalUploadFile()` (`images.ts:614`); the original is written at upload (`saveOriginalAndGetMetadata`), never in the queue. The queue's cleanup correctly handles only derivatives. The only residual orphan is a best-effort `unlink` failure, which is logged in `cleanupFailures` by design.
4. **"Process restart resets rate limit → 5-attempt bypass (MEDIUM vuln)"** — REFUTED/downgraded. The DB-backed `login` / `login_account` buckets survive restart and are the source of truth, consulted on every attempt (`auth-rate-limit.ts:16-18`, `actions/auth.ts`). The in-memory map is a fast-path fallback for DB-unavailable mode only; a post-restart slack exists only if the DB is *also* down — acceptable degraded behavior. (Captured as the documentation note CRT-09.)
5. **"CSP nonce is read but never set → ineffective script isolation"** — REFUTED. `proxy.ts:41` generates `crypto.randomUUID().replace(/-/g,'')`, sets it as `x-nonce` (line 43), and builds the CSP with it (lines 44-45). Nonce isolation is wired correctly.

---

## Multi-Perspective Notes (concerns not promoted to numbered findings)

- **Executor:** The migration runbook is executable as written — all four functions (`getAllJournalMigrations`, `prepareLegacyDatabaseIfNeeded` with hash-coverage check, `reconcileLegacySchema` mirroring all 15 color/HDR/processing columns, `runMigrations` post-condition throw) exist and match CLAUDE.md. The journal's idx 6→7 non-monotonic inversion is grandfathered, allowlisted in test, and any *new* non-monotonic entry is caught by both the monotonicity test and the silent-skip post-condition. Solid.
- **Stakeholder:** The CLIP "dark by default" honesty posture is genuinely airtight — `disabled` default (`gallery-config-shared.ts:108`), `production`→`disabled` healing unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`gallery-config.ts`), no `production` SelectItem in the admin UI, `SimilarPhotos` returns null unless production (`similar-photos.tsx:95`), and the search route 503s when not stub/production. No anonymous exposure, no embedding leak into public selects. The directive's "do not activate CLIP" concern is well-protected by the code itself.
- **Security:** Stripe webhook signature verification (`constructStripeEvent`), entitlement idempotency (sessionId SELECT + UNIQUE + insertId-disambiguated fresh-insert check), 256-bit single-use download tokens with token↔imageId binding (no IDOR), Argon2id params matching OWASP, timingSafeEqual with pre-length-check, advisory-lock-serialized admin deletes/restores/backfills — all verified correct. The security floor here is high.
- **New-hire:** The biggest onboarding hazard is the volume of indirectly-enforced invariants (CRT-05) and the static-path cache gotcha (CRT-D1) — both are the kind of thing a newcomer breaks without realizing because the enforcement is two layers away from the code they touch.

---

## The 3 Most Important Things to Fix

1. **CRT-01 — Close the async-payment money gap operationally NOW** (restrict Stripe to `payment_method_types: ['card']` until plan-316's `async_payment_succeeded` handler ships). It is the only path where a customer can be charged and receive nothing, and it is currently guarded by a doc sentence, not code.
2. **CRT-02 — Add a retention/prune job for the `*_views` analytics tables and a global anonymous-write ceiling.** Unbounded durable writes from per-IP-only-limited anonymous endpoints are a slow-burn DB-growth and index-bloat outage waiting on the single writer.
3. **CRT-05 — Gate the public HDR badge on `isAdmin` explicitly (+ a test), and add the CRT-D1 static-path-cache sentence to CLAUDE.md.** The HDR honesty invariant and the ETag freshness story are both currently enforced/explained indirectly; making them explicit converts two future-refactor traps into asserted, documented contracts.
