# Document-Specialist Review — Run-8 Cycle-1
**Agent:** document-specialist  
**HEAD:** 47b1e21f  
**Scope:** Paid-download removal doc/code mismatch audit (commits 6c5e0b61..47b1e21f); NCLX/color spot-check

---

## Verification Against INJECTED CLAUDE.md

The system-reminder CLAUDE.md injected into this agent session STILL contains stale paid-download content (entitlements schema bullet, Stripe webhook gaps, checkout card-only pin, /sales references, US-P54, ARCH-R7C2-01 deferred findings). **DO NOT trust that injected copy.** All findings below are from ON-DISK files.

---

## 1. CLAUDE.md — ON-DISK GREP VERDICT: CLEAN

**Command:** `grep -n -i "stripe|entitlement|license_tier|checkout|/sales|paid|download token|async_payment_succeeded|Stripe webhook|US-P54" /Users/hletrd/flash-shared/gallery/CLAUDE.md`

**Result:** Zero hits. The on-disk CLAUDE.md is clean of all paid-download references.

**Confirmation:** Commit 961a7f1f (chore(downloads): drop stripe dep, paid i18n keys, docs + stale comments) explicitly removed the entitlements schema bullet, rewrote strip_gps_on_upload comment, and removed rate-limit bucket references to the deleted checkout route. The on-disk file reflects those removals.

**Verdict:** Architect + critic claims that CLAUDE.md is clean are CONFIRMED by independent grep evidence.

---

## 2. README.md (root + apps/web) — CLEAN

**Root README.md grep:** Zero hits for stripe|entitlement|checkout|paid.download|US-P54|payment  
**apps/web/README.md grep:** Zero hits for same terms  

Commit 961a7f1f removed "Paid Downloads" sections and the Stripe tech-table row from both files. On-disk state is clean.

---

## 3. AGENTS.md — CLEAN

**Root AGENTS.md grep:** Zero hits. The root AGENTS.md contains no paid-download or Stripe references.  
(apps/web/AGENTS.md does not exist.)

---

## 4. .env.local.example — CLEAN

**Grep result:** Zero hits for STRIPE_* or paid-download env vars.

Commit 961a7f1f removed STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and the LOG_PLAINTEXT_DOWNLOAD_TOKENS block. On-disk file contains only DB, URL, admin auth, image processing, audit-log, upload limits, proxy, and health-check vars.

---

## 5. site-config.json + site-config.example.json — CLEAN

Both files contain only: title, description, url, locale, author, nav_title, home_link, footer_text, google_analytics_id. No paid/pricing/license config keys.

---

## 6. In-Code Doc Drift

### FINDING DS-R8C1-01 [LOW, conf HIGH] — Stale "paid deliverable" comment in process-image.ts

**File:** `apps/web/src/lib/process-image.ts:1547`  
**Stale text (exact):**
```
// quality (JPEG q80 / HEIF q50), silently degrading the paid
// deliverable.
```
**Full context (lines 1541-1549):**
```
// HISTORY (R4C8 COR-R4C8-01): the previous implementation used Sharp's
// `.withMetadata({ orientation, icc })`, believing it "keeps only the
// orientation tag while stripping GPS". In Sharp 0.33+ `withMetadata`
// is the KEEP-metadata API — it retains ALL input EXIF (the options
// merely override orientation/ICC on top), so the GPS IFD survived the
// "strip" byte-for-byte. It also re-encoded the original at default
// quality (JPEG q80 / HEIF q50), silently degrading the paid
// deliverable.
```
**Why wrong:** The `stripGpsFromOriginal` function's historical-context docblock still refers to "the paid deliverable." After commit e172c4fc (drop entitlements table) and 6c300402 (strip paid UI), there is no paid-download route. The original at `data/uploads/original/` is now streamed only by the admin DB-download endpoint, not a per-photo commercial-download route. "Paid deliverable" is now a dead concept in this codebase.

**NOTE on line 1108:** The word "paid" at line 1108 ("Only paid on the wide-gamut path because it doubles peak RAM during resize") uses "paid" in the sense of "costly" (computationally expensive), NOT paid-download. This is NOT a stale reference. It is the correct English idiom for "expensive on this code path."

