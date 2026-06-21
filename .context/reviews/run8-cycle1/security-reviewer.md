# Security Review Report — Run-8 Cycle-1 (Stripe paid-download removal)

**Reviewer:** security-reviewer
**Repo:** /Users/hletrd/flash-shared/gallery
**HEAD:** 47b1e21f
**Scope:** Security implications of the Stripe paid-download feature removal (commits `6c5e0b61..47b1e21f`) + standard OWASP sweep on the live surface, focused on what the removal changed. Run-7 converged with ZERO findings; this cycle re-audits only the delta plus carried residual RES-R7C6-01 reachability.

**Risk Level:** LOW

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- Informational / disposition changes: 1 (RES-R7C6-01 reachability **CLOSED** by the removal — a privacy-positive downgrade, not a new finding)

**Verdict: the Stripe removal is surgically clean and introduces NO new security surface. It strictly REDUCES attack surface (3 public/admin routes + 4 libs deleted) and CLOSES the only public consumer of the on-disk original, which downgrades the carried RES-R7C6-01 HEIC GPS residual from "privacy-relevant residual (paid-download leak path)" to "unreachable / no public consumer."** All 3 security lint gates, full typecheck (app + scripts), and the privacy/tag-name contract tests pass. `npm audit --omit=dev` shows the same 2 documented moderate `postcss`-via-`next` (build-time only) — unchanged from run-7, NOT escalated.

---

## Special-focus findings (the 5 directed checks)

### 1. Free download exposes NO new surface — CONFIRMED CLEAN (High confidence)
- The deleted `api/download/[imageId]` token-gated route is gone. The free download is now a plain `<a href download>` in `photo-viewer.tsx:176-177` and `info-bottom-sheet.tsx:154-155`, pointing at:
  - `imageUrl('/uploads/jpeg/${image.filename_jpeg}')`
  - `imageUrl('/uploads/avif/${image.filename_avif}')`
- These are PUBLIC derivative paths that the gallery already serves for every thumbnail and lightbox image — the same `/uploads/{jpeg,avif}/` namespace served by Next static / `serve-upload.ts` / nginx. **No path the browser couldn't already reach.**
- **Does removing the token-gated route expose any previously-paid-only original?** NO. The download route streamed the on-disk **original** (`data/uploads/original/...`), a DIFFERENT namespace. The free anchors point at the size-laddered public derivatives, never `original/`.
- **Original-directory exclusion is intact at BOTH layers (defense in depth, unchanged):**
  - App layer: `serve-upload.ts:15` — `ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif'])`; `original` is NOT a member, and per-dir extension allowlist (`serve-upload.ts:94-96`) further constrains.
  - Edge layer: `nginx/default.conf:163` — `location ^~ /uploads/original/ { return 404; }` (the `^~` longest-prefix-match wins over the regex static location), and the static-serve location `:170` is regex-restricted to `(jpeg|webp|avif)` extensions only.
- **License-tier gating was the ONLY thing removed from the button** — it was previously hidden when `license_tier != 'none'`; now unconditional. Since `license_tier` was already a PUBLIC field and the derivatives were always publicly reachable, making the button unconditional changes UX, not the security boundary.

### 2. Rate-limit removal is coherent — CONFIRMED CLEAN (High confidence)
- `rate-limit.ts` cleanly removed `CHECKOUT_*` constants + `checkoutRateLimit` map + `pruneCheckoutRateLimit` / `preIncrementCheckoutAttempt` / `rollbackCheckoutAttempt` / `resetCheckoutRateLimitForTests` (commit `6c300402`). These were only ever called by the deleted `api/checkout/[imageId]` route.
- **Docstring coherence verified:** `grep -ni "checkout|stripe|for sale|unpriced" src/lib/rate-limit.ts` → EMPTY. The surviving Pattern-2 docstring was correctly edited to drop the checkout/Stripe-budget references and now reads coherently for the semantic-only case.
- **No remaining public mutating route lost required rate limiting.** `npm run lint:public-route-rate-limit` → PASS. The only surviving mutating public handler (`api/search/semantic/route.ts` POST) still imports + calls `preIncrementSemanticAttempt` / `rollbackSemanticAttempt` (`route.ts:37-38, 209`). All other public route files have no mutating handlers. The `check-public-route-rate-limit.test.ts` fixture was correctly repointed from `preIncrementCheckoutAttempt` to the surviving `preIncrementShareAttempt`.

### 3. RES-R7C6-01 (HEIC anomaly GPS-strip fall-through) — REACHABILITY CLOSED by the removal (High confidence)
**This is the highest-signal result of the cycle — a privacy-positive disposition change, NOT a new finding.**
- The carried residual's exploit narrative depended ENTIRELY on one consumer: *"the on-disk original retains GPS, which the **paid-download route streams**."* (deferred.md RES-R7C6-01.)
- The paid-download route (`api/download/[imageId]`) was the SOLE path that streamed the on-disk original to a public consumer. It is now DELETED.
- **Full consumer audit of `data/uploads/original/` post-removal** (`grep` over `src/app/api` + `serve-upload.ts` + all callers of `stripGpsFromOriginal` / `resolveOriginalUploadPath` / `UPLOAD_DIR_ORIGINAL`):
  | Consumer | Disposition |
  |---|---|
  | `images.ts:315` / `lr-upload:324` `stripGpsFromOriginal()` | WRITE-time strip (admin upload) — not a public read |
  | `image-queue.ts` / `admin-backfill-runner.ts` | internal decode for derivative encoding — never streamed |
  | `embeddings.ts:133` `embedImageReal(originalPath)` | internal CLIP read — never streamed |
  | `images.ts:618/751` `deleteOriginalUploadFile` | delete — not a read |
  | **(deleted) `api/download/[imageId]`** | **GONE — was the only public stream of the original** |
- **No remaining code path returns the on-disk original to a public HTTP response.** The original is now exclusively a private processing input + a deletable artifact.
- **`gps-exif-strip.ts` and `process-image.ts` changes in the removal were COMMENT-ONLY** (verified: every `+`/`-` line in `git show 961a7f1f` for both files is inside a `//` or `/* */` comment — rewording "paid-download deliverable" → "stored original"). The functional GPS-strip logic (including the anomalous-HEIC fall-through at `process-image.ts:1633`) is byte-identical.
- **Net effect on RES-R7C6-01:** the underlying file-level behavior is unchanged (an anomalous HEIC can still retain GPS at rest on disk against `strip_gps_on_upload` intent — a defense-in-depth / data-at-rest concern), BUT there is no longer ANY public consumer that would deliver that GPS to an external party. The DB columns are still nulled before the strip (`images.ts`), so the gallery UI / public API / Atom feed never leaked GPS regardless. **The residual's privacy-LEAK reachability is CLOSED.** The remaining concern collapses to "admin's strip-on-upload intent isn't byte-perfectly honored on one container family for the file at rest" — a hardening nit on a now-internal-only file, not a privacy-leak path. The exit criteria in deferred.md (a confirming probe escalating to HIGH/CRITICAL on the paid-download path) are now MOOT for the leak vector.
- **Recommendation:** the next planning pass should formally retire/close RES-R7C6-01 as a privacy-LEAK residual (the leak vector no longer exists), optionally re-classify the at-rest byte-fidelity concern as a standalone INFO hardening item if anyone still wants the anomalous-HEIC branch to zero the Exif item. Do NOT re-open it at its prior severity — the route that gave it severity is gone.