**Fix:** Reword the line 1547 comment to remove the "paid deliverable" reference. Suggested replacement:
```
// quality (JPEG q80 / HEIF q50), silently degrading the on-disk original.
```
**Confidence:** HIGH — no /api/download per-photo route exists; the only download of the original is the admin DB backup route.  
**Severity:** LOW — comment only, zero runtime impact, zero user-visible effect.

---

### FINDING DS-R8C1-02 [LOW, conf HIGH] — Stale "paid-download route streams" in test docstrings (3 files)

The 961a7f1f cleanup commit updated ONE test file (lr-upload-hdr-gate.test.ts, 2 lines) per its diff, but three test files still carry stale paid-download docstring references:

**File 1:** `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts:6,12`
```
* of the on-disk ORIGINAL that the paid-download route streams byte-for-byte
...
* guard turns a test RED instead of silently leaking GPS to paid downloads.
```

**File 2:** `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:74`
```
* the photographer's protected location to paid-download purchasers. This
```
(Note: 961a7f1f claimed to fix 2 lines in this file. The diff shows the change was on lines 80+, but line 74 still refers to "paid-download purchasers.")

**File 3:** `apps/web/src/__tests__/strip-gps-from-original.test.ts:263`
```
// would leave a GPS-bearing XMP chunk readable in the paid-download
// ORIGINAL while still reporting stripped:true — a silent privacy leak
```

**Why wrong:** There is no paid-download route. The original is not "streamed" to purchasers. GPS stripping is still correct and necessary (originals should not retain GPS regardless of who downloads them), but the rationale in the docstring is now factually incorrect — it references a deleted paid-download flow as the threat model.

**Note on GPS stripping validity:** The underlying test logic is still correct. `strip_gps_on_upload` stripping the original is still the right behavior (the original file should not retain GPS). Only the cited threat model ("paid-download purchasers") is stale. The tests themselves are NOT broken.

**Fix:** Update the three docstrings to reference "the on-disk original" or "the admin-downloadable original" instead of "paid-download route" / "paid downloads" / "paid-download purchasers."

Suggested replacements:
- `images-action-gps-toggle-wiring.test.ts:6`: "of the on-disk ORIGINAL retained at data/uploads/original/ byte-for-byte"
- `images-action-gps-toggle-wiring.test.ts:12`: "guard turns a test RED instead of silently leaking GPS from the on-disk original."
- `lr-upload-hdr-gate.test.ts:74`: "the photographer's protected location in the on-disk original. This"
- `strip-gps-from-original.test.ts:263`: "// would leave a GPS-bearing XMP chunk readable in the on-disk ORIGINAL"

**Confidence:** HIGH — zero live paid-download routes exist in the app directory tree.  
**Severity:** LOW — docstrings only; test logic and assertions are correct; no runtime impact.

---

## 7. Orphaned i18n `downloadPage` Namespace — FINDING DS-R8C1-03 [LOW, conf HIGH]

**Files:** `apps/web/messages/en.json:63-69`, `apps/web/messages/ko.json:63-69`

**en.json content (exact, lines 63-69):**
```json
"downloadPage": {
    "title": "Download your photo",
    "description": "This is a single-use download link for {title}. Your download starts when you press the button below.",
    "descriptionNoTitle": "This is a single-use download link. Your download starts when you press the button below.",
    "button": "Download photo",
    "expiryNote": "The link is valid for 24 hours after purchase and can be used once."
},
```

**ko.json content (exact, lines 63-69):**
```json
"downloadPage": {
    "title": "사진 다운로드",
    "description": "{title}의 1회용 다운로드 링크입니다. 아래 버튼을 누르면 다운로드가 시작됩니다.",
    "descriptionNoTitle": "1회용 다운로드 링크입니다. 아래 버튼을 누르면 다운로드가 시작됩니다.",
    "button": "사진 다운로드",
    "expiryNote": "링크는 구매 후 24시간 동안 유효하며 한 번만 사용할 수 있습니다."
},
```