### 4. OWASP sweep on the live surface — CONFIRMED CLEAN (no removal-induced regressions)
Items NOT re-litigated (confirmed-clean in run-7, untouched by the removal): Argon2id KDF params, HMAC-SHA256 session + `timingSafeEqual`, cookie attributes, login rate-limit two-bucket, PAT auth, upload path-traversal (`SAFE_SEGMENT` + whitelist + containment), symlink rejection, CSV formula/bidi/zero-width escapes, sanitizers, Drizzle parameterization, the `_PrivacySensitiveKeys` / `publicSelectFields` compile-time guards.
Removal-delta checks (all PASS):
- `npm run lint:api-auth` → PASS (both surviving admin routes wrap `withAdminAuth`).
- `npm run lint:action-origin` → PASS (all mutating server actions enforce `requireSameOriginAdmin()`; the deleted `sales.ts` action is gone, no dangling scanner target).
- `npm run lint:public-route-rate-limit` → PASS (see #2).
- `npm run typecheck` → PASS (app + scripts), confirming no dangling `license_tier` / `licensePrices` / `checkoutStatus` type references after the prop removals.
- `npm audit --omit=dev` → 2 moderate (`postcss <8.5.10` XSS via `next`, GHSA-qx2v-qp2m-jg93). **Build-time-only, transitive via `next`, the documented run-7 pair. Fix requires `next@9.3.3` downgrade (a breaking regression, worse than the advisory). NOT escalated, NOT a new finding — unchanged from run-7.**

### 5. Privacy-guard / `_PrivacySensitiveKeys` / `publicSelectFields` contract — CONFIRMED CLEAN, NO half-removed sensitive remnant (High confidence)
- `license_tier` was a **PUBLIC** field (it drove the buy/download button; `data.ts` comment "US-P54: license_tier is PUBLIC"). It was correctly removed from `adminSelectFields` in `data.ts` AND from `ImageDetail` in `image-types.ts`. Because it was public, it was NEVER in `PrivacySensitiveKeys` / `SENSITIVE_KEYS` — so its removal required no privacy-guard edit, and none was needed.
- `PrivacySensitiveKeys` (`data.ts:414`) is unchanged and internally consistent; `privacy-fields.test.ts` (the `SENSITIVE_KEYS` symmetric contract: admin-only keys === SENSITIVE_KEYS exactly) → **PASS (17/17 with data-tag-names)**.
- **No half-removed sensitive remnant exists:** `grep` over live `src/` (excluding the legit `download-filename`/`downloadHref` helpers for the free button) for `license_tier|licenseTier|entitlement|downloadToken|checkout|stripe|Stripe|licensePrice|LICENSE_TIER` → EMPTY. `schema.ts`, `gallery-config(-shared).ts`, `photo-viewer.tsx`, `info-bottom-sheet.tsx` all clean.
- DB schema: `entitlements` table + `images.license_tier` column dropped via migration 0023 + `reconcileLegacySchema` (commit `47b1e21f` correctly closes the baselined-not-executed gap by adding idempotent `dropTableIfPresent`/`dropColumnIfPresent` to the legacy-reconcile path — without it, an existing prod DB would baseline 0023's hash WITHOUT running its DROP SQL and the objects would survive). Journal monotonic-`when` invariant verified (0023 `when=1782000000000` > prior max `1781687094232`). The dropped `entitlements` table carried `customerEmail` (PII) + `downloadTokenHash` (secret) — removing the table eliminates that PII/secret store entirely (net privacy gain).

---

## Security Checklist
- [x] No hardcoded secrets introduced (removal only deletes `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `LOG_PLAINTEXT_DOWNLOAD_TOKENS` from `.env.local.example` — no new secrets)
- [x] All public mutating inputs still rate-limited (lint:public-route-rate-limit PASS)
- [x] Injection prevention unaffected (no query surface added; migration 0023 is static DDL)
- [x] Authentication/authorization unaffected (lint:api-auth + lint:action-origin PASS; surviving admin routes still `withAdminAuth`)
- [x] Dependencies audited (`npm audit --omit=dev` = 2 documented build-time moderates, unchanged, not escalated; `stripe` dep removed = one fewer prod dependency + its supply-chain surface)
- [x] Original/private-store exclusion intact at app + edge (ALLOWED_UPLOAD_DIRS + nginx `return 404`)
- [x] Privacy guards intact (`_PrivacySensitiveKeys` / `publicSelectFields` / privacy-fields test PASS; no half-removed sensitive key)
- [x] RES-R7C6-01 reachability re-assessed (CLOSED — no public consumer of the original remains)

## Carried items — re-confirmed, NOT re-filed
Per the directive, the following are NOT re-litigated and NOT re-filed: MED-R7C2-01 (refuted), REJ-R7C3-01 (`indexSize`, disproved), the NCLX matrix/transfer pin class (exhausted). The Stripe-specific deferrals (ARCH-R7C2-01 `charge.refunded`, TE-R7C2-02 webhook behavioral coverage) are now **MOOT** — their target route is deleted; they should be struck from the deferred register rather than carried.