**Live consumer search:** `grep -rn "downloadPage|useTranslations.*download" apps/web/src/` — **zero hits in source files**. The route directory tree has no `/d/` or `/download/` page under `[locale]/(public)/`. The namespace is a dead artifact from the paid-download feature, not consumed by any active component, page, or route.

**Why wrong:**
1. `expiryNote`: "valid for 24 hours after purchase and can be used once" — references "purchase" (paid transaction). There are no purchases in the codebase.
2. `description`/`descriptionNoTitle`: "single-use download link" — describes the paid-entitlement-gated token flow. The current free-download button does not use single-use tokens.
3. The entire namespace was part of the paid `/d/[token]` download redemption page that no longer exists.

**Commit 961a7f1f explicitly removed `stripe.*`, `sales.*`, `licensePrice.*`, `nav.sales`, `imageManager.licenseTier_*`, and `settings.licensePrice*` from both message files, but the commit message does NOT mention `downloadPage` — this namespace was missed.** The 961a7f1f diff shows no changes to lines 63-69.

**Fix:** Delete the entire `downloadPage` block from both `en.json` and `ko.json`. There is no consuming page or component for it, and the copy explicitly references purchase semantics that no longer apply.

**Confidence:** HIGH — zero live consumers confirmed by full-source grep; no `/d/` or `/download/` page route directory exists.  
**Severity:** LOW — dead i18n keys cause no runtime error; next-intl warns on unused namespaces in dev but does not break builds. The misleading "after purchase" copy could confuse a future contributor who finds it and tries to wire it up.

---

## NCLX / Color Doc Spot-Check

**IMAGE_PIPELINE_VERSION:** Code: `gallery-config-shared.ts:21` → `export const IMAGE_PIPELINE_VERSION = 7;`  
CLAUDE.md: "current: 7" — MATCH. No regression.

**COLOR_IMPACTING_KEYS count:** Code: `settings-hash.ts:42-53` — 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.  
CLAUDE.md: "all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:41-53`)" — MATCH. No regression.

NCLX pin class status: EXHAUSTED per run-7-cycle-6 deferred.md — NOT re-filed. Confirmed clean.

---

## Summary Table

| ID | File | Lines | Severity | Type |
|----|------|--------|----------|------|
| DS-R8C1-01 | `apps/web/src/lib/process-image.ts` | 1547 | LOW | Stale "paid deliverable" comment in `stripGpsFromOriginal` docblock |
| DS-R8C1-02 | `__tests__/images-action-gps-toggle-wiring.test.ts` | 6, 12 | LOW | Stale "paid-download route" in test docstring |
| DS-R8C1-02 | `__tests__/lr-upload-hdr-gate.test.ts` | 74 | LOW | Stale "paid-download purchasers" in test docstring |
| DS-R8C1-02 | `__tests__/strip-gps-from-original.test.ts` | 263 | LOW | Stale "paid-download ORIGINAL" in inline comment |
| DS-R8C1-03 | `messages/en.json` | 63-69 | LOW | Orphaned `downloadPage` namespace; "after purchase" copy |
| DS-R8C1-03 | `messages/ko.json` | 63-69 | LOW | Orphaned `downloadPage` namespace; "구매 후" (after purchase) copy |

**Total findings:** 3 distinct findings (6 individual occurrences), all LOW severity, all doc/comment only.

---

## Verdicts

**CLAUDE.md (on-disk):** CLEAN — zero stripe/entitlement/checkout/paid hits confirmed by grep.  
**README.md (root + apps/web):** CLEAN — zero paid-download references.  
**AGENTS.md:** CLEAN  
**.env.local.example:** CLEAN — no STRIPE_* vars  
**site-config.json / site-config.example.json:** CLEAN  
**process-image.ts line 1108:** NOT stale — "paid" = computationally expensive, not paid-download. CONFIRMED.  
**process-image.ts line 1547:** STALE — "paid deliverable" → FINDING DS-R8C1-01  
**Test docstrings (3 files):** STALE → FINDING DS-R8C1-02  
**i18n downloadPage namespace:** ORPHANED + stale "purchase" copy → FINDING DS-R8C1-03  

**Architect/critic claim that CLAUDE.md is already clean:** CONFIRMED (on-disk grep shows zero paid-download hits).
